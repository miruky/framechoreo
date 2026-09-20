/* Standalone player: recorded values only, never evaluates Python or makes requests. */
(function startPlayer(preparedData) {
  "use strict";
  const root = document.getElementById("framechoreo-player");
  const dataNode = document.getElementById("framechoreo-data");
  if (dataNode.dataset.encoding === "gzip-base64" && preparedData === undefined) {
    root.textContent = "Opening story…";
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
      root.textContent = "Could not open this story: " + error.message;
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
  const count = (number, noun) => number + " " + noun + (number === 1 ? "" : "s");
  const blankKind = (cell) =>
    cell.type === "string" && !cell.display.trim()
      ? cell.display.length
        ? "whitespace"
        : "empty"
      : null;
  const displayValue = (cell) => (blankKind(cell) ? JSON.stringify(cell.display) : cell.display);
  const typeDescription = (cell) =>
    blankKind(cell) === "empty"
      ? "empty string"
      : blankKind(cell) === "whitespace"
        ? "whitespace-only string (" + count([...cell.display].length, "character") + ")"
        : cell.type;
  try {
    const data = preparedData === undefined ? JSON.parse(dataNode.textContent) : preparedData;
    dataNode.textContent = "";
    const model = globalThis.FrameChoreoModel,
      steps = model.indexStory(data),
      scenes = model.scenes(data, steps);
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
      originOffset: 0n,
      reduceMotion: false,
    };
    let timer = null,
      deadline = 0,
      remainingHold = null,
      lastKey = null,
      lastViewportKey = null,
      animationNodes = [],
      rowAnimations = [];
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
    const play = button("▶ Play", () => (state.playing ? stop() : start()), "button primary");
    const prev = button("← Previous", () => go(state.index - 1));
    const next = button("Next →", () => go(state.index + 1));
    const speed = el("label", "speed", "Speed "),
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
    motionLabel.append(motionCheckbox, el("span", "", "Reduce motion"));
    toolbar.append(play, prev, next, el("span", "spacer"), motionLabel, speed);
    root.append(toolbar);
    const nav = el("nav", "timeline");
    nav.setAttribute("aria-label", "Transformation steps");
    root.append(nav);
    const chapterButtons = scenes.map((scene, i) => {
      const names = {
        source: "Input",
        filter: "Filter",
        merge: "Join",
        group: "Group",
        sum: "Sum",
        sort: "Sort",
        select: "Columns",
        rename: "Rename",
        calculate: "Calculate",
      };
      const b = button(i + 1 + " · " + (names[scene.kind] || scene.kind), () => go(i), "chapter");
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
    heading.append(info, counter);
    shell.append(heading);
    const code = el("div", "code");
    shell.append(code);
    const body = el("div", "stage-body");
    shell.append(body);
    const notice = el("div", "notice");
    notice.setAttribute("aria-live", "polite");
    body.append(notice);
    const backToStep = button(
      "← Back to the transformation",
      () => {
        state.inspection = null;
        state.all = state.returnAll;
        state.tablePage = state.returnPage;
        lastKey = null;
        render();
        reveal(caption);
      },
      "text-button",
    );
    backToStep.hidden = true;
    body.append(backToStep);
    const reference = el("div");
    body.append(reference);
    const scroll = el("div", "table-scroll");
    body.append(scroll);
    const table = el("div");
    table.setAttribute("role", "table");
    table.setAttribute("aria-label", "Recorded values");
    scroll.append(table);
    const columnHead = el("div", "column-head");
    columnHead.setAttribute("role", "row");
    const board = el("div", "board");
    board.setAttribute("role", "rowgroup");
    table.append(columnHead, board);
    const limitInfo = el("div", "row-limit");
    body.append(limitInfo);
    const inspector = el("section", "inspector");
    inspector.setAttribute("aria-label", "Value origins");
    inspector.tabIndex = -1;
    root.append(inspector);
    const inspectorHead = el("div", "inspector-head", "SELECT A VALUE"),
      selectedValue = el("div", "selected-value", "Select any cell to trace its value inputs.");
    inspectorHead.id = "framechoreo-selected-cell";
    inspector.setAttribute("aria-describedby", inspectorHead.id);
    const selectedType = el("div", "value-type");
    const columnDtype = el("div", "value-type column-dtype");
    const origins = el("div", "origins"),
      originPager = el("div", "origin-pager"),
      explanation = el("div", "explanation");
    const clearSelection = button(
      "Clear selection",
      () => {
        settleAnimations();
        const target = board.querySelector(".cell.selected") || caption;
        state.selection = null;
        state.selectionLocation = null;
        state.originOffset = 0n;
        inspectorHead.textContent = "SELECT A VALUE";
        selectedValue.textContent = "Select any cell to trace its value inputs.";
        selectedType.textContent = "";
        columnDtype.textContent = "";
        origins.replaceChildren();
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
    const returnSelection = button("Back to selected cell", returnToSelection, "text-button");
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
      origins,
      originPager,
      explanation,
    );
    const disclosure = el("details", "disclosure");
    disclosure.append(
      el("summary", "", "About the data in this file"),
      el(
        "p",
        "",
        "This file includes all recorded ancestor tables, including filtered-out rows and removed columns. Compression and display limits do not remove data. Review source tables before sharing. Playback uses recorded results and makes no network requests.",
      ),
    );
    root.append(
      disclosure,
      el(
        "div",
        "footer",
        "FrameChoreo " +
          data.library_version +
          " · pandas " +
          data.pandas_version +
          " · schema " +
          data.schema_version,
      ),
    );

    function stop() {
      if (state.playing && timer !== null) {
        remainingHold = Math.max(0, (deadline - performance.now()) * state.speed);
      }
      state.playing = false;
      clearTimeout(timer);
      timer = null;
      play.textContent = "▶ Play";
      rowAnimations.forEach((animation) => {
        if (animation.playState === "running") animation.pause();
      });
    }
    function settleAnimations() {
      rowAnimations.forEach((animation) => animation.cancel());
      rowAnimations = [];
      animationNodes.forEach((node) => node.remove());
      animationNodes = [];
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
        lastKey = null;
        render();
      }
      if (state.index === scenes.length - 1 && remainingHold === null) go(0, true);
      state.playing = true;
      play.textContent = "Ⅱ Pause";
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
    function isSelected(step, row, column) {
      if (!state.selection) return false;
      return (
        (state.selection.step === step &&
          state.selection.row === row &&
          state.selection.column === column) ||
        state.selection.trace.hasSource(step, row, column)
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
      };
      state.originOffset = 0n;
      inspectorHead.textContent =
        model.tableLabel(data, tableData) + " · row " + (row + 1) + " · " + column;
      selectedValue.textContent = displayValue(cell);
      selectedType.textContent = "Type: " + typeDescription(cell);
      columnDtype.textContent = dtypeLabel(step, column);
      clearSelection.hidden = false;
      returnSelection.hidden = false;
      explanation.classList.remove("calculation-note");
      origins.replaceChildren();
      originPager.replaceChildren();
      try {
        const trace = model.prepareTrace(data, { step, row, column }, steps);
        state.selection = { step, row, column, trace };
        renderOrigins();
        const details = model.cellExplanation(steps, { step, row, column });
        const instructions =
          trace.total > 0n
            ? "Select an input above to inspect its source table. Repeated inputs are retained."
            : "No raw source value inputs were recorded for this cell.";
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
      reveal(findBoardCell(target) || caption);
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
      }
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
        b.title = "Type: " + typeDescription(origin.cell);
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
          "← Previous inputs",
          () => change(-50n, "origins-previous"),
          "text-button",
        ),
        next = button("Next inputs →", () => change(50n, "origins-next"), "text-button");
      previous.dataset.action = "origins-previous";
      next.dataset.action = "origins-next";
      previous.disabled = offset === 0n;
      next.disabled = !page.has_next;
      const status = el(
        "span",
        "",
        offset + 1n + "–" + (offset + BigInt(inputs.length)) + " of " + total + " value inputs",
      );
      status.setAttribute("aria-live", "polite");
      originPager.append(previous, status, next);
      if (total > 200n) {
        const form = el("form", "jump-form"),
          label = el("label", "", "Input number "),
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
          "Go to input",
          () => {
            if (
              !/^[1-9][0-9]*$/.test(number.value) ||
              number.value.length > 100 ||
              BigInt(number.value) > total
            ) {
              message.textContent = "Enter an input number from 1 to " + total + ".";
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
      root.querySelectorAll("button[data-step]").forEach((b) => {
        const selected = isSelected(b.dataset.step, Number(b.dataset.row), b.dataset.column);
        b.classList.toggle("selected", selected);
        b.setAttribute("aria-pressed", String(selected));
      });
    }
    function cellButton(step, row, column, cell) {
      const b = button(displayValue(cell), () => selectCell(step, row, column), "cell");
      b.dataset.step = step;
      b.dataset.row = String(row);
      b.dataset.column = column;
      b.dataset.type = cell.type;
      if (blankKind(cell)) b.dataset.blank = blankKind(cell);
      const dtype = dtypeLabel(step, column);
      b.title =
        displayValue(cell) + "\nType: " + typeDescription(cell) + (dtype ? "\n" + dtype : "");
      b.setAttribute(
        "aria-label",
        column +
          ": " +
          displayValue(cell) +
          (cell.type === "missing"
            ? " (missing)"
            : blankKind(cell)
              ? " (" + typeDescription(cell) + ")"
              : "") +
          "; trace value inputs",
      );
      return b;
    }
    function dtypeLabel(step, column) {
      const tableData = steps.get(step),
        dtype = tableData.dtypes?.[tableData.columns.indexOf(column)];
      return typeof dtype === "string" ? "Column dtype: " + dtype : "";
    }
    function renderReference(scene) {
      const wasOpen =
        reference.firstElementChild?.dataset.step === scene.step.id &&
        reference.firstElementChild.open;
      reference.replaceChildren();
      if (scene.kind !== "merge" || state.inspection) return;
      const right = steps.get(scene.step.parents[1]);
      const details = el("details", "reference");
      details.dataset.step = scene.step.id;
      details.open = Boolean(wasOpen);
      details.append(
        el(
          "summary",
          "",
          "Right input: " + model.tableLabel(data, right) + " · " + right.rows.length + " rows",
        ),
      );
      const area = el("div", "ref-table"),
        t = el("table"),
        head = el("thead"),
        tr = el("tr");
      for (const col of right.columns) tr.append(el("th", "", col));
      head.append(tr);
      t.append(head);
      const tbody = el("tbody");
      right.rows.slice(0, 12).forEach((row) => {
        const r = el("tr");
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
            "Showing 12 of " + right.rows.length + " right-input rows. All are recorded.",
          ),
        );
      details.append(area);
      const inspect = button(
        "Inspect all " + right.rows.length + " rows",
        () => inspectStep(right.id, null, true),
        "text-button inspect-input",
      );
      inspect.dataset.action = "inspect-right";
      details.append(inspect);
      reference.append(details);
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
        const group =
          scene.kind === "group"
            ? groupMap.has(row.position)
              ? groupMap.get(row.position)
              : -1
            : scene.kind === "sum"
              ? row.position
              : null;
        if (scene.kind === "group" && group !== lastGroup) {
          result.push({
            band: true,
            y,
            label: group < 0 ? "Excluded missing-key rows" : model.groupTitle(scene, group),
            group,
          });
          y += 36;
          lastGroup = group;
        }
        result.push({ row, y, group });
        positions.set(model.rowKey(scene.table.id, row.position), y);
        y += 46;
      }
      return { items: result, positions, height: Math.max(70, y) };
    }
    function render() {
      const focusedAction = document.activeElement?.dataset.action;
      const scene = activeScene(),
        tableData = scene.table,
        sceneKey = scene.table.id + ":" + scene.kind + ":" + (state.inspection || "");
      const shouldAnimate =
        lastKey !== null &&
        lastKey !== sceneKey &&
        !state.reduceMotion &&
        !reduced.matches &&
        !state.all &&
        !scroll.classList.contains("paged") &&
        !state.inspection &&
        typeof board.animate === "function";
      root.classList.toggle("reduce-motion", state.reduceMotion || reduced.matches);
      animationNodes.forEach((n) => n.remove());
      animationNodes = [];
      const oldRows = [...board.querySelectorAll(".data-row")].map((n) => ({
        key: n.dataset.ref,
        top: n.getBoundingClientRect().top - board.getBoundingClientRect().top,
        parents: JSON.parse(n.dataset.parents || "[]"),
        node: n.cloneNode(true),
      }));
      rowAnimations.forEach((animation) => animation.cancel());
      rowAnimations = [];
      const oldMap = new Map(oldRows.map((r) => [r.key, r]));
      board.replaceChildren();
      columnHead.replaceChildren();
      const allRows = orderedRows(scene),
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
      const grid = "46px repeat(" + tableData.columns.length + ", minmax(100px, 1fr))";
      const minWidth = 49 + tableData.columns.length * 100;
      table.style.minWidth = minWidth + "px";
      columnHead.style.gridTemplateColumns = grid;
      const numberHead = el("div", "", "Row");
      numberHead.setAttribute("role", "columnheader");
      columnHead.append(numberHead);
      const presentation = scene.step.presentation || {};
      tableData.columns.forEach((col) => {
        const h = el("div", "", col);
        h.title = col;
        h.setAttribute("role", "columnheader");
        if ((presentation.highlight || []).includes(col)) h.classList.add("highlight");
        columnHead.append(h);
      });
      table.setAttribute("aria-rowcount", String(tableData.rows.length + 1));
      table.setAttribute("aria-colcount", String(tableData.columns.length + 1));
      const geometry = layout(scene, rows),
        usedAnchors = new Set(),
        targets = new Map();
      const duration = 750;
      const animate = (node, frames, options) => {
        const animation = node.animate(frames, options);
        animation.updatePlaybackRate(state.speed);
        rowAnimations.push(animation);
        return animation;
      };
      for (const entry of geometry.items) {
        if (entry.band) {
          const band = el("div", "group-band", entry.label);
          band.title = entry.label;
          band.style.top = entry.y + "px";
          band.style.borderLeftColor =
            entry.group < 0 ? "var(--line)" : "var(--g" + (entry.group % 6) + ")";
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
        if (entry.group !== null && entry.group >= 0)
          node.style.borderLeftColor = "var(--g" + (entry.group % 6) + ")";
        const number = el("div", "row-number", String(row.position + 1));
        number.setAttribute("role", "rowheader");
        node.append(number);
        row.cells.forEach((cell, i) => {
          const wrap = el("div", "cell-wrap");
          wrap.setAttribute("role", "cell");
          wrap.append(cellButton(tableData.id, row.position, tableData.columns[i], cell));
          node.append(wrap);
        });
        board.append(node);
        const candidates = [key, ...row.parents.map((p) => model.rowKey(p.step, p.row))];
        for (const parent of candidates) targets.set(parent, entry.y);
        const anchor =
          candidates.find((k) => oldMap.has(k)) ??
          oldRows.find((old) => old.parents.includes(key))?.key;
        if (shouldAnimate && anchor) {
          usedAnchors.add(anchor);
          const dy = oldMap.get(anchor).top - entry.y;
          animate(
            node,
            [{ transform: "translateY(" + dy + "px)" }, { transform: "translateY(0)" }],
            { duration, easing: "cubic-bezier(.2,.75,.2,1)" },
          );
        } else if (shouldAnimate) {
          animate(
            node,
            [
              { transform: "translateX(20px)", opacity: 0 },
              { transform: "translateX(0)", opacity: 1 },
            ],
            { duration },
          );
        }
      }
      if (rows.length === 0) board.append(el("div", "empty", "No rows remain in this step."));
      board.style.height = geometry.height + "px";
      if (shouldAnimate) {
        for (const old of oldRows) {
          if (usedAnchors.has(old.key)) continue;
          const ghost = old.node;
          ghost.classList.add("ghost");
          ghost.setAttribute("aria-hidden", "true");
          ghost.querySelectorAll("button").forEach((b) => (b.disabled = true));
          board.append(ghost);
          animationNodes.push(ghost);
          const target = targets.get(old.key),
            dy = target === undefined ? 0 : target - old.top;
          const anim = animate(
            ghost,
            [
              { transform: "translate(0,0)", opacity: 0.6 },
              {
                transform:
                  "translate(" + (target === undefined ? 36 : 0) + "px," + dy + "px) scale(.96)",
                opacity: 0,
              },
            ],
            { duration, easing: "ease-in", fill: "forwards" },
          );
          anim.onfinish = () => ghost.remove();
        }
      }
      operation.textContent = scene.kind.toUpperCase();
      caption.textContent = state.inspection
        ? model.tableLabel(data, tableData)
        : scene.kind === "group"
          ? "Form the groups"
          : model.tableLabel(data, scene.step);
      counter.textContent =
        count(tableData.rows.length, "row") + " · " + count(tableData.columns.length, "column");
      code.textContent = state.inspection
        ? scene.kind === "source"
          ? "Recorded source table"
          : "Recorded join input"
        : model.description(scene);
      let note = "Select a value to follow its source cells.";
      if (scene.kind === "filter")
        note =
          count(scene.step.parameters.removed_rows, "row") +
          " excluded; source rows remain available.";
      if (scene.kind === "merge") {
        const n = scene.step.parameters.unmatched_rows;
        note =
          count(n, "output row") +
          (n === 1 ? " has" : " have") +
          " no right-side match. Validation: " +
          scene.step.parameters.validate +
          ".";
      }
      if (scene.kind === "group" || scene.kind === "sum")
        note =
          "Missing keys " +
          (scene.step.parameters.dropna ? "are excluded" : "are kept") +
          "; " +
          count(scene.step.parameters.excluded_rows, "input row") +
          " excluded by grouping. min_count=" +
          scene.step.parameters.min_count +
          ".";
      notice.textContent = presentation.note ? presentation.note + " " + note : note;
      backToStep.hidden = !state.inspection;
      renderReference(scene);
      limitInfo.replaceChildren();
      limitInfo.append(
        el(
          "span",
          "",
          paged
            ? "Page " +
                (state.tablePage + 1) +
                " of " +
                Math.ceil(allRows.length / 100) +
                " · " +
                rows.length +
                " of " +
                allRows.length +
                " recorded rows shown; calculations use all rows."
            : rows.length === allRows.length
              ? "All " + allRows.length + " recorded rows shown"
              : "Showing " +
                rows.length +
                " of " +
                allRows.length +
                " rows; calculations use all recorded rows.",
        ),
      );
      if (allRows.length > 12) {
        const toggle = button(
          state.all
            ? "Show first 12"
            : (allRows.length > 200 ? "Browse all " : "Show all ") + allRows.length,
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
      prev.disabled = state.index === 0;
      next.disabled = state.index === scenes.length - 1;
      refreshSelection();
      if (["show-rows", "rows-previous", "rows-next"].includes(focusedAction)) {
        const control = limitInfo.querySelector('[data-action="' + focusedAction + '"]');
        if (control && !control.disabled) control.focus({ preventScroll: true });
        else caption.focus({ preventScroll: true });
      }
      lastKey = sceneKey;
    }
    function renderRowPager(allRows) {
      const pager = el("div", "table-pager"),
        move = (delta) => {
          stop();
          state.tablePage += delta;
          lastKey = null;
          render();
        };
      const previous = button("← Previous rows", () => move(-1), "text-button"),
        next = button("Next rows →", () => move(1), "text-button");
      previous.dataset.action = "rows-previous";
      next.dataset.action = "rows-next";
      previous.disabled = state.tablePage === 0;
      next.disabled = (state.tablePage + 1) * 100 >= allRows.length;
      const form = el("form", "jump-form"),
        label = el("label", "", "Table row number "),
        number = el("input"),
        message = el("span", "jump-message");
      number.type = "number";
      number.min = "1";
      number.max = String(allRows.length);
      number.step = "1";
      number.value = String(allRows[state.tablePage * 100].position + 1);
      number.dataset.action = "row-number";
      label.append(number);
      message.setAttribute("role", "status");
      const jump = button(
        "Go to row",
        () => {
          const row = Number(number.value) - 1;
          if (
            !Number.isSafeInteger(row) ||
            row < 0 ||
            row >= allRows.length ||
            !number.value.trim()
          ) {
            message.textContent = "Enter a table row number from 1 to " + allRows.length + ".";
            return;
          }
          stop();
          state.tablePage = Math.floor(allRows.findIndex((r) => r.position === row) / 100);
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
    root.replaceChildren(el("div", "error", "Could not load this story: " + error.message));
    root.dataset.ready = "error";
  }
})();
