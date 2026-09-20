const test = require("node:test");
const assert = require("node:assert/strict");
const { mount, fixture } = require("./player-harness.cjs");

test("selecting a value reveals and focuses its origins", (t) => {
  const p = mount(fixture(60));
  t.after(p.close);
  p.click('.data-row .cell[data-column="v"]');
  const inspector = p.document.querySelector(".inspector");
  assert.equal(p.document.activeElement, inspector);
  assert.equal(inspector.dataset.scrolled, "true");
  assert.equal(p.document.querySelector(".selected-value").textContent, "1");
});

test("returning to a selected value preserves its scene and shown rows", (t) => {
  const p = mount(fixture(60));
  t.after(p.close);
  p.click(".chapter:nth-child(2)");
  p.click('[data-action="show-rows"]');
  p.click('.data-row .cell[data-row="59"][data-column="v"]');
  p.click(".origin");
  assert.equal(p.scene(), "SOURCE");
  p.click('[data-action="return-selection"]');
  assert.equal(p.scene(), "FILTER");
  assert.equal(p.document.querySelectorAll(".data-row:not(.ghost)").length, 60);
  assert.equal(p.document.activeElement.dataset.step, "f");
  assert.equal(p.document.activeElement.dataset.row, "59");
  assert.equal(p.document.activeElement.dataset.column, "v");
  assert.equal(p.document.querySelector(".selected-value").textContent, "60");
  assert.equal(p.document.querySelectorAll(".origin").length, 1);
});

test("returning from an origin retains a grouping scene instead of changing the operation", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".chapter:nth-child(3)");
  p.click('.data-row .cell[data-row="1"][data-column="v"]');
  p.click(".origin");
  p.click('[data-action="return-selection"]');
  assert.equal(p.scene(), "GROUP");
  assert.equal(p.document.activeElement.dataset.step, "f");
  assert.equal(p.document.activeElement.dataset.row, "1");
});

test("an inspection error is revealed and still lets the reader return to the cell", (t) => {
  const p = mount();
  t.after(p.close);
  p.window.FrameChoreoModel.traceCell = () => {
    throw new Error("Too many inputs");
  };
  p.click('.data-row .cell[data-column="v"]');
  assert.equal(p.document.activeElement, p.document.querySelector(".inspector"));
  assert.match(p.document.querySelector(".explanation").textContent, /Too many inputs/);
  p.click('[data-action="return-selection"]');
  assert.equal(p.document.activeElement.dataset.column, "v");
  p.click('[data-action="clear-selection"]');
  assert.equal(p.document.querySelector('[data-action="return-selection"]').hidden, true);
});

test("returning to a selected scene restores that scene's remaining hold time", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".primary");
  p.tick(250);
  p.click('.data-row .cell[data-column="v"]');
  p.click(".chapter:nth-child(2)");
  p.click(".primary");
  p.tick(500);
  p.click('[data-action="return-selection"]');
  assert.equal(p.scene(), "SOURCE");
  p.click(".primary");
  p.tick(749);
  assert.equal(p.scene(), "SOURCE");
  p.tick(1);
  assert.equal(p.scene(), "FILTER");
});

test("the reader's reduced-motion choice survives OS setting changes", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".motion-toggle input");
  p.setReduced(true);
  p.setReduced(false);
  assert.equal(p.document.querySelector(".motion-toggle input").checked, true);
  assert.equal(p.document.querySelector(".motion-toggle input").disabled, false);
  p.click(".chapter:nth-child(2)");
  assert.equal(p.animations.filter((a) => a.playState === "running").length, 0);
});

test("turning off OS reduced motion restores the reader's normal-motion choice", (t) => {
  const p = mount();
  t.after(p.close);
  p.setReduced(true);
  assert.equal(p.document.querySelector(".motion-toggle input").checked, true);
  assert.equal(p.document.querySelector(".motion-toggle input").disabled, true);
  p.setReduced(false);
  assert.equal(p.document.querySelector(".motion-toggle input").checked, false);
  p.click(".chapter:nth-child(2)");
  assert.ok(p.animations.some((a) => a.playState === "running"));
});

for (const [value, description] of [
  ["", "empty string"],
  ["  ", "whitespace-only string"],
  ["\t\n", "whitespace-only string"],
]) {
  test("blank text remains inspectable: " + JSON.stringify(value), (t) => {
    const data = fixture();
    data.steps = data.steps.slice(0, 1);
    data.timeline = ["s"];
    data.result = "s";
    data.steps[0].rows[0].cells[1] = { type: "string", value, display: value };
    const p = mount(data);
    t.after(p.close);
    const cell = p.document.querySelector('.data-row .cell[data-column="v"]');
    assert.equal(cell.textContent, JSON.stringify(value));
    assert.ok(cell.getAttribute("aria-label").includes(description));
    p.click('.data-row .cell[data-column="v"]');
    assert.equal(p.document.querySelector(".selected-value").textContent, JSON.stringify(value));
    assert.ok(p.document.querySelector(".value-type").textContent.includes(description));
    assert.equal(p.document.querySelector(".origin .value").textContent, JSON.stringify(value));
    assert.equal(
      p.window.FrameChoreoModel.traceCell(data, { step: "s", row: 0, column: "v" })[0].cell.value,
      value,
    );
  });
}

test("literal quote marks and missing values do not become empty strings", (t) => {
  const data = fixture();
  data.steps[0].rows[0].cells[1] = { type: "string", value: '""', display: '""' };
  data.steps[0].rows[1].cells[1] = { type: "missing", value: null, display: "∅" };
  const p = mount(data);
  t.after(p.close);
  p.click('.data-row .cell[data-row="0"][data-column="v"]');
  assert.equal(p.document.querySelector(".value-type").textContent, "Type: string");
  assert.equal(
    p.document.querySelector('.cell[data-row="0"][data-column="v"]').dataset.blank,
    undefined,
  );
  p.click('.data-row .cell[data-row="1"][data-column="v"]');
  assert.equal(p.document.querySelector(".value-type").textContent, "Type: missing");
  assert.equal(p.document.querySelector(".selected-value").textContent, "∅");
});
