const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/rank.json");

test("rank candidates, tie method, and missing-current decisions validate", () => {
  const steps = model.indexStory(story);
  const ranked = story.steps[1];
  assert.deepEqual(
    model.traceCell(story, { step: ranked.id, row: 0, column: "team_rank" }).map((o) => o.row),
    [0, 2, 5],
  );
  assert.deepEqual(
    model
      .controlInputs(steps, { step: ranked.id, row: 3, column: "team_rank" })
      .map((o) => o.column),
    ["team", "score"],
  );
  assert.equal(model.groupIdentity(steps, story.steps.at(-1).id, 0).step, ranked.id);
  const forged = structuredClone(story);
  forged.steps[1].rows[0].cell_parents.team_rank.pop();
  assert.throws(() => model.indexStory(forged), /Invalid story/);
  const bad = structuredClone(story);
  bad.steps[1].parameters.method = "random";
  assert.throws(() => model.indexStory(bad), /Invalid story/);
});

test("group colors and tied rank inputs remain visible after ranking", (t) => {
  const p = mount(story);
  t.after(p.close);
  p.click('.chapter[data-kind="rank_within"]');
  assert.equal(p.document.querySelectorAll('.data-row[data-group="0"]').length, 4);
  assert.equal(p.document.querySelectorAll('.data-row[data-group="1"]').length, 2);
  p.click('.cell[data-row="0"][data-column="team_rank"]');
  assert.equal(p.document.querySelectorAll(".origins .origin").length, 3);
  assert.equal(p.document.querySelectorAll(".decision-origin").length, 3);
  assert.match(p.document.querySelector(".explanation").textContent, /ties/);
});
