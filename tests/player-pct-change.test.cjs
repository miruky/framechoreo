const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/growth.json");

test("fractional change traces the numerator and earlier denominator", () => {
  const steps = model.indexStory(story);
  const result = story.steps.at(-1);
  const reference = { step: result.id, row: 2, column: "fractional_change" };
  assert.deepEqual(
    model.traceCell(story, reference).map((source) => source.row),
    [2, 0],
  );
  assert.deepEqual(
    model.controlInputs(steps, reference).map((source) => source.column),
    ["store", "store"],
  );
  const forged = structuredClone(story);
  forged.steps.at(-1).rows[2].cell_parents.fractional_change.pop();
  assert.throws(() => model.indexStory(forged), /Invalid story/);
});

test("the player explains an infinite fractional result without hiding inputs", (t) => {
  const player = mount(story);
  t.after(player.close);
  player.click('.chapter[data-kind="window"]');
  assert.match(player.document.querySelector(".notice").textContent, /Multiply by 100/);
  player.click('.cell[data-row="2"][data-column="fractional_change"]');
  assert.equal(player.document.querySelectorAll(".origins .origin").length, 2);
  assert.match(player.document.querySelector(".explanation").textContent, /zero denominators/);
});
