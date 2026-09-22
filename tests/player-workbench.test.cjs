const test = require("node:test");
const assert = require("node:assert/strict");
const { mount, fixture } = require("./player-harness.cjs");
const template = require("./fixtures/retail.json");
const fresh = (language = "en") => ({ ...structuredClone(template), language });

function search(p, value) {
  const input = p.document.querySelector('[data-action="search-rows"]');
  assert.ok(input, "a visible row search is available");
  input.value = value;
  p.document
    .querySelector(".table-search")
    .dispatchEvent(new p.window.Event("submit", { bubbles: true, cancelable: true }));
}

test("a full workflow exposes table, comparison, quality and chart views", (t) => {
  const p = mount(fresh());
  t.after(p.close);
  assert.equal(p.document.querySelector("main").dataset.ready, "true");
  assert.equal(p.document.querySelectorAll(".view-tab").length, 4);
  assert.equal(
    p.document.querySelectorAll(".chapter").length,
    p.window.FrameChoreoModel.scenes(template).length,
  );
  assert.ok(p.document.querySelector(".story-description").textContent.includes("two months"));
});

test("search is a view filter and clearing it restores recorded rows", (t) => {
  const p = mount(fresh());
  t.after(p.close);
  search(p, "book");
  assert.equal(p.document.querySelectorAll(".data-row").length, 2);
  assert.match(p.document.querySelector(".view-status").textContent, /2.*5/);
  p.click('[data-action="clear-search"]');
  assert.equal(p.document.querySelectorAll(".data-row").length, 5);
  assert.equal(p.document.querySelectorAll(".ghost").length, 0);
});

test("column visibility does not alter value inputs and is restored after inspection", (t) => {
  const p = mount(fresh());
  t.after(p.close);
  const column = p.document.querySelector('[data-column-choice="date"]');
  column.checked = false;
  column.dispatchEvent(new p.window.Event("change"));
  assert.equal(p.document.querySelector('.data-row .cell[data-column="date"]'), null);
  p.click('.data-row .cell[data-column="unit_price"]');
  p.click(".origin");
  p.click('[data-action="return-selection"]');
  assert.equal(p.document.activeElement.dataset.column, "unit_price");
  assert.equal(p.document.querySelector('.data-row .cell[data-column="date"]'), null);
});

test("comparison shows the actual primary input and operation result", (t) => {
  const p = mount(fresh());
  t.after(p.close);
  p.click('.chapter[data-operation="to_numeric"]');
  p.click('[data-view="compare"]');
  assert.equal(p.document.querySelector(".compare-panel").hidden, false);
  assert.equal(p.document.querySelectorAll(".compare-panel .comparison-table").length, 2);
  assert.ok(p.document.querySelectorAll(".compare-panel .changed-value").length > 0);
  assert.match(p.document.querySelector(".compare-panel").textContent, /Before/);
  assert.match(p.document.querySelector(".compare-panel").textContent, /After/);
});

test("quality reads recorded missingness and duplicate counts", (t) => {
  const p = mount(fresh());
  t.after(p.close);
  p.click('[data-view="quality"]');
  assert.match(p.document.querySelector(".quality-panel").textContent, /Missing/);
  assert.equal(p.document.querySelector('[data-stat="duplicate-rows"]').textContent, "1");
  assert.equal(p.document.querySelector('[data-stat="missing-cells"]').textContent, "1");
  assert.equal(p.document.querySelectorAll(".quality-column").length, 5);
});

test("the chart retains exact value text and links to provenance", (t) => {
  const p = mount(fresh());
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('[data-view="chart"]');
  const metric = p.document.querySelector('[data-action="chart-column"]');
  metric.value = "revenue_total";
  metric.dispatchEvent(new p.window.Event("change"));
  assert.ok(p.document.querySelectorAll(".chart-value").length > 0);
  p.click('.chart-value[data-row="0"]');
  assert.equal(Number(p.document.querySelector(".selected-value").textContent), 2700);
  assert.ok(p.document.querySelectorAll(".origin").length >= 4);
  p.click('[data-action="return-selection"]');
  assert.ok(p.document.activeElement.classList.contains("chart-value"));
});

test("recorded tables outside the primary timeline remain reachable", (t) => {
  const p = mount(fresh());
  t.after(p.close);
  const secondary = template.steps.find((s) => s.name === "February orders");
  p.click(`[data-table="${secondary.id}"]`);
  assert.match(p.document.querySelector(".stage-heading h2").textContent, /February/);
  assert.equal(p.document.querySelectorAll(".data-row").length, 5);
});

test("Japanese controls are localized without changing data names or values", (t) => {
  const p = mount(fresh("ja"));
  t.after(p.close);
  assert.equal(p.document.documentElement.lang, "ja");
  assert.match(p.document.querySelector(".primary").textContent, /再生/);
  assert.match(p.document.querySelector('[data-view="compare"]').textContent, /比較/);
  assert.match(p.document.querySelector('[data-view="quality"]').textContent, /品質/);
  assert.equal(p.document.querySelector('.cell[data-column="order_id"]').textContent, "A01");
  assert.equal(p.document.querySelector('.cell[data-column="item"]').textContent, '" Pen "');
  assert.equal(template.steps[0].rows[0].cells[1].value, " Pen ");
});

test("a named aggregate has a grouped scene and an input path for each metric", (t) => {
  const p = mount(fresh());
  t.after(p.close);
  p.click('.chapter[data-kind="aggregate"]');
  assert.equal(p.scene(), "AGGREGATE");
  assert.ok(p.document.querySelector('.data-row[data-group="0"]'));
  p.click('.data-row .cell[data-column="orders"]');
  assert.ok(
    [...p.document.querySelectorAll(".origin")].every((b) => b.textContent.includes("order_id")),
  );
  assert.ok(p.document.querySelectorAll(".lineage-step").length > 1);
});

test("a comparison selection restores the exact comparison pane after inspecting a source", (t) => {
  const p = mount(fresh());
  t.after(p.close);
  p.click('.chapter[data-operation="to_numeric"]');
  p.click('[data-view="compare"]');
  p.click('.compare-panel .comparison-side:last-child .cell[data-row="0"][data-column="units"]');
  const step = p.document.querySelector(".cell.selected").dataset.step;
  p.click(".origin");
  p.click('[data-action="return-selection"]');
  assert.equal(
    p.document.querySelector('[data-view="compare"]').getAttribute("aria-selected"),
    "true",
  );
  assert.ok(p.document.activeElement.closest(".compare-panel"));
  assert.equal(p.document.activeElement.dataset.step, step);
});

test("search survives an origin visit and the row jump uses recorded positions", (t) => {
  const p = mount(fixture(1000));
  t.after(p.close);
  search(p, "9");
  p.click('[data-action="show-rows"]');
  const number = p.document.querySelector('[data-action="row-number"]');
  number.value = "900";
  p.click('[data-action="rows-jump"]');
  assert.equal(p.document.activeElement.dataset.row, "899");
  p.click('.data-row .cell[data-row="899"][data-column="v"]');
  p.click(".origin");
  p.click('[data-action="return-selection"]');
  assert.equal(p.document.querySelector('[data-action="search-rows"]').value, "9");
  assert.equal(p.document.activeElement.dataset.row, "899");
  p.document.querySelector('[data-action="row-number"]').value = "500";
  p.click('[data-action="rows-jump"]');
  assert.match(p.document.querySelector(".jump-message").textContent, /outside the search/);
});

test("at least one display column stays enabled", (t) => {
  const p = mount();
  t.after(p.close);
  const choice = p.document.querySelector('[data-column-choice="v"]');
  choice.checked = false;
  choice.dispatchEvent(new p.window.Event("change"));
  assert.equal(p.document.querySelector('[data-column-choice="key"]').disabled, true);
  assert.equal(p.document.querySelectorAll(".column-head > div").length, 2);
});

test("mode tabs support keyboard navigation and disable replay outside the table", (t) => {
  const p = mount(fresh());
  t.after(p.close);
  p.click('.chapter[data-operation="concat"]');
  const table = p.document.querySelector('[data-view="table"]');
  table.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(p.document.activeElement.dataset.view, "compare");
  assert.equal(p.document.querySelector('[data-action="replay-motion"]').disabled, true);
});

test("chart colors follow the original groups after sorting", (t) => {
  const p = mount(fresh());
  t.after(p.close);
  p.click(".chapter:last-child");
  assert.equal(p.document.querySelector(".data-row .group-id").textContent, "G2");
  p.click('[data-view="chart"]');
  assert.equal(p.document.querySelector('.chart-value[data-row="0"]').dataset.group, "1");
  const labels = [...p.document.querySelectorAll(".chart-value")].map((b) =>
    b.getAttribute("aria-label"),
  );
  assert.equal(new Set(labels).size, labels.length);
  assert.match(labels[0], /Books/);
});

test("huge integers and non-finite numbers keep their exact text without false bars", (t) => {
  const data = fixture(3);
  data.steps = data.steps.slice(0, 1);
  data.timeline = ["s"];
  data.result = "s";
  data.steps[0].rows[0].cells[1] = {
    type: "integer",
    value: "1152921504606846977",
    display: "1152921504606846977",
  };
  data.steps[0].rows[1].cells[1] = { type: "float", value: "inf", display: "inf" };
  const p = mount(data);
  t.after(p.close);
  p.click('[data-view="chart"]');
  assert.equal(p.document.querySelectorAll(".uncharted-value").length, 2);
  assert.match(
    p.document.querySelector('.chart-value[data-row="0"]').textContent,
    /1152921504606846977/,
  );
  assert.equal(p.document.querySelector('.chart-value[data-row="0"] .bar-fill').style.width, "0%");
});

test("negative chart values have a finite range on both sides of zero", (t) => {
  const data = fixture(3);
  data.steps = data.steps.slice(0, 1);
  data.timeline = ["s"];
  data.result = "s";
  [-1e308, 0, 1e308].forEach(
    (n, i) =>
      (data.steps[0].rows[i].cells[1] = { type: "float", value: String(n), display: String(n) }),
  );
  const p = mount(data);
  t.after(p.close);
  p.click('[data-view="chart"]');
  const bars = [...p.document.querySelectorAll(".bar-fill")];
  assert.equal(bars[0].style.left, "0%");
  assert.equal(bars[0].style.width, "50%");
  assert.equal(bars[1].style.width, "0%");
  assert.equal(bars[2].style.left, "50%");
  assert.equal(bars[2].style.width, "50%");
});

test("search and chart labels render HTML-like text literally", (t) => {
  const data = fixture(1);
  data.steps = data.steps.slice(0, 1);
  data.timeline = ["s"];
  data.result = "s";
  data.steps[0].rows[0].cells[0] = {
    type: "string",
    value: "<img src=x onerror=alert(1)>",
    display: "<img src=x onerror=alert(1)>",
  };
  const p = mount(data);
  t.after(p.close);
  search(p, "onerror");
  p.click('[data-view="chart"]');
  assert.equal(p.document.querySelectorAll("img").length, 0);
  assert.match(p.document.querySelector(".bar-label").textContent, /onerror/);
});
