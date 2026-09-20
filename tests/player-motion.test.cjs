const test = require("node:test");
const assert = require("node:assert/strict");
const { mount, fixture } = require("./player-harness.cjs");

const { dropnaGroupFixture, mergeFixture } = require("./motion-fixtures.cjs");

test("group results and their group rows share the same color and number", (t) => {
  const p = mount(fixture(3, "group_sum"));
  t.after(p.close);
  p.click(".chapter:nth-child(3)");
  assert.equal(p.scene(), "GROUP");
  assert.equal(p.document.querySelector(".data-row").dataset.group, "0");
  assert.equal(p.document.querySelector(".group-band").dataset.group, "0");
  p.click(".chapter:nth-child(4)");
  assert.equal(p.scene(), "SUM");
  assert.equal(p.document.querySelector(".data-row:not(.ghost)").dataset.group, "0");
});

test("every contributing value converges toward the aggregate result, not away from it", (t) => {
  const p = mount(fixture(3, "group_sum"));
  t.after(p.close);
  p.click(".chapter:nth-child(3)");
  p.click(".chapter:nth-child(4)");
  assert.equal(p.scene(), "SUM");
  const ghosts = [...p.document.querySelectorAll(".value-flight")];
  assert.equal(ghosts.length, 3);
  assert.deepEqual(
    ghosts.map((n) => n.dataset.sourceRow),
    ["0", "1", "2"],
  );
  for (const ghost of ghosts) {
    assert.equal(ghost.dataset.targetRow, "0");
    assert.equal(ghost.dataset.sourceColumn, "v");
    assert.equal(ghost.getAttribute("aria-hidden"), "true");
    assert.ok([...ghost.querySelectorAll("button")].every((b) => b.disabled));
  }
  assert.equal(
    p.document.querySelector('.data-row:not(.ghost) .cell[data-column="v"]').textContent,
    "6",
  );
});

test("a dropna-excluded row is labeled separately and never converges into the result", (t) => {
  const p = mount(dropnaGroupFixture());
  t.after(p.close);
  p.click(".chapter:nth-child(3)");
  assert.equal(p.scene(), "GROUP");
  const excludedRow = [...p.document.querySelectorAll(".data-row")].find(
    (r) => r.dataset.group === "excluded",
  );
  assert.ok(excludedRow);
  p.click(".chapter:nth-child(4)");
  assert.equal(p.scene(), "SUM");
  const ghosts = [...p.document.querySelectorAll(".value-flight")];
  assert.deepEqual(
    ghosts.map((g) => g.dataset.sourceRow),
    ["0", "1"],
  );
  assert.ok(ghosts.every((g) => g.dataset.sourceColumn === "v" && g.dataset.targetRow === "0"));
  assert.match(p.document.querySelector(".notice").textContent, /1 input row excluded/);
});

test("legend content stays small regardless of table size", (t) => {
  const p = mount(fixture(600));
  t.after(p.close);
  assert.equal(p.scene(), "SOURCE");
  assert.equal(p.document.querySelectorAll(".legend .legend-item").length, 0);
  p.click(".chapter:nth-child(2)");
  assert.equal(p.scene(), "FILTER");
  assert.equal(p.document.querySelectorAll(".legend .legend-item").length, 1);
  assert.match(p.document.querySelector(".legend").textContent, /removed by the filter/);
});

test("matched merge values are labeled with their right-hand row, unmatched values are not", (t) => {
  const p = mount(mergeFixture());
  t.after(p.close);
  p.click(".chapter:nth-child(2)");
  assert.equal(p.scene(), "MERGE");
  const rows = [...p.document.querySelectorAll(".data-row")];
  const scoreWrap = (rowIndex) =>
    rows[rowIndex].querySelector('.cell[data-column="score"]').closest(".cell-wrap");
  const keyWrap = (rowIndex) =>
    rows[rowIndex].querySelector('.cell[data-column="key"]').closest(".cell-wrap");
  assert.equal(scoreWrap(0).dataset.origin, "right");
  assert.match(scoreWrap(0).querySelector(".cell").getAttribute("aria-label"), /Right row 1/);
  assert.equal(keyWrap(0).dataset.origin, undefined);
  assert.equal(scoreWrap(1).dataset.origin, undefined);
  assert.equal(scoreWrap(2).dataset.origin, "right", "a missing/null key can still be matched");
  assert.match(scoreWrap(2).querySelector(".cell").getAttribute("aria-label"), /Right row 2/);
  assert.equal(scoreWrap(3).dataset.origin, "right", "the same right row can be reused");
  assert.match(scoreWrap(3).querySelector(".cell").getAttribute("aria-label"), /Right row 1/);
  assert.equal(p.document.querySelectorAll(".legend .legend-item").length, 1);
  assert.match(
    p.document.querySelector(".legend").textContent,
    /Blue cards.*matching result cells/,
  );
});

test("merge origin tags do not depend on the shown-all viewport", (t) => {
  const p = mount(mergeFixture(10));
  t.after(p.close);
  p.click(".chapter:nth-child(2)");
  p.click('[data-action="show-rows"]');
  assert.equal(p.document.querySelectorAll(".data-row:not(.ghost)").length, 14);
  const rows = [...p.document.querySelectorAll(".data-row")];
  const scoreWrap = rows[0].querySelector('.cell[data-column="score"]').closest(".cell-wrap");
  assert.equal(scoreWrap.dataset.origin, "right");
});

test("selecting a value distinguishes it from its traced sources shown elsewhere", (t) => {
  const p = mount(fixture(3, "group_sum"));
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  p.click(".chapter:first-child");
  assert.equal(p.scene(), "SOURCE");
  const sourceCell = p.document.querySelector('.cell[data-row="0"][data-column="v"]');
  assert.ok(sourceCell.classList.contains("selected-source"));
  assert.equal(sourceCell.classList.contains("selected"), false);
  assert.match(p.document.querySelector(".selection-legend").textContent, /Dashed outline/);
});

test("clearing a selection removes the selected/source distinction and its legend note", (t) => {
  const p = mount(fixture(3, "group_sum"));
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  p.click('[data-action="clear-selection"]');
  assert.equal(p.document.querySelectorAll(".selected, .selected-source").length, 0);
  assert.equal(p.document.querySelector(".selection-legend").textContent, "");
});

test("replay is unavailable on the first scene and while reduced motion is active", (t) => {
  const p = mount();
  t.after(p.close);
  const replay = () => p.document.querySelector('[data-action="replay-motion"]');
  assert.equal(replay().disabled, true);
  p.click(".chapter:nth-child(2)");
  assert.equal(replay().disabled, false);
  p.setReduced(true);
  assert.equal(replay().disabled, true);
  p.setReduced(false);
  assert.equal(replay().disabled, false);
});

test("replay re-runs the transition and keeps focus on the replay control", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".chapter:nth-child(2)");
  const before = p.animations.length;
  p.click('[data-action="replay-motion"]');
  assert.equal(p.scene(), "FILTER");
  assert.ok(p.animations.length > before);
  assert.equal(p.document.activeElement, p.document.querySelector('[data-action="replay-motion"]'));
  assert.equal(p.document.querySelectorAll(".data-row:not(.ghost)").length, 3);
});

test("replay does not fire during an active inspection or on a fresh scene it can't replay", (t) => {
  const p = mount();
  t.after(p.close);
  p.click('.data-row .cell[data-column="key"]');
  p.click(".origin");
  const replay = p.document.querySelector('[data-action="replay-motion"]');
  assert.equal(replay.disabled, true);
});
