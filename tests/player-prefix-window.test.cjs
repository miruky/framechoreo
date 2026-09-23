const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/prefix_window.json");

test("compact cumulative windows retain exact late value and control pages", () => {
  const steps = model.indexStory(story);
  const result = story.steps.at(-1);
  const reference = { step: result.id, row: 999, column: "running" };
  const trace = model.prepareTrace(story, reference, steps);
  assert.equal(trace.total, 999n);
  assert.deepEqual(
    trace.page(997n, 5).origins.map((origin) => origin.row),
    [998, 999],
  );
  assert.equal(model.controlInputs(steps, reference).length, 999);
  assert.equal(model.traceCell(story, { step: result.id, row: 500, column: "running" }).length, 0);
  assert.deepEqual(
    model
      .controlInputs(steps, { step: result.id, row: 500, column: "running" })
      .map((input) => input.column),
    ["group", "value"],
  );
});

test("invalid shared prefix metadata cannot hide forged references", () => {
  const old = structuredClone(story);
  old.schema_version = 1;
  assert.throws(() => model.indexStory(old), /Invalid story/);
  const forged = structuredClone(story);
  forged.steps.at(-1).rows[999].cell_parents.running.push({
    step: forged.steps[0].id,
    row: 0,
    column: "value",
  });
  assert.throws(() => model.indexStory(forged), /Invalid story/);
  const wrongGroup = structuredClone(story);
  wrongGroup.steps.at(-1).parameters.row_groups[999] = 2;
  assert.throws(() => model.indexStory(wrongGroup), /Invalid story/);
});

test("a compact cumulative story opens and its first result is inspectable", (t) => {
  const player = mount(story);
  t.after(player.close);
  player.click('.chapter[data-kind="window"]');
  player.click('.cell[data-row="0"][data-column="running"]');
  assert.equal(player.document.querySelectorAll(".origins .origin").length, 1);
  assert.match(player.document.querySelector(".explanation").textContent, /current row order/);
});
