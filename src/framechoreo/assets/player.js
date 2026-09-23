/* Standalone player: recorded values only, never evaluates Python or makes requests. */
(function startPlayer(preparedData) {
  "use strict";
  const root = document.getElementById("framechoreo-player");
  const dataNode = document.getElementById("framechoreo-data");
  let language = document.documentElement.lang === "ja" ? "ja" : "en";
  const tx = (en, ja) => (language === "ja" ? ja : en);
  if (dataNode.dataset.encoding === "gzip-base64" && preparedData === undefined) {
    root.textContent = tx("Opening story…", "ストーリーを開いています…");
    root.setAttribute("aria-busy", "true");
    (async () => {
      if (typeof DecompressionStream !== "function")
        throw new Error("Use a current browser, or ask the author for an uncompressed export.");
      const expected = Number(dataNode.dataset.jsonBytes);
      if (!Number.isSafeInteger(expected) || expected < 1) throw new Error("Invalid story size");
      const bytes = Uint8Array.from(atob(dataNode.textContent), (c) => c.charCodeAt(0));
      dataNode.textContent = "";
      const reader = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"))
        .getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true }),
        chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > expected) {
          await reader.cancel();
          throw new Error("Story exceeds its recorded size");
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      if (size !== expected) throw new Error("Incomplete compressed story");
      chunks.push(decoder.decode());
      const data = JSON.parse(chunks.join(""));
      root.removeAttribute("aria-busy");
      root.replaceChildren();
      startPlayer(data);
    })().catch((error) => {
      root.removeAttribute("aria-busy");
      root.textContent =
        tx("Could not open this story: ", "ストーリーを開けませんでした: ") + error.message;
      root.dataset.ready = "error";
    });
    return;
  }
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const button = (label, action, cls = "button") => {
    const b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", action);
    return b;
  };
  const count = (number, noun) =>
    language === "ja"
      ? number +
        ({
          row: "行",
          column: "列",
          "input row": "入力行",
          "output row": "出力行",
          character: "文字",
        }[noun] || noun)
      : number + " " + noun + (number === 1 ? "" : "s");
  const blankKind = (cell) =>
    cell.type === "string" && !cell.display.trim()
      ? cell.display.length
        ? "whitespace"
        : "empty"
      : null;
  const displayValue = (cell) =>
    cell.type === "string" &&
    (blankKind(cell) ||
      cell.display !== cell.display.trim() ||
      /[\r\n\t\u2028\u2029]/.test(cell.display))
      ? JSON.stringify(cell.display)
          .replace(/\u2028/g, "\\u2028")
          .replace(/\u2029/g, "\\u2029")
      : cell.display;
  const typeDescription = (cell) =>
    blankKind(cell) === "empty"
      ? tx("empty string", "空文字")
      : blankKind(cell) === "whitespace"
        ? tx("whitespace-only string (", "空白だけの文字列（") +
          count([...cell.display].length, "character") +
          ")"
        : language === "ja"
          ? {
              string: "文字列",
              integer: "整数",
              float: "浮動小数点数",
              decimal: "小数 (Decimal)",
              boolean: "真偽値",
              missing: "欠損",
              datetime: "日付・時刻",
              duration: "期間",
            }[cell.type] || cell.type
          : cell.type;
  try {
    const data = preparedData === undefined ? JSON.parse(dataNode.textContent) : preparedData;
    dataNode.textContent = "";
    const model = globalThis.FrameChoreoModel,
      steps = model.indexStory(data),
      scenes = model.scenes(data, steps);
    language = data.language || "en";
    document.documentElement.lang = language;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const state = {
      index: 0,
      playing: false,
      speed: 1,
      all: false,
      tablePage: 0,
      selection: null,
      selectionLocation: null,
      inspection: null,
      returnAll: false,
      returnPage: 0,
      returnView: null,
      originOffset: 0n,
      reduceMotion: false,
    };
    let timer = null,
      deadline = 0,
      remainingHold = null,
      lastKey = null,
      lastIndex = null,
      lastViewportKey = null,
      animationNodes = [],
      rowAnimations = [],
      replaying = false;
    const orderedCache = new Map(),
      groupMapCache = new Map();
    function orderedRows(scene) {
      const key = scene.step.id + ":" + scene.kind;
      if (!orderedCache.has(key)) orderedCache.set(key, model.orderedRows(scene));
      return orderedCache.get(key);
    }
    const brand = el("div", "brand", "FRAMECHOREO");
    const title = el("h1", "", data.title);
    root.append(brand, title);
    const toolbar = el("div", "toolbar");
    const play = button(
      tx("▶ Play", "▶ 再生"),
      () =>
        state.playing || rowAnimations.some((a) => a.playState === "running") ? stop() : start(),
      "button primary",
    );
    const prev = button(tx("← Previous", "← 前へ"), () => go(state.index - 1));
    const next = button(tx("Next →", "次へ →"), () => go(state.index + 1));
    const speed = el("label", "speed", tx("Speed ", "速度 ")),
      speedSelect = el("select");
    for (const value of [0.5, 1, 2]) {
      const option = el("option", "", value + "×");
      option.value = value;
      option.selected = value === 1;
      speedSelect.append(option);
    }
    speedSelect.addEventListener("change", () => {
      const wasPlaying = state.playing;
      if (wasPlaying) stop();
      state.speed = Number(speedSelect.value);
      rowAnimations.forEach((animation) => animation.updatePlaybackRate(state.speed));
      if (wasPlaying) start();
    });
    speed.append(speedSelect);
    const motionLabel = el("label", "motion-toggle"),
      motionCheckbox = el("input");
    motionCheckbox.type = "checkbox";
    motionCheckbox.checked = state.reduceMotion || reduced.matches;
    motionCheckbox.disabled = reduced.matches;
    motionCheckbox.addEventListener("change", () => {
      state.reduceMotion = motionCheckbox.checked;
      stop();
      lastKey = null;
      render();
    });
    motionLabel.append(motionCheckbox, el("span", "", tx("Reduce motion", "動きを減らす")));
    toolbar.append(play, prev, next, el("span", "spacer"), motionLabel, speed);
    root.append(toolbar);
    const nav = el("nav", "timeline");
    nav.setAttribute("aria-label", tx("Transformation steps", "分析の工程"));
    root.append(nav);
    let currentChapter = null;
    const chapterButtons = scenes.map((scene, i) => {
      const names = {
        source: "Input",
        filter: "Filter",
        filter_by: "Decision filter",
        merge: "Join",
        group: "Group",
        sum: "Sum",
        mean: "Mean",
        count: "Count",
        sort: "Sort",
        select: "Columns",
        rename: "Rename",
        calculate: "Calculate",
        case_when: "Choose",
        coalesce: "Fallback",
        window: "Window",
        drop_missing: "Drop missing",
        fill_missing: "Fill missing",
        drop_duplicates: "Deduplicate",
        take: "Take",
        astype: "Types",
        to_numeric: "Numbers",
        to_datetime: "Dates",
        string_transform: "Text",
        concat: "Combine",
        melt: "Melt",
        pivot: "Pivot",
        aggregate: "Summarize",
        group_transform: "Group metric",
      };
      const japanese = {
        source: "入力",
        filter: "抽出",
        filter_by: "条件で抽出",
        merge: "結合",
        group: "グループ",
        sum: "合計",
        mean: "平均",
        count: "件数",
        sort: "並べ替え",
        select: "列を選ぶ",
        rename: "名前を変える",
        calculate: "計算",
        case_when: "条件で選ぶ",
        coalesce: "最初の値を選ぶ",
        window: "窓計算",
        drop_missing: "欠損行を除く",
        fill_missing: "欠損を補う",
        drop_duplicates: "重複を除く",
        take: "行を選ぶ",
        astype: "型を変える",
        to_numeric: "数値に変換",
        to_datetime: "日付に変換",
        string_transform: "文字を整える",
        concat: "縦につなぐ",
        melt: "縦長にする",
        pivot: "横長にする",
        aggregate: "複数指標の集計",
        group_transform: "各行にグループ指標",
      };
      if (language === "ja") Object.assign(names, japanese);
      const chapter = scene.step.presentation?.chapter;
      if (chapter && chapter !== currentChapter) {
        currentChapter = chapter;
        nav.append(el("div", "chapter-label", chapter));
      }
      const b = button(i + 1 + " · " + (names[scene.kind] || scene.kind), () => go(i), "chapter");
      b.dataset.operation = scene.step.operation;
      b.dataset.kind = scene.kind;
      b.dataset.scene = String(i);
      const name =
        scene.kind === "group"
          ? tx("Form the groups", "グループを作る")
          : model.tableLabel(data, scene.step);
      b.replaceChildren(el("span", "chapter-index", i + 1));
      const copy = el("span", "chapter-copy");
      copy.append(
        el("span", "chapter-name", name),
        el(
          "small",
          "chapter-meta",
          (names[scene.kind] || scene.kind) + " · " + count(scene.table.rows.length, "row"),
        ),
      );
      b.append(copy);
      nav.append(b);
      return b;
    });
    const shell = el("section", "stage-shell");
    root.append(shell);
    const heading = el("div", "stage-heading"),
      info = el("div", "stage-info");
    const operation = el("span", "operation"),
      caption = el("h2"),
      counter = el("span", "counter");
    counter.setAttribute("aria-live", "polite");
    caption.tabIndex = -1;
    info.append(operation, caption);
    const meta = el("div", "stage-meta"),
      replay = button(
        tx("↻ Replay the movement", "↻ 移動をもう一度見る"),
        replayMotion,
        "text-button replay-button",
      );
    replay.dataset.action = "replay-motion";
    meta.append(counter, replay);
    heading.append(info, meta);
    shell.append(heading);
    const code = el("div", "code"),
      codeDisclosure = el("details", "operation-code");
    codeDisclosure.append(el("summary", "", tx("Python operation", "処理の内容")), code);
    codeDisclosure.addEventListener("toggle", settleAnimations);
    shell.append(codeDisclosure);
    const body = el("div", "stage-body");
    shell.append(body);
    const notice = el("div", "notice");
    notice.setAttribute("aria-live", "polite");
    body.append(notice);
    const legend = el("div", "legend");
    body.append(legend);
    const decisionAudit = el("section", "decision-audit");
    decisionAudit.hidden = true;
    body.append(decisionAudit);
    const motionStatus = el("div", "motion-status");
    body.append(motionStatus);
    const backToStep = button(
      tx("← Back to the transformation", "← 加工の表示に戻る"),
      () => {
        state.inspection = null;
        state.all = state.returnAll;
        state.tablePage = state.returnPage;
        workbench.restore(state.returnView);
        lastKey = null;
        render();
        reveal(caption);
      },
      "text-button",
    );
    backToStep.hidden = true;
    body.append(backToStep);
    const dataStage = el("div", "data-stage"),
      reference = el("div", "reference-area");
    body.append(dataStage);
    dataStage.append(reference);
    const scroll = el("div", "table-scroll");
    dataStage.append(scroll);
    const table = el("div");
    table.setAttribute("role", "table");
    table.setAttribute("aria-label", tx("Recorded values", "記録した値"));
    scroll.append(table);
    const columnHead = el("div", "column-head");
    columnHead.setAttribute("role", "row");
    const board = el("div", "board");
    board.setAttribute("role", "rowgroup");
    table.append(columnHead, board);
    const limitInfo = el("div", "row-limit");
    body.append(limitInfo);
    const inspector = el("section", "inspector");
    inspector.setAttribute("aria-label", tx("Value origins", "値の入力元"));
    inspector.tabIndex = -1;
    root.append(inspector);
    const inspectorHead = el("div", "inspector-head", tx("SELECT A VALUE", "値を選んでください")),
      selectedValue = el(
        "div",
        "selected-value",
        tx(
          "Select any cell to trace its value inputs.",
          "セルを選ぶと、その値の入力元を確認できます。",
        ),
      );
    inspectorHead.id = "framechoreo-selected-cell";
    inspector.setAttribute("aria-describedby", inspectorHead.id);
    const selectedType = el("div", "value-type");
    const columnDtype = el("div", "value-type column-dtype");
    const selectionLegend = el("div", "value-type selection-legend");
    const lineagePath = el("div", "lineage-path");
    lineagePath.setAttribute(
      "aria-label",
      tx("Steps traversed by these value inputs", "値の入力元をたどった工程"),
    );
    const origins = el("div", "origins"),
      originPager = el("div", "origin-pager"),
      decisionInputs = el("div", "decision-inputs"),
      clausePanel = el("div", "clause-panel"),
      explanation = el("div", "explanation");
    decisionInputs.hidden = true;
    clausePanel.hidden = true;
    const clearSelection = button(
      tx("Clear selection", "選択を解除"),
      () => {
        settleAnimations();
        const target = board.querySelector(".cell.selected") || caption;
        state.selection = null;
        state.selectionLocation = null;
        state.originOffset = 0n;
        inspectorHead.textContent = tx("SELECT A VALUE", "値を選んでください");
        selectedValue.textContent = tx(
          "Select any cell to trace its value inputs.",
          "セルを選ぶと、その値の入力元を確認できます。",
        );
        selectedType.textContent = "";
        columnDtype.textContent = "";
        selectionLegend.textContent = "";
        origins.replaceChildren();
        decisionInputs.replaceChildren();
        decisionInputs.hidden = true;
        clausePanel.replaceChildren();
        clausePanel.hidden = true;
        lineagePath.replaceChildren();
        originPager.replaceChildren();
        explanation.textContent = "";
        explanation.classList.remove("calculation-note");
        clearSelection.hidden = true;
        returnSelection.hidden = true;
        refreshSelection();
        reveal(target);
      },
      "text-button clear-selection",
    );
    clearSelection.dataset.action = "clear-selection";
    clearSelection.hidden = true;
    const returnSelection = button(
      tx("Back to selected cell", "選んだセルに戻る"),
      returnToSelection,
      "text-button",
    );
    returnSelection.dataset.action = "return-selection";
    returnSelection.hidden = true;
    const inspectorTitle = el("div", "inspector-titlebar"),
      inspectorActions = el("div", "inspector-actions");
    inspectorActions.append(returnSelection, clearSelection);
    inspectorTitle.append(inspectorHead, inspectorActions);
    inspector.append(
      inspectorTitle,
      selectedValue,
      selectedType,
      columnDtype,
      selectionLegend,
      lineagePath,
      decisionInputs,
      clausePanel,
      origins,
      originPager,
      explanation,
    );
    const disclosure = el("details", "disclosure");
    disclosure.append(
      el("summary", "", tx("About the data in this file", "このファイルに含まれるデータ")),
      el(
        "p",
        "",
        tx(
          "This file includes all recorded ancestor tables, including filtered-out rows and removed columns. Compression and display limits do not remove data. Review source tables before sharing. Playback uses recorded results and makes no network requests.",
          "このファイルには、除外した行や表示から外した列も含め、入力元の表が記録されています。圧縮・検索・表示列の変更でデータは削除されません。共有前に元の表を確認してください。再生は記録済みの結果を使い、外部通信を行いません。",
        ),
      ),
    );
    disclosure.append(
      el(
        "p",
        "small",
        "FrameChoreo " +
          data.library_version +
          " · pandas " +
          data.pandas_version +
          " · schema " +
          data.schema_version,
      ),
    );
    root.append(disclosure, el("div", "footer", "FrameChoreo " + data.library_version));
    const motionLayer = el("div", "motion-layer");
    motionLayer.setAttribute("aria-hidden", "true");
    root.append(motionLayer);
    const workbench = globalThis.FrameChoreoWorkbench.create({
      root,
      data,
      steps,
      scenes,
      brand,
      title,
      nav,
      toolbar,
      shell,
      body,
      dataStage,
      limitInfo,
      inspector,
      disclosure,
      el,
      button,
      cellButton,
      displayValue,
      tx,
      inspect: (id) => inspectStep(id),
      settle: settleAnimations,
      change: (resetPage) => {
        stop();
        if (resetPage) state.tablePage = 0;
        lastKey = null;
        render();
      },
    });

    function syncPlayButton() {
      play.textContent =
        state.playing || rowAnimations.some((a) => a.playState === "running")
          ? tx("Ⅱ Pause", "Ⅱ 一時停止")
          : tx("▶ Play", "▶ 再生");
    }
    function animate(node, frames, options, finish = () => {}) {
      const animation = node.animate(frames, options);
      animation.updatePlaybackRate(state.speed);
      rowAnimations.push(animation);
      animation.onfinish = () => {
        finish();
        rowAnimations = rowAnimations.filter((a) => a !== animation);
        syncPlayButton();
      };
      syncPlayButton();
      return animation;
    }

    function stop() {
      if (state.playing && timer !== null) {
        remainingHold = Math.max(0, (deadline - performance.now()) * state.speed);
      }
      state.playing = false;
      clearTimeout(timer);
      timer = null;
      play.textContent = tx("▶ Play", "▶ 再生");
      rowAnimations.forEach((animation) => {
        if (animation.playState === "running") animation.pause();
      });
    }
    function settleAnimations() {
      rowAnimations.forEach((animation) => animation.cancel());
      rowAnimations = [];
      animationNodes.forEach((node) => node.remove());
      animationNodes = [];
      motionLayer.replaceChildren();
      syncPlayButton();
    }
    function schedule() {
      clearTimeout(timer);
      const hold = remainingHold ?? (scenes[state.index].step.presentation || {}).hold_ms ?? 2800;
      deadline = performance.now() + hold / state.speed;
      timer = setTimeout(() => {
        timer = null;
        remainingHold = null;
        if (!state.playing) return;
        if (state.index === scenes.length - 1) {
          settleAnimations();
          stop();
          return;
        }
        go(state.index + 1, true);
        schedule();
      }, hold / state.speed);
    }
    function start() {
      if (state.inspection) {
        state.inspection = null;
        state.all = state.returnAll;
        state.tablePage = state.returnPage;
        workbench.restore(state.returnView);
        lastKey = null;
        render();
      }
      if (
        state.index === scenes.length - 1 &&
        remainingHold === null &&
        !rowAnimations.some((a) => a.playState === "paused")
      )
        go(0, true);
      state.playing = true;
      play.textContent = tx("Ⅱ Pause", "Ⅱ 一時停止");
      rowAnimations.forEach((animation) => {
        if (animation.playState === "paused") animation.play();
      });
      schedule();
    }
    function go(index, keepPlaying = false) {
      if (!keepPlaying) stop();
      remainingHold = null;
      state.index = Math.max(0, Math.min(scenes.length - 1, index));
      state.inspection = null;
      state.all = false;
      state.tablePage = 0;
      render();
    }
    function activeScene() {
      if (state.inspection) {
        const t = steps.get(state.inspection);
        return { kind: t.operation === "source" ? "source" : "input", step: t, table: t };
      }
      return scenes[state.index];
    }
    function isRootSelection(step, row, column) {
      return Boolean(
        state.selection &&
        state.selection.step === step &&
        state.selection.row === row &&
        state.selection.column === column,
      );
    }
    function isTracedSource(step, row, column) {
      return Boolean(
        state.selection &&
        !isRootSelection(step, row, column) &&
        state.selection.trace.hasSource(step, row, column),
      );
    }
    function selectCell(step, row, column) {
      stop();
      settleAnimations();
      const tableData = steps.get(step),
        cell = tableData.rows[row].cells[tableData.columns.indexOf(column)];
      state.selection = null;
      state.selectionLocation = {
        step,
        row,
        column,
        index: state.index,
        inspection: state.inspection,
        all: state.all,
        tablePage: state.tablePage,
        returnAll: state.returnAll,
        returnPage: state.returnPage,
        remainingHold,
        view: workbench.capture(),
        returnView: state.returnView,
      };
      state.originOffset = 0n;
      inspectorHead.textContent =
        model.tableLabel(data, tableData) + " · row " + (row + 1) + " · " + column;
      selectedValue.textContent = displayValue(cell);
      selectedType.textContent = tx("Type: ", "値の種類: ") + typeDescription(cell);
      columnDtype.textContent = dtypeLabel(step, column);
      clearSelection.hidden = false;
      returnSelection.hidden = false;
      explanation.classList.remove("calculation-note");
      origins.replaceChildren();
      decisionInputs.replaceChildren();
      decisionInputs.hidden = true;
      clausePanel.replaceChildren();
      clausePanel.hidden = true;
      lineagePath.replaceChildren();
      originPager.replaceChildren();
      try {
        const trace = model.prepareTrace(data, { step, row, column }, steps);
        state.selection = { step, row, column, trace };
        renderOrigins();
        for (const id of trace.steps || []) {
          const node = steps.get(id);
          const chip = button(model.tableLabel(data, node), () => inspectStep(id), "lineage-step");
          chip.title = node.operation;
          lineagePath.append(chip);
        }
        const details = model.cellExplanation(steps, { step, row, column }, language);
        const controls = model.controlInputs(steps, { step, row, column });
        const selectedStep = steps.get(step);
        if (
          selectedStep.parameters.clause_outcomes &&
          (selectedStep.operation === "filter_by" ||
            (selectedStep.operation === "case_when" && column === selectedStep.parameters.name))
        ) {
          const inputRow =
            selectedStep.operation === "filter_by" ? selectedStep.rows[row].parents[0].row : row;
          renderClausePanel(clausePanel, selectedStep, inputRow);
        }
        if (controls.length) {
          decisionInputs.hidden = false;
          decisionInputs.append(
            el(
              "div",
              "decision-title",
              tx("DECISION INPUTS", "判定に使った入力") + " · " + controls.length,
            ),
          );
          for (const control of controls.slice(0, 24)) {
            const item = button(
              "",
              () => inspectStep(control.step, control),
              "origin decision-origin",
            );
            item.append(
              el(
                "span",
                "muted",
                control.name + " · row " + (control.row + 1) + " · " + control.column,
              ),
              el("span", "value", displayValue(control.cell)),
            );
            decisionInputs.append(item);
          }
          if (controls.length > 24)
            decisionInputs.append(
              el(
                "p",
                "muted",
                tx(
                  "Showing the first 24 decision inputs. Use Python explain_controls() for the complete list.",
                  "判定入力は先頭24件を表示しています。全件は Python の explain_controls() で確認できます。",
                ),
              ),
            );
        }
        const instructions =
          trace.total > 0n
            ? tx(
                "Select an input above to inspect its source table. Repeated inputs are retained.",
                "入力を選ぶと元の表へ移動できます。同じ入力を複数回使った場合も、その回数を残しています。",
              )
            : tx(
                "No raw source value inputs were recorded for this cell.",
                "このセルには元データの値が記録されていません。定数や空の入力からできた値は、処理の説明を確認してください。",
              );
        explanation.textContent = details.text ? details.text + " " + instructions : instructions;
        explanation.classList.toggle("calculation-note", Boolean(details.warning));
      } catch (error) {
        origins.replaceChildren();
        explanation.textContent = error.message;
      }
      refreshSelection();
      reveal(inspector, "start");
    }
    function reveal(node, block = "center") {
      node.focus({ preventScroll: true });
      node.scrollIntoView({ block, behavior: "auto" });
    }
    function renderClausePanel(container, step, inputRow) {
      const clauses = model.conditionBreakdown(step, inputRow);
      if (!clauses.length) return;
      container.hidden = false;
      container.append(
        el("div", "decision-title", tx("EACH CHECK BEFORE COMBINATION", "組み合わせる前の各条件")),
      );
      for (const clause of clauses) {
        const chip = el(
          "span",
          "clause-chip",
          clause.column +
            " " +
            clause.op +
            " → " +
            tx(
              clause.outcome,
              clause.outcome === "true" ? "成立" : clause.outcome === "false" ? "不成立" : "欠損",
            ),
        );
        chip.dataset.outcome = clause.outcome;
        container.append(chip);
      }
      container.append(
        el(
          "div",
          "clause-formula",
          tx("Combined: ", "組み合わせ: ") + model.conditionFormula(step, inputRow, language),
        ),
      );
    }
    function findBoardCell(target) {
      return [...board.querySelectorAll(".cell")].find(
        (b) =>
          b.dataset.step === target.step &&
          Number(b.dataset.row) === target.row &&
          b.dataset.column === target.column,
      );
    }
    function revealCell(target) {
      const input = limitInfo.querySelector('[data-action="row-number"]');
      if (input) input.value = String(target.row + 1);
      reveal(workbench.findCell(target) || findBoardCell(target) || caption);
    }
    function returnToSelection() {
      const target = state.selectionLocation;
      if (!target) return;
      stop();
      state.index = target.index;
      state.inspection = target.inspection;
      state.all = target.all;
      state.tablePage = target.tablePage;
      state.returnAll = target.returnAll;
      state.returnPage = target.returnPage;
      remainingHold = target.remainingHold;
      state.returnView = target.returnView;
      workbench.restore(target.view);
      if (target.view?.mode === "compare") {
        lastKey = null;
        render();
        const cell = workbench.findCell(target);
        if (cell) {
          reveal(cell);
          return;
        }
      }
      if (activeScene().table.id !== target.step) {
        inspectStep(target.step, target);
        return;
      }
      lastKey = null;
      render();
      revealCell(target);
    }
    function inspectStep(step, target = null, all = false) {
      stop();
      if (!state.inspection) {
        state.returnAll = state.all;
        state.returnPage = state.tablePage;
        state.returnView = workbench.capture();
      }
      workbench.inspect();
      state.inspection = step;
      state.all = all || (target !== null && target.row >= 12);
      state.tablePage = target ? Math.floor(target.row / 100) : 0;
      lastKey = null;
      render();
      if (target) revealCell(target);
      else reveal(caption);
    }
    function renderOrigins() {
      const trace = state.selection.trace,
        page = trace.page(state.originOffset, 50),
        inputs = page.origins,
        offset = state.originOffset,
        total = trace.total;
      origins.replaceChildren();
      originPager.replaceChildren();
      for (const origin of inputs) {
        const b = button("", () => inspectStep(origin.step, origin), "origin"),
          value = el("span", "value", displayValue(origin.cell));
        if (blankKind(origin.cell)) value.dataset.blank = blankKind(origin.cell);
        b.title = tx("Type: ", "値の種類: ") + typeDescription(origin.cell);
        b.append(
          el(
            "span",
            "muted",
            model.tableLabel(data, steps.get(origin.step)) +
              " · row " +
              (origin.row + 1) +
              " · " +
              origin.column,
          ),
          value,
        );
        origins.append(b);
      }
      origins.scrollTop = 0;
      if (total <= 50n) return;
      const change = (delta, action) => {
        state.originOffset += delta;
        renderOrigins();
        const control = originPager.querySelector('[data-action="' + action + '"]');
        (control.disabled ? origins.firstElementChild : control).focus();
      };
      const previous = button(
          tx("← Previous inputs", "← 前の入力"),
          () => change(-50n, "origins-previous"),
          "text-button",
        ),
        next = button(
          tx("Next inputs →", "次の入力 →"),
          () => change(50n, "origins-next"),
          "text-button",
        );
      previous.dataset.action = "origins-previous";
      next.dataset.action = "origins-next";
      previous.disabled = offset === 0n;
      next.disabled = !page.has_next;
      const status = el(
        "span",
        "",
        language === "ja"
          ? offset + 1n + "–" + (offset + BigInt(inputs.length)) + " / " + total + " 個の入力"
          : offset + 1n + "–" + (offset + BigInt(inputs.length)) + " of " + total + " value inputs",
      );
      status.setAttribute("aria-live", "polite");
      originPager.append(previous, status, next);
      if (total > 200n) {
        const form = el("form", "jump-form"),
          label = el("label", "", tx("Input number ", "入力の番号 ")),
          number = el("input"),
          message = el("span", "jump-message");
        number.type = "text";
        number.inputMode = "numeric";
        number.maxLength = 100;
        number.value = String(offset + 1n);
        number.dataset.action = "origin-number";
        label.append(number);
        message.setAttribute("role", "status");
        const jump = button(
          tx("Go to input", "入力へ移動"),
          () => {
            if (
              !/^[1-9][0-9]*$/.test(number.value) ||
              number.value.length > 100 ||
              BigInt(number.value) > total
            ) {
              message.textContent =
                tx("Enter an input number from 1 to ", "入力の番号を1〜") + total + ".";
              return;
            }
            const position = BigInt(number.value) - 1n;
            state.originOffset = (position / 50n) * 50n;
            renderOrigins();
            originPager.querySelector('[data-action="origin-number"]').value = String(
              position + 1n,
            );
            reveal(origins.children[Number(position % 50n)]);
          },
          "text-button",
        );
        jump.dataset.action = "origins-jump";
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          jump.click();
        });
        form.append(label, jump, message);
        originPager.append(form);
      }
    }
    function refreshSelection() {
      let sourceVisible = false;
      root.querySelectorAll("button[data-step]").forEach((b) => {
        const step = b.dataset.step,
          row = Number(b.dataset.row),
          column = b.dataset.column,
          isRoot = isRootSelection(step, row, column),
          isSource = isTracedSource(step, row, column);
        if (isSource && !b.closest("[hidden]") && !b.closest("details:not([open])"))
          sourceVisible = true;
        b.classList.toggle("selected", isRoot);
        b.classList.toggle("selected-source", isSource);
        b.setAttribute("aria-pressed", String(isRoot || isSource));
      });
      selectionLegend.textContent =
        state.selection && sourceVisible
          ? tx(
              "Solid outline: the selected value. Dashed outlines: traced source values currently in view.",
              "実線は選択した値、破線はこの表示にある入力元の値です。",
            )
          : "";
    }
    function cellButton(step, row, column, cell, originNote) {
      const b = button(displayValue(cell), () => selectCell(step, row, column), "cell");
      b.dataset.step = step;
      b.dataset.row = String(row);
      b.dataset.column = column;
      b.dataset.type = cell.type;
      if (blankKind(cell)) b.dataset.blank = blankKind(cell);
      const dtype = dtypeLabel(step, column);
      b.title =
        displayValue(cell) +
        tx("\nType: ", "\n値の種類: ") +
        typeDescription(cell) +
        (dtype ? "\n" + dtype : "") +
        (originNote ? "\n" + originNote : "");
      b.setAttribute(
        "aria-label",
        column +
          ": " +
          displayValue(cell) +
          (cell.type === "missing"
            ? tx(" (missing)", "（欠損）")
            : blankKind(cell)
              ? " (" + typeDescription(cell) + ")"
              : "") +
          (originNote ? "; " + originNote : "") +
          tx("; trace value inputs", "：入力元を確認"),
      );
      return b;
    }
    function dtypeLabel(step, column) {
      const tableData = steps.get(step),
        dtype = tableData.dtypes?.[tableData.columns.indexOf(column)];
      return typeof dtype === "string" ? tx("Column dtype: ", "列の型: ") + dtype : "";
    }
    function renderReference(scene, rows) {
      const previous = reference.querySelector("details");
      const sameReference = previous?.dataset.step === scene.step.id;
      const wasOpen = sameReference && previous.open;
      reference.replaceChildren();
      dataStage.classList.toggle("with-reference", scene.kind === "merge" && !state.inspection);
      if (scene.kind !== "merge" || state.inspection) return;
      const right = steps.get(scene.step.parents[1]);
      const dock = el("section", "source-dock"),
        cards = el("div", "source-cards"),
        seen = new Set();
      dock.setAttribute("aria-label", tx("Join value inputs", "結合で使う入力値"));
      dock.append(
        el("div", "source-heading", tx("From ", "入力元: ") + model.tableLabel(data, right)),
        cards,
      );
      for (const row of rows)
        for (const refs of Object.values(row.cell_parents))
          for (const ref of refs) {
            const key = model.cellKey(ref.step, ref.row, ref.column);
            if (ref.step !== right.id || seen.has(key) || seen.size >= 12) continue;
            seen.add(key);
            const card = el("div", "source-card"),
              cell = right.rows[ref.row].cells[right.columns.indexOf(ref.column)];
            card.append(el("span", "source-label", "row " + (ref.row + 1) + " · " + ref.column));
            const value = cellButton(right.id, ref.row, ref.column, cell);
            value.classList.add("source-cell");
            card.append(value);
            cards.append(card);
          }
      if (!seen.size)
        cards.append(
          el(
            "span",
            "muted small",
            tx(
              "No right-hand value inputs for these rows.",
              "この表示範囲には、結合する側の入力値がありません。",
            ),
          ),
        );
      if (seen.size === 12)
        dock.append(
          el(
            "div",
            "source-footnote",
            tx("Preview limited to 12 source cells", "入力元は最大12セルを表示しています"),
          ),
        );
      reference.append(dock);
      const details = el("details", "reference");
      details.dataset.step = scene.step.id;
      details.open = Boolean(wasOpen);
      let open = details.open;
      details.addEventListener("toggle", () => {
        if (open !== details.open) settleAnimations();
        open = details.open;
      });
      details.append(
        el(
          "summary",
          "",
          tx("Right input: ", "結合する表: ") +
            model.tableLabel(data, right) +
            " · " +
            right.rows.length +
            " rows",
        ),
      );
      const area = el("div", "ref-table"),
        t = el("table"),
        head = el("thead"),
        tr = el("tr");
      tr.append(el("th", "", tx("Row", "行")));
      for (const col of right.columns) tr.append(el("th", "", col));
      head.append(tr);
      t.append(head);
      const tbody = el("tbody");
      const selected = new Set();
      for (const row of rows) {
        for (const refs of Object.values(row.cell_parents)) {
          for (const ref of refs) {
            if (ref.step === right.id && selected.size < 12) selected.add(ref.row);
          }
        }
      }
      for (let i = 0; i < right.rows.length && selected.size < 12; i++) selected.add(i);
      [...selected]
        .sort((a, b) => a - b)
        .map((i) => right.rows[i])
        .forEach((row) => {
          const r = el("tr");
          r.append(el("td", "ref-row-number", String(row.position + 1)));
          row.cells.forEach((c, i) => {
            const td = el("td");
            td.append(cellButton(right.id, row.position, right.columns[i], c));
            r.append(td);
          });
          tbody.append(r);
        });
      t.append(tbody);
      area.append(t);
      if (right.rows.length > 12)
        area.append(
          el(
            "p",
            "muted",
            "Showing 12 selected rows from " +
              right.rows.length +
              " right-input rows, prioritizing matches in the result preview. All are recorded.",
          ),
        );
      details.append(area);
      const inspect = button(
        tx("Inspect all ", "表の全行を見る: ") + right.rows.length + " rows",
        () => inspectStep(right.id, null, true),
        "text-button inspect-input",
      );
      inspect.dataset.action = "inspect-right";
      details.append(inspect);
      reference.append(details);
    }
    function legendItem(swatchAttr, swatchValue, text) {
      const item = el("div", "legend-item"),
        swatch = el("span", "legend-swatch");
      swatch.setAttribute(swatchAttr, swatchValue);
      item.append(swatch, el("span", "", text));
      return item;
    }
    function renderLegend(scene) {
      legend.replaceChildren();
      if (["filter", "filter_by", "drop_missing", "drop_duplicates"].includes(scene.kind))
        legend.append(
          legendItem(
            "data-kind",
            "filter",
            tx(
              "Fading rows were removed by the filter; earlier steps still have them.",
              "除外する行は表示から離れます。元の表には記録を残しています。",
            ),
          ),
        );
      else if (scene.kind === "merge")
        legend.append(
          legendItem(
            "data-kind",
            "merge",
            tx(
              "Blue cards → matching result cells. Select a value to inspect its source.",
              "青いカードから、対応する結果のセルへ値が移動します。値を選ぶと入力元を確認できます。",
            ),
          ),
        );
      else if (["case_when", "coalesce", "window"].includes(scene.kind))
        legend.append(
          legendItem(
            "data-kind",
            "calculate",
            tx(
              "Colored value cards show the selected inputs. Decision inputs appear in the inspector.",
              "色付きの値カードは実際の入力元です。判定入力は詳細欄で確認できます。",
            ),
          ),
        );
      else if (scene.kind === "group_transform")
        legend.append(
          legendItem(
            "data-kind",
            "group",
            tx(
              "Matching group colors show where the repeated metric came from. Select a value for every candidate.",
              "同じ色の行にグループ指標を繰り返します。値を選ぶと候補の全行を確認できます。",
            ),
          ),
        );
      else if (["group", "sum", "mean", "count", "aggregate"].includes(scene.kind)) {
        legend.append(
          legendItem(
            "data-kind",
            "group",
            scene.kind === "group"
              ? tx(
                  "Rows with the same key share a group number and color. Colors repeat; group labels stay distinct.",
                  "同じキーの行に、共通のグループ番号と色を付けています。色が繰り返されても、番号とラベルで区別できます。",
                )
              : tx(
                  "Only non-missing inputs move into their group's result. Select a result for all inputs.",
                  "欠損を除いた入力が、同じグループの結果へ集まります。すべての入力は結果のセルから確認できます。",
                ),
          ),
        );
        if (scene.step.parameters.dropna)
          legend.append(
            legendItem(
              "data-kind",
              "filter",
              tx(
                "Rows with a missing grouping key are excluded from the result.",
                "グループのキーが欠損している行は結果に含めません。",
              ),
            ),
          );
      }
    }
    function renderDecisionAudit(scene) {
      decisionAudit.replaceChildren();
      decisionAudit.hidden =
        !["filter_by", "merge"].includes(scene.kind) || Boolean(state.inspection);
      if (decisionAudit.hidden) return;
      decisionAudit.dataset.kind = scene.kind;
      if (scene.kind === "merge") {
        renderJoinAudit(scene);
        return;
      }
      const outcome = scene.step.parameters.outcomes,
        source = steps.get(scene.step.parents[0]),
        condition = scene.step.parameters.condition,
        fields = [...new Set(model.conditionFields(condition, source.columns))],
        excluded = outcome.flatMap((result, row) => (result === "true" ? [] : [{ result, row }])),
        failed = outcome.filter((result) => result === "false").length,
        missing = outcome.filter((result) => result === "missing").length;
      decisionAudit.setAttribute("aria-label", tx("Filtered-row decisions", "除外した行の判定"));
      decisionAudit.append(
        el("div", "decision-audit-title", tx("Why rows left", "除外した行の理由")),
        el(
          "p",
          "decision-audit-summary",
          tx(
            failed + " failed the condition · " + missing + " had a missing comparison",
            failed + "行は条件不成立 · " + missing + "行は比較結果が欠損",
          ),
        ),
      );
      if (scene.step.parameters.clause_outcomes)
        decisionAudit.append(
          el(
            "p",
            "decision-audit-summary",
            tx(
              "Individual checks below are shown before AND, OR, and NOT; each row's final decision appears first.",
              "下の個別判定は AND・OR・NOT で組み合わせる前の結果です。各行の最終判定を先に表示しています。",
            ),
          ),
        );
      const list = el("div", "decision-audit-list");
      for (const item of excluded.slice(0, 12)) {
        const targetColumn = fields[0];
        const checked =
          fields
            .slice(0, 3)
            .map((column) => {
              const cell = source.rows[item.row].cells[source.columns.indexOf(column)];
              return column + " = " + displayValue(cell);
            })
            .join(" · ") + (fields.length > 3 ? " · +" + (fields.length - 3) : "");
        const action = button(
          "",
          () =>
            inspectStep(source.id, {
              step: source.id,
              row: item.row,
              column: targetColumn,
            }),
          "decision-audit-row",
        );
        action.append(
          el("strong", "", tx("Row ", "行 ") + (item.row + 1)),
          el(
            "span",
            "",
            item.result === "missing"
              ? tx("Comparison missing", "比較結果が欠損")
              : tx("Condition false", "条件不成立"),
          ),
          el("span", "decision-audit-value", checked),
        );
        if (scene.step.parameters.clause_outcomes) {
          const clauses = model.conditionBreakdown(scene.step, item.row);
          action.append(
            el(
              "span",
              "decision-clause-summary",
              tx("Checks: ", "各条件: ") +
                clauses
                  .map((part) => part.column + " " + part.op + " → " + part.outcome)
                  .join(" · "),
            ),
            el(
              "span",
              "decision-clause-summary",
              tx("Combined: ", "組み合わせ: ") +
                model.conditionFormula(scene.step, item.row, language),
            ),
          );
        }
        list.append(action);
      }
      decisionAudit.append(list);
      if (excluded.length > 12)
        decisionAudit.append(
          el(
            "p",
            "muted",
            tx(
              "Showing the first 12 excluded rows. All decisions remain in the recorded source table.",
              "除外行の先頭12件を表示しています。判定結果はすべて記録されています。",
            ),
          ),
        );
      decisionAudit.append(
        button(
          tx("Inspect all source rows", "元の全行を見る"),
          () => inspectStep(source.id, null, true),
          "text-button",
        ),
      );
    }
    function renderJoinAudit(scene) {
      const audit = scene.step.parameters.audit;
      if (!audit) {
        decisionAudit.hidden = true;
        return;
      }
      const p = scene.step.parameters,
        left = steps.get(scene.step.parents[0]),
        right = steps.get(scene.step.parents[1]);
      decisionAudit.setAttribute("aria-label", tx("Join input audit", "結合入力の監査"));
      decisionAudit.append(
        el("div", "decision-audit-title", tx("What happened to each input", "各入力行の結合結果")),
        el(
          "p",
          "decision-audit-summary",
          tx(
            audit.left_unmatched.length +
              " unmatched left · " +
              audit.right_unmatched.length +
              " unmatched right · " +
              audit.left_fanout.length +
              " left rows expanded · " +
              audit.null_key_output_rows.length +
              " missing-key matches",
            "左の不一致" +
              audit.left_unmatched.length +
              "行 · 右の不一致" +
              audit.right_unmatched.length +
              "行 · 左の複製" +
              audit.left_fanout.length +
              "行 · 欠損キーの一致" +
              audit.null_key_output_rows.length +
              "件",
          ),
        ),
      );
      const groups = [
        ["left_unmatched", left, p.left_on[0], tx("Left without a partner", "一致相手のない左行")],
        [
          "right_unmatched",
          right,
          p.right_on[0],
          tx("Right without a partner", "一致相手のない右行"),
        ],
        ["left_fanout", left, p.left_on[0], tx("Left rows expanded", "複数行に広がった左行")],
        ["right_fanout", right, p.right_on[0], tx("Right rows expanded", "複数行に広がった右行")],
        ["left_duplicate_keys", left, p.left_on[0], tx("Repeated left keys", "重複した左キー")],
        ["right_duplicate_keys", right, p.right_on[0], tx("Repeated right keys", "重複した右キー")],
      ];
      for (const [kind, source, column, title] of groups) {
        const positions = audit[kind];
        if (!positions.length) continue;
        const list = el("div", "decision-audit-list");
        list.append(el("div", "decision-audit-group-title", title + " · " + positions.length));
        for (const row of positions.slice(0, 12)) {
          const cell = source.rows[row].cells[source.columns.indexOf(column)];
          const action = button(
            "",
            () =>
              inspectStep(source.id, {
                step: source.id,
                row,
                column,
              }),
            "decision-audit-row",
          );
          action.dataset.auditKind = kind;
          action.append(
            el("strong", "", model.tableLabel(data, source) + " · row " + (row + 1)),
            el("span", "decision-audit-value", column + " = " + displayValue(cell)),
          );
          list.append(action);
        }
        if (positions.length > 12)
          list.append(el("span", "muted", tx("First 12 shown", "先頭12行を表示")));
        decisionAudit.append(list);
      }
      if (audit.null_key_output_rows.length)
        decisionAudit.append(
          el(
            "p",
            "decision-audit-summary",
            tx(
              "pandas matched missing join keys. Select the result or source tables to inspect them.",
              "pandas は欠損した結合キー同士も一致させます。結果か元の表で確認できます。",
            ),
          ),
        );
      decisionAudit.append(
        button(
          tx("Inspect left input", "左の入力表を見る"),
          () => inspectStep(left.id, null, true),
          "text-button",
        ),
        button(
          tx("Inspect right input", "右の入力表を見る"),
          () => inspectStep(right.id, null, true),
          "text-button",
        ),
      );
    }
    function replayMotion() {
      if (
        replaying ||
        state.inspection ||
        state.index === 0 ||
        state.all ||
        workbench.mode !== "table" ||
        workbench.query
      )
        return;
      if (state.reduceMotion || reduced.matches) return;
      stop();
      replaying = true;
      const targetIndex = state.index;
      const minimum = root.style.minHeight;
      // The intermediate scene can be shorter than the current viewport.
      // Preserve page height so rebuilding it does not clamp the reader's scroll.
      root.style.minHeight = root.getBoundingClientRect().height + "px";
      try {
        state.all = false;
        state.tablePage = 0;
        lastKey = null;
        state.index = targetIndex - 1;
        render();
        state.index = targetIndex;
        render();
      } finally {
        root.style.minHeight = minimum;
        replaying = false;
      }
    }
    function layout(scene, rows) {
      const result = [],
        positions = new Map();
      let y = 0,
        lastGroup = null;
      let groupMap = groupMapCache.get(scene.step.id);
      if (scene.kind === "group" && !groupMap) {
        groupMap = new Map();
        scene.step.parameters.groups.forEach((g, i) =>
          g.input_rows.forEach((r) => groupMap.set(r, i)),
        );
        groupMapCache.set(scene.step.id, groupMap);
      }
      for (const row of rows) {
        const identity = model.groupIdentity(steps, scene.table.id, row.position);
        const group =
          scene.kind === "group"
            ? groupMap.has(row.position)
              ? groupMap.get(row.position)
              : -1
            : (identity?.row ?? null);
        if (scene.kind === "group" && group !== lastGroup) {
          result.push({
            band: true,
            y,
            label:
              group < 0
                ? tx("Excluded missing-key rows", "キーが欠損しているため除外する行")
                : "G" + (group + 1) + " · " + model.groupTitle(scene, group),
            group,
          });
          y += 36;
          lastGroup = group;
        }
        result.push({ row, y, group, groupStep: identity?.step });
        positions.set(model.rowKey(scene.table.id, row.position), y);
        y += 46;
      }
      return { items: result, positions, height: Math.max(70, y) };
    }
    function visibleCell(node) {
      if (
        !node ||
        !node.isConnected ||
        node.closest("details:not([open])") ||
        node.closest("[hidden]")
      )
        return false;
      const r = node.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      let left = 0,
        top = 0,
        right = window.innerWidth,
        bottom = window.innerHeight;
      if (window.getComputedStyle(toolbar).position === "sticky")
        top = Math.max(top, toolbar.getBoundingClientRect().bottom);
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (
          parent === scroll ||
          parent.classList.contains("ref-table") ||
          parent.classList.contains("source-cards")
        ) {
          const clip = parent.getBoundingClientRect();
          left = Math.max(left, clip.left);
          top = Math.max(top, clip.top);
          right = Math.min(right, clip.right);
          bottom = Math.min(bottom, clip.bottom);
        }
      }
      return r.left >= left && r.right <= right && r.top >= top && r.bottom <= bottom;
    }
    function animateTransition(scene, oldRows, oldCells, rows) {
      const aggregate = ["sum", "mean", "count", "aggregate"].includes(scene.kind),
        transfer =
          aggregate ||
          [
            "merge",
            "melt",
            "pivot",
            "calculate",
            "case_when",
            "coalesce",
            "window",
            "group_transform",
          ].includes(scene.kind),
        flows = [],
        sources = new Map(),
        targets = new Map();
      if (transfer) {
        const destinations = [];
        let total = 0;
        for (const row of rows) {
          const columns = aggregate
            ? model.metrics(scene.step).map((m) => m.output)
            : scene.kind === "melt"
              ? [scene.step.parameters.value_name]
              : scene.kind === "pivot"
                ? scene.step.parameters.output_columns
                : ["calculate", "case_when", "coalesce", "window", "group_transform"].includes(
                      scene.kind,
                    )
                  ? [scene.step.parameters.name]
                  : scene.table.columns;
          for (const column of columns) {
            const refs = row.cell_parents[column] || [];
            for (const ref of refs)
              if (scene.kind !== "merge" || ref.step === scene.step.parents[1]) total++;
            destinations.push({
              refs,
              group: aggregate
                ? row.position
                : scene.kind === "group_transform"
                  ? scene.step.parameters.row_groups[row.position]
                  : null,
              target: findBoardCell({ step: scene.table.id, row: row.position, column }),
            });
          }
        }
        // The status has to occupy its final space BEFORE measuring endpoints.
        // The moving count reserves two digit widths, so updating it cannot move the tables.
        const movingCount = el("span", "motion-count", "0");
        motionStatus.replaceChildren(
          movingCount,
          el(
            "span",
            "",
            tx(
              " of " + total + " inputs animated · fully visible cells only.",
              " / " + total + "個の入力を移動しています。画面に収まる値だけを動かします。",
            ),
          ),
        );
        if (scene.kind === "merge") {
          for (const source of reference.querySelectorAll(".source-cell")) {
            if (visibleCell(source))
              sources.set(
                model.cellKey(
                  source.dataset.step,
                  Number(source.dataset.row),
                  source.dataset.column,
                ),
                {
                  rect: source.getBoundingClientRect(),
                  text: source.textContent,
                  type: source.dataset.type,
                },
              );
          }
        }
        // No position is inferred for hidden cells, non-matches, or offscreen inputs.
        for (const { target, refs, group } of destinations) {
          if (!visibleCell(target)) continue;
          const to = target.getBoundingClientRect();
          for (const ref of refs) {
            if (
              (scene.kind === "merge" && ref.step !== scene.step.parents[1]) ||
              flows.length >= 48
            )
              continue;
            const source = (scene.kind === "merge" ? sources : oldCells).get(
              model.cellKey(ref.step, ref.row, ref.column),
            );
            if (source) flows.push({ source, ref, target, to, group });
          }
        }
        movingCount.textContent = String(flows.length);
      }
      if (!transfer) {
        const previous = new Map(oldRows.map((r) => [r.key, r])),
          used = new Set();
        for (const node of board.querySelectorAll(".data-row")) {
          const candidates = [node.dataset.ref, ...JSON.parse(node.dataset.parents)],
            source = candidates.map((key) => previous.get(key)).find(Boolean);
          if (!source) continue;
          used.add(source.key);
          const dy = source.top - parseFloat(node.style.top);
          animate(
            node,
            [{ transform: "translateY(" + dy + "px)" }, { transform: "translateY(0)" }],
            { duration: 850, easing: "cubic-bezier(.22,1,.36,1)" },
          );
        }
        // Only a filter removes rows here. A preview or a chapter jump is not
        // evidence of exclusion, so it must not manufacture departing records.
        if (["filter", "filter_by", "drop_missing", "drop_duplicates"].includes(scene.kind)) {
          const kept = new Set(
            scene.step.parameters.selected_rows || scene.step.parameters.positions,
          );
          for (const old of oldRows) {
            if (used.has(old.key)) continue;
            const position = Number(old.key.slice(old.key.lastIndexOf(":") + 1));
            if (kept.has(position)) continue;
            const ghost = old.node;
            ghost.classList.add("ghost");
            ghost.dataset.transition = "exit";
            ghost.setAttribute("aria-hidden", "true");
            ghost.querySelectorAll("button").forEach((b) => (b.disabled = true));
            board.append(ghost);
            animationNodes.push(ghost);
            animate(
              ghost,
              [
                { transform: "translateX(0)", opacity: 0.8 },
                { transform: "translateX(28px)", opacity: 0 },
              ],
              { duration: 650, easing: "ease-in", fill: "forwards" },
              () => ghost.remove(),
            );
          }
        }
      }
      flows.forEach((flow, index) => {
        const { source, ref, target, to, group } = flow,
          ghost = el("div", "value-flight ghost"),
          delay = (index % 8) * 35,
          numeric = ["integer", "float", "decimal"].includes(source.type),
          width = Math.min(source.rect.width, 160),
          targetWidth = Math.min(to.width, 160),
          left = numeric ? source.rect.right - width : source.rect.left,
          targetLeft = numeric ? to.right - targetWidth : to.left;
        Object.assign(ghost.dataset, {
          sourceStep: ref.step,
          sourceRow: String(ref.row),
          sourceColumn: ref.column,
          targetStep: target.dataset.step,
          targetRow: target.dataset.row,
          targetColumn: target.dataset.column,
          kind: scene.kind,
          type: source.type,
        });
        if (group !== null) ghost.dataset.group = String(group % 6);
        ghost.setAttribute("aria-hidden", "true");
        ghost.append(
          el(
            "span",
            "flight-label",
            (group === null ? "" : "G" + (group + 1) + " · ") +
              "row " +
              (ref.row + 1) +
              " · " +
              ref.column,
          ),
          el("span", "flight-value", source.text),
        );
        Object.assign(ghost.style, {
          left: left + "px",
          top: source.rect.top + "px",
          width: width + "px",
          minHeight: source.rect.height + "px",
        });
        motionLayer.append(ghost);
        const destination =
          "translate(" + (targetLeft - left) + "px, " + (to.top - source.rect.top) + "px)";
        animate(
          ghost,
          [
            {
              transform: "translate(0, 0)",
              width: width + "px",
              opacity: 0.95,
              offset: 0,
            },
            {
              transform: "translate(0, 0)",
              width: width + "px",
              opacity: 1,
              offset: 0.18,
              easing: "cubic-bezier(.4,0,.2,1)",
            },
            { transform: destination, width: targetWidth + "px", opacity: 1, offset: 0.88 },
            { transform: destination, width: targetWidth + "px", opacity: 0, offset: 1 },
          ],
          { duration: 1150, delay, fill: "both", easing: "linear" },
          () => ghost.remove(),
        );
        targets.set(target, Math.max(targets.get(target) || 0, 1150 + delay));
      });
      for (const [target, duration] of targets) {
        animate(
          target,
          [
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: 0.7 },
            { opacity: 1, offset: 1 },
          ],
          { duration, easing: "ease-out" },
        );
      }
    }
    function render() {
      const focusedAction = document.activeElement?.dataset.action;
      const scene = activeScene(),
        tableData = scene.table,
        sceneKey = scene.table.id + ":" + scene.kind + ":" + (state.inspection || "");
      workbench.sync(scene);
      const shownColumns = workbench.columns(scene);
      const shouldAnimate =
        lastKey !== null &&
        lastKey !== sceneKey &&
        lastIndex === state.index - 1 &&
        workbench.mode === "table" &&
        !workbench.query &&
        !state.reduceMotion &&
        !reduced.matches &&
        !state.all &&
        !scroll.classList.contains("paged") &&
        !state.inspection &&
        typeof board.animate === "function";
      root.classList.toggle("reduce-motion", state.reduceMotion || reduced.matches);
      settleAnimations();
      const oldRows = [...board.querySelectorAll(".data-row")].map((n) => ({
        key: n.dataset.ref,
        top: n.getBoundingClientRect().top - board.getBoundingClientRect().top,
        node: n.cloneNode(true),
      }));
      const oldCells = new Map();
      for (const cell of board.querySelectorAll(".cell")) {
        if (visibleCell(cell))
          oldCells.set(
            model.cellKey(cell.dataset.step, Number(cell.dataset.row), cell.dataset.column),
            { rect: cell.getBoundingClientRect(), text: cell.textContent, type: cell.dataset.type },
          );
      }
      board.replaceChildren();
      columnHead.replaceChildren();
      const allRows = workbench.filter(orderedRows(scene)),
        paged = state.all && allRows.length > 200;
      state.tablePage = Math.min(state.tablePage, Math.max(0, Math.ceil(allRows.length / 100) - 1));
      const rowOffset = paged ? state.tablePage * 100 : 0,
        rows = paged
          ? allRows.slice(rowOffset, rowOffset + 100)
          : state.all
            ? allRows
            : allRows.slice(0, 12);
      scroll.classList.toggle("paged", state.all);
      const viewportKey = sceneKey + ":" + state.all + ":" + state.tablePage;
      if (viewportKey !== lastViewportKey) scroll.scrollTop = 0;
      lastViewportKey = viewportKey;
      const grid = "46px repeat(" + shownColumns.length + ", minmax(var(--cell-min), 1fr))";
      table.style.minWidth = "calc(49px + " + shownColumns.length + " * var(--cell-min))";
      columnHead.style.gridTemplateColumns = grid;
      const numberHead = el("div", "", tx("Row", "行"));
      numberHead.setAttribute("role", "columnheader");
      columnHead.append(numberHead);
      const presentation = scene.step.presentation || {};
      shownColumns.forEach((col) => {
        const h = el("div", "", col);
        h.title = col;
        h.setAttribute("role", "columnheader");
        if ((presentation.highlight || []).includes(col)) h.classList.add("highlight");
        columnHead.append(h);
      });
      table.setAttribute("aria-rowcount", String(tableData.rows.length + 1));
      table.setAttribute("aria-colcount", String(shownColumns.length + 1));
      const geometry = layout(scene, rows);
      const rightId = scene.kind === "merge" ? scene.step.parents[1] : null;
      for (const entry of geometry.items) {
        if (entry.band) {
          const band = el("div", "group-band", entry.label);
          band.title = entry.label;
          band.style.top = entry.y + "px";
          band.dataset.group = entry.group < 0 ? "excluded" : String(entry.group % 6);
          board.append(band);
          continue;
        }
        const row = entry.row,
          key = model.rowKey(tableData.id, row.position),
          node = el("div", "data-row");
        node.dataset.ref = key;
        node.dataset.parents = JSON.stringify(row.parents.map((p) => model.rowKey(p.step, p.row)));
        node.style.top = entry.y + "px";
        node.style.gridTemplateColumns = grid;
        node.setAttribute("role", "row");
        node.setAttribute("aria-rowindex", String(rowOffset + rows.indexOf(row) + 2));
        if (entry.group !== null)
          node.dataset.group = entry.group < 0 ? "excluded" : String(entry.group % 6);
        const number = el("div", "row-number", String(row.position + 1));
        number.setAttribute("role", "rowheader");
        if (entry.group !== null && scene.kind !== "group") {
          number.classList.add("with-group");
          number.append(el("span", "group-id", "G" + (entry.group + 1)));
          number.title = model.groupTitle({ step: steps.get(entry.groupStep) }, entry.group);
        }
        node.append(number);
        row.cells.forEach((cell, i) => {
          const column = tableData.columns[i],
            wrap = el("div", "cell-wrap");
          if (!shownColumns.includes(column)) return;
          wrap.setAttribute("role", "cell");
          let originNote;
          if (rightId !== null) {
            const refs = row.cell_parents[column] || [];
            if (refs.length > 0 && refs.every((r) => r.step === rightId)) {
              wrap.dataset.origin = "right";
              originNote =
                tx("From ", "入力元: ") +
                model.tableLabel(data, steps.get(rightId)) +
                " row " +
                (refs[0].row + 1);
            }
          }
          wrap.append(cellButton(tableData.id, row.position, column, cell, originNote));
          node.append(wrap);
        });
        board.append(node);
      }
      if (rows.length === 0)
        board.append(
          el(
            "div",
            "empty",
            workbench.query
              ? tx(
                  "No matching rows. Clear the search to see the recorded table.",
                  "一致する行がありません。検索を解除すると元の表示に戻ります。",
                )
              : tx("No rows remain in this step.", "この工程には行がありません。"),
          ),
        );
      board.style.height = geometry.height + "px";
      const badgeNames = {
        source: "入力",
        input: "参照",
        filter: "抽出",
        filter_by: "条件抽出",
        merge: "結合",
        group: "グループ",
        sum: "合計",
        mean: "平均",
        count: "件数",
        aggregate: "集計",
        group_transform: "グループ指標",
        sort: "並べ替え",
        select: "列選択",
        rename: "名前変更",
        calculate: "計算",
        case_when: "条件選択",
        coalesce: "優先値選択",
        window: "窓計算",
        drop_missing: "欠損行除外",
        drop_duplicates: "重複除外",
        fill_missing: "欠損補完",
        take: "行選択",
        astype: "型変換",
        to_numeric: "数値変換",
        to_datetime: "日付変換",
        string_transform: "文字整形",
        concat: "縦結合",
        melt: "縦長化",
        pivot: "横長化",
      };
      const englishBadges = {
        filter_by: "FILTER",
        case_when: "DECISION",
        coalesce: "FALLBACK",
        window: "WINDOW",
        group_transform: "GROUP METRIC",
      };
      operation.textContent =
        language === "ja"
          ? badgeNames[scene.kind] || scene.kind.toUpperCase()
          : englishBadges[scene.kind] || scene.kind.toUpperCase();
      operation.dataset.kind = scene.kind;
      renderLegend(scene);
      renderDecisionAudit(scene);
      caption.textContent = state.inspection
        ? model.tableLabel(data, tableData)
        : scene.kind === "group"
          ? tx("Form the groups", "グループを作る")
          : model.tableLabel(data, scene.step);
      counter.textContent =
        count(tableData.rows.length, "row") + " · " + count(tableData.columns.length, "column");
      code.textContent = state.inspection
        ? scene.kind === "source"
          ? tx("Recorded source table", "記録した入力表")
          : tx("Recorded join input", "記録した入力表")
        : model.description(scene);
      let note = tx(
        "Select a value to follow its source cells.",
        "値を選ぶと、元の入力セルまでたどれます。",
      );
      if (["filter", "filter_by", "drop_missing", "drop_duplicates"].includes(scene.kind))
        note =
          count(scene.step.parameters.removed_rows, "row") +
          tx(
            " excluded; source rows remain available.",
            "を除外しました。元の行は入力表から確認できます。",
          );
      if (scene.kind === "filter_by") {
        const outcomes = scene.step.parameters.outcomes;
        const missing = outcomes.filter((x) => x === "missing").length;
        note +=
          " " +
          missing +
          tx(
            missing === 1
              ? " comparison was missing and excluded."
              : " comparisons were missing and excluded.",
            "件の比較は欠損で、除外しました。",
          );
      }
      if (scene.kind === "merge") {
        const n = scene.step.parameters.unmatched_rows;
        note =
          language === "ja"
            ? n +
              "行は結合する側に一致がなく、" +
              (scene.step.parameters.unmatched_left_rows || 0) +
              "行は元の左側の入力がありません。"
            : count(n, "output row") +
              (n === 1 ? " has" : " have") +
              tx(
                " no right-side match. Validation: ",
                "結合する側に一致する行がありません。照合の関係: ",
              ) +
              scene.step.parameters.validate +
              "." +
              (scene.step.parameters.unmatched_left_rows || 0
                ? " " +
                  count(scene.step.parameters.unmatched_left_rows, "output row") +
                  (scene.step.parameters.unmatched_left_rows === 1 ? " has" : " have") +
                  " no left-side match."
                : "");
      }
      if (["group", "sum", "mean", "count", "aggregate"].includes(scene.kind)) {
        const gp = scene.step.parameters;
        note =
          tx("Missing keys ", "欠損しているキーは") +
          (gp.dropna ? tx("are excluded", "除外します") : tx("are kept", "残します")) +
          "; " +
          count(gp.excluded_rows, "input row") +
          tx(" excluded by grouping.", "がグループの条件で除外されます。") +
          (gp.min_count !== undefined ? " min_count=" + gp.min_count + "." : "");
      }
      if (scene.kind === "calculate") {
        const p = scene.step.parameters,
          symbols = { add: "+", subtract: "−", multiply: "×", divide: "÷" };
        note =
          p.left +
          " " +
          symbols[p.op] +
          " " +
          (p.right.column || displayValue(p.right.constant)) +
          " → " +
          p.name;
      }
      if (scene.kind === "case_when")
        note = tx(
          "Each row chooses then or otherwise. Missing comparisons choose otherwise; inspect a cell for both input types.",
          "各行で then または otherwise を選びます。比較が欠損のときは otherwise です。セルで入力の二種類を確認できます。",
        );
      if (scene.kind === "coalesce")
        note = tx(
          "Columns are checked from left to right. The first present value moves into the result; missing candidates remain decision inputs.",
          "列を左から調べ、最初の欠損でない値を結果へ移します。欠損だった候補は判定入力として残します。",
        );
      if (scene.kind === "window")
        note = tx(
          "Rows are used in their current order. Sort first for a chronological result; inspect a result for exact window members.",
          "現在の行順で計算します。時系列なら先に並べ替えてください。結果のセルから対象行を確認できます。",
        );
      if (scene.kind === "group_transform") {
        const p = scene.step.parameters;
        note = tx(
          "Each row keeps its original identity while receiving its group's " +
            p.op +
            ". Missing-key exclusions: " +
            p.excluded_rows.length +
            ".",
          "元の行を残したまま、グループの" +
            p.op +
            "を各行へ付けます。欠損キーによる除外: " +
            p.excluded_rows.length +
            "行。",
        );
      }
      if (scene.kind === "melt")
        note = tx(
          "Values from " +
            scene.step.parameters.value_vars.length +
            " columns move into one value column; column names become labels.",
          scene.step.parameters.value_vars.length +
            "列の値を1列にまとめ、元の列名をラベルとして残します。",
        );
      if (scene.kind === "pivot")
        note = tx(
          "Recorded values move to the matching named column. Empty combinations remain missing.",
          "記録した値を、対応する名前の列へ移します。元の値がない組み合わせは欠損として残ります。",
        );
      notice.textContent = presentation.note ? presentation.note + " " + note : note;
      backToStep.hidden = !state.inspection;
      renderReference(scene, rows);
      limitInfo.replaceChildren();
      const scope = workbench.query ? "matching" : "recorded";
      const rowSummary =
        language === "ja"
          ? (workbench.query ? "検索結果 " : "記録した全") +
            allRows.length +
            "行中 " +
            rows.length +
            "行を表示" +
            (paged
              ? " · " + (state.tablePage + 1) + "/" + Math.ceil(allRows.length / 100) + " ページ"
              : "")
          : paged
            ? "Page " +
              (state.tablePage + 1) +
              " of " +
              Math.ceil(allRows.length / 100) +
              " · " +
              rows.length +
              " of " +
              allRows.length +
              " " +
              scope +
              " rows shown; calculations use all rows."
            : rows.length === allRows.length
              ? "All " + allRows.length + " " + scope + " rows shown"
              : "Showing " +
                rows.length +
                " of " +
                allRows.length +
                " rows; calculations use all recorded rows.";
      limitInfo.append(el("span", "", rowSummary));
      if (allRows.length > 12) {
        const toggle = button(
          state.all
            ? tx("Show first 12", "先頭12行に戻す")
            : (allRows.length > 200
                ? tx("Browse all ", "全行をページで見る: ")
                : tx("Show all ", "全行を表示: ")) + allRows.length,
          () => {
            stop();
            state.all = !state.all;
            state.tablePage = 0;
            lastKey = null;
            render();
          },
          "text-button",
        );
        toggle.dataset.action = "show-rows";
        limitInfo.append(toggle);
      }
      if (paged) renderRowPager(allRows);
      chapterButtons.forEach((b, i) => {
        if (i === state.index) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      });
      const chapter = chapterButtons[state.index],
        navBox = nav.getBoundingClientRect(),
        chapterBox = chapter?.getBoundingClientRect();
      if (chapterBox) {
        if (chapterBox.top < navBox.top) nav.scrollTop -= navBox.top - chapterBox.top;
        else if (chapterBox.bottom > navBox.bottom)
          nav.scrollTop += chapterBox.bottom - navBox.bottom;
        if (chapterBox.left < navBox.left) nav.scrollLeft -= navBox.left - chapterBox.left;
        else if (chapterBox.right > navBox.right) nav.scrollLeft += chapterBox.right - navBox.right;
      }
      prev.disabled = state.index === 0;
      next.disabled = state.index === scenes.length - 1;
      if (!replaying)
        replay.disabled =
          state.inspection ||
          state.index === 0 ||
          state.all ||
          state.reduceMotion ||
          reduced.matches ||
          workbench.mode !== "table" ||
          Boolean(workbench.query);
      workbench.render(scene, allRows);
      legend.hidden = workbench.mode !== "table";
      motionStatus.hidden = workbench.mode !== "table";
      refreshSelection();
      if (["show-rows", "rows-previous", "rows-next"].includes(focusedAction)) {
        const control = limitInfo.querySelector('[data-action="' + focusedAction + '"]');
        if (control && !control.disabled) control.focus({ preventScroll: true });
        else caption.focus({ preventScroll: true });
      }
      motionStatus.textContent = "";
      if (shouldAnimate) animateTransition(scene, oldRows, oldCells, rows);
      else if (
        [
          "merge",
          "sum",
          "mean",
          "count",
          "aggregate",
          "melt",
          "pivot",
          "calculate",
          "case_when",
          "coalesce",
          "window",
          "group_transform",
        ].includes(scene.kind) &&
        workbench.mode === "table"
      ) {
        motionStatus.textContent =
          state.reduceMotion || reduced.matches
            ? tx(
                "Motion is reduced. Select a result to inspect its inputs.",
                "動きを抑えて表示しています。結果のセルから入力元を確認できます。",
              )
            : state.all
              ? tx(
                  "Expanded tables stay still. Select a value to inspect its inputs.",
                  "全行・ページ表示中は動かしません。値を選ぶと入力元を確認できます。",
                )
              : tx(
                  "Replay the movement to follow the visible inputs into this result.",
                  "「移動をもう一度見る」で、この結果へ集まる入力を確認できます。",
                );
      }
      lastKey = sceneKey;
      lastIndex = state.index;
    }
    function renderRowPager(allRows) {
      const pager = el("div", "table-pager"),
        move = (delta) => {
          stop();
          state.tablePage += delta;
          lastKey = null;
          render();
        };
      const previous = button(tx("← Previous rows", "← 前のページ"), () => move(-1), "text-button"),
        next = button(tx("Next rows →", "次のページ →"), () => move(1), "text-button");
      previous.dataset.action = "rows-previous";
      next.dataset.action = "rows-next";
      previous.disabled = state.tablePage === 0;
      next.disabled = (state.tablePage + 1) * 100 >= allRows.length;
      const form = el("form", "jump-form"),
        label = el("label", "", tx("Table row number ", "表の行番号 ")),
        number = el("input"),
        message = el("span", "jump-message");
      number.type = "number";
      number.min = "1";
      number.max = String(activeScene().table.rows.length);
      number.step = "1";
      number.value = String(allRows[state.tablePage * 100].position + 1);
      number.dataset.action = "row-number";
      label.append(number);
      message.setAttribute("role", "status");
      const jump = button(
        tx("Go to row", "行へ移動"),
        () => {
          const row = Number(number.value) - 1;
          if (
            !Number.isSafeInteger(row) ||
            row < 0 ||
            row >= activeScene().table.rows.length ||
            !number.value.trim()
          ) {
            message.textContent =
              language === "ja"
                ? "表の行番号を1〜" + activeScene().table.rows.length + "の範囲で入力してください。"
                : "Enter a table row number from 1 to " + activeScene().table.rows.length + ".";
            return;
          }
          const position = allRows.findIndex((r) => r.position === row);
          if (position < 0) {
            message.textContent = tx(
              "That row is outside the search. Clear the search to visit it.",
              "その行は検索結果に含まれません。検索を解除して確認してください。",
            );
            return;
          }
          stop();
          state.tablePage = Math.floor(position / 100);
          lastKey = null;
          render();
          revealCell({
            step: activeScene().table.id,
            row,
            column: activeScene().table.columns[0],
          });
        },
        "text-button",
      );
      jump.dataset.action = "rows-jump";
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        jump.click();
      });
      form.append(label, jump, message);
      pager.append(previous, next, form);
      limitInfo.append(pager);
    }
    window.addEventListener("resize", settleAnimations);
    document.addEventListener(
      "scroll",
      (event) => {
        if (event.target === nav) return;
        settleAnimations();
      },
      true,
    );
    render();
    root.dataset.ready = "true";
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
    });
    reduced.addEventListener("change", () => {
      motionCheckbox.checked = state.reduceMotion || reduced.matches;
      motionCheckbox.disabled = reduced.matches;
      stop();
      lastKey = null;
      render();
    });
  } catch (error) {
    root.replaceChildren(
      el(
        "div",
        "error",
        tx("Could not load this story: ", "ストーリーを読み込めませんでした: ") + error.message,
      ),
    );
    root.dataset.ready = "error";
  }
})();
