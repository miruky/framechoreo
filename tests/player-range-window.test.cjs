const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/range_window.json");

test("compact rolling ranges keep late candidates and missing controls", () => {
  const steps = model.indexStory(story);
  const result = story.steps.at(-1);
  const reference = { step: result.id, row: 999, column: "recent" };
  const trace = model.prepareTrace(story, reference, steps);
  assert.equal(trace.total, 799n);
  assert.deepEqual(
    trace.page(798n, 5).origins.map((origin) => origin.row),
    [999],
  );
  const controls = model.controlInputs(steps, reference);
  assert.equal(controls.length, 800);
  assert.deepEqual([controls.at(-1).row, controls.at(-1).column], [500, "value"]);
});

test("forged rolling groups and explicit references are rejected", () => {
  const old = structuredClone(story);
  old.schema_version = 1;
  assert.throws(() => model.indexStory(old), /Invalid story/);
  const forged = structuredClone(story);
  forged.steps.at(-1).rows[999].cell_parents.recent.push({
    step: forged.steps[0].id,
    row: 999,
    column: "value",
  });
  assert.throws(() => model.indexStory(forged), /Invalid story/);
  const wrongOffset = structuredClone(story);
  wrongOffset.steps.at(-1).parameters.row_offsets[999] = 1;
  assert.throws(() => model.indexStory(wrongOffset), /Invalid story/);
});

test("a compact rolling result opens with paged source values", (t) => {
  const player = mount(story);
  t.after(player.close);
  player.click('.chapter[data-kind="window"]');
  player.click('.cell[data-row="0"][data-column="recent"]');
  assert.equal(player.document.querySelectorAll(".origins .origin").length, 1);
  assert.match(player.document.querySelector(".explanation").textContent, /row order/);
});
