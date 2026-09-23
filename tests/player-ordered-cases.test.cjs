const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/ordered_cases.json");

test("ordered cases validate priority, values, and repeated comparison uses", () => {
  const steps = model.indexStory(story);
  const result = story.steps.at(-1);
  assert.deepEqual(result.parameters.selected_cases, [0, 1, null, 2]);
  assert.deepEqual(
    model.caseSelection(result, 2).cases.map((c) => c.outcome),
    ["missing", "false", "missing"],
  );
  assert.deepEqual(
    model.traceCell(story, { step: result.id, row: 3, column: "lane" }).map((o) => o.column),
    ["fallback_lane"],
  );
  assert.deepEqual(
    model.controlInputs(steps, { step: result.id, row: 3, column: "lane" }).map((c) => c.column),
    ["score", "vip", "score"],
  );
  const forged = structuredClone(story);
  forged.steps.at(-1).parameters.selected_cases[0] = 1;
  assert.throws(() => model.indexStory(forged), /Invalid story/);
  const bad = structuredClone(story);
  bad.steps.at(-1).rows[3].cell_parents.lane = [];
  assert.throws(() => model.indexStory(bad), /Invalid story/);
});

test("the inspector names every branch and highlights the chosen one", (t) => {
  const p = mount(story);
  t.after(p.close);
  p.click('.chapter[data-kind="case_select"]');
  p.click('.cell[data-row="3"][data-column="lane"]');
  assert.equal(p.document.querySelectorAll(".origins .origin").length, 1);
  assert.equal(p.document.querySelectorAll(".decision-origin").length, 3);
  assert.equal(p.document.querySelectorAll(".clause-chip").length, 3);
  assert.match(
    p.document.querySelector('.clause-chip[data-selected="true"]').textContent,
    /Case 3.*selected/,
  );
  p.click('[data-action="clear-selection"]');
  p.click('.cell[data-row="2"][data-column="lane"]');
  assert.match(p.document.querySelector(".clause-formula").textContent, /default value/);
});
