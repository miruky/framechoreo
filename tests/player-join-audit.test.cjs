const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/join_audit.json");
const older = require("./fixtures/retail.json");

function tamper(change) {
  const data = structuredClone(story);
  change(data.steps.at(-1));
  assert.throws(() => model.indexStory(data), /Invalid story/);
}

test("join audit validates matches, dropped inputs, fanout, and null-key matches", () => {
  const steps = model.indexStory(story);
  assert.equal(steps.size, 3);
  const audit = story.steps.at(-1).parameters.audit;
  assert.deepEqual(audit.left_match_counts, [2, 0, 1]);
  assert.deepEqual(audit.right_unmatched, [2]);
  assert.deepEqual(audit.null_key_output_rows, [4]);
  tamper((s) => s.parameters.audit.left_match_counts[0]++);
  tamper((s) => s.parameters.audit.right_unmatched.pop());
  tamper((s) => s.parameters.audit.null_key_output_rows.pop());
  tamper((s) => s.parameters.audit.right_duplicate_keys.push(999));
  assert.ok(model.indexStory(older).size > 0, "older stories remain readable");
});

test("the browser exposes unmatched inputs, repeated keys, and a source-row link", (t) => {
  const p = mount(story);
  t.after(p.close);
  p.click('.chapter[data-kind="merge"]');
  const audit = p.document.querySelector('.decision-audit[data-kind="merge"]');
  assert.ok(audit && !audit.hidden);
  assert.match(audit.textContent, /1 unmatched left.*1 unmatched right.*1 left rows expanded/s);
  assert.equal(audit.querySelectorAll('[data-audit-kind="right_duplicate_keys"]').length, 2);
  p.click('[data-audit-kind="right_unmatched"]');
  assert.equal(p.document.activeElement.dataset.column, "code");
  assert.equal(p.document.activeElement.dataset.row, "2");
});
