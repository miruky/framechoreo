const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/time_buckets.json");

test("time buckets keep empty intervals and positional input rows", () => {
  const steps = model.indexStory(story);
  const result = story.steps.at(-1);
  assert.deepEqual(result.parameters.empty_bins, [1, 4]);
  assert.deepEqual(
    model.traceCell(story, { step: result.id, row: 0, column: "reading" }).map((ref) => ref.row),
    [0, 2],
  );
  assert.deepEqual(model.traceCell(story, { step: result.id, row: 1, column: "reading" }), []);
  assert.deepEqual(
    model
      .controlInputs(steps, { step: result.id, row: 0, column: "reading" })
      .map((ref) => [ref.row, ref.column]),
    [
      [0, "time"],
      [2, "time"],
      [0, "sensor"],
    ],
  );
  assert.deepEqual(model.groupIdentity(steps, result.id, 1), { step: result.id, row: 1 });
  const forged = structuredClone(story);
  forged.steps.at(-1).rows[0].cell_parents.reading.pop();
  assert.throws(() => model.indexStory(forged), /Invalid story/);
  const missing = structuredClone(story);
  missing.steps.at(-1).parameters.bins[0].input_rows.pop();
  assert.throws(() => model.indexStory(missing), /Invalid story/);
});

test("the player shows time-bin sources and the empty interval", (t) => {
  const player = mount(story);
  t.after(player.close);
  player.click('.chapter[data-kind="time_resample"]');
  assert.match(player.document.querySelector(".notice").textContent, /2 empty buckets/);
  assert.equal(player.document.querySelectorAll(".data-row[data-group]").length, 6);
  player.click('.cell[data-row="0"][data-column="reading"]');
  assert.equal(player.document.querySelectorAll(".origins .origin").length, 2);
  assert.equal(player.document.querySelectorAll(".decision-origin").length, 3);
});
