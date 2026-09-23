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
  const aggregateScene = {
    group_sum: "sum",
    group_mean: "mean",
    group_count: "count",
    group_agg: "aggregate",
  };
  const reducers = ["sum", "mean", "min", "max", "median", "count", "nunique"];
  const sameList = (a, b) =>
    Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
  const record = (x) => x && typeof x === "object" && !Array.isArray(x);
  const namedKeys = (keys, columns, empty = false) =>
    Array.isArray(keys) &&
    (empty || keys.length > 0) &&
    new Set(keys).size === keys.length &&
    keys.every((c) => columns.includes(c));
  const sameRefs = (refs, expected) =>
    Array.isArray(refs) &&
    refs.length === expected.length &&
    refs.every(
      (r, i) =>
        r.step === expected[i].step && r.row === expected[i].row && r.column === expected[i].column,
    );
  const operand = (value, columns, allowMissing = false) =>
    record(value) &&
    Object.keys(value).length === 1 &&
    (Object.prototype.hasOwnProperty.call(value, "column")
      ? columns.includes(value.column)
      : Object.prototype.hasOwnProperty.call(value, "constant") &&
        validCell(value.constant) &&
        (allowMissing || value.constant.type !== "missing"));
  function conditionFields(condition, columns, depth = 0, counter = { leaves: 0 }) {
    if (!record(condition) || depth > 8) return null;
    if (["all", "any", "not"].includes(condition.kind)) {
      const arity = condition.kind === "not" ? 1 : 2;
      if (
        !sameList(Object.keys(condition).sort(), ["children", "kind"]) ||
        !Array.isArray(condition.children) ||
        condition.children.length !== arity
      )
        return null;
      const parts = condition.children.map((child) =>
        conditionFields(child, columns, depth + 1, counter),
      );
      return parts.every(Array.isArray) ? parts.flat() : null;
    }
    if (
      condition.kind !== undefined ||
      !sameList(Object.keys(condition).sort(), ["column", "op", "value"]) ||
      !columns.includes(condition.column)
    )
      return null;
    counter.leaves++;
    if (counter.leaves > 32) return null;
    if (["is_missing", "is_not_missing"].includes(condition.op))
      return condition.value === null ? [condition.column] : null;
    if (["eq", "ne", "gt", "ge", "lt", "le"].includes(condition.op))
      return operand(condition.value, columns)
        ? [condition.column, ...(condition.value.column ? [condition.value.column] : [])]
        : null;
    if (condition.op === "in")
      return record(condition.value) &&
        sameList(Object.keys(condition.value), ["values"]) &&
        Array.isArray(condition.value.values) &&
        condition.value.values.length <= 1000 &&
        condition.value.values.every(validCell)
        ? [condition.column]
        : null;
    if (condition.op === "between") {
      const bounds = condition.value?.bounds;
      return record(condition.value) &&
        sameList(Object.keys(condition.value), ["bounds"]) &&
        Array.isArray(bounds) &&
        bounds.length === 2 &&
        bounds.every((bound) => operand(bound, columns))
        ? [condition.column, ...bounds.flatMap((bound) => (bound.column ? [bound.column] : []))]
        : null;
    }
    return null;
  }
  function conditionLeaves(condition) {
    return condition.kind ? condition.children.flatMap(conditionLeaves) : [condition];
  }
  function conditionResult(condition, clauses, row, cursor) {
    if (!condition.kind) return clauses[cursor.index++][row];
    const first = conditionResult(condition.children[0], clauses, row, cursor);
    if (condition.kind === "not")
      return first === "missing" ? "missing" : first === "true" ? "false" : "true";
    const second = conditionResult(condition.children[1], clauses, row, cursor);
    if (condition.kind === "all")
      return first === "false" || second === "false"
        ? "false"
        : first === "true" && second === "true"
          ? "true"
          : "missing";
    return first === "true" || second === "true"
      ? "true"
      : first === "false" && second === "false"
        ? "false"
        : "missing";
  }
  function conditionBreakdown(step, inputRow) {
    const leaves = conditionLeaves(step.parameters.condition),
      clauses = step.parameters.clause_outcomes || [step.parameters.outcomes];
    if (
      clauses.length !== leaves.length ||
      !Number.isSafeInteger(inputRow) ||
      inputRow < 0 ||
      inputRow >= step.parameters.outcomes.length
    )
      return [];
    return leaves.map((leaf, i) => ({
      column: leaf.column,
      op: leaf.op,
      outcome: clauses[i][inputRow],
    }));
  }
  function conditionFormula(step, inputRow, language = "en") {
    const clauses = step.parameters.clause_outcomes;
    if (
      !Array.isArray(clauses) ||
      !Number.isSafeInteger(inputRow) ||
      inputRow < 0 ||
      inputRow >= step.parameters.outcomes.length
    )
      return "";
    const names =
      language === "ja"
        ? { true: "成立", false: "不成立", missing: "欠損" }
        : { true: "true", false: "false", missing: "missing" };
    const cursor = { index: 0 };
    const render = (node) => {
      if (!node.kind) return names[clauses[cursor.index++][inputRow]];
      if (node.kind === "not") return "NOT (" + render(node.children[0]) + ")";
      return (
        "(" +
        render(node.children[0]) +
        (node.kind === "all" ? " AND " : " OR ") +
        render(node.children[1]) +
        ")"
      );
    };
    return render(step.parameters.condition) + " → " + names[step.parameters.outcomes[inputRow]];
  }
  function caseSelection(step, row, language = "en") {
    if (
      step.operation !== "case_select" ||
      !Number.isSafeInteger(row) ||
      row < 0 ||
      row >= step.rows.length
    )
      return null;
    return {
      selected: step.parameters.selected_cases[row],
      cases: step.parameters.cases.map((branch, index) => ({
        index,
        outcome: branch.outcomes[row],
        condition: conditionCode(branch.condition),
        formula: conditionFormula({ parameters: branch }, row, language),
      })),
    };
  }
  function checkedCondition(
    p,
    parent,
    columns,
    invalid,
    counter = { leaves: 0 },
    requireClauses = false,
  ) {
    const fields = conditionFields(p.condition, columns, 0, counter);
    if (
      !fields ||
      !Array.isArray(p.outcomes) ||
      p.outcomes.length !== parent.rows.length ||
      p.outcomes.some((outcome) => !["true", "false", "missing"].includes(outcome))
    )
      invalid("invalid condition");
    if (requireClauses && p.clause_outcomes === undefined) invalid("missing comparison outcomes");
    if (p.clause_outcomes !== undefined) {
      const leaves = conditionLeaves(p.condition);
      if (
        !Array.isArray(p.clause_outcomes) ||
        p.clause_outcomes.length !== leaves.length ||
        p.clause_outcomes.some(
          (states) =>
            !Array.isArray(states) ||
            states.length !== parent.rows.length ||
            states.some((outcome) => !["true", "false", "missing"].includes(outcome)),
        )
      )
        invalid("invalid comparison outcomes");
      p.outcomes.forEach((outcome, row) => {
        if (conditionResult(p.condition, p.clause_outcomes, row, { index: 0 }) !== outcome)
          invalid("inconsistent condition logic");
      });
    }
    return fields;
  }
  function metrics(step) {
    if (step.operation === "group_agg") return step.parameters.metrics;
    return Object.prototype.hasOwnProperty.call(aggregateScene, step.operation)
      ? [
          {
            output: step.parameters.value,
            column: step.parameters.value,
            agg: step.operation.slice(6),
          },
        ]
      : [];
  }
  function validateWorkflow(step, steps, invalid) {
    const p = step.parameters,
      parent = steps.get(step.parents[0]),
      columns = parent?.columns,
      selected = ["drop_missing", "drop_duplicates", "take"].includes(step.operation),
      converted = ["astype", "to_numeric", "to_datetime", "string_transform"].includes(
        step.operation,
      );
    const ref = (row, column, id = parent?.id) => ({ step: id, row, column });
    if (selected || converted || step.operation === "fill_missing") {
      if (!sameList(step.columns, columns)) invalid("changed workflow columns");
      const positions = selected ? p.positions : step.rows.map((_, i) => i);
      if (
        !Array.isArray(positions) ||
        positions.length !== step.rows.length ||
        positions.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= parent.rows.length) ||
        (!selected && step.rows.length !== parent.rows.length)
      )
        invalid("invalid workflow positions");
      if (["drop_missing", "drop_duplicates"].includes(step.operation)) {
        if (
          !namedKeys(p.subset, columns) ||
          p.removed_rows !== parent.rows.length - step.rows.length ||
          positions.some((v, i) => i && v <= positions[i - 1])
        )
          invalid("invalid removed rows");
        if (step.operation === "drop_missing") {
          if (!["any", "all"].includes(p.how)) invalid("invalid missing-row policy");
          const kept = parent.rows
            .filter((r) => {
              const missing = p.subset.map((c) => r.cells[columns.indexOf(c)].type === "missing");
              return !(p.how === "any" ? missing.some(Boolean) : missing.every(Boolean));
            })
            .map((r) => r.position);
          if (!sameList(positions, kept)) invalid("inconsistent missing-row selection");
        } else if (!["first", "last", false].includes(p.keep)) invalid("invalid duplicate policy");
      }
      if (step.operation === "astype") {
        if (
          !record(p.mapping) ||
          !Object.keys(p.mapping).length ||
          Object.entries(p.mapping).some(
            ([c, dtype]) => !columns.includes(c) || typeof dtype !== "string" || !dtype.trim(),
          )
        )
          invalid("invalid dtype conversion");
      }
      if (["to_numeric", "to_datetime", "string_transform"].includes(step.operation)) {
        if (!namedKeys(p.columns, columns)) invalid("invalid conversion columns");
        if (step.operation === "string_transform") {
          if (!["strip", "lower", "upper", "casefold"].includes(p.op))
            invalid("invalid string operation");
        } else if (!["raise", "coerce"].includes(p.errors)) invalid("invalid parse error policy");
        if (
          step.operation === "to_datetime" &&
          (typeof p.format !== "string" || !p.format.trim() || typeof p.utc !== "boolean")
        )
          invalid("invalid datetime settings");
      }
      if (step.operation === "fill_missing") {
        if (
          !record(p.values) ||
          !Object.keys(p.values).length ||
          !record(p.filled_positions) ||
          !sameList(Object.keys(p.filled_positions).sort(), Object.keys(p.values).sort())
        )
          invalid("invalid fill constants");
        for (const [c, value] of Object.entries(p.values)) {
          if (!columns.includes(c) || !validCell(value) || value.type === "missing")
            invalid("invalid fill value");
          const expected = parent.rows
            .filter((r) => r.cells[columns.indexOf(c)].type === "missing")
            .map((r) => r.position);
          if (!sameList(p.filled_positions[c], expected)) invalid("inconsistent fill positions");
        }
      }
      step.rows.forEach((row, i) => {
        const position = positions[i];
        if (!sameRefs(row.parents, [{ step: parent.id, row: position }]))
          invalid("inconsistent workflow row reference");
        for (const c of columns) {
          const isFill =
            step.operation === "fill_missing" &&
            Object.prototype.hasOwnProperty.call(p.values, c) &&
            parent.rows[position].cells[columns.indexOf(c)].type === "missing";
          if (!sameRefs(row.cell_parents[c], isFill ? [] : [ref(position, c)]))
            invalid("inconsistent workflow value input");
        }
      });
    }
    if (step.operation === "concat") {
      if (
        !Array.isArray(p.inputs) ||
        !p.inputs.length ||
        p.inputs.some((id) => !step.parents.includes(id)) ||
        new Set(p.inputs).size !== step.parents.length ||
        !["inner", "outer"].includes(p.join) ||
        typeof p.ignore_index !== "boolean"
      )
        invalid("invalid concatenation inputs");
      const inputs = p.inputs.map((id) => steps.get(id));
      const expected =
        p.join === "outer"
          ? [...new Set(inputs.flatMap((s) => s.columns))]
          : inputs[0].columns.filter((c) => inputs.every((s) => s.columns.includes(c)));
      if (
        !sameList(step.columns, expected) ||
        step.rows.length !== inputs.reduce((n, s) => n + s.rows.length, 0)
      )
        invalid("inconsistent concatenation shape");
      let position = 0;
      for (const input of inputs)
        for (const source of input.rows) {
          const row = step.rows[position++];
          if (!sameRefs(row.parents, [{ step: input.id, row: source.position }]))
            invalid("inconsistent concatenation row");
          for (const c of step.columns)
            if (
              !sameRefs(
                row.cell_parents[c],
                input.columns.includes(c) ? [ref(source.position, c, input.id)] : [],
              )
            )
              invalid("inconsistent concatenation value");
        }
    }
    if (step.operation === "melt") {
      if (
        !namedKeys(p.id_vars, columns, true) ||
        !namedKeys(p.value_vars, columns) ||
        p.id_vars.some((c) => p.value_vars.includes(c)) ||
        !sameList(step.columns, [...p.id_vars, p.var_name, p.value_name]) ||
        step.rows.length !== parent.rows.length * p.value_vars.length
      )
        invalid("invalid melt shape");
      step.rows.forEach((row, i) => {
        const position = i % parent.rows.length,
          valueColumn = p.value_vars[Math.floor(i / parent.rows.length)];
        if (
          !sameRefs(row.parents, [{ step: parent.id, row: position }]) ||
          !sameRefs(row.cell_parents[p.var_name], []) ||
          !sameRefs(row.cell_parents[p.value_name], [ref(position, valueColumn)]) ||
          row.cells[step.columns.indexOf(p.var_name)].type !== "string" ||
          row.cells[step.columns.indexOf(p.var_name)].value !== valueColumn
        )
          invalid("inconsistent melt inputs");
        for (const c of p.id_vars)
          if (!sameRefs(row.cell_parents[c], [ref(position, c)]))
            invalid("inconsistent melt identity");
      });
    }
    if (step.operation === "pivot") {
      if (
        !namedKeys(p.index, columns) ||
        !columns.includes(p.columns) ||
        !columns.includes(p.values) ||
        p.index.includes(p.columns) ||
        p.index.includes(p.values) ||
        p.columns === p.values ||
        !Array.isArray(p.output_columns) ||
        !sameList(step.columns, [...p.index, ...p.output_columns])
      )
        invalid("invalid pivot fields");
      const used = new Set();
      for (const row of step.rows) {
        const positions = [];
        for (const c of p.output_columns) {
          const refs = row.cell_parents[c];
          if (refs.length > 1 || refs.some((r) => r.column !== p.values))
            invalid("invalid pivot value input");
          for (const r of refs) {
            const key = parent.rows[r.row].cells[columns.indexOf(p.columns)];
            if (key.type !== "string" || key.value !== c || used.has(r.row))
              invalid("inconsistent pivot placement");
            used.add(r.row);
            positions.push(r.row);
          }
        }
        positions.sort((a, b) => a - b);
        if (
          !sameRefs(
            row.parents,
            positions.map((row) => ({ step: parent.id, row })),
          )
        )
          invalid("inconsistent pivot membership");
        for (const c of p.index)
          if (
            !sameRefs(
              row.cell_parents[c],
              positions.map((r) => ref(r, c)),
            )
          )
            invalid("inconsistent pivot key inputs");
      }
      if (used.size !== parent.rows.length) invalid("pivot omitted an input row");
    }
    if (["case_when", "filter_by"].includes(step.operation)) {
      const fields = checkedCondition(p, parent, columns, invalid);
      if (step.operation === "case_when") {
        if (
          !p.name ||
          columns.includes(p.name) ||
          !sameList(step.columns, [...columns, p.name]) ||
          step.rows.length !== parent.rows.length ||
          !operand(p.then, columns, true) ||
          !operand(p.otherwise, columns, true)
        )
          invalid("invalid conditional result");
        step.rows.forEach((row, i) => {
          const selected = p.outcomes[i] === "true" ? p.then : p.otherwise;
          if (
            !sameRefs(row.parents, [{ step: parent.id, row: i }]) ||
            !record(row.cell_controls) ||
            !sameList(Object.keys(row.cell_controls), [p.name]) ||
            !sameRefs(
              row.cell_controls[p.name],
              fields.map((column) => ref(i, column)),
            ) ||
            !sameRefs(row.cell_parents[p.name], selected.column ? [ref(i, selected.column)] : [])
          )
            invalid("inconsistent conditional inputs");
          for (const column of columns)
            if (!sameRefs(row.cell_parents[column], [ref(i, column)]))
              invalid("inconsistent unchanged conditional value");
        });
      } else {
        const selected = p.outcomes.flatMap((outcome, i) => (outcome === "true" ? [i] : []));
        if (
          !sameList(step.columns, columns) ||
          !sameList(p.selected_rows, selected) ||
          p.removed_rows !== parent.rows.length - selected.length ||
          step.rows.length !== selected.length
        )
          invalid("inconsistent condition filter");
        step.rows.forEach((row, i) => {
          const position = selected[i];
          if (
            !sameRefs(row.parents, [{ step: parent.id, row: position }]) ||
            !sameRefs(
              row.row_controls,
              fields.map((column) => ref(position, column)),
            )
          )
            invalid("inconsistent filtered decision inputs");
          for (const column of columns)
            if (!sameRefs(row.cell_parents[column], [ref(position, column)]))
              invalid("inconsistent filtered value inputs");
        });
      }
    }
    if (step.operation === "case_select") {
      if (
        !p.name ||
        columns.includes(p.name) ||
        !sameList(step.columns, [...columns, p.name]) ||
        step.rows.length !== parent.rows.length ||
        !Array.isArray(p.cases) ||
        p.cases.length < 1 ||
        p.cases.length > 16 ||
        !operand(p.otherwise, columns, true) ||
        !Array.isArray(p.selected_cases) ||
        p.selected_cases.length !== parent.rows.length
      )
        invalid("invalid ordered cases");
      const counter = { leaves: 0 },
        allFields = [];
      p.cases.forEach((branch) => {
        if (!record(branch) || !operand(branch.value, columns, true))
          invalid("invalid case replacement");
        allFields.push(...checkedCondition(branch, parent, columns, invalid, counter, true));
      });
      step.rows.forEach((row, i) => {
        const selected = p.cases.findIndex((branch) => branch.outcomes[i] === "true"),
          chosen = selected >= 0 ? selected : null,
          value = chosen === null ? p.otherwise : p.cases[chosen].value;
        if (
          p.selected_cases[i] !== chosen ||
          !sameRefs(row.parents, [{ step: parent.id, row: i }]) ||
          !record(row.cell_controls) ||
          !sameList(Object.keys(row.cell_controls), [p.name]) ||
          !sameRefs(
            row.cell_controls[p.name],
            allFields.map((column) => ref(i, column)),
          ) ||
          !sameRefs(row.cell_parents[p.name], value.column ? [ref(i, value.column)] : [])
        )
          invalid("inconsistent ordered case inputs");
        for (const column of columns)
          if (!sameRefs(row.cell_parents[column], [ref(i, column)]))
            invalid("inconsistent unchanged case value");
      });
    }
    if (step.operation === "coalesce") {
      if (
        !p.name ||
        columns.includes(p.name) ||
        !sameList(step.columns, [...columns, p.name]) ||
        !namedKeys(p.columns, columns) ||
        !validCell(p.default) ||
        !Array.isArray(p.selected_columns) ||
        p.selected_columns.length !== parent.rows.length ||
        step.rows.length !== parent.rows.length
      )
        invalid("invalid coalescing settings");
      step.rows.forEach((row, i) => {
        const checked = [];
        let chosen = null;
        for (const candidate of p.columns) {
          checked.push(candidate);
          if (parent.rows[i].cells[columns.indexOf(candidate)].type !== "missing") {
            chosen = candidate;
            break;
          }
        }
        if (
          p.selected_columns[i] !== chosen ||
          !sameRefs(row.parents, [{ step: parent.id, row: i }]) ||
          !record(row.cell_controls) ||
          !sameList(Object.keys(row.cell_controls), [p.name]) ||
          !sameRefs(
            row.cell_controls[p.name],
            checked.map((column) => ref(i, column)),
          ) ||
          !sameRefs(row.cell_parents[p.name], chosen ? [ref(i, chosen)] : [])
        )
          invalid("inconsistent first-available inputs");
        for (const column of columns)
          if (!sameRefs(row.cell_parents[column], [ref(i, column)]))
            invalid("inconsistent unchanged coalesced value");
      });
    }
    if (step.operation === "window") {
      if (
        !p.name ||
        columns.includes(p.name) ||
        !columns.includes(p.column) ||
        !sameList(step.columns, [...columns, p.name]) ||
        !namedKeys(p.by, columns, true) ||
        p.by.includes(p.column) ||
        ![
          "lag",
          "diff",
          "cumsum",
          "cummin",
          "cummax",
          "rolling_sum",
          "rolling_mean",
          "rolling_min",
          "rolling_max",
        ].includes(p.op) ||
        !Number.isSafeInteger(p.periods) ||
        p.periods < 1 ||
        !Number.isSafeInteger(p.size) ||
        p.size < 1 ||
        !Number.isSafeInteger(p.min_periods) ||
        p.min_periods < 0 ||
        p.min_periods > p.size ||
        step.rows.length !== parent.rows.length ||
        !Array.isArray(p.groups)
      )
        invalid("invalid window settings");
      const seen = new Set();
      for (const group of p.groups) {
        if (!Array.isArray(group) || !group.length) invalid("empty window group");
        group.forEach((position, j) => {
          if (
            !Number.isSafeInteger(position) ||
            position < 0 ||
            position >= parent.rows.length ||
            seen.has(position) ||
            (j && position <= group[j - 1])
          )
            invalid("invalid window group membership");
          seen.add(position);
          const row = step.rows[position],
            range = group.slice(Math.max(0, j - p.size + 1), j + 1),
            present = (position) =>
              parent.rows[position].cells[columns.indexOf(p.column)].type !== "missing";
          const members =
            p.op === "lag"
              ? j >= p.periods
                ? [group[j - p.periods]]
                : []
              : p.op === "diff"
                ? j >= p.periods
                  ? [position, group[j - p.periods]]
                  : [position]
                : ["cumsum", "cummin", "cummax"].includes(p.op)
                  ? present(position)
                    ? group.slice(0, j + 1).filter(present)
                    : []
                  : range.filter(present);
          const controls = [
            ...[...new Set([...members, position])].flatMap((r) =>
              p.by.map((column) => ref(r, column)),
            ),
            ...(p.op.startsWith("rolling_")
              ? range.filter((r) => !present(r))
              : ["cumsum", "cummin", "cummax"].includes(p.op) && !present(position)
                ? [position]
                : []
            ).map((r) => ref(r, p.column)),
          ];
          if (
            !sameRefs(row.parents, [{ step: parent.id, row: position }]) ||
            !sameRefs(
              row.cell_parents[p.name],
              members.map((r) => ref(r, p.column)),
            ) ||
            !record(row.cell_controls) ||
            !sameList(Object.keys(row.cell_controls), [p.name]) ||
            !sameRefs(row.cell_controls[p.name], controls)
          )
            invalid("inconsistent window provenance");
          for (const column of columns)
            if (!sameRefs(row.cell_parents[column], [ref(position, column)]))
              invalid("inconsistent unchanged window value");
        });
      }
      if (seen.size !== parent.rows.length) invalid("window omitted rows");
    }
    if (step.operation === "group_transform") {
      if (
        !p.name ||
        columns.includes(p.name) ||
        !sameList(step.columns, [...columns, p.name]) ||
        !namedKeys(p.by, columns) ||
        !columns.includes(p.value) ||
        p.by.includes(p.value) ||
        !["sum", "mean", "min", "max", "count", "nunique"].includes(p.op) ||
        typeof p.dropna !== "boolean" ||
        (p.op === "sum"
          ? !Number.isSafeInteger(p.min_count) || p.min_count < 0
          : p.min_count !== undefined) ||
        !Array.isArray(p.groups) ||
        !Array.isArray(p.row_groups) ||
        p.row_groups.length !== parent.rows.length ||
        !Array.isArray(p.excluded_rows) ||
        step.rows.length !== parent.rows.length
      )
        invalid("invalid grouped row metric");
      const seen = new Set();
      for (const [groupIndex, members] of p.groups.entries()) {
        if (!Array.isArray(members) || !members.length) invalid("empty grouped row metric");
        members.forEach((position, j) => {
          if (
            !Number.isSafeInteger(position) ||
            position < 0 ||
            position >= parent.rows.length ||
            seen.has(position) ||
            (j && position <= members[j - 1])
          )
            invalid("invalid grouped metric membership");
          seen.add(position);
          if (p.row_groups[position] !== groupIndex)
            invalid("inconsistent grouped metric color identity");
        });
        const candidates = members
          .filter(
            (position) => parent.rows[position].cells[columns.indexOf(p.value)].type !== "missing",
          )
          .map((row) => ref(row, p.value));
        const keyRefs = members.flatMap((row) => p.by.map((column) => ref(row, column)));
        for (const position of members) {
          const row = step.rows[position];
          if (
            !sameRefs(row.parents, [{ step: parent.id, row: position }]) ||
            !sameRefs(row.cell_parents[p.name], candidates) ||
            !record(row.cell_controls) ||
            !sameList(Object.keys(row.cell_controls), [p.name]) ||
            !sameRefs(row.cell_controls[p.name], keyRefs)
          )
            invalid("inconsistent grouped metric inputs");
        }
      }
      const excluded = parent.rows.flatMap((_, i) => (seen.has(i) ? [] : [i]));
      if (!sameList(p.excluded_rows, excluded) || (!p.dropna && excluded.length))
        invalid("inconsistent grouped metric exclusions");
      for (const position of excluded) {
        const row = step.rows[position];
        if (
          p.row_groups[position] !== null ||
          !p.by.some(
            (column) => parent.rows[position].cells[columns.indexOf(column)].type === "missing",
          ) ||
          !sameRefs(row.parents, [{ step: parent.id, row: position }]) ||
          !sameRefs(row.cell_parents[p.name], []) ||
          !record(row.cell_controls) ||
          !sameList(Object.keys(row.cell_controls), [p.name]) ||
          !sameRefs(
            row.cell_controls[p.name],
            p.by.map((column) => ref(position, column)),
          )
        )
          invalid("inconsistent excluded group row");
      }
      step.rows.forEach((row, i) => {
        for (const column of columns)
          if (!sameRefs(row.cell_parents[column], [ref(i, column)]))
            invalid("inconsistent unchanged grouped metric value");
      });
    }
    if (step.operation === "merge_asof") {
      const right = steps.get(step.parents[1]);
      if (
        !columns.includes(p.on) ||
        !right.columns.includes(p.on) ||
        !namedKeys(p.by, columns, true) ||
        p.by.some((key) => key === p.on || !right.columns.includes(key)) ||
        !["backward", "forward", "nearest"].includes(p.direction) ||
        typeof p.allow_exact_matches !== "boolean" ||
        (p.tolerance !== null && (!validCell(p.tolerance) || p.tolerance.type === "missing")) ||
        !Array.isArray(p.suffixes) ||
        p.suffixes.length !== 2 ||
        p.suffixes.some((v) => typeof v !== "string") ||
        !record(p.audit) ||
        step.rows.length !== parent.rows.length
      )
        invalid("invalid as-of join settings");
      const common = [p.on, ...p.by],
        overlap = columns.filter((c) => right.columns.includes(c) && !common.includes(c)),
        expectedColumns = [
          ...columns.map((c) => (overlap.includes(c) ? c + p.suffixes[0] : c)),
          ...right.columns
            .filter((c) => !common.includes(c))
            .map((c) => (overlap.includes(c) ? c + p.suffixes[1] : c)),
        ],
        matches = p.audit.matched_right_rows,
        usage = Array(right.rows.length).fill(0);
      if (
        !sameList(step.columns, expectedColumns) ||
        !Array.isArray(matches) ||
        matches.length !== parent.rows.length
      )
        invalid("invalid as-of output shape");
      step.rows.forEach((row, i) => {
        const ri = matches[i];
        if (ri !== null && (!Number.isSafeInteger(ri) || ri < 0 || ri >= right.rows.length))
          invalid("invalid as-of match position");
        if (ri !== null) usage[ri]++;
        const expectedParents = [
          { step: parent.id, row: i },
          ...(ri === null ? [] : [{ step: right.id, row: ri }]),
        ];
        if (!sameRefs(row.parents, expectedParents)) invalid("inconsistent as-of row input");
        const rightOutputs = right.columns
          .filter((c) => !common.includes(c))
          .map((c) => (overlap.includes(c) ? c + p.suffixes[1] : c));
        if (!record(row.cell_controls) || !sameList(Object.keys(row.cell_controls), rightOutputs))
          invalid("invalid as-of match controls");
        const matchControls = [
          ...common.map((c) => ref(i, c)),
          ...(ri === null ? [] : common.map((c) => ref(ri, c, right.id))),
        ];
        for (const output of rightOutputs)
          if (!sameRefs(row.cell_controls[output], matchControls))
            invalid("inconsistent as-of match controls");
        for (const c of columns) {
          const output = overlap.includes(c) ? c + p.suffixes[0] : c;
          if (!sameRefs(row.cell_parents[output], [ref(i, c)]))
            invalid("inconsistent as-of left value");
        }
        for (const c of right.columns) {
          if (common.includes(c)) continue;
          const output = overlap.includes(c) ? c + p.suffixes[1] : c;
          if (!sameRefs(row.cell_parents[output], ri === null ? [] : [ref(ri, c, right.id)]))
            invalid("inconsistent as-of right value");
        }
      });
      if (
        !sameList(
          p.audit.left_unmatched,
          matches.flatMap((r, i) => (r === null ? [i] : [])),
        ) ||
        !sameList(p.audit.right_usage_counts, usage) ||
        !sameList(
          p.audit.right_unused,
          usage.flatMap((n, i) => (n === 0 ? [i] : [])),
        ) ||
        !sameList(
          p.audit.right_reused,
          usage.flatMap((n, i) => (n > 1 ? [i] : [])),
        )
      )
        invalid("inconsistent as-of audit");
    }
    if (step.operation === "rank_within") {
      if (
        !p.name ||
        columns.includes(p.name) ||
        !columns.includes(p.value) ||
        !sameList(step.columns, [...columns, p.name]) ||
        !namedKeys(p.by, columns, true) ||
        p.by.includes(p.value) ||
        !["average", "min", "max", "dense", "first"].includes(p.method) ||
        typeof p.ascending !== "boolean" ||
        !Array.isArray(p.groups) ||
        !Array.isArray(p.row_groups) ||
        p.row_groups.length !== parent.rows.length ||
        step.rows.length !== parent.rows.length
      )
        invalid("invalid ranking settings");
      const seen = new Set();
      for (const [groupIndex, members] of p.groups.entries()) {
        if (!Array.isArray(members) || !members.length) invalid("empty rank group");
        members.forEach((position, j) => {
          if (
            !Number.isSafeInteger(position) ||
            position < 0 ||
            position >= parent.rows.length ||
            seen.has(position) ||
            (j && position <= members[j - 1]) ||
            p.row_groups[position] !== groupIndex
          )
            invalid("invalid rank membership");
          seen.add(position);
        });
        const candidates = members.filter(
          (i) => parent.rows[i].cells[columns.indexOf(p.value)].type !== "missing",
        );
        for (const position of members) {
          const row = step.rows[position],
            present = parent.rows[position].cells[columns.indexOf(p.value)].type !== "missing",
            valueRefs = present ? candidates.map((i) => ref(i, p.value)) : [],
            keyRefs = present
              ? candidates.flatMap((i) => p.by.map((column) => ref(i, column)))
              : [...p.by.map((column) => ref(position, column)), ref(position, p.value)];
          if (
            !sameRefs(row.parents, [{ step: parent.id, row: position }]) ||
            !sameRefs(row.cell_parents[p.name], valueRefs) ||
            !record(row.cell_controls) ||
            !sameList(Object.keys(row.cell_controls), [p.name]) ||
            !sameRefs(row.cell_controls[p.name], keyRefs)
          )
            invalid("inconsistent rank inputs");
          for (const column of columns)
            if (!sameRefs(row.cell_parents[column], [ref(position, column)]))
              invalid("inconsistent unchanged rank value");
        }
      }
      if (seen.size !== parent.rows.length) invalid("rank omitted rows");
    }
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
    if (data.language !== undefined && !["en", "ja"].includes(data.language))
      invalid("invalid language");
    if (
      data.description !== undefined &&
      (!textValue(data.description) || [...data.description].length > 2000)
    )
      invalid("invalid description");
    const steps = new Map();
    const parentCounts = {
      source: 0,
      filter: 1,
      merge: 2,
      merge_asof: 2,
      group_sum: 1,
      group_mean: 1,
      group_count: 1,
      sort: 1,
      select: 1,
      rename: 1,
      calculate: 1,
      drop_missing: 1,
      fill_missing: 1,
      drop_duplicates: 1,
      take: 1,
      astype: 1,
      to_numeric: 1,
      to_datetime: 1,
      string_transform: 1,
      melt: 1,
      pivot: 1,
      concat: -1,
      group_agg: 1,
      group_transform: 1,
      rank_within: 1,
      case_when: 1,
      case_select: 1,
      filter_by: 1,
      window: 1,
      coalesce: 1,
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
        (step.operation === "concat"
          ? !step.parents.length || new Set(step.parents).size !== step.parents.length
          : step.parents.length !== parentCounts[step.operation]) ||
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
          row.row_controls !== undefined &&
          (!Array.isArray(row.row_controls) || row.row_controls.some((ref) => !validRef(ref, true)))
        )
          invalid("invalid row control reference");
        if (
          row.cell_controls !== undefined &&
          (!record(row.cell_controls) ||
            Object.entries(row.cell_controls).some(
              ([column, refs]) =>
                !step.columns.includes(column) ||
                !Array.isArray(refs) ||
                refs.some((ref) => !validRef(ref, true)),
            ))
        )
          invalid("invalid cell control reference");
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
      validateWorkflow(step, steps, invalid);
      if (step.profile !== undefined) {
        const profile = step.profile;
        if (
          !record(profile) ||
          profile.rows !== step.rows.length ||
          profile.column_count !== step.columns.length ||
          !Array.isArray(profile.columns) ||
          profile.columns.length !== step.columns.length ||
          !Number.isSafeInteger(profile.duplicate_rows) ||
          profile.duplicate_rows < 0 ||
          profile.duplicate_rows > Math.max(0, step.rows.length - 1)
        )
          invalid("invalid quality profile");
        let missing = 0;
        profile.columns.forEach((c, i) => {
          const n = step.rows.reduce((sum, r) => sum + (r.cells[i].type === "missing" ? 1 : 0), 0);
          if (
            !record(c) ||
            c.name !== step.columns[i] ||
            typeof c.dtype !== "string" ||
            c.missing !== n ||
            !Number.isSafeInteger(c.unique) ||
            c.unique < 0 ||
            c.unique > step.rows.length - n
          )
            invalid("invalid column profile");
          missing += n;
        });
        if (profile.missing_cells !== missing) invalid("inconsistent missing-cell count");
      }
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
        const left = steps.get(step.parents[0]),
          right = steps.get(step.parents[1]),
          leftKeys = p.left_on || p.on,
          rightKeys = p.right_on || p.on;
        if (
          !namedKeys(leftKeys, left.columns) ||
          !namedKeys(rightKeys, right.columns) ||
          leftKeys.length !== rightKeys.length ||
          !["left", "inner", "right", "outer"].includes(p.how) ||
          !["many_to_one", "one_to_one", "one_to_many", "m:1", "1:1", "1:m"].includes(p.validate) ||
          !Array.isArray(p.suffixes) ||
          p.suffixes.length !== 2 ||
          p.suffixes.some((v) => typeof v !== "string")
        )
          invalid("invalid join settings");
        const noRight = step.rows.filter((r) => !r.parents.some((p) => p.step === right.id)).length,
          noLeft = step.rows.filter((r) => !r.parents.some((p) => p.step === left.id)).length;
        if (
          p.unmatched_rows !== noRight ||
          (p.unmatched_left_rows !== undefined && p.unmatched_left_rows !== noLeft) ||
          (["right", "inner"].includes(p.how) && noRight !== 0) ||
          (["left", "inner"].includes(p.how) && noLeft !== 0)
        )
          invalid("inconsistent join counts");
        if (p.audit !== undefined) {
          const audit = p.audit,
            leftCounts = Array(left.rows.length).fill(0),
            rightCounts = Array(right.rows.length).fill(0),
            nullRows = [];
          if (!record(audit)) invalid("invalid join audit");
          step.rows.forEach((row, i) => {
            let li = null,
              ri = null;
            if (row.parents.length === 2) {
              if (row.parents[0].step !== left.id || row.parents[1].step !== right.id)
                invalid("invalid join audit correspondence");
              li = row.parents[0].row;
              ri = row.parents[1].row;
            } else if (row.parents.length === 1 && left.id !== right.id) {
              const only = row.parents[0];
              if (only.step === left.id) li = only.row;
              else if (only.step === right.id) ri = only.row;
              else invalid("invalid join audit input");
            } else invalid("invalid join audit row");
            if (li !== null && ri !== null) {
              leftCounts[li]++;
              rightCounts[ri]++;
              if (
                leftKeys.some(
                  (key) => left.rows[li].cells[left.columns.indexOf(key)].type === "missing",
                )
              )
                nullRows.push(i);
            }
          });
          const positions = (list, n) =>
            Array.isArray(list) &&
            list.every(
              (v, i) => Number.isSafeInteger(v) && v >= 0 && v < n && (i === 0 || v > list[i - 1]),
            );
          if (
            !sameList(audit.left_match_counts, leftCounts) ||
            !sameList(audit.right_match_counts, rightCounts) ||
            !sameList(
              audit.left_unmatched,
              leftCounts.flatMap((n, i) => (n === 0 ? [i] : [])),
            ) ||
            !sameList(
              audit.right_unmatched,
              rightCounts.flatMap((n, i) => (n === 0 ? [i] : [])),
            ) ||
            !sameList(
              audit.left_fanout,
              leftCounts.flatMap((n, i) => (n > 1 ? [i] : [])),
            ) ||
            !sameList(
              audit.right_fanout,
              rightCounts.flatMap((n, i) => (n > 1 ? [i] : [])),
            ) ||
            !sameList(audit.null_key_output_rows, nullRows) ||
            !positions(audit.left_duplicate_keys, left.rows.length) ||
            !positions(audit.right_duplicate_keys, right.rows.length)
          )
            invalid("inconsistent join audit");
        }
      }
      if (Object.prototype.hasOwnProperty.call(aggregateScene, step.operation)) {
        const p = step.parameters,
          parent = steps.get(step.parents[0]),
          seen = new Set(),
          hasMinCount = ["group_sum", "group_agg"].includes(step.operation);
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
          (hasMinCount
            ? !Number.isSafeInteger(p.min_count) || p.min_count < 0
            : p.min_count !== undefined) ||
          (step.operation !== "group_agg" &&
            (!step.columns.includes(p.value) || p.by.includes(p.value)))
        )
          invalid("invalid aggregation settings");
        if (step.operation === "group_agg") {
          if (
            !Array.isArray(p.metrics) ||
            !p.metrics.length ||
            p.metrics.some(
              (m) =>
                !record(m) ||
                !parent.columns.includes(m.column) ||
                p.by.includes(m.column) ||
                !reducers.includes(m.agg) ||
                typeof m.output !== "string" ||
                !m.output.trim(),
            ) ||
            !sameList(step.columns, [...p.by, ...p.metrics.map((m) => m.output)])
          )
            invalid("invalid named metrics");
        }
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
        if (step.operation === "group_agg")
          step.rows.forEach((row, i) => {
            const members = p.groups[i].input_rows;
            if (
              !sameRefs(
                row.parents,
                members.map((row) => ({ step: parent.id, row })),
              )
            )
              invalid("inconsistent metric membership");
            for (const m of p.metrics) {
              const expected = members
                .filter(
                  (j) => parent.rows[j].cells[parent.columns.indexOf(m.column)].type !== "missing",
                )
                .map((row) => ({ step: parent.id, row, column: m.column }));
              if (!sameRefs(row.cell_parents[m.output], expected))
                invalid("inconsistent metric value inputs");
            }
            for (const c of p.by)
              if (
                !sameRefs(
                  row.cell_parents[c],
                  members.map((row) => ({ step: parent.id, row, column: c })),
                )
              )
                invalid("inconsistent metric key inputs");
          });
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
        if (
          presentation.note !== undefined &&
          (!textValue(presentation.note) || [...presentation.note].length > 600)
        )
          invalid("invalid scene note");
        if (
          presentation.chapter !== undefined &&
          (!textValue(presentation.chapter) || [...presentation.chapter].length > 100)
        )
          invalid("invalid chapter label");
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
      if (Object.prototype.hasOwnProperty.call(aggregateScene, step.operation)) {
        const groupingStep = { ...step, presentation: { ...(step.presentation || {}), note: "" } };
        result.push({ kind: "group", step: groupingStep, table: steps.get(step.parents[0]) });
        result.push({ kind: aggregateScene[step.operation], step, table: step });
      } else result.push({ kind: step.operation, step, table: step });
    }
    return result;
  }
  function prepareTrace(data, reference, preparedIndex = null) {
    const steps = preparedIndex || indexStory(data);
    validateReference(steps, reference);
    const counts = new Map(),
      usedSteps = new Set(),
      work = [[reference, false]],
      keyOf = (ref) => cellKey(ref.step, ref.row, ref.column);
    while (work.length) {
      const [ref, expanded] = work.pop(),
        key = keyOf(ref);
      if (counts.has(key)) continue;
      const step = steps.get(ref.step);
      usedSteps.add(step.id);
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
      steps: [...steps.keys()].filter((id) => usedSteps.has(id)),
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
  function controlInputs(steps, reference) {
    const step = validateReference(steps, reference),
      row = step.rows[reference.row],
      refs = row.cell_controls?.[reference.column] || row.row_controls || [];
    return refs.map((ref) => {
      const source = steps.get(ref.step);
      return {
        ...ref,
        cell: source.rows[ref.row].cells[source.columns.indexOf(ref.column)],
        name: source.name,
      };
    });
  }
  function cellExplanation(steps, reference, language = "en") {
    if (language === "ja") {
      const original = cellExplanation(steps, reference, "en");
      if (!original.text) return original;
      const step = validateReference(steps, reference),
        row = step.rows[reference.row],
        m = metrics(step).find((m) => m.output === reference.column),
        refs = row.cell_parents[reference.column] || [];
      let text;
      if (step.operation === "case_when" && reference.column === step.parameters.name) {
        const outcome = step.parameters.outcomes[reference.row];
        text =
          (outcome === "missing"
            ? "比較が欠損だったため、otherwise の値を選びました。"
            : outcome === "true"
              ? "条件が成立し、then の値を選びました。"
              : "条件が成立せず、otherwise の値を選びました。") +
          "値の入力元と判定入力は別に表示します。";
      } else if (step.operation === "case_select" && reference.column === step.parameters.name) {
        const chosen = step.parameters.selected_cases[reference.row];
        text =
          chosen === null
            ? "成立した条件がなく、既定値を選びました。欠損の条件は次の分岐へ進みます。"
            : "条件を上から確認し、最初に成立した" +
              (chosen + 1) +
              "番目の値を選びました。各分岐の結果は下に表示します。";
      } else if (step.operation === "filter_by")
        text = "条件を満たした行です。判定に使った入力は、コピーした値の入力元と分けて表示します。";
      else if (step.operation === "group_transform" && reference.column === step.parameters.name)
        text = step.parameters.excluded_rows.includes(reference.row)
          ? "グループのキーが欠損していて除外されたため、この行の指標は欠損です。"
          : "同じグループの" +
            refs.length +
            "件の非欠損候補から求めた指標を、各行へ繰り返しています。グループ判定のキーは別に表示します。";
      else if (step.operation === "rank_within" && reference.column === step.parameters.name)
        text =
          refs.length === 0
            ? "現在の値が欠損のため順位も欠損です。元の値とグループキーを判定入力に残しています。"
            : "同じグループの" +
              refs.length +
              "件を比較し、" +
              step.parameters.method +
              "方式で順位を決めています。同順位の候補も残しています。";
      else if (step.operation === "window" && reference.column === step.parameters.name) {
        const op = step.parameters.op;
        if (op === "lag" && refs.length === 0)
          text = "このグループに指定した距離の前の行がないため、結果は欠損です。";
        else if (op === "diff" && refs.length === 1)
          text =
            "比較対象の前の行がないため差分は欠損です。現在の値だけを入力として記録しています。";
        else if (op.startsWith("rolling_") && refs.length < step.parameters.min_periods)
          text =
            "窓内の有効な値が" +
            refs.length +
            "件で、必要な" +
            step.parameters.min_periods +
            "件に足りないため結果は欠損です。";
        else if (
          ["cumsum", "cummin", "cummax"].includes(op) &&
          refs.length === 0 &&
          row.cells[step.columns.indexOf(reference.column)].type === "missing"
        )
          text = "現在行の入力が欠損のため、この位置の累計結果も欠損です。";
        else
          text =
            "現在の行順で計算した" +
            op +
            "です。値に寄与した行と、グループや欠損の判定入力を分けて表示します。";
      } else if (step.operation === "coalesce" && reference.column === step.parameters.name)
        text = step.parameters.selected_columns[reference.row]
          ? "左から調べ、最初の欠損でない値を選びました。判定した列は別に表示します。"
          : "すべて欠損だったため、指定した定数を使いました。元の値セルは捏造していません。";
      else if (m) {
        const names = {
          sum: "合計",
          mean: "平均",
          min: "最小値",
          max: "最大値",
          median: "中央値",
          count: "非欠損値の件数",
          nunique: "ユニーク値数",
        };
        text = refs.length + "個の欠損でない入力から、" + names[m.agg] + "を求めています。";
        if (m.agg === "sum" && refs.length < step.parameters.min_count)
          text =
            "有効な入力が" +
            refs.length +
            "個で、必要数（min_count=" +
            step.parameters.min_count +
            "）に足りないため、通常は欠損になります。";
        else if (!refs.length)
          text =
            m.agg === "count" ||
            m.agg === "nunique" ||
            (m.agg === "sum" && step.parameters.min_count === 0)
              ? "有効な入力がないため、記録された件数・合計は0です。"
              : "有効な入力がないため、結果は欠損です。";
        if (m.agg === "nunique") text += "判定に使った重複値も、入力の一覧には残しています。";
        if (original.warning) {
          text =
            "記録された結果と入力の関係に注意が必要です。入力の数・値・列の型を確認してください。";
          if (
            m.agg === "sum" &&
            refs.every(
              (r) =>
                steps.get(r.step).rows[r.row].cells[steps.get(r.step).columns.indexOf(r.column)]
                  .type === "integer",
            )
          ) {
            const exact = refs.reduce(
              (n, r) =>
                n +
                BigInt(
                  steps.get(r.step).rows[r.row].cells[steps.get(r.step).columns.indexOf(r.column)]
                    .value,
                ),
              0n,
            );
            text +=
              " 整数としての加算結果は" + exact + "です。型の桁あふれなどを確認してください。";
          }
        }
      } else if (step.operation === "fill_missing")
        text =
          "指定した定数で欠損を補った値です。元データの値を入力として捏造せず、補う前のセルは前の表に残しています。";
      else if (step.operation === "melt")
        text = "元の列名から作ったラベルです。元データの値セルをコピーしたものではありません。";
      else if (["pivot", "concat"].includes(step.operation))
        text =
          "この行と列の組み合わせには元の値セルがありません。表の形を変える際にできた欠損です。";
      else if (step.operation === "merge")
        text = "この結合結果には、条件に一致する側の入力値がありません。";
      else if (step.operation === "merge_asof" && row.cell_controls?.[reference.column])
        text =
          step.parameters.audit.matched_right_rows[reference.row] === null
            ? "指定した方向・許容距離に合う右側の行がありません。左側の時刻とグループを確認できます。"
            : "時刻とグループで選ばれた右側の行から値を取りました。照合に使ったキーは判定入力に表示します。";
      else
        text =
          "変換前の入力セルをたどれます。読み取りに失敗して欠損になった場合も、元の文字列を確認できます。";
      return { text, ...(original.warning ? { warning: true } : {}) };
    }
    const step = validateReference(steps, reference),
      row = step.rows[reference.row],
      cell = row.cells[step.columns.indexOf(reference.column)],
      p = step.parameters,
      metric = metrics(step).find((m) => m.output === reference.column),
      operation = metric ? "group_" + metric.agg : step.operation,
      valueColumn = metric?.output || p.value;
    if (step.operation === "case_when" && reference.column === p.name) {
      const outcome = p.outcomes[reference.row];
      return {
        text:
          (outcome === "missing"
            ? "The comparison was missing, so otherwise was selected."
            : outcome === "true"
              ? "The condition was true, so then was selected."
              : "The condition was false, so otherwise was selected.") +
          " Value inputs and decision inputs are separate.",
      };
    }
    if (step.operation === "case_select" && reference.column === p.name) {
      const chosen = p.selected_cases[reference.row];
      return {
        text:
          chosen === null
            ? "No condition was true, so the default value was selected. Missing checks continued to later cases."
            : "The first true case was case " +
              (chosen + 1) +
              ". Every case was evaluated; its result and deciding inputs are shown separately.",
      };
    }
    if (step.operation === "merge_asof" && row.cell_controls?.[reference.column]) {
      const match = p.audit.matched_right_rows[reference.row];
      return {
        text:
          match === null
            ? "No right row matched within the chosen direction, exact-match policy, and tolerance. The left keys are shown as decision inputs."
            : "Right input row " +
              (match + 1) +
              " was selected by the ordered key and group. The compared keys are separate decision inputs.",
      };
    }
    if (step.operation === "filter_by")
      return {
        text: "This row passed the condition. Its deciding inputs are separate from its copied value inputs.",
      };
    if (step.operation === "group_transform" && reference.column === p.name)
      return {
        text: p.excluded_rows.includes(reference.row)
          ? "This missing-key row was excluded from grouping, so its group metric is missing."
          : "The " +
            p.op +
            " considered " +
            row.cell_parents[p.name].length +
            " non-missing group candidates and repeats the metric beside each member. Group keys are separate decision inputs.",
      };
    if (step.operation === "rank_within" && reference.column === p.name)
      return {
        text:
          row.cell_parents[p.name].length === 0
            ? "The current value is missing, so its rank is missing. The missing value and group keys remain decision inputs."
            : "The " +
              p.method +
              " rank compares " +
              row.cell_parents[p.name].length +
              " non-missing group candidates, including ties. " +
              (p.ascending ? "Lower values rank first." : "Higher values rank first."),
      };
    if (step.operation === "window" && reference.column === p.name) {
      const count = row.cell_parents[p.name].length;
      if (p.op === "lag" && count === 0)
        return {
          text: "No earlier row exists at this lag within the group; the result is missing.",
        };
      if (p.op === "diff" && count === 1)
        return {
          text: "No earlier comparison row exists; only the current value is recorded and the difference is missing.",
        };
      if (p.op.startsWith("rolling_") && count < p.min_periods)
        return {
          text:
            count +
            " non-missing values are below min_periods=" +
            p.min_periods +
            "; the rolling result is missing.",
        };
      if (["cumsum", "cummin", "cummax"].includes(p.op) && count === 0 && cell.type === "missing")
        return {
          text: "The current input is missing, so the cumulative result at this row is missing.",
        };
      return {
        text:
          "This " +
          p.op +
          " uses current row order. Window values are separate from grouping and missing-value controls.",
      };
    }
    if (step.operation === "coalesce" && reference.column === p.name)
      return {
        text: p.selected_columns[reference.row]
          ? "The first non-missing column supplied the value. Tested columns are separate decision inputs."
          : "Every candidate was missing, so the explicit default supplied the value. No source value was invented.",
      };
    if (operation === "group_sum" && reference.column === valueColumn) {
      const refs = row.cell_parents[valueColumn],
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
    if (operation === "group_mean" && reference.column === valueColumn) {
      const refs = row.cell_parents[valueColumn],
        count = refs.length;
      if (count === 0)
        return cell.type === "missing"
          ? { text: "There are no non-missing input values; pandas returns a missing average." }
          : {
              text: "The recorded result conflicts with its empty input references.",
              warning: true,
            };
      if (cell.type === "missing")
        return {
          text: "pandas returned a missing average despite sufficient inputs. Inspect non-finite values and the dtype.",
          warning: true,
        };
    }
    if (operation === "group_count" && reference.column === valueColumn) {
      const refs = row.cell_parents[valueColumn],
        count = refs.length;
      if (count === 0) return { text: "There are no non-missing input values; the count is 0." };
      if (cell.type !== "integer" || BigInt(cell.value) !== BigInt(count))
        return {
          text:
            "The recorded count conflicts with its " +
            count +
            " traced non-missing input references.",
          warning: true,
        };
    }
    if (
      step.operation === "merge" &&
      row.parents.length === 1 &&
      row.cell_parents[reference.column].length === 0
    )
      return {
        text:
          p.how === "left"
            ? "This left join found no right-side match for the selected value."
            : "No value from the corresponding input table matched this join cell.",
      };
    if (metric && ["min", "max", "median", "nunique"].includes(metric.agg))
      return {
        text:
          "The " +
          metric.agg +
          " used " +
          row.cell_parents[valueColumn].length +
          " non-missing candidate values. Repeated inputs remain visible even when the operation counts unique values.",
      };
    if (step.operation === "fill_missing" && row.cell_parents[reference.column].length === 0)
      return {
        text: "This value was filled from an explicit constant. It has no raw value input; the original missing cell remains in the preceding table.",
      };
    if (step.operation === "melt" && reference.column === p.var_name)
      return {
        text: "This label comes from the original column name, not from a source data cell.",
      };
    if (
      ["concat", "pivot"].includes(step.operation) &&
      row.cell_parents[reference.column].length === 0
    )
      return {
        text: "No recorded input cell occupies this column/row combination. This missing value was introduced by the table shape.",
      };
    if (
      (step.operation === "astype" &&
        Object.prototype.hasOwnProperty.call(p.mapping, reference.column)) ||
      (["to_numeric", "to_datetime", "string_transform"].includes(step.operation) &&
        p.columns.includes(reference.column))
    )
      return {
        text: "The recorded conversion retains the original input cell, including when parsing produced a missing value.",
      };
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
  function groupIdentity(steps, stepId, position) {
    const seen = new Set();
    while (!seen.has(stepId)) {
      seen.add(stepId);
      const step = steps.get(stepId),
        row = step?.rows[position];
      if (!row) return null;
      if (Object.prototype.hasOwnProperty.call(aggregateScene, step.operation))
        return { step: stepId, row: position };
      if (["group_transform", "rank_within"].includes(step.operation)) {
        const group = step.parameters.row_groups[position];
        return group === null ? null : { step: stepId, row: group };
      }
      if (["source", "concat", "pivot", "melt"].includes(step.operation)) return null;
      const parent = row.parents.find((r) => r.step === step.parents[0]);
      if (!parent) return null;
      stepId = parent.step;
      position = parent.row;
    }
    return null;
  }
  function groupTitle(scene, groupIndex) {
    const rowPosition = ["group_transform", "rank_within"].includes(scene.step.operation)
      ? scene.step.parameters.groups[groupIndex][0]
      : groupIndex;
    const row = scene.step.rows[rowPosition];
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
  function cellCode(cell) {
    if (cell.type === "string") return JSON.stringify(cell.value);
    if (cell.type === "boolean") return cell.value ? "True" : "False";
    if (cell.type === "missing") return "None";
    if (cell.type === "float" && !Number.isFinite(Number(cell.value)))
      return "float(" + JSON.stringify(cell.value) + ")";
    if (cell.type === "decimal") return "Decimal(" + JSON.stringify(cell.value) + ")";
    if (cell.type === "datetime" || cell.type === "duration") return JSON.stringify(cell.value);
    return cell.display;
  }
  function operandCode(value) {
    return value.column ? "col(" + JSON.stringify(value.column) + ")" : cellCode(value.constant);
  }
  function conditionCode(condition) {
    if (condition.kind === "not") return "~(" + conditionCode(condition.children[0]) + ")";
    if (["all", "any"].includes(condition.kind))
      return (
        "(" +
        condition.children.map(conditionCode).join(condition.kind === "all" ? " & " : " | ") +
        ")"
      );
    const start = "where(" + JSON.stringify(condition.column) + ", " + JSON.stringify(condition.op);
    if (condition.value === null) return start + ")";
    const value =
      condition.op === "in"
        ? "[" + condition.value.values.map(cellCode).join(", ") + "]"
        : condition.op === "between"
          ? "(" + condition.value.bounds.map(operandCode).join(", ") + ")"
          : operandCode(condition.value);
    return start + ", " + value + ")";
  }
  function description(scene) {
    const p = scene.step.parameters;
    if (scene.kind === "source") return "Recorded input";
    if (scene.kind === "filter") return "filter_rows(predicate)";
    if (scene.kind === "filter_by") return "filter_by(" + conditionCode(p.condition) + ")";
    if (scene.kind === "case_when")
      return (
        "case_when(" +
        JSON.stringify(p.name) +
        ", condition=" +
        conditionCode(p.condition) +
        ", then=" +
        operandCode(p.then) +
        ", otherwise=" +
        operandCode(p.otherwise) +
        ")"
      );
    if (scene.kind === "case_select")
      return (
        "case_select(" +
        JSON.stringify(p.name) +
        ", cases=[" +
        p.cases
          .map(
            (branch) =>
              "(" + conditionCode(branch.condition) + ", " + operandCode(branch.value) + ")",
          )
          .join(", ") +
        "], otherwise=" +
        operandCode(p.otherwise) +
        ")"
      );
    if (scene.kind === "window")
      return (
        "window(" +
        JSON.stringify(p.name) +
        ", column=" +
        JSON.stringify(p.column) +
        ", op=" +
        JSON.stringify(p.op) +
        ", by=" +
        JSON.stringify(p.by) +
        ", periods=" +
        p.periods +
        ", size=" +
        p.size +
        ", min_periods=" +
        p.min_periods +
        ")"
      );
    if (scene.kind === "group_transform")
      return (
        "group_transform(" +
        JSON.stringify(p.name) +
        ", by=" +
        JSON.stringify(p.by) +
        ", value=" +
        JSON.stringify(p.value) +
        ", op=" +
        JSON.stringify(p.op) +
        ", dropna=" +
        (p.dropna ? "True" : "False") +
        (p.min_count === undefined ? "" : ", min_count=" + p.min_count) +
        ")"
      );
    if (scene.kind === "rank_within")
      return (
        "rank_within(" +
        JSON.stringify(p.name) +
        ", value=" +
        JSON.stringify(p.value) +
        ", by=" +
        JSON.stringify(p.by) +
        ", method=" +
        JSON.stringify(p.method) +
        ", ascending=" +
        (p.ascending ? "True" : "False") +
        ")"
      );
    if (scene.kind === "coalesce")
      return (
        "coalesce(" +
        JSON.stringify(p.name) +
        ", " +
        JSON.stringify(p.columns) +
        ", default=" +
        JSON.stringify(p.default) +
        ")"
      );
    if (scene.kind === "drop_missing")
      return (
        "drop_missing(subset=" + JSON.stringify(p.subset) + ", how=" + JSON.stringify(p.how) + ")"
      );
    if (scene.kind === "drop_duplicates")
      return (
        "drop_duplicates(subset=" +
        JSON.stringify(p.subset) +
        ", keep=" +
        (p.keep === false ? "False" : JSON.stringify(p.keep)) +
        ")"
      );
    if (scene.kind === "take") return "take_rows(" + JSON.stringify(p.positions) + ")";
    if (scene.kind === "fill_missing")
      return "fill_missing(values=" + JSON.stringify(p.values) + ")";
    if (scene.kind === "astype") return "astype(" + JSON.stringify(p.mapping) + ")";
    if (["to_numeric", "to_datetime", "string_transform"].includes(scene.kind)) {
      const options = Object.entries(p)
        .filter(([key]) => key !== "columns")
        .map(
          ([key, value]) =>
            key +
            "=" +
            (typeof value === "boolean" ? (value ? "True" : "False") : JSON.stringify(value)),
        );
      return scene.kind + "(" + JSON.stringify(p.columns) + ", " + options.join(", ") + ")";
    }
    if (scene.kind === "concat")
      return (
        "concat(inputs=" +
        JSON.stringify(p.inputs) +
        ", join=" +
        JSON.stringify(p.join) +
        ", ignore_index=" +
        (p.ignore_index ? "True" : "False") +
        ")"
      );
    if (scene.kind === "melt")
      return (
        "melt(id_vars=" +
        JSON.stringify(p.id_vars) +
        ", value_vars=" +
        JSON.stringify(p.value_vars) +
        ", var_name=" +
        JSON.stringify(p.var_name) +
        ", value_name=" +
        JSON.stringify(p.value_name) +
        ")"
      );
    if (scene.kind === "pivot")
      return (
        "pivot(index=" +
        JSON.stringify(p.index) +
        ", columns=" +
        JSON.stringify(p.columns) +
        ", values=" +
        JSON.stringify(p.values) +
        ")"
      );
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
        (p.on
          ? "merge(on=" + JSON.stringify(p.on)
          : "merge(left_on=" +
            JSON.stringify(p.left_on) +
            ", right_on=" +
            JSON.stringify(p.right_on)) +
        ", how=" +
        JSON.stringify(p.how) +
        ", validate=" +
        JSON.stringify(p.validate) +
        ", suffixes=" +
        JSON.stringify(p.suffixes || ["_x", "_y"]) +
        ", sort=False)"
      );
    if (scene.kind === "merge_asof")
      return (
        "merge_asof(on=" +
        JSON.stringify(p.on) +
        ", by=" +
        JSON.stringify(p.by) +
        ", direction=" +
        JSON.stringify(p.direction) +
        ", tolerance=" +
        (p.tolerance === null ? "None" : cellCode(p.tolerance)) +
        ", allow_exact_matches=" +
        (p.allow_exact_matches ? "True" : "False") +
        ")"
      );
    const group =
      "groupby(" +
      JSON.stringify(p.by) +
      ", dropna=" +
      (p.dropna ? "True" : "False") +
      ", sort=" +
      (p.sort ? "True" : "False") +
      ", observed=True)";
    if (scene.kind === "group") return group;
    if (scene.kind === "aggregate")
      return (
        "group_agg(by=" +
        JSON.stringify(p.by) +
        ", aggregations=" +
        JSON.stringify(Object.fromEntries(p.metrics.map((m) => [m.output, [m.column, m.agg]]))) +
        ", dropna=" +
        (p.dropna ? "True" : "False") +
        ", min_count=" +
        p.min_count +
        ")"
      );
    const call = {
      group_sum: "sum(min_count=" + p.min_count + ")",
      group_mean: "mean()",
      group_count: "count()",
    }[scene.step.operation];
    return group + "[" + JSON.stringify(p.value) + "]." + call + ".reset_index()";
  }
  const api = {
    indexStory,
    metrics,
    groupIdentity,
    scenes,
    traceCell,
    prepareTrace,
    rowKey,
    cellKey,
    cellExplanation,
    controlInputs,
    conditionFields,
    conditionBreakdown,
    conditionFormula,
    caseSelection,
    tableLabel,
    groupTitle,
    orderedRows,
    description,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FrameChoreoModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
