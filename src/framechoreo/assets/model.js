/* FrameChoreo's browser-independent display model. */
(function (root) {
  "use strict";
  function indexStory(data) {
    if (!data || data.format !== "framechoreo.story" || data.schema_version !== 1) {
      throw new Error("Unsupported story format");
    }
    const invalid = (reason) => {
      throw new Error("Invalid story: " + reason);
    };
    if (!Array.isArray(data.steps) || !Array.isArray(data.timeline))
      invalid("missing steps or timeline");
    const steps = new Map();
    const parentCounts = { source: 0, filter: 1, merge: 2, group_sum: 1 };
    for (const step of data.steps) {
      if (!step || typeof step.id !== "string" || steps.has(step.id))
        invalid("duplicate or missing step ID");
      if (!Object.prototype.hasOwnProperty.call(parentCounts, step.operation))
        invalid("unknown operation");
      if (
        !Array.isArray(step.columns) ||
        !step.columns.length ||
        step.columns.some((c) => typeof c !== "string" || !c) ||
        new Set(step.columns).size !== step.columns.length
      )
        invalid("invalid columns");
      if (
        !Array.isArray(step.rows) ||
        !Array.isArray(step.parents) ||
        step.parents.length !== parentCounts[step.operation] ||
        step.parents.some((id) => !steps.has(id))
      )
        invalid("invalid or cyclic parents");
      const validRef = (ref, cell) => {
        const parent = ref && steps.get(ref.step);
        return (
          parent &&
          step.parents.includes(ref.step) &&
          Number.isInteger(ref.row) &&
          ref.row >= 0 &&
          ref.row < parent.rows.length &&
          (!cell || parent.columns.includes(ref.column))
        );
      };
      step.rows.forEach((row, i) => {
        if (
          !row ||
          row.position !== i ||
          !Array.isArray(row.cells) ||
          row.cells.length !== step.columns.length ||
          row.cells.some((c) => !c || typeof c.display !== "string")
        )
          invalid("invalid row cells");
        if (!Array.isArray(row.parents) || row.parents.some((ref) => !validRef(ref, false)))
          invalid("invalid row reference");
        if (
          !row.cell_parents ||
          typeof row.cell_parents !== "object" ||
          Array.isArray(row.cell_parents)
        )
          invalid("missing value references");
        for (const [column, refs] of Object.entries(row.cell_parents)) {
          if (
            !step.columns.includes(column) ||
            !Array.isArray(refs) ||
            refs.some((ref) => !validRef(ref, true))
          )
            invalid("invalid cell reference");
        }
      });
      if (step.operation === "group_sum") {
        const p = step.parameters,
          parent = steps.get(step.parents[0]),
          seen = new Set();
        if (
          !p ||
          !Array.isArray(p.by) ||
          !p.by.length ||
          p.by.some((key) => !step.columns.includes(key) || !parent.columns.includes(key)) ||
          !Array.isArray(p.groups) ||
          p.groups.length !== step.rows.length
        )
          invalid("invalid groups");
        p.groups.forEach((group, i) => {
          if (group.output_row !== i || !Array.isArray(group.input_rows))
            invalid("invalid group output");
          for (const row of group.input_rows) {
            if (!Number.isInteger(row) || row < 0 || row >= parent.rows.length || seen.has(row))
              invalid("invalid group membership");
            seen.add(row);
          }
        });
      }
      steps.set(step.id, step);
    }
    data.timeline.forEach((id, i) => {
      const step = steps.get(id);
      if (!step || (i === 0 ? step.parents.length !== 0 : step.parents[0] !== data.timeline[i - 1]))
        invalid("invalid primary timeline");
    });
    return steps;
  }
  function scenes(data) {
    const steps = indexStory(data),
      result = [];
    for (const id of data.timeline) {
      const step = steps.get(id);
      if (!step) throw new Error("Missing timeline step");
      if (step.operation === "group_sum") {
        const groupingStep = { ...step, presentation: { ...(step.presentation || {}), note: "" } };
        result.push({ kind: "group", step: groupingStep, table: steps.get(step.parents[0]) });
        result.push({ kind: "sum", step, table: step });
      } else result.push({ kind: step.operation, step, table: step });
    }
    return result;
  }
  function traceCell(data, reference, limit = 10000) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("The source limit must be a finite positive integer");
    const steps = indexStory(data),
      pending = [reference],
      result = [];
    let visited = 0;
    while (pending.length) {
      if (++visited > limit * Math.max(1, data.steps.length)) {
        throw new Error("This value has too many ancestors to display. Select an earlier step.");
      }
      const ref = pending.pop(),
        step = steps.get(ref.step);
      const row = step && step.rows[ref.row];
      if (!row || !step.columns.includes(ref.column)) throw new Error("Invalid cell reference");
      if (step.operation === "source") {
        result.push({
          source: step.name,
          step: step.id,
          row: ref.row,
          column: ref.column,
          cell: row.cells[step.columns.indexOf(ref.column)],
        });
        if (result.length > limit)
          throw new Error("This value has too many source cells to display.");
      } else {
        const refs = Object.prototype.hasOwnProperty.call(row.cell_parents, ref.column)
          ? row.cell_parents[ref.column]
          : [];
        for (let i = refs.length - 1; i >= 0; i--) pending.push(refs[i]);
      }
    }
    return result;
  }
  function rowKey(stepId, position) {
    return stepId + ":" + position;
  }
  function tableLabel(data, step) {
    const label = step.label || step.name;
    if (step.operation !== "source") return label;
    const sources = data.steps.filter((item) => item.operation === "source");
    return sources.filter((item) => item.name === step.name).length > 1
      ? label + " (source " + (sources.findIndex((item) => item.id === step.id) + 1) + ")"
      : label;
  }
  function groupTitle(scene, groupIndex) {
    const row = scene.step.rows[groupIndex];
    return scene.step.parameters.by
      .map((key) => {
        const cell = row.cells[scene.step.columns.indexOf(key)];
        const text =
          cell.type === "missing"
            ? "∅ (missing)"
            : cell.type === "string"
              ? JSON.stringify(cell.display)
              : cell.display;
        return key + ": " + text;
      })
      .join(" · ");
  }
  function orderedRows(scene) {
    if (scene.kind !== "group") return scene.table.rows;
    const positions = scene.step.parameters.groups.flatMap((g) => g.input_rows);
    const seen = new Set(positions);
    return positions
      .map((i) => scene.table.rows[i])
      .concat(scene.table.rows.filter((r) => !seen.has(r.position)));
  }
  function description(scene) {
    const p = scene.step.parameters;
    if (scene.kind === "source") return "Recorded input";
    if (scene.kind === "filter") return "filter_rows(predicate)";
    if (scene.kind === "merge")
      return (
        "merge(on=" +
        JSON.stringify(p.on) +
        ", how=" +
        JSON.stringify(p.how) +
        ", validate=" +
        JSON.stringify(p.validate) +
        ", suffixes=" +
        JSON.stringify(p.suffixes || ["_x", "_y"]) +
        ", sort=False)"
      );
    const group =
      "groupby(" +
      JSON.stringify(p.by) +
      ", dropna=" +
      (p.dropna ? "True" : "False") +
      ", sort=" +
      (p.sort ? "True" : "False") +
      ", observed=True)";
    return scene.kind === "group"
      ? group
      : group +
          "[" +
          JSON.stringify(p.value) +
          "].sum(min_count=" +
          p.min_count +
          ").reset_index()";
  }
  const api = {
    indexStory,
    scenes,
    traceCell,
    rowKey,
    tableLabel,
    groupTitle,
    orderedRows,
    description,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FrameChoreoModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
