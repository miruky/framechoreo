const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { mount } = require("./player-harness.cjs");
const story = require("./fixtures/asof.json");

test("as-of schema validates selected positions and comparison keys", () => {
  const steps = model.indexStory(story);
  const result = story.steps.at(-1);
  assert.deepEqual(result.parameters.audit.matched_right_rows, [null, 0, 0, 2]);
  assert.deepEqual(result.parameters.audit.right_reused, [0]);
  assert.deepEqual(
    model
      .controlInputs(steps, { step: result.id, row: 1, column: "reading" })
      .map((ref) => ref.column),
    ["time", "sensor", "time", "sensor"],
  );
  assert.deepEqual(
    model.traceCell(story, { step: result.id, row: 2, column: "reading" }).map((ref) => ref.row),
    [0],
  );
  const wrongMatch = structuredClone(story);
  wrongMatch.steps.at(-1).parameters.audit.matched_right_rows[1] = 1;
  assert.throws(() => model.indexStory(wrongMatch), /Invalid story/);
  const wrongKey = structuredClone(story);
  wrongKey.steps.at(-1).rows[1].cell_controls.reading.pop();
  assert.throws(() => model.indexStory(wrongKey), /Invalid story/);
});

test("the browser shows unmatched and reused readings with direct source links", (t) => {
  const p = mount(story);
  t.after(p.close);
  p.click('.chapter[data-kind="merge_asof"]');
  const audit = p.document.querySelector('.decision-audit[data-kind="merge_asof"]');
  assert.ok(audit && !audit.hidden);
  assert.match(p.document.querySelector(".notice").textContent, /Tolerance: 3 min/);
  assert.match(
    audit.textContent,
    /3 matched.*1 unmatched events.*1 unused right rows.*1 reused right rows/s,
  );
  assert.equal(audit.querySelectorAll('[data-asof-kind="pair"]').length, 3);
  p.click('[data-asof-kind="right_unused"]');
  assert.equal(p.document.activeElement.dataset.column, "time");
  assert.equal(p.document.activeElement.dataset.row, "1");
});
