const test = require("node:test");
const assert = require("node:assert/strict");
const { mount } = require("./player-harness.cjs");
const model = require("../src/framechoreo/assets/model.js");
const template = require("./fixtures/reshape.json");

test("melt moves values from their real month columns, not from the schema label", (t) => {
  const p = mount(template);
  t.after(p.close);
  p.click('.chapter[data-kind="melt"]');
  const flights = [...p.document.querySelectorAll(".value-flight")];
  assert.equal(flights.length, 9);
  assert.deepEqual(
    flights.map((n) => n.dataset.sourceColumn),
    ["Jan", "Jan", "Jan", "Feb", "Feb", "Feb", "Mar", "Mar", "Mar"],
  );
  assert.ok(flights.every((n) => n.dataset.targetColumn === "sales"));
});
test("pivot movement lands in the column matching the input month", (t) => {
  const p = mount(template);
  t.after(p.close);
  p.click('.chapter[data-kind="aggregate"]');
  p.click('.chapter[data-kind="pivot"]');
  const aggregate = template.steps.find((s) => s.operation === "group_agg"),
    month = aggregate.columns.indexOf("month");
  const flights = [...p.document.querySelectorAll(".value-flight")];
  assert.equal(flights.length, 6);
  for (const n of flights) {
    assert.equal(n.dataset.sourceColumn, "total");
    assert.equal(
      aggregate.rows[Number(n.dataset.sourceRow)].cells[month].value,
      n.dataset.targetColumn,
    );
  }
});
test("arithmetic shows both recorded operands for each output value", (t) => {
  const p = mount(template);
  t.after(p.close);
  p.click('.chapter[data-kind="select"]');
  p.click('.chapter[data-kind="calculate"]');
  const flights = [...p.document.querySelectorAll(".value-flight")];
  assert.equal(flights.length, 4);
  assert.deepEqual(
    flights.map((n) => n.dataset.sourceColumn),
    ["Mar", "Jan", "Mar", "Jan"],
  );
  assert.ok(flights.every((n) => n.dataset.targetColumn === "growth"));
});
test("melt rejects a forged source column", () => {
  const data = structuredClone(template),
    melt = data.steps.find((s) => s.operation === "melt");
  melt.rows[0].cell_parents.sales[0].column = "Feb";
  assert.throws(() => model.indexStory(data), /melt/);
});
test("pivot rejects a value moved into a different month's column", () => {
  const data = structuredClone(template),
    pivot = data.steps.find((s) => s.operation === "pivot");
  pivot.rows[0].cell_parents.Jan[0].row = pivot.rows[0].cell_parents.Feb[0].row;
  assert.throws(() => model.indexStory(data), /pivot/);
});
