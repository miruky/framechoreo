/* Reader-only charts. Every point remains a button linked to its recorded cell. */
(function (root) {
  "use strict";
  function number(cell) {
    if (cell.type === "integer") {
      const n = BigInt(cell.value);
      if (n < -9007199254740991n || n > 9007199254740991n) return null;
    } else if (cell.type !== "float") return null;
    const n = Number(cell.value);
    return Number.isFinite(n) ? n : null;
  }
  function position(value, low, high) {
    if (low === high) return 0.5;
    const scale = Math.max(1, Math.abs(low), Math.abs(high));
    const scaledLow = low / scale;
    return (value / scale - scaledLow) / (high / scale - scaledLow);
  }
  function render(options) {
    const { panel, scene, rows, state, el, cellButton, displayValue, tx, change, steps } = options;
    panel.replaceChildren();
    const candidates = scene.table.columns.filter((_, i) =>
      scene.table.rows.some((row) => ["integer", "float"].includes(row.cells[i].type)),
    );
    if (!candidates.length) {
      panel.append(
        el(
          "p",
          "empty",
          tx(
            "Choose a step with numeric columns to view a chart.",
            "数値列のある工程を選ぶとグラフを表示できます。",
          ),
        ),
      );
      return;
    }
    if (!candidates.includes(state.metric)) state.metric = candidates[0];
    if (!candidates.includes(state.xMetric) || state.xMetric === state.metric)
      state.xMetric = candidates.find((column) => column !== state.metric) || "";
    if (!["bar", "line", "scatter"].includes(state.chartKind)) state.chartKind = "bar";
    if (state.chartKind === "scatter" && !state.xMetric) state.chartKind = "bar";
    const controls = el("div", "chart-controls"),
      kindLabel = el("label", "chart-choice", tx("Chart ", "グラフ ")),
      kind = el("select");
    kind.dataset.action = "chart-kind";
    kind.setAttribute("aria-label", tx("Chart type", "グラフの種類"));
    for (const [value, text] of [
      ["bar", tx("Bars", "棒")],
      ["line", tx("Line", "折れ線")],
      ...(candidates.length >= 2 ? [["scatter", tx("Scatter", "散布図")]] : []),
    ]) {
      const option = el("option", "", text);
      option.value = value;
      kind.append(option);
    }
    kind.value = state.chartKind;
    kind.addEventListener("change", () => {
      state.chartKind = kind.value;
      change(false);
      panel.querySelector('[data-action="chart-kind"]')?.focus({ preventScroll: true });
    });
    kindLabel.append(kind);
    controls.append(kindLabel);
    const valueLabel = el("label", "chart-choice", tx("Value ", "表示する値 ")),
      valueSelect = el("select");
    valueSelect.dataset.action = "chart-column";
    valueSelect.setAttribute("aria-label", tx("Value column", "値の列"));
    for (const column of candidates) {
      const option = el("option", "", column);
      option.value = column;
      valueSelect.append(option);
    }
    valueSelect.value = state.metric;
    valueSelect.addEventListener("change", () => {
      state.metric = valueSelect.value;
      change(false);
      panel.querySelector('[data-action="chart-column"]')?.focus({ preventScroll: true });
    });
    valueLabel.append(valueSelect);
    controls.append(valueLabel);
    if (state.chartKind === "scatter") {
      const xLabel = el("label", "chart-choice", tx("Horizontal ", "横軸 ")),
        xSelect = el("select");
      xSelect.dataset.action = "chart-x-column";
      xSelect.setAttribute("aria-label", tx("Horizontal column", "横軸の列"));
      for (const column of candidates.filter((candidate) => candidate !== state.metric)) {
        const option = el("option", "", column);
        option.value = column;
        xSelect.append(option);
      }
      xSelect.value = state.xMetric;
      xSelect.addEventListener("change", () => {
        state.xMetric = xSelect.value;
        change(false);
        panel.querySelector('[data-action="chart-x-column"]')?.focus({ preventScroll: true });
      });
      xLabel.append(xSelect);
      controls.append(xLabel);
    }
    panel.append(controls);
    const shown = rows.slice(0, state.chartKind === "bar" ? 20 : 40),
      yIndex = scene.table.columns.indexOf(state.metric),
      yValues = shown.map((row) => number(row.cells[yIndex])),
      labelColumn = scene.table.columns.findIndex(
        (column, i) =>
          column !== state.metric &&
          shown.some((row) => ["string", "datetime"].includes(row.cells[i].type)),
      ),
      labelFor = (row) =>
        labelColumn >= 0
          ? displayValue(row.cells[labelColumn])
          : tx("Row ", "行 ") + (row.position + 1),
      identityFor = (row) =>
        root.FrameChoreoModel.groupIdentity(steps, scene.table.id, row.position),
      groupFor = (row) => String((identityFor(row)?.row ?? 0) % 6),
      groupKeyFor = (row) => {
        const identity = identityFor(row);
        return identity ? identity.step + ":" + identity.row : "all";
      };
    const identities = new Map();
    for (const row of shown) {
      const identity = identityFor(row);
      if (identity) identities.set(identity.step + ":" + identity.row, identity);
    }
    if (identities.size > 1 && identities.size <= 6) {
      const legend = el("div", "chart-group-legend");
      for (const identity of identities.values()) {
        const group = el(
          "span",
          "chart-group-chip",
          "G" +
            (identity.row + 1) +
            " · " +
            root.FrameChoreoModel.groupTitle({ step: steps.get(identity.step) }, identity.row),
        );
        group.dataset.group = String(identity.row % 6);
        legend.append(group);
      }
      panel.append(legend);
    }
    panel.append(
      el(
        "p",
        "panel-caption",
        shown.length +
          tx(" of ", " / ") +
          rows.length +
          (state.chartKind === "bar"
            ? tx(
                " rows shown. Bar lengths are approximate; the recorded value text is unchanged.",
                " 行を表示。棒の長さは近似ですが、表示する値は記録したものです。",
              )
            : tx(
                " rows shown in recorded order. Positions are visual approximations; select a point for its exact value and inputs.",
                " 行を記録順に表示。点の位置は近似です。点を選ぶと正確な値と入力元を確認できます。",
              )),
      ),
    );
    function valueButton(row) {
      const cell = row.cells[yIndex],
        b = cellButton(scene.table.id, row.position, state.metric, cell);
      b.classList.add("chart-value");
      b.dataset.group = groupFor(row);
      b.setAttribute(
        "aria-label",
        labelFor(row) +
          " · " +
          tx("row ", "行 ") +
          (row.position + 1) +
          " · " +
          state.metric +
          ": " +
          displayValue(cell) +
          tx("; trace value inputs", "：入力元を確認"),
      );
      b.replaceChildren();
      return b;
    }
    if (state.chartKind === "bar") {
      const finite = yValues.filter((n) => n !== null),
        scale = Math.max(1, ...finite.map(Math.abs)),
        low = Math.min(0, ...finite.map((n) => n / scale)),
        high = Math.max(0, ...finite.map((n) => n / scale)),
        range = high - low || 1,
        zero = (100 * -low) / range,
        chart = el("div", "bar-chart");
      shown.forEach((row, i) => {
        const b = valueButton(row),
          track = el("span", "bar-track"),
          axis = el("span", "bar-zero"),
          fill = el("span", "bar-fill");
        axis.style.left = zero + "%";
        track.setAttribute("aria-hidden", "true");
        const value = yValues[i];
        if (value !== null) {
          fill.style.left = (value < 0 ? (100 * (value / scale - low)) / range : zero) + "%";
          fill.style.width = (100 * Math.abs(value / scale)) / range + "%";
        } else {
          fill.style.width = "0%";
          b.classList.add("uncharted-value");
        }
        track.append(axis, fill);
        b.append(
          el("span", "bar-label", labelFor(row)),
          track,
          el("span", "bar-value", displayValue(row.cells[yIndex])),
        );
        chart.append(b);
      });
      panel.append(chart);
    } else {
      const scatter = state.chartKind === "scatter",
        xIndex = scene.table.columns.indexOf(state.xMetric),
        xValues = shown.map((row, i) => (scatter ? number(row.cells[xIndex]) : i)),
        valid = shown.flatMap((row, i) =>
          xValues[i] === null || yValues[i] === null
            ? []
            : [{ row, i, x: xValues[i], y: yValues[i] }],
        ),
        xMin = Math.min(...valid.map((point) => point.x)),
        xMax = Math.max(...valid.map((point) => point.x)),
        yMin = Math.min(...valid.map((point) => point.y)),
        yMax = Math.max(...valid.map((point) => point.y)),
        chart = el("div", "plot-scroll"),
        plot = el("div", "point-plot");
      plot.setAttribute("aria-label", tx("Recorded value plot", "記録した値のグラフ"));
      const points = [];
      if (valid.length) {
        for (const [kind, content] of [
          ["x-start", scatter ? String(xMin) : labelFor(shown[0])],
          ["x-end", scatter ? String(xMax) : labelFor(shown[shown.length - 1])],
          ["y-high", String(yMax)],
          ["y-low", String(yMin)],
        ]) {
          const axis = el("span", "plot-axis " + kind, content);
          axis.title = content;
          axis.setAttribute("aria-hidden", "true");
          plot.append(axis);
        }
      }
      for (const point of valid) {
        const px = 48 + position(point.x, xMin, xMax) * 624,
          py = 215 - position(point.y, yMin, yMax) * 185,
          b = valueButton(point.row);
        b.classList.add("plot-point");
        b.style.left = px + "px";
        b.style.top = py + "px";
        b.title = labelFor(point.row) + " · " + displayValue(point.row.cells[yIndex]);
        b.append(el("span", "point-mark"));
        points.push({
          x: px,
          y: py,
          i: point.i,
          group: b.dataset.group,
          groupKey: groupKeyFor(point.row),
          button: b,
        });
      }
      if (!scatter) {
        const byIndex = new Map(points.map((point) => [point.i, point])),
          previousByGroup = new Map();
        for (let i = 0; i < shown.length; i++) {
          const groupKey = groupKeyFor(shown[i]),
            next = byIndex.get(i);
          if (!next) {
            previousByGroup.delete(groupKey);
            continue;
          }
          const first = previousByGroup.get(groupKey);
          if (first) {
            const dx = next.x - first.x,
              dy = next.y - first.y,
              segment = el("span", "plot-segment");
            segment.dataset.group = next.group;
            segment.style.left = first.x + "px";
            segment.style.top = first.y + "px";
            segment.style.width = Math.hypot(dx, dy) + "px";
            segment.style.transform = "rotate(" + Math.atan2(dy, dx) + "rad)";
            segment.setAttribute("aria-hidden", "true");
            plot.append(segment);
          }
          previousByGroup.set(groupKey, next);
        }
      }
      for (const point of points) plot.append(point.button);
      chart.append(plot);
      panel.append(chart);
      if (valid.length)
        panel.append(
          el(
            "p",
            "panel-caption",
            (scatter ? state.xMetric : tx("Row order", "行の順序")) +
              " → · " +
              state.metric +
              " ↑ · " +
              tx("values from ", "値の範囲 ") +
              yMin +
              " … " +
              yMax,
          ),
        );
      const omitted = shown.filter((_, i) => xValues[i] === null || yValues[i] === null);
      if (omitted.length) {
        const list = el("div", "plot-unplotted");
        list.append(
          el(
            "p",
            "panel-caption",
            tx(
              "Values without safe finite coordinates stay below the plot for inspection.",
              "安全な有限座標に置けない値は、グラフの下から確認できます。",
            ),
          ),
        );
        for (const row of omitted) {
          const b = valueButton(row);
          b.classList.add("unplotted-point");
          b.append(el("span", "", labelFor(row)), el("span", "", displayValue(row.cells[yIndex])));
          list.append(b);
        }
        panel.append(list);
      }
    }
    if (yValues.some((value) => value === null))
      panel.append(
        el(
          "p",
          "panel-caption",
          tx(
            "Nonnumeric, missing, non-finite, and unsafe-integer values are not positioned as finite numbers. Their recorded values remain inspectable.",
            "数値でない値・欠損・非有限値・大きすぎる整数は有限値の位置に置きません。記録した値は確認できます。",
          ),
        ),
      );
  }
  root.FrameChoreoCharts = { render };
})(typeof globalThis !== "undefined" ? globalThis : this);
