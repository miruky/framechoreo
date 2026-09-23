/* Reader-only views. These never modify a recorded table or its provenance. */
(function (root) {
  "use strict";
  function create(o) {
    const { data, steps, scenes, el, button, cellButton, displayValue, tx } = o;
    let state = {
      table: null,
      mode: "table",
      query: "",
      columns: null,
      metric: "",
      chartKind: "bar",
      xMetric: "",
      before: null,
    };
    const profileCache = new Map();
    function profile(table) {
      if (profileCache.has(table.id)) return profileCache.get(table.id);
      const value = table.profile || {
        rows: table.rows.length,
        column_count: table.columns.length,
        duplicate_rows: null,
        columns: table.columns.map((name, i) => ({
          name,
          dtype: table.dtypes?.[i] || "—",
          missing: table.rows.reduce((n, row) => n + (row.cells[i].type === "missing" ? 1 : 0), 0),
          unique: null,
        })),
      };
      if (value.missing_cells === undefined)
        value.missing_cells = value.columns.reduce((n, c) => n + c.missing, 0);
      profileCache.set(table.id, value);
      return value;
    }
    const pretty = (n) => (n === null || n === undefined ? "—" : String(n));
    function stat(label, value, key) {
      const item = el("div", "stat-item"),
        number = el("strong", "stat-number", pretty(value));
      if (key) number.dataset.stat = key;
      item.append(number, el("span", "stat-label", label));
      return item;
    }
    const header = el("header", "story-header"),
      heading = el("div", "story-heading"),
      overview = el("div", "story-overview");
    o.root.insertBefore(header, o.root.firstChild);
    heading.append(o.brand, o.title);
    if (data.description) heading.append(el("p", "story-description", data.description));
    overview.append(
      stat(tx("Steps", "工程"), scenes.length),
      stat(tx("Sources", "入力表"), data.steps.filter((s) => s.operation === "source").length),
      stat(tx("Result rows", "結果の行数"), steps.get(data.result)?.rows.length || 0),
    );
    header.append(heading, overview);
    const workspace = el("div", "workspace"),
      sidebar = el("aside", "story-sidebar"),
      content = el("div", "story-content");
    o.root.insertBefore(workspace, o.nav);
    sidebar.append(el("div", "sidebar-heading", tx("THE ANALYSIS", "分析の流れ")), o.nav);
    const catalog = el("details", "table-catalog");
    catalog.addEventListener("toggle", o.settle);
    catalog.append(
      el(
        "summary",
        "",
        tx("All recorded tables", "記録した表をすべて見る") + " · " + data.steps.length,
      ),
    );
    const tableLinks = el("div", "table-links");
    for (const table of data.steps) {
      const b = button("", () => o.inspect(table.id), "table-link");
      b.dataset.table = table.id;
      b.append(
        el("span", "", root.FrameChoreoModel.tableLabel(data, table)),
        el("small", "muted", table.rows.length + tx(" rows", " 行")),
      );
      tableLinks.append(b);
    }
    catalog.append(tableLinks);
    sidebar.append(catalog);
    content.append(o.shell, o.inspector, o.disclosure);
    workspace.append(sidebar, content);
    const themeLabel = el("label", "theme-control", tx("Theme ", "配色 ")),
      theme = el("select");
    theme.setAttribute("aria-label", tx("Theme", "配色"));
    for (const [value, label] of [
      ["auto", tx("Auto", "自動")],
      ["light", tx("Light", "ライト")],
      ["dark", tx("Dark", "ダーク")],
    ]) {
      const option = el("option", "", label);
      option.value = value;
      theme.append(option);
    }
    theme.value = document.documentElement.dataset.theme || "auto";
    theme.addEventListener("change", () => {
      document.documentElement.dataset.theme = theme.value;
    });
    themeLabel.append(theme);
    o.toolbar.append(themeLabel);

    const modeBar = el("div", "view-tabs"),
      tabs = new Map();
    modeBar.setAttribute("role", "tablist");
    modeBar.setAttribute("aria-label", tx("Data views", "データの見方"));
    for (const [id, label] of [
      ["table", tx("Table", "表を見る")],
      ["compare", tx("Before / after", "前後を比較")],
      ["quality", tx("Data quality", "データ品質")],
      ["chart", tx("Chart", "グラフ")],
    ]) {
      const b = button(
        label,
        () => {
          state.mode = id;
          o.change(false);
        },
        "view-tab",
      );
      b.dataset.view = id;
      b.id = "fc-tab-" + id;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", "fc-view-" + id);
      b.addEventListener("keydown", (event) => {
        const ids = [...tabs.keys()];
        let index = ids.indexOf(id);
        if (event.key === "ArrowRight") index = (index + 1) % ids.length;
        else if (event.key === "ArrowLeft") index = (index - 1 + ids.length) % ids.length;
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = ids.length - 1;
        else return;
        event.preventDefault();
        tabs.get(ids[index]).click();
        tabs.get(ids[index]).focus();
      });
      modeBar.append(b);
      tabs.set(id, b);
    }
    const changes = el("div", "step-stats"),
      inputLinks = el("div", "input-links"),
      viewTools = el("div", "view-tools");
    const form = el("form", "table-search"),
      searchInput = el("input"),
      find = button(tx("Find", "検索"), () => applySearch());
    searchInput.type = "search";
    searchInput.maxLength = 200;
    searchInput.placeholder = tx("Search all recorded fields…", "すべての列から値を探す…");
    searchInput.setAttribute("aria-label", tx("Search recorded values", "記録した値を検索"));
    searchInput.dataset.action = "search-rows";
    const clear = button(
      tx("Clear", "解除"),
      () => {
        state.query = "";
        searchInput.value = "";
        o.change(true);
        searchInput.focus();
      },
      "text-button",
    );
    clear.dataset.action = "clear-search";
    function applySearch() {
      state.query = searchInput.value;
      o.change(true);
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      applySearch();
    });
    searchInput.addEventListener("search", applySearch);
    form.append(searchInput, find, clear);
    const picker = el("details", "column-picker"),
      pickerTitle = el("summary"),
      choices = el("div", "column-choices");
    picker.append(pickerTitle, choices);
    picker.addEventListener("toggle", () => o.settle());
    viewTools.append(form, picker);
    const status = el("div", "view-status");
    status.setAttribute("role", "status");
    o.body.insertBefore(inputLinks, o.body.firstChild);
    o.body.insertBefore(changes, o.body.firstChild);
    o.body.insertBefore(modeBar, o.body.firstChild);
    o.body.insertBefore(viewTools, o.dataStage);
    o.body.insertBefore(status, o.dataStage);
    const panels = {
      table: o.dataStage,
      compare: el("section", "compare-panel"),
      quality: el("section", "quality-panel"),
      chart: el("section", "chart-panel"),
    };
    for (const [name, panel] of Object.entries(panels)) {
      panel.id = "fc-view-" + name;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", "fc-tab-" + name);
      if (name !== "table") o.body.append(panel);
    }
    function sync(scene) {
      if (state.table !== scene.table.id) {
        state.table = scene.table.id;
        state.query = "";
        state.columns = null;
        state.metric = "";
        state.chartKind = "bar";
        state.xMetric = "";
        state.before = null;
      }
    }
    function columns(scene) {
      return scene.table.columns.filter((c) => !state.columns || state.columns.includes(c));
    }
    function filter(rows) {
      if (!state.query) return rows;
      const query = state.query.toLowerCase();
      return rows.filter((row) =>
        row.cells.some((cell) => displayValue(cell).toLowerCase().includes(query)),
      );
    }
    function preview(table, title, compare = null) {
      const section = el("section", "comparison-side"),
        heading = el("h3", "", title),
        area = el("div", "comparison-scroll"),
        t = el("table", "comparison-table");
      const head = el("thead"),
        tr = el("tr");
      tr.append(el("th", "", tx("Row", "行")));
      table.columns.forEach((name, i) => {
        const th = el("th");
        th.append(
          el("span", "comparison-column", name),
          el("small", "comparison-dtype", table.dtypes?.[i] || ""),
        );
        tr.append(th);
      });
      head.append(tr);
      t.append(head);
      const body = el("tbody");
      for (const row of table.rows.slice(0, 6)) {
        const r = el("tr");
        r.append(el("th", "", row.position + 1));
        row.cells.forEach((cell, i) => {
          const column = table.columns[i],
            td = el("td"),
            b = cellButton(table.id, row.position, column, cell);
          if (compare) {
            const refs = row.cell_parents[column] || [],
              ref = refs.length === 1 ? refs[0] : null;
            const old =
              ref && ref.step === compare.id
                ? compare.rows[ref.row].cells[compare.columns.indexOf(ref.column)]
                : null;
            if (
              !old ||
              old.type !== cell.type ||
              old.value !== cell.value ||
              old.display !== cell.display
            )
              td.classList.add("changed-value");
          }
          td.append(b);
          r.append(td);
        });
        body.append(r);
      }
      t.append(body);
      area.append(t);
      section.append(
        heading,
        el(
          "p",
          "muted small",
          root.FrameChoreoModel.tableLabel(data, table) +
            " · " +
            table.rows.length +
            tx(" recorded rows", " 行を記録"),
        ),
        area,
      );
      if (table.rows.length > 6)
        section.append(
          el(
            "p",
            "small muted",
            tx(
              "First 6 rows shown. Select a value for its inputs.",
              "先頭6行を表示しています。値を選ぶと入力元を確認できます。",
            ),
          ),
        );
      return section;
    }
    function renderCompare(scene) {
      const panel = panels.compare;
      panel.replaceChildren();
      if (!scene.step.parents.length) {
        panel.append(
          el(
            "p",
            "empty",
            tx(
              "This is an input table. Choose a transformation to compare it with its input.",
              "ここは入力表です。加工の工程を選ぶと前後を比較できます。",
            ),
          ),
        );
        return;
      }
      const ids = [...new Set(scene.step.parents)];
      if (!ids.includes(state.before)) state.before = ids[0];
      if (ids.length > 1) {
        const label = el("label", "compare-choice", tx("Compare input ", "比較する入力表 ")),
          select = el("select");
        for (const id of ids) {
          const option = el("option", "", root.FrameChoreoModel.tableLabel(data, steps.get(id)));
          option.value = id;
          select.append(option);
        }
        select.value = state.before;
        select.addEventListener("change", () => {
          state.before = select.value;
          o.change(false);
          panels.compare.querySelector("select")?.focus({ preventScroll: true });
        });
        label.append(select);
        panel.append(label);
      }
      const before = steps.get(state.before),
        grid = el("div", "comparison-grid");
      grid.append(
        preview(before, tx("Before", "加工前")),
        preview(scene.step, tx("After", "加工後"), before),
      );
      panel.append(
        el(
          "p",
          "panel-caption",
          tx(
            "Recorded input and result, independent of the table search. Tinted cells changed or combine multiple inputs; this view does not recalculate data.",
            "検索による表示の絞り込みとは別に、記録した入力表と結果を並べています。色付きのセルは値が変わったか、複数の入力からできたものです。",
          ),
        ),
        grid,
      );
    }
    function renderQuality(scene) {
      const panel = panels.quality,
        p = profile(scene.table);
      panel.replaceChildren();
      const summary = el("div", "quality-summary");
      summary.append(
        stat(tx("Missing cells", "欠損セル"), p.missing_cells, "missing-cells"),
        stat(tx("Duplicate rows", "重複行"), p.duplicate_rows, "duplicate-rows"),
        stat(tx("Recorded rows", "記録した行"), p.rows),
      );
      panel.append(
        summary,
        el(
          "p",
          "panel-caption",
          tx(
            "Counts describe this recorded table. Unique counts exclude missing values; duplicate rows ignore the DataFrame index.",
            "この工程の表を集計しています。ユニーク値数は欠損を除き、重複行の判定にはDataFrameのインデックスを使いません。",
          ),
        ),
      );
      for (const c of p.columns) {
        const row = el("div", "quality-column"),
          name = el("div", "quality-name"),
          info = el("div", "quality-numbers");
        name.append(el("strong", "", c.name), el("code", "", c.dtype));
        info.append(
          el("span", "", tx("Missing: ", "欠損: ") + c.missing + " / " + p.rows),
          el("span", "", tx("Unique: ", "ユニーク値: ") + pretty(c.unique)),
        );
        const track = el("div", "quality-track"),
          fill = el("div", "quality-fill");
        fill.style.width = (p.rows ? (100 * c.missing) / p.rows : 0) + "%";
        track.setAttribute("aria-hidden", "true");
        track.append(fill);
        const focus = button(
          tx("View column", "列を見る"),
          () => {
            state.mode = "table";
            state.columns = [c.name];
            o.change(false);
            const cell = [...o.root.querySelectorAll(".data-row .cell")].find(
              (n) => n.dataset.column === c.name,
            );
            cell?.focus({ preventScroll: true });
            cell?.scrollIntoView({ block: "nearest", behavior: "auto" });
          },
          "text-button",
        );
        row.append(name, info, track, focus);
        panel.append(row);
      }
    }
    function renderChart(scene, rows) {
      root.FrameChoreoCharts.render({
        panel: panels.chart,
        scene,
        rows,
        state,
        el,
        cellButton,
        displayValue,
        tx,
        change: o.change,
        steps,
      });
    }
    function render(scene, rows) {
      const table = scene.table,
        p = profile(table),
        focusedColumn = document.activeElement?.dataset.columnChoice;
      searchInput.value = state.query;
      clear.hidden = !state.query;
      viewTools.hidden = !["table", "chart"].includes(state.mode);
      picker.hidden = state.mode !== "table";
      status.hidden = !["table", "chart"].includes(state.mode);
      status.textContent = state.query
        ? rows.length +
          tx(" of ", " / ") +
          table.rows.length +
          tx(
            " recorded rows match. Search changes this view only.",
            " 行に一致。検索は表示だけを絞ります。",
          )
        : "";
      const chosen = columns(scene);
      pickerTitle.textContent =
        tx("Columns ", "表示列 ") + chosen.length + "/" + table.columns.length;
      choices.replaceChildren();
      for (const name of table.columns) {
        const label = el("label"),
          input = el("input");
        input.type = "checkbox";
        input.checked = chosen.includes(name);
        input.disabled = input.checked && chosen.length === 1;
        input.dataset.columnChoice = name;
        input.addEventListener("change", () => {
          const current = new Set(columns(scene));
          if (input.checked) current.add(name);
          else current.delete(name);
          if (!current.size) {
            input.checked = true;
            return;
          }
          state.columns = table.columns.filter((c) => current.has(c));
          o.change(false);
        });
        label.append(input, el("span", "", name));
        choices.append(label);
      }
      if (focusedColumn)
        [...choices.querySelectorAll("input")]
          .find((n) => n.dataset.columnChoice === focusedColumn)
          ?.focus({ preventScroll: true });
      changes.replaceChildren(
        stat(tx("Rows", "行数"), p.rows),
        stat(tx("Fields", "列数"), p.column_count),
        stat(tx("Missing", "欠損セル"), p.missing_cells),
      );
      inputLinks.replaceChildren();
      if (scene.step.parents.length) {
        inputLinks.append(el("span", "muted", tx("Inputs: ", "入力元: ")));
        for (const id of [...new Set(scene.step.parents)]) {
          const b = button(
            root.FrameChoreoModel.tableLabel(data, steps.get(id)),
            () => o.inspect(id),
            "input-link",
          );
          inputLinks.append(b);
        }
      }
      for (const [id, panel] of Object.entries(panels)) {
        panel.hidden = state.mode !== id;
        panel.setAttribute("aria-hidden", String(state.mode !== id));
        const tab = tabs.get(id);
        tab.setAttribute("aria-selected", String(state.mode === id));
        tab.tabIndex = state.mode === id ? 0 : -1;
        if (id !== "table" && state.mode !== id) panel.replaceChildren();
      }
      o.limitInfo.hidden = state.mode !== "table";
      if (state.mode === "compare") renderCompare(scene);
      if (state.mode === "quality") renderQuality(scene);
      if (state.mode === "chart") renderChart(scene, rows);
    }
    return {
      sync,
      filter,
      columns,
      render,
      get mode() {
        return state.mode;
      },
      get query() {
        return state.query;
      },
      capture: () => ({ ...state, columns: state.columns?.slice() || null }),
      restore: (saved) => {
        if (saved) state = { ...saved, columns: saved.columns?.slice() || null };
      },
      inspect: () => {
        state = { ...state, table: null, mode: "table", query: "", columns: null };
      },
      findCell: (ref) =>
        [...o.root.querySelectorAll(".cell")].find(
          (n) =>
            !n.closest("[hidden]") &&
            !n.closest("details:not([open])") &&
            n.dataset.step === ref.step &&
            Number(n.dataset.row) === ref.row &&
            n.dataset.column === ref.column,
        ),
      focusSearch: () => {
        if (!viewTools.hidden) searchInput.focus();
      },
    };
  }
  root.FrameChoreoWorkbench = { create };
})(typeof globalThis !== "undefined" ? globalThis : this);
