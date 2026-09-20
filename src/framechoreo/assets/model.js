/* FrameChoreo's browser-independent display model. */
(function (root) {
  "use strict";
  const textValue = (value) =>
    typeof value === "string" &&
    value.length <= 40000 &&
    (value.length <= 20000 || [...value].length <= 20000) &&
    !/[\uD800-\uDFFF]/u.test(value);
  function validCell(cell) {
    if (!cell || !textValue(cell.display)) return false;
    if (cell.type === "missing") return cell.value === null && cell.display === "∅";
    if (cell.type === "boolean")
      return typeof cell.value === "boolean" && cell.display === (cell.value ? "True" : "False");
    if (
      !["string", "integer", "float", "decimal", "datetime", "duration"].includes(cell.type) ||
      !textValue(cell.value) ||
      cell.display !== cell.value
    )
      return false;
    return cell.type !== "integer" || /^-?(?:0|[1-9][0-9]*)$/.test(cell.value);
  }
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
    const parentCounts = {
      source: 0,
      filter: 1,
      merge: 2,
      group_sum: 1,
      sort: 1,
      select: 1,
      rename: 1,
      calculate: 1,
    };
    for (const step of data.steps) {
      if (!step || typeof step.id !== "string" || !step.id || steps.has(step.id))
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
          row.cells.some((c) => !validCell(c))
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
        if (
          step.operation !== "source" &&
          step.columns.some(
            (column) => !Object.prototype.hasOwnProperty.call(row.cell_parents, column),
          )
        )
          invalid("missing cell reference entries");
      });
      const p = step.parameters;
      if (!p || typeof p !== "object" || Array.isArray(p)) invalid("missing operation settings");
      if (["sort", "select", "rename", "calculate"].includes(step.operation)) {
        const parent = steps.get(step.parents[0]);
        if (step.rows.length !== parent.rows.length) invalid("inconsistent analysis row count");
        let expectedColumns = parent.columns,
          positions = null;
        const columnInputs = new Map(parent.columns.map((column) => [column, [column]]));
        if (step.operation === "sort") {
          if (
            !Array.isArray(p.by) ||
            !p.by.length ||
            new Set(p.by).size !== p.by.length ||
            p.by.some((c) => !parent.columns.includes(c)) ||
            !(
              typeof p.ascending === "boolean" ||
              (Array.isArray(p.ascending) &&
                p.ascending.length === p.by.length &&
                p.ascending.every((v) => typeof v === "boolean"))
            ) ||
            !["first", "last"].includes(p.na_position) ||
            !Array.isArray(p.positions) ||
            p.positions.length !== parent.rows.length ||
            new Set(p.positions).size !== parent.rows.length ||
            p.positions.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= parent.rows.length)
          )
            invalid("invalid sort settings");
          positions = p.positions;
        }
        if (step.operation === "select") {
          if (
            !Array.isArray(p.columns) ||
            !p.columns.length ||
            p.columns.some((c) => !parent.columns.includes(c))
          )
            invalid("invalid selected columns");
          expectedColumns = p.columns;
        }
        if (step.operation === "rename") {
          if (
            !p.mapping ||
            typeof p.mapping !== "object" ||
            Array.isArray(p.mapping) ||
            Object.entries(p.mapping).some(
              ([k, v]) => !parent.columns.includes(k) || typeof v !== "string" || !v.trim(),
            )
          )
            invalid("invalid renamed columns");
          expectedColumns = parent.columns.map((c) =>
            Object.prototype.hasOwnProperty.call(p.mapping, c) ? p.mapping[c] : c,
          );
          columnInputs.clear();
          expectedColumns.forEach((c, i) => columnInputs.set(c, [parent.columns[i]]));
        }
        if (step.operation === "calculate") {
          if (
            typeof p.name !== "string" ||
            !p.name.trim() ||
            parent.columns.includes(p.name) ||
            !parent.columns.includes(p.left) ||
            !["add", "subtract", "multiply", "divide"].includes(p.op) ||
            !p.right ||
            typeof p.right !== "object" ||
            Array.isArray(p.right)
          )
            invalid("invalid calculation");
          const isColumn = Object.prototype.hasOwnProperty.call(p.right, "column"),
            isConstant = Object.prototype.hasOwnProperty.call(p.right, "constant");
          if (
            isColumn === isConstant ||
            (isColumn && !parent.columns.includes(p.right.column)) ||
            (isConstant &&
              (!validCell(p.right.constant) ||
                !["integer", "float", "missing"].includes(p.right.constant.type)))
          )
            invalid("invalid calculation operand");
          expectedColumns = [...parent.columns, p.name];
          columnInputs.set(p.name, [p.left, ...(isColumn ? [p.right.column] : [])]);
        }
        if (
          expectedColumns.length !== step.columns.length ||
          expectedColumns.some((c, i) => c !== step.columns[i])
        )
          invalid("inconsistent analysis columns");
        step.rows.forEach((row, i) => {
          const position = positions ? positions[i] : i;
          if (
            row.parents.length !== 1 ||
            row.parents[0].step !== parent.id ||
            row.parents[0].row !== position
          )
            invalid("inconsistent analysis row reference");
          for (const column of step.columns) {
            const expected = columnInputs.get(column),
              refs = row.cell_parents[column];
            if (
              refs.length !== expected.length ||
              refs.some(
                (r, j) => r.step !== parent.id || r.row !== position || r.column !== expected[j],
              )
            )
              invalid("inconsistent analysis value references");
          }
        });
      }
      if (step.operation === "filter") {
        const parent = steps.get(step.parents[0]);
        if (
          !Array.isArray(p.selected_rows) ||
          p.selected_rows.length !== step.rows.length ||
          new Set(p.selected_rows).size !== p.selected_rows.length ||
          p.removed_rows !== parent.rows.length - step.rows.length
        )
          invalid("inconsistent filter counts");
        step.rows.forEach((row, i) => {
          if (
            row.parents.length !== 1 ||
            row.parents[0].row !== p.selected_rows[i] ||
            row.parents[0].step !== parent.id
          )
            invalid("inconsistent filtered rows");
        });
      }
      if (step.operation === "merge") {
        if (
          !Array.isArray(p.on) ||
          !p.on.length ||
          new Set(p.on).size !== p.on.length ||
          p.on.some((key) => step.parents.some((id) => !steps.get(id).columns.includes(key))) ||
          !["left", "inner"].includes(p.how) ||
          !["many_to_one", "one_to_one", "m:1", "1:1"].includes(p.validate) ||
          !Array.isArray(p.suffixes) ||
          p.suffixes.length !== 2 ||
          p.suffixes.some((value) => typeof value !== "string")
        )
          invalid("invalid join settings");
        if (
          p.unmatched_rows !== step.rows.filter((row) => row.parents.length === 1).length ||
          (p.how === "inner" && p.unmatched_rows !== 0)
        )
          invalid("inconsistent join counts");
      }
      if (step.operation === "group_sum") {
        const p = step.parameters,
          parent = steps.get(step.parents[0]),
          seen = new Set();
        if (
          !p ||
          !Array.isArray(p.by) ||
          !p.by.length ||
          new Set(p.by).size !== p.by.length ||
          p.by.some((key) => !step.columns.includes(key) || !parent.columns.includes(key)) ||
          !Array.isArray(p.groups) ||
          p.groups.length !== step.rows.length
        )
          invalid("invalid groups");
        if (
          typeof p.dropna !== "boolean" ||
          typeof p.sort !== "boolean" ||
          !Number.isSafeInteger(p.min_count) ||
          p.min_count < 0 ||
          !step.columns.includes(p.value) ||
          p.by.includes(p.value)
        )
          invalid("invalid aggregation settings");
        p.groups.forEach((group, i) => {
          if (group.output_row !== i || !Array.isArray(group.input_rows))
            invalid("invalid group output");
          for (const row of group.input_rows) {
            if (!Number.isInteger(row) || row < 0 || row >= parent.rows.length || seen.has(row))
              invalid("invalid group membership");
            seen.add(row);
          }
        });
        if (p.excluded_rows !== parent.rows.length - seen.size)
          invalid("inconsistent grouping count");
      }
      if (step.presentation) {
        const presentation = step.presentation;
        if (
          presentation.hold_ms !== undefined &&
          (!Number.isInteger(presentation.hold_ms) ||
            presentation.hold_ms < 1000 ||
            presentation.hold_ms > 30000)
        )
          invalid("invalid scene hold time");
        if (presentation.note !== undefined && typeof presentation.note !== "string")
          invalid("invalid scene note");
        if (
          presentation.highlight !== undefined &&
          (!Array.isArray(presentation.highlight) ||
            presentation.highlight.some((column) => !step.columns.includes(column)))
        )
          invalid("invalid highlighted columns");
      }
      steps.set(step.id, step);
    }
    data.timeline.forEach((id, i) => {
      const step = steps.get(id);
      if (!step || (i === 0 ? step.parents.length !== 0 : step.parents[0] !== data.timeline[i - 1]))
        invalid("invalid primary timeline");
    });
    if (
      data.result !== (data.timeline.at(-1) ?? null) ||
      (data.steps.length > 0 && data.timeline.length === 0)
    )
      invalid("result does not match the primary timeline");
    return steps;
  }
  function scenes(data, preparedIndex = null) {
    const steps = preparedIndex || indexStory(data),
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
  function prepareTrace(data, reference, preparedIndex = null) {
    const steps = preparedIndex || indexStory(data);
    validateReference(steps, reference);
    const counts = new Map(),
      work = [[reference, false]],
      keyOf = (ref) => cellKey(ref.step, ref.row, ref.column);
    while (work.length) {
      const [ref, expanded] = work.pop(),
        key = keyOf(ref);
      if (counts.has(key)) continue;
      const step = steps.get(ref.step);
      if (step.operation === "source") {
        counts.set(key, 1n);
        continue;
      }
      const refs = step.rows[ref.row].cell_parents[ref.column];
      if (expanded)
        counts.set(
          key,
          refs.reduce((total, parent) => total + counts.get(keyOf(parent)), 0n),
        );
      else {
        work.push([ref, true]);
        for (const parent of refs) if (!counts.has(keyOf(parent))) work.push([parent, false]);
      }
    }
    const total = counts.get(keyOf(reference));
    return {
      total,
      hasSource(step, row, column) {
        return steps.get(step)?.operation === "source" && counts.has(cellKey(step, row, column));
      },
      page(offset = 0n, limit = 50) {
        if (
          (typeof offset === "number" && (!Number.isSafeInteger(offset) || offset < 0)) ||
          (typeof offset === "string" && !/^[0-9]+$/.test(offset)) ||
          !["number", "string", "bigint"].includes(typeof offset)
        )
          throw new Error("The input offset must be a nonnegative integer");
        offset = BigInt(offset);
        if (offset < 0n || !Number.isSafeInteger(limit) || limit < 1 || limit > 10000)
          throw new Error("Use a nonnegative offset and a page size from 1 through 10000");
        const pending = [reference],
          origins = [];
        let skip = offset;
        while (pending.length && origins.length < limit) {
          const ref = pending.pop(),
            count = counts.get(keyOf(ref));
          if (count <= skip) {
            skip -= count;
            continue;
          }
          const step = steps.get(ref.step),
            row = step.rows[ref.row];
          if (step.operation === "source") {
            origins.push({
              source: step.name,
              step: step.id,
              row: ref.row,
              column: ref.column,
              cell: row.cells[step.columns.indexOf(ref.column)],
            });
          } else {
            const refs = row.cell_parents[ref.column];
            for (let i = refs.length - 1; i >= 0; i--) pending.push(refs[i]);
          }
        }
        return {
          origins,
          total: total.toString(),
          offset: offset.toString(),
          has_next: offset + BigInt(origins.length) < total,
        };
      },
    };
  }
  function traceCell(data, reference, limit = 10000) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("The source limit must be a finite positive integer");
    const trace = prepareTrace(data, reference);
    if (trace.total > BigInt(limit))
      throw new Error("This value has too many source cells to display.");
    // Keep the existing complete-list API, including explicitly larger limits.
    const result = [];
    for (let offset = 0n; offset < trace.total; offset += 10000n)
      result.push(...trace.page(offset, 10000).origins);
    return result;
  }
  function rowKey(stepId, position) {
    return stepId + ":" + position;
  }
  function validateReference(steps, reference) {
    const step = reference && steps.get(reference.step);
    if (
      !step ||
      !Number.isSafeInteger(reference.row) ||
      reference.row < 0 ||
      reference.row >= step.rows.length ||
      !step.columns.includes(reference.column)
    )
      throw new Error("Invalid cell reference");
    return step;
  }
  function cellKey(step, row, column) {
    return JSON.stringify([step, row, column]);
  }
  function cellExplanation(steps, reference) {
    const step = validateReference(steps, reference),
      row = step.rows[reference.row],
      cell = row.cells[step.columns.indexOf(reference.column)],
      p = step.parameters;
    if (step.operation === "group_sum" && reference.column === p.value) {
      const refs = row.cell_parents[p.value],
        count = refs.length;
      if (count < p.min_count && cell.type === "missing")
        return {
          text:
            count +
            (count === 1
              ? " non-missing input value is below min_count="
              : " non-missing input values are below min_count=") +
            p.min_count +
            "; the result is missing.",
        };
      if (count === 0 && p.min_count === 0)
        return {
          text: "There are no non-missing input values; pandas returns zero with min_count=0.",
        };
      if (count < p.min_count)
        return {
          text:
            "The recorded result conflicts with min_count=" +
            p.min_count +
            " and its input references.",
          warning: true,
        };
      const inputs = refs.map((ref) => {
        const parent = steps.get(ref.step);
        return parent.rows[ref.row].cells[parent.columns.indexOf(ref.column)];
      });
      if (
        cell.type === "integer" &&
        inputs.every((value) => value.type === "integer") &&
        typeof BigInt === "function"
      ) {
        const exact = inputs.reduce((sum, value) => sum + BigInt(value.value), 0n);
        if (exact !== BigInt(cell.value))
          return {
            text:
              "Exact integer addition gives " +
              exact +
              ". The recorded pandas value differs; the dtype may have overflowed.",
            warning: true,
          };
      }
      if (cell.type === "missing")
        return {
          text: "pandas returned a missing result despite sufficient inputs. Inspect non-finite values and the dtype.",
          warning: true,
        };
    }
    if (
      step.operation === "merge" &&
      row.parents.length === 1 &&
      row.cell_parents[reference.column].length === 0
    )
      return { text: "This left join found no right-side match for the selected value." };
    return { text: "" };
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
    if (scene.kind === "sort")
      return (
        "sort_values(" +
        JSON.stringify(p.by) +
        ", ascending=" +
        (Array.isArray(p.ascending)
          ? "[" + p.ascending.map((v) => (v ? "True" : "False")).join(", ") + "]"
          : p.ascending
            ? "True"
            : "False") +
        ", na_position=" +
        JSON.stringify(p.na_position) +
        ', kind="stable")'
      );
    if (scene.kind === "select") return "select_columns(" + JSON.stringify(p.columns) + ")";
    if (scene.kind === "rename") return "rename_columns(" + JSON.stringify(p.mapping) + ")";
    if (scene.kind === "calculate")
      return (
        "calculate(" +
        JSON.stringify(p.name) +
        ", left=" +
        JSON.stringify(p.left) +
        ", op=" +
        JSON.stringify(p.op) +
        ", right=" +
        (Object.prototype.hasOwnProperty.call(p.right, "column")
          ? JSON.stringify(p.right.column)
          : p.right.constant.display) +
        ")"
      );
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
    prepareTrace,
    rowKey,
    cellKey,
    cellExplanation,
    tableLabel,
    groupTitle,
    orderedRows,
    description,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FrameChoreoModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
