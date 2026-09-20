const test = require("node:test");
const assert = require("node:assert/strict");
const { mount, fixture } = require("./player-harness.cjs");

test("Play gives the current scene its authored hold time", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".primary");
  assert.equal(p.scene(), "SOURCE");
  p.tick(999);
  assert.equal(p.scene(), "SOURCE");
  p.tick(1);
  assert.equal(p.scene(), "FILTER");
});
test("pause and resume stay in the same scene and preserve its remaining hold", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".primary");
  p.tick(100);
  p.click(".primary");
  const before = p.scene();
  p.tick(5000);
  assert.equal(p.scene(), before);
  p.click(".primary");
  assert.equal(p.scene(), before);
  p.tick(899);
  assert.equal(p.scene(), before);
  p.tick(1);
  assert.equal(p.scene(), "FILTER");
});
test("speed changes preserve progress within the current scene", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".primary");
  p.tick(500);
  const select = p.document.querySelector(".speed select");
  select.value = "2";
  select.dispatchEvent(new p.window.Event("change"));
  p.tick(249);
  assert.equal(p.scene(), "SOURCE");
  p.tick(1);
  assert.equal(p.scene(), "FILTER");
});
test("Pause freezes active row animations as well as the timer", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".primary");
  p.tick(1000);
  p.tick(100);
  p.click(".primary");
  assert.ok(p.animations.some((a) => a.playState === "paused"));
  assert.equal(p.animations.filter((a) => a.playState === "running").length, 0);
});
test("a complete playback stops and replay starts at the input", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".primary");
  p.tick(10000);
  assert.equal(p.scene(), "SUM");
  assert.match(p.document.querySelector(".primary").textContent, /Play|Replay/);
  p.click(".primary");
  assert.equal(p.scene(), "SOURCE");
});
test("show-all retains keyboard focus on the corresponding control", (t) => {
  const p = mount(fixture(15));
  t.after(p.close);
  p.click(".row-limit button");
  assert.equal(p.document.querySelectorAll(".data-row:not(.ghost)").length, 15);
  assert.equal(p.document.activeElement, p.document.querySelector(".row-limit button"));
});
test("source inspection focuses and reveals the requested source cell", (t) => {
  const p = mount(fixture(15));
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  p.click(".origin:last-of-type");
  assert.equal(p.scene(), "SOURCE");
  assert.equal(p.document.activeElement.dataset.step, "s");
  assert.equal(p.document.activeElement.dataset.row, "14");
  assert.equal(p.document.activeElement.dataset.column, "v");
  assert.equal(p.document.querySelectorAll(".data-row:not(.ghost)").length, 15);
});
test("every source input is reachable when an aggregate has more than 50 inputs", (t) => {
  const p = mount(fixture(60));
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  assert.equal(p.document.querySelectorAll(".origin").length, 50);
  p.click('[data-action="origins-next"]');
  assert.equal(p.document.querySelectorAll(".origin").length, 10);
  assert.match(p.document.querySelector(".origin:last-of-type").textContent, /row 60/);
});
test("a lineage error cannot leave an unrelated value selected", (t) => {
  const p = mount();
  t.after(p.close);
  p.click('.data-row .cell[data-column="key"]');
  p.window.FrameChoreoModel.prepareTrace = () => {
    throw new Error("Too many inputs");
  };
  p.click('.data-row .cell[data-column="v"]');
  assert.equal(p.document.querySelector(".selected-value").textContent, "1");
  assert.equal(p.document.querySelectorAll(".cell.selected").length, 0);
  assert.match(p.document.querySelector(".explanation").textContent, /Too many inputs/);
});
test("reduced motion remains effective for manual scene navigation", (t) => {
  const p = mount();
  t.after(p.close);
  p.setReduced(true);
  p.click(".chapter:nth-child(2)");
  assert.ok(p.document.querySelector("main").classList.contains("reduce-motion"));
  assert.equal(p.animations.filter((a) => a.playState === "running").length, 0);
});

test("all rows of a derived right input are available and identified as an input", (t) => {
  const data = fixture(15);
  data.steps[0].rows.forEach((row, i) => {
    row.cells[0] = { type: "string", value: "k" + i, display: "k" + i };
    data.steps[1].rows[i].cells = row.cells;
  });
  const left = {
    ...data.steps[0],
    id: "left",
    name: "Left",
    label: "Left",
    columns: ["key"],
    rows: [
      { position: 0, cells: [data.steps[0].rows[14].cells[0]], parents: [], cell_parents: {} },
    ],
  };
  const join = {
    id: "j",
    name: "Join",
    label: "Join",
    operation: "merge",
    parents: ["left", "f"],
    columns: ["key", "v"],
    parameters: {
      on: ["key"],
      how: "left",
      validate: "many_to_one",
      suffixes: ["_x", "_y"],
      unmatched_rows: 0,
    },
    rows: [
      {
        position: 0,
        cells: data.steps[1].rows[14].cells,
        parents: [
          { step: "left", row: 0 },
          { step: "f", row: 14 },
        ],
        cell_parents: {
          key: [{ step: "left", row: 0, column: "key" }],
          v: [{ step: "f", row: 14, column: "v" }],
        },
      },
    ],
  };
  data.steps = [left, ...data.steps.slice(0, 2), join];
  data.timeline = ["left", "j"];
  data.result = "j";
  const p = mount(data);
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('[data-action="inspect-right"]');
  assert.equal(p.scene(), "INPUT");
  assert.equal(p.document.querySelectorAll(".data-row:not(.ghost)").length, 15);
  assert.match(p.document.querySelector(".code").textContent, /join input/);
  assert.equal(p.document.activeElement, p.document.querySelector(".stage-heading h2"));
  p.click(".stage-body > .text-button");
  assert.equal(p.scene(), "MERGE");
  p.click(".reference summary");
  p.click('.ref-table .cell[data-row="10"][data-column="v"]');
  p.click(".origin");
  p.click('[data-action="return-selection"]');
  assert.equal(p.scene(), "INPUT");
  assert.equal(p.document.activeElement.dataset.step, "f");
  assert.equal(p.document.activeElement.dataset.row, "10");
  assert.equal(p.document.querySelector(".selected-value").textContent, "11");
});

test("the selected cell exposes its value type", (t) => {
  const p = mount();
  t.after(p.close);
  p.click('.data-row .cell[data-column="key"]');
  assert.equal(p.document.querySelector(".value-type").textContent, "Type: string");
});
