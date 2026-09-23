const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/shared_group.json");

test("shared group lineage keeps exact value and decision pages", () => {
  const steps = model.indexStory(story);
  const total = story.steps.find((step) => step.operation === "group_transform");
  const rank = story.steps.find((step) => step.operation === "rank_within");
  assert.equal(story.schema_version, 2);
  for (const [step, column] of [
    [total, "group_total"],
    [rank, "rank"],
  ]) {
    const reference = { step: step.id, row: 0, column };
    const trace = model.prepareTrace(story, reference, steps);
    assert.equal(trace.total, 599n);
    assert.deepEqual(
      trace.page(597n, 5).origins.map((source) => source.row),
      [597, 598],
    );
    assert.equal(
      model.controlInputs(steps, reference).length,
      column === "group_total" ? 600 : 599,
    );
  }
  assert.equal(model.traceCell(story, { step: rank.id, row: 599, column: "rank" }).length, 0);
  assert.deepEqual(
    model
      .controlInputs(steps, { step: rank.id, row: 599, column: "rank" })
      .map((ref) => ref.column),
    ["group", "score"],
  );
});

test("shared-group payload rejects downgraded schemas and forged references", () => {
  const oldVersion = structuredClone(story);
  oldVersion.schema_version = 1;
  assert.throws(() => model.indexStory(oldVersion), /Invalid story/);
  const forged = structuredClone(story);
  forged.steps[1].rows[0].cell_parents.group_total.push({
    step: forged.steps[0].id,
    row: 0,
    column: "score",
  });
  assert.throws(() => model.indexStory(forged), /Invalid story/);
  const missing = structuredClone(story);
  missing.steps[1].parameters.groups[0].pop();
  assert.throws(() => model.indexStory(missing), /Invalid story/);
});

test("the player opens complete sources from a compact large-group story", (t) => {
  const player = mount(story);
  t.after(player.close);
  player.click('.chapter[data-kind="rank_within"]');
  player.click('.cell[data-row="0"][data-column="rank"]');
  assert.equal(player.document.querySelectorAll(".origins .origin").length, 50);
  assert.equal(player.document.querySelectorAll(".decision-origin").length, 24);
  assert.match(player.document.querySelector(".explanation").textContent, /599/);
});
