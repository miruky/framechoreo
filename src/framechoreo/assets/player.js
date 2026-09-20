/* Standalone player: recorded values only, never evaluates Python or makes requests. */
(function () {
  "use strict";
  const root = document.getElementById("framechoreo-player");
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
  try {
    const data = JSON.parse(document.getElementById("framechoreo-data").textContent);
    const model = globalThis.FrameChoreoModel,
      steps = model.indexStory(data),
      scenes = model.scenes(data);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const state = {
      index: 0,
      playing: false,
      speed: 1,
      all: false,
      selection: null,
      inspection: null,
      returnAll: false,
      originPage: 0,
      reduceMotion: reduced.matches,
    };
    let timer = null,
      deadline = 0,
      remainingHold = null,
      lastKey = null,
      animationNodes = [],
      rowAnimations = [];
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
    motionCheckbox.checked = state.reduceMotion;
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
    root.append(inspector);
    const inspectorHead = el("div", "inspector-head", "SELECT A VALUE"),
      selectedValue = el("div", "selected-value", "Select any cell to trace its value inputs.");
    const selectedType = el("div", "value-type");
    const origins = el("div", "origins"),
      originPager = el("div", "origin-pager"),
      explanation = el("div", "explanation");
    inspector.append(inspectorHead, selectedValue, selectedType, origins, originPager, explanation);
    const disclosure = el("details", "disclosure");
    disclosure.append(
      el("summary", "", "About the data in this file"),
      el(
        "p",
        "",
        "This file includes all recorded ancestor tables, including filtered-out rows. Display limits do not remove data. Review source tables before sharing. Playback uses recorded results and makes no network requests.",
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
      if (
        state.selection.step === step &&
        state.selection.row === row &&
        state.selection.column === column
      )
        return true;
      return state.selection.origins.some(
        (o) => o.step === step && o.row === row && o.column === column,
      );
    }
    function selectCell(step, row, column) {
      stop();
      const tableData = steps.get(step),
        cell = tableData.rows[row].cells[tableData.columns.indexOf(column)];
      state.selection = null;
      state.originPage = 0;
      inspectorHead.textContent =
        model.tableLabel(data, tableData) + " · row " + (row + 1) + " · " + column;
      selectedValue.textContent = cell.display;
      selectedType.textContent = "Type: " + cell.type;
      origins.replaceChildren();
      originPager.replaceChildren();
      try {
        const inputs = model.traceCell(data, { step, row, column });
        state.selection = { step, row, column, origins: inputs };
        renderOrigins();
        explanation.textContent = inputs.length
          ? "Select an input above to inspect its source table. Repeated inputs are retained."
          : "No source value inputs: this can be an unmatched join cell or a sum with no non-missing values. Check the operation settings.";
      } catch (error) {
        origins.replaceChildren();
        explanation.textContent = error.message;
      }
      refreshSelection();
    }
    function reveal(node) {
      node.focus({ preventScroll: true });
      node.scrollIntoView({ block: "center", behavior: "auto" });
    }
    function inspectStep(step, target = null, all = false) {
      stop();
      if (!state.inspection) state.returnAll = state.all;
      state.inspection = step;
      state.all = all || (target !== null && target.row >= 12);
      lastKey = null;
      render();
      const cell =
        target &&
        [...board.querySelectorAll(".cell")].find(
          (b) =>
            b.dataset.step === target.step &&
            Number(b.dataset.row) === target.row &&
            b.dataset.column === target.column,
        );
      reveal(cell || caption);
    }
    function renderOrigins() {
      const inputs = state.selection.origins;
      const offset = state.originPage * 50;
      origins.replaceChildren();
      originPager.replaceChildren();
      for (const origin of inputs.slice(offset, offset + 50)) {
        const b = button("", () => inspectStep(origin.step, origin), "origin");
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
          el("span", "value", origin.cell.display),
        );
        origins.append(b);
      }
      if (inputs.length <= 50) return;
      const change = (delta, action) => {
        state.originPage += delta;
        renderOrigins();
        const control = originPager.querySelector('[data-action="' + action + '"]');
        (control.disabled ? origins.firstElementChild : control).focus();
      };
      const previous = button(
        "← Previous inputs",
        () => change(-1, "origins-previous"),
        "text-button",
      );
      const next = button("Next inputs →", () => change(1, "origins-next"), "text-button");
      previous.dataset.action = "origins-previous";
      next.dataset.action = "origins-next";
      previous.disabled = state.originPage === 0;
      next.disabled = offset + 50 >= inputs.length;
      const status = el(
        "span",
        "",
        offset +
          1 +
          "–" +
          Math.min(offset + 50, inputs.length) +
          " of " +
          inputs.length +
          " value inputs",
      );
      status.setAttribute("aria-live", "polite");
      originPager.append(previous, status, next);
    }
    function refreshSelection() {
      root.querySelectorAll("button[data-step]").forEach((b) => {
        const selected = isSelected(b.dataset.step, Number(b.dataset.row), b.dataset.column);
        b.classList.toggle("selected", selected);
        b.setAttribute("aria-pressed", String(selected));
      });
    }
    function cellButton(step, row, column, cell) {
      const b = button(cell.display, () => selectCell(step, row, column), "cell");
      b.dataset.step = step;
      b.dataset.row = String(row);
      b.dataset.column = column;
      b.dataset.type = cell.type;
      b.title = cell.display + "\nType: " + cell.type;
      b.setAttribute(
        "aria-label",
        column +
          ": " +
          cell.display +
          (cell.type === "missing" ? " (missing)" : "") +
          "; trace value inputs",
      );
      return b;
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
      const groupMap = new Map();
      if (scene.kind === "group")
        scene.step.parameters.groups.forEach((g, i) =>
          g.input_rows.forEach((r) => groupMap.set(r, i)),
        );
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
      const allRows = model.orderedRows(scene),
        rows = state.all ? allRows : allRows.slice(0, 12);
      const grid = "46px repeat(" + tableData.columns.length + ", minmax(100px, 1fr))";
      const minWidth = 46 + tableData.columns.length * 100;
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
        node.setAttribute("aria-rowindex", String(rows.indexOf(row) + 2));
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
          rows.length === allRows.length
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
          state.all ? "Show first 12" : "Show all " + allRows.length,
          () => {
            stop();
            state.all = !state.all;
            lastKey = null;
            render();
          },
          "text-button",
        );
        toggle.dataset.action = "show-rows";
        limitInfo.append(toggle);
      }
      chapterButtons.forEach((b, i) => {
        if (i === state.index) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      });
      prev.disabled = state.index === 0;
      next.disabled = state.index === scenes.length - 1;
      refreshSelection();
      if (focusedAction === "show-rows")
        limitInfo.querySelector("button")?.focus({ preventScroll: true });
      lastKey = sceneKey;
    }
    render();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
    });
    reduced.addEventListener("change", () => {
      state.reduceMotion = reduced.matches;
      motionCheckbox.checked = reduced.matches;
      motionCheckbox.disabled = reduced.matches;
      stop();
      lastKey = null;
      render();
    });
  } catch (error) {
    root.replaceChildren(el("div", "error", "Could not load this story: " + error.message));
  }
})();
