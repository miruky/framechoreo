const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const template = require("./fixtures/retail.json");

function bad(operation, mutate) {
  const data = structuredClone(template),
    step = data.steps.find((s) => s.operation === operation);
  mutate(step, data);
  assert.throws(() => model.indexStory(data), /Invalid story/);
}

test("quality metadata must agree with the recorded cells", () => {
  bad("source", (s) => s.profile.columns[0].missing++);
  bad("source", (s) => (s.profile.columns[0].unique = s.rows.length + 1));
  bad("source", (s) => (s.profile.duplicate_rows = -1));
});
test("chapter labels and notes keep their text-only length contract", () => {
  bad("source", (s) => (s.presentation.chapter = { text: "not a string" }));
  bad("source", (s) => (s.presentation.chapter = "x".repeat(101)));
  bad("source", (s) => (s.presentation.note = "x".repeat(601)));
});
test("fill constants and missing positions are verified independently", () => {
  bad("fill_missing", (s) => (s.parameters.values.units.type = "object"));
  bad("fill_missing", (s) => s.parameters.filled_positions.units.push(0));
  bad("fill_missing", (s) => (s.rows[0].cell_parents.units = []));
});
test("removed missing rows cannot be invented by changing membership", () => {
  bad("drop_missing", (s) => s.parameters.positions.reverse());
  bad("drop_missing", (s) => (s.parameters.how = "sometimes"));
});
test("conversions preserve references to their original fields", () => {
  bad("to_numeric", (s) => (s.rows[0].cell_parents.units[0].column = "item"));
  bad("to_datetime", (s) => (s.parameters.errors = "ignore"));
  bad("astype", (s) => (s.parameters.mapping.units = {}));
  bad("string_transform", (s) => (s.parameters.op = "eval"));
});
test("concat checks both schema and ordering of its source records", () => {
  bad("concat", (s) => s.parameters.inputs.reverse());
  bad("concat", (s) => (s.rows[0].cell_parents.units = []));
});
test("each named metric must use its own declared column and group members", () => {
  bad("group_agg", (s) => (s.parameters.metrics[0].agg = "script"));
  bad("group_agg", (s) => (s.parameters.metrics[0].output = s.parameters.by[0]));
  bad("group_agg", (s) => (s.rows[0].cell_parents.orders = s.rows[0].cell_parents.revenue_total));
});
test("group identity survives sorting and keeps the original group number", () => {
  const steps = model.indexStory(template),
    sorted = template.steps.find((s) => s.operation === "sort"),
    aggregate = template.steps.find((s) => s.operation === "group_agg");
  const group = model.groupIdentity(steps, sorted.id, 0);
  assert.equal(group.step, aggregate.id);
  assert.equal(group.row, 1);
  assert.equal(aggregate.rows[group.row].cells[0].display, "Books");
});
test("the value-input step list includes both concatenated sources", () => {
  const steps = model.indexStory(template),
    result = template.steps.at(-1),
    trace = model.prepareTrace(
      template,
      { step: result.id, row: 0, column: "revenue_total" },
      steps,
    );
  assert.ok(trace.steps.includes(template.steps[0].id));
  assert.ok(trace.steps.includes(template.steps[1].id));
  assert.ok(trace.steps.includes(result.id));
});
test("Japanese constant-fill explanations do not claim an original value exists", () => {
  const steps = model.indexStory(template),
    fill = template.steps.find((s) => s.operation === "fill_missing"),
    row = fill.parameters.filled_positions.units[0];
  assert.match(
    model.cellExplanation(steps, { step: fill.id, row, column: "units" }, "ja").text,
    /定数/,
  );
  assert.equal(
    model.prepareTrace(template, { step: fill.id, row, column: "units" }, steps).total,
    0n,
  );
});
