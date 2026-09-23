const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/decisions.json");
const extrema = require("./fixtures/window_extrema.json");

function corrupt(operation, change) {
  const data = structuredClone(story);
  const step = data.steps.find((s) => s.operation === operation);
  change(step);
  assert.throws(() => model.indexStory(data), /Invalid story/);
}

test("the example validates and shows value versus decision inputs", () => {
  const steps = model.indexStory(story);
  const conditional = story.steps.find((s) => s.operation === "case_when");
  const reference = { step: conditional.id, row: 0, column: "status" };
  assert.deepEqual(
    model.traceCell(story, reference).map((origin) => origin.column),
    [],
  );
  assert.deepEqual(
    model.controlInputs(steps, reference).map((input) => input.column),
    ["sales", "target"],
  );
  assert.match(model.cellExplanation(steps, reference, "ja").text, /判定入力/);
  const selected = story.steps.at(-1);
  assert.equal(
    selected.parameters.outcomes.filter((x) => x === "true").length,
    selected.rows.length,
  );
  assert.deepEqual(
    model
      .controlInputs(steps, { step: selected.id, row: 0, column: "account" })
      .map((input) => input.column),
    ["sales", "target"],
  );
  const lag = story.steps.find((s) => s.operation === "window" && s.parameters.op === "lag");
  assert.match(
    model.cellExplanation(steps, { step: lag.id, row: 0, column: "previous_sales" }, "ja").text,
    /前の行/,
  );
});

test("conditional and filter declarations cannot counterfeit source references", () => {
  corrupt("case_when", (s) => s.rows[0].cell_controls.status.reverse());
  corrupt("case_when", (s) =>
    s.rows[0].cell_parents.status.push({
      step: s.parents[0],
      row: 0,
      column: "sales",
    }),
  );
  corrupt("case_when", (s) => (s.parameters.outcomes[0] = "unknown"));
  corrupt("filter_by", (s) => (s.parameters.outcomes[0] = "false"));
  corrupt("filter_by", (s) => (s.rows[0].row_controls = []));
  corrupt("filter_by", (s) => delete s.rows[0].row_controls);
});

test("window membership and exact candidate references are checked", () => {
  const data = structuredClone(story);
  const rolling = data.steps.find(
    (s) => s.operation === "window" && s.parameters.op === "rolling_mean",
  );
  rolling.rows[1].cell_parents.two_week_average = [];
  assert.throws(() => model.indexStory(data), /Invalid story/);
  corrupt("window", (s) => s.parameters.groups[0].reverse());
  corrupt("window", (s) => (s.parameters.periods = 0));
  corrupt("coalesce", (s) => (s.parameters.selected_columns[4] = "sales"));
  corrupt("coalesce", (s) => (s.rows[4].cell_parents.effective_sales = []));
});

test("cumulative and rolling extrema keep their candidate windows", () => {
  const steps = model.indexStory(extrema);
  assert.deepEqual(
    extrema.steps.slice(1).map((s) => s.parameters.op),
    ["cummin", "cummax", "rolling_min", "rolling_max"],
  );
  const final = extrema.steps.at(-1);
  assert.deepEqual(
    model.traceCell(extrema, { step: final.id, row: 3, column: "high2" }).map((input) => input.row),
    [3],
  );
  assert.ok(model.controlInputs(steps, { step: final.id, row: 3, column: "high2" }).length > 0);
  const forged = structuredClone(extrema);
  forged.steps.at(-1).rows[3].cell_parents.high2.push({
    step: forged.steps.at(-2).id,
    row: 0,
    column: "v",
  });
  assert.throws(() => model.indexStory(forged), /Invalid story/);
});

test("the inspector distinguishes why a constant was chosen from its value origin", (t) => {
  const p = mount(story);
  t.after(p.close);
  p.click('.chapter[data-kind="case_when"]');
  p.click('.data-row .cell[data-column="status"]');
  assert.equal(p.document.querySelectorAll(".origins .origin").length, 0);
  assert.equal(p.document.querySelectorAll(".decision-inputs .decision-origin").length, 2);
  assert.match(
    p.document.querySelector(".decision-inputs").textContent,
    /sales.*110.*target.*100/s,
  );
  p.click(".decision-origin");
  assert.equal(p.document.activeElement.dataset.column, "sales");
  p.click('[data-action="return-selection"]');
  assert.equal(p.document.activeElement.dataset.column, "status");
});

test("window reports offscreen inputs without inventing movement; filtering uses recorded rows", (t) => {
  const p = mount(story);
  t.after(p.close);
  const cumulative = story.steps.find(
    (s) => s.operation === "window" && s.parameters.op === "cumsum",
  );
  p.click('.chapter[data-kind="coalesce"]');
  p.click('.cell[data-row="4"][data-column="effective_sales"]');
  assert.match(p.document.querySelector(".origins").textContent, /forecast_sales/);
  assert.equal(p.document.querySelectorAll(".decision-origin").length, 2);
  p.click('[data-action="clear-selection"]');
  p.click('.chapter[data-kind="window"]');
  assert.match(p.document.querySelector(".motion-status").textContent, /4 inputs/);
  assert.equal(p.document.querySelectorAll(".value-flight").length, 0);
  p.click('.chapter[data-kind="filter_by"]');
  assert.match(p.document.querySelector(".notice").textContent, /excluded/);
  assert.match(
    p.document.querySelector(".decision-audit-summary").textContent,
    /1 failed.*1 had a missing comparison/,
  );
  assert.equal(p.document.querySelectorAll(".decision-audit-row").length, 2);
  p.click(".decision-audit-row:last-child");
  assert.equal(p.document.activeElement.dataset.column, "sales");
  p.click('.chapter[data-kind="filter_by"]');
  p.click('.data-row .cell[data-column="account"]');
  assert.equal(p.document.querySelectorAll(".decision-origin").length, 2);
  assert.ok(cumulative.rows.some((r) => r.cell_parents.running_sales.length > 1));
});
