const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/group_transform.json");

test("broadcast totals retain all non-missing candidates and group-key controls", () => {
  const steps = model.indexStory(story);
  const first = story.steps.find((s) => s.operation === "group_transform");
  const reference = { step: first.id, row: 2, column: "team_total" };
  assert.deepEqual(
    model.traceCell(story, reference).map((o) => o.row),
    [0, 4],
  );
  assert.deepEqual(
    model.controlInputs(steps, reference).map((o) => o.row),
    [0, 2, 4],
  );
  const tampered = structuredClone(story);
  tampered.steps[1].rows[2].cell_parents.team_total.pop();
  assert.throws(() => model.indexStory(tampered), /Invalid story/);
  const excluded = structuredClone(story);
  excluded.steps[1].parameters.excluded_rows.push(2);
  assert.throws(() => model.indexStory(excluded), /Invalid story/);
});

test("the repeated group metric is inspectable beside each original row", (t) => {
  const p = mount(story);
  t.after(p.close);
  p.click('.chapter[data-kind="group_transform"]');
  assert.equal(p.document.querySelectorAll('.data-row[data-group="0"]').length, 3);
  assert.equal(p.document.querySelectorAll('.data-row[data-group="1"]').length, 2);
  p.click('.cell[data-row="2"][data-column="team_total"]');
  assert.equal(p.document.querySelectorAll(".origins .origin").length, 2);
  assert.equal(p.document.querySelectorAll(".decision-origin").length, 3);
  assert.match(p.document.querySelector(".explanation").textContent, /group/i);
});
