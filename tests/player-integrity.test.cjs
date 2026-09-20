const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { fixture, mount } = require("./player-harness.cjs");

test("the recorded result must be the end of the timeline", () => {
  const data = fixture();
  data.result = "s";
  assert.throws(() => model.indexStory(data), /Invalid story/);
});
test("cell types and displayed values must agree", () => {
  for (const change of [
    (c) => {
      delete c.type;
    },
    (c) => {
      c.value = "different";
    },
  ]) {
    const data = fixture();
    change(data.steps[0].rows[0].cells[0]);
    assert.throws(() => model.indexStory(data), /Invalid story/);
  }
});
test("missing value references cannot masquerade as explicitly empty lineage", () => {
  const data = fixture();
  delete data.steps[1].rows[0].cell_parents.v;
  assert.throws(() => model.indexStory(data), /Invalid story/);
});
test("filter metadata must match recorded row membership", () => {
  for (const change of [
    (p) => {
      p.removed_rows = 99;
    },
    (p) => {
      p.selected_rows = [2, 0, 1];
    },
  ]) {
    const data = fixture();
    change(data.steps[1].parameters);
    assert.throws(() => model.indexStory(data), /Invalid story/);
  }
});
test("group settings and exclusion counts are checked", () => {
  for (const change of [
    (p) => {
      p.min_count = "1";
    },
    (p) => {
      p.dropna = "false";
    },
    (p) => {
      p.excluded_rows = 99;
    },
  ]) {
    const data = fixture();
    change(data.steps[2].parameters);
    assert.throws(() => model.indexStory(data), /Invalid story/);
  }
});
test("a selected row position must be a number", () => {
  assert.throws(
    () => model.traceCell(fixture(), { step: "s", row: "0", column: "v" }),
    /Invalid cell reference/,
  );
});
test("a selection can be cleared without changing the scene", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  p.click('[data-action="clear-selection"]');
  assert.equal(p.scene(), "SUM");
  assert.equal(p.document.querySelectorAll(".cell.selected").length, 0);
  assert.equal(p.document.querySelectorAll(".origin").length, 0);
  assert.match(p.document.querySelector(".selected-value").textContent, /Select any cell/);
});
test("missing totals explain the minimum input count", (t) => {
  const data = fixture();
  data.steps[2].parameters.min_count = 4;
  data.steps[2].rows[0].cells[1] = { type: "missing", value: null, display: "∅" };
  const p = mount(data);
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  assert.match(p.document.querySelector(".explanation").textContent, /3 non-missing.*min_count=4/);
});
test("an empty-input zero explains min_count=0", (t) => {
  const data = fixture();
  data.steps[0].rows.forEach((r) => (r.cells[1] = { type: "missing", value: null, display: "∅" }));
  data.steps[2].parameters.min_count = 0;
  data.steps[2].rows[0].cell_parents.v = [];
  data.steps[2].rows[0].cells[1] = { type: "integer", value: "0", display: "0" };
  const p = mount(data);
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  assert.match(
    p.document.querySelector(".explanation").textContent,
    /no non-missing.*min_count=0/i,
  );
});
test("integer overflow is visible while the recorded pandas value stays unchanged", (t) => {
  const data = fixture(2);
  data.steps[0].rows[0].cells[1] = {
    type: "integer",
    value: "9223372036854775807",
    display: "9223372036854775807",
  };
  data.steps[0].rows[1].cells[1] = { type: "integer", value: "1", display: "1" };
  data.steps[2].rows[0].cells[1] = {
    type: "integer",
    value: "-9223372036854775808",
    display: "-9223372036854775808",
  };
  const p = mount(data);
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  assert.equal(p.document.querySelector(".selected-value").textContent, "-9223372036854775808");
  assert.match(
    p.document.querySelector(".explanation").textContent,
    /9223372036854775808.*overflow/,
  );
});

test("inconsistent empty lineage does not invent a min_count=0 setting", (t) => {
  const data = fixture();
  data.steps[2].rows[0].cell_parents.v = [];
  const p = mount(data);
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  assert.match(p.document.querySelector(".explanation").textContent, /conflicts with min_count=1/);
});
test("cell highlight keys cannot collide across step, row, and column boundaries", () => {
  assert.notEqual(model.cellKey("s:1", 0, "v"), model.cellKey("s", 1, "0:v"));
});
test("astral Unicode characters count as characters rather than UTF-16 halves", () => {
  const data = fixture();
  data.steps = data.steps.slice(0, 1);
  data.timeline = ["s"];
  data.result = "s";
  const cell = data.steps[0].rows[0].cells[0];
  cell.value = cell.display = "😀".repeat(20000);
  assert.equal(model.indexStory(data).size, 1);
  cell.value = cell.display = "😀".repeat(20001);
  assert.throws(() => model.indexStory(data), /Invalid story/);
});

test("inspecting a value settles transient rows instead of freezing ghosts", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".chapter:last-child");
  assert.ok(p.document.querySelectorAll(".ghost").length > 0);
  p.click('.data-row:not(.ghost) .cell[data-column="v"]');
  assert.equal(p.document.querySelectorAll(".ghost").length, 0);
  assert.equal(p.document.querySelectorAll(".data-row").length, 1);
  assert.equal(p.animations.filter((a) => ["running", "paused"].includes(a.playState)).length, 0);
});

test("the inspector identifies column precision without changing the recorded value", (t) => {
  const data = fixture();
  data.steps[0].dtypes = ["str", "float32"];
  data.steps[0].rows[0].cells[1] = { type: "float", value: "0.1", display: "0.1" };
  const p = mount(data);
  t.after(p.close);
  p.click('.data-row .cell[data-column="v"]');
  assert.equal(p.document.querySelector(".selected-value").textContent, "0.1");
  assert.equal(p.document.querySelector(".column-dtype")?.textContent, "Column dtype: float32");
  assert.match(p.document.querySelector('.cell[data-column="v"]').title, /float32/);
  p.click('[data-action="clear-selection"]');
  assert.equal(p.document.querySelector(".column-dtype").textContent, "");
});
