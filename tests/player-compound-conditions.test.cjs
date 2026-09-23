const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/compound_conditions.json");

test("nested condition fields and three-valued outcomes validate", () => {
  const steps = model.indexStory(story);
  const rule = story.steps.at(-1).parameters.condition;
  assert.deepEqual(model.conditionFields(rule, story.steps[0].columns), [
    "amount",
    "region",
    "priority",
  ]);
  assert.deepEqual(story.steps.at(-1).parameters.outcomes, [
    "true",
    "false",
    "true",
    "false",
    "missing",
  ]);
  assert.deepEqual(
    model.conditionBreakdown(story.steps.at(-1), 4).map((part) => part.outcome),
    ["missing", "true", "true"],
  );
  assert.match(
    model.conditionFormula(story.steps[1], 2),
    /\(\(missing AND true\) OR NOT \(false\)\) → true/,
  );
  const description = model.description(model.scenes(story).at(-1));
  assert.match(description, /where\("amount", "between"/);
  assert.match(description, / & /);
  assert.match(description, / \| /);
  assert.doesNotMatch(description, /undefined/);
  const route = story.steps[1];
  assert.deepEqual(
    model.controlInputs(steps, { step: route.id, row: 2, column: "route" }).map((r) => r.column),
    ["amount", "region", "priority"],
  );
  const bad = structuredClone(story);
  bad.steps.at(-1).parameters.condition.children[0].kind = "execute";
  assert.throws(() => model.indexStory(bad), /Invalid story/);
  const forged = structuredClone(story);
  forged.steps[1].rows[2].cell_controls.route.pop();
  assert.throws(() => model.indexStory(forged), /Invalid story/);
  const logic = structuredClone(story);
  logic.steps.at(-1).parameters.clause_outcomes[0][0] = "false";
  assert.throws(() => model.indexStory(logic), /Invalid story/);
});

test("filter audit names every checked field and distinguishes missing outcomes", (t) => {
  const p = mount(story);
  t.after(p.close);
  p.click('.chapter[data-kind="filter_by"]');
  const audit = p.document.querySelector(".decision-audit");
  assert.match(audit.textContent, /2 failed the condition.*1 had a missing comparison/s);
  assert.match(audit.textContent, /amount = ∅.*region = South.*priority = False/s);
  assert.match(audit.textContent, /Checks: amount between → missing/);
  assert.match(audit.textContent, /Combined:.*NOT \(true\).*→ missing/s);
  p.click(".decision-audit-row:last-child");
  assert.equal(p.document.activeElement.dataset.column, "amount");
  assert.equal(p.document.activeElement.dataset.row, "4");
});

test("a chosen value shows each atomic comparison separately", (t) => {
  const p = mount(story);
  t.after(p.close);
  p.click('.chapter[data-kind="case_when"]');
  p.click('.cell[data-row="2"][data-column="route"]');
  assert.deepEqual(
    [...p.document.querySelectorAll(".clause-chip")].map((chip) => chip.dataset.outcome),
    ["missing", "true", "false"],
  );
  assert.match(p.document.querySelector(".clause-panel").textContent, /priority eq/);
  assert.match(p.document.querySelector(".clause-formula").textContent, /NOT \(false\).*→ true/);
});
