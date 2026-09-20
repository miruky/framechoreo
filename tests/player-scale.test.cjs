const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const { fixture, mount } = require("./player-harness.cjs");

test("large lineage can be counted and paged without a 10,000-input cutoff", () => {
  const data = fixture(12001);
  const trace = model.prepareTrace(data, { step: "g", row: 0, column: "v" });
  const page = trace.page(12000n, 50);
  assert.equal(page.total, "12001");
  assert.equal(page.offset, "12000");
  assert.equal(page.has_next, false);
  assert.deepEqual(
    page.origins.map((o) => o.row),
    [12000],
  );
  assert.equal(trace.hasSource("s", 12000, "v"), true);
  assert.equal(trace.hasSource("s", 12000, "key"), false);
});

test("browsing a large table bounds DOM rows and can reach its final row", (t) => {
  const p = mount(fixture(1000));
  t.after(p.close);
  p.click('[data-action="show-rows"]');
  assert.ok(p.document.querySelectorAll(".data-row:not(.ghost)").length <= 100);
  const jump = p.document.querySelector('[data-action="row-number"]');
  assert.ok(jump);
  jump.value = "1000";
  p.click('[data-action="rows-jump"]');
  assert.equal(p.document.activeElement.dataset.row, "999");
  assert.equal(p.document.querySelector('[data-action="row-number"]').value, "1000");
  assert.equal(p.document.querySelectorAll(".data-row:not(.ghost)").length, 100);
  assert.equal(p.document.querySelector('[data-action="rows-next"]').disabled, true);
});

test("a large aggregate jumps to its last input and returns to the result", (t) => {
  const p = mount(fixture(12001));
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  assert.equal(p.document.querySelectorAll(".origin").length, 50);
  const input = p.document.querySelector('[data-action="origin-number"]');
  assert.ok(input);
  input.value = "12001";
  p.click('[data-action="origins-jump"]');
  assert.match(p.document.querySelector(".origin").textContent, /row 12001/);
  p.click(".origin");
  assert.equal(p.document.activeElement.dataset.row, "12000");
  assert.ok(p.document.querySelectorAll(".data-row:not(.ghost)").length <= 100);
  p.click('[data-action="return-selection"]');
  assert.equal(p.scene(), "SUM");
  assert.equal(p.document.activeElement.dataset.column, "v");
});

test("a compressed story loads offline and treats decoded HTML as cell text", async (t) => {
  const data = fixture();
  const value = "</script><script>window.injected = true</script> 日本語";
  data.steps[0].rows[0].cells[0] = { type: "string", value, display: value };
  const p = mount(data, { compressed: true });
  t.after(p.close);
  await p.ready();
  assert.equal(p.scene(), "SOURCE");
  assert.equal(p.document.querySelector('.cell[data-column="key"]').textContent, value);
  assert.equal(p.window.injected, undefined);
  assert.equal(p.document.querySelector("#framechoreo-data").textContent, "");
  assert.equal(p.document.querySelector("main").hasAttribute("aria-busy"), false);
});

test("compressed stories fail clearly when decompression is unavailable or the size is wrong", async (t) => {
  for (const options of [{ unsupported: true }, { sizeOffset: -1 }, { sizeOffset: 1 }]) {
    const p = mount(fixture(), { compressed: true, ...options });
    t.after(p.close);
    await p.ready();
    assert.equal(p.document.querySelector("main").dataset.ready, "error");
    assert.match(p.document.querySelector("main").textContent, /Could not open this story/);
  }
});

test("invalid table and origin jumps leave the current view intact", (t) => {
  const p = mount(fixture(501));
  t.after(p.close);
  p.click('[data-action="show-rows"]');
  const row = p.document.querySelector('[data-action="row-number"]');
  row.value = "502";
  p.click('[data-action="rows-jump"]');
  assert.match(p.document.querySelector(".jump-message").textContent, /1 to 501/);
  assert.equal(p.document.querySelector(".cell").dataset.row, "0");
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  p.document.querySelector('[data-action="origin-number"]').value = "1.5";
  p.click('[data-action="origins-jump"]');
  assert.match(p.document.querySelector(".origin-pager .jump-message").textContent, /1 to 501/);
  assert.match(p.document.querySelector(".origin").textContent, /row 1/);
});

test("an origin jump keeps the requested input number visible", (t) => {
  const p = mount(fixture(501));
  t.after(p.close);
  p.click(".chapter:last-child");
  p.click('.data-row .cell[data-column="v"]');
  p.document.querySelector('[data-action="origin-number"]').value = "500";
  p.click('[data-action="origins-jump"]');
  assert.equal(p.document.querySelector('[data-action="origin-number"]').value, "500");
  assert.match(p.document.activeElement.textContent, /row 500/);
});

test("grouped row jumps use recorded row numbers and preserve the selected page", (t) => {
  const data = fixture(600),
    grouped = data.steps[2];
  data.steps[0].rows.forEach((r, i) => {
    r.cells[0] = { type: "string", value: i % 2 ? "odd" : "even", display: i % 2 ? "odd" : "even" };
  });
  const groups = [1, 0].map((parity) =>
    data.steps[0].rows.filter((r) => r.position % 2 === parity).map((r) => r.position),
  );
  grouped.parameters.groups = groups.map((input_rows, output_row) => ({ input_rows, output_row }));
  grouped.rows = groups.map((members, position) => ({
    position,
    cells: [
      data.steps[0].rows[members[0]].cells[0],
      {
        type: "integer",
        value: String(members.reduce((n, i) => n + i + 1, 0)),
        display: String(members.reduce((n, i) => n + i + 1, 0)),
      },
    ],
    parents: members.map((row) => ({ step: "f", row })),
    cell_parents: {
      key: members.map((row) => ({ step: "f", row, column: "key" })),
      v: members.map((row) => ({ step: "f", row, column: "v" })),
    },
  }));
  const p = mount(data);
  t.after(p.close);
  p.click(".chapter:nth-child(3)");
  p.click('[data-action="show-rows"]');
  p.document.querySelector('[data-action="row-number"]').value = "600";
  p.click('[data-action="rows-jump"]');
  assert.equal(p.document.activeElement.dataset.row, "599");
  assert.match(p.document.querySelector(".row-limit").textContent, /Page 3 of 6/);
  p.click('.cell[data-row="599"][data-column="v"]');
  p.click(".origin");
  p.click('[data-action="return-selection"]');
  assert.equal(p.scene(), "GROUP");
  assert.equal(p.document.activeElement.dataset.row, "599");
  assert.match(p.document.querySelector(".row-limit").textContent, /Page 3 of 6/);
});

test("changing motion preferences does not reset a table's scroll position", (t) => {
  const p = mount(fixture(501));
  t.after(p.close);
  p.click('[data-action="show-rows"]');
  p.document.querySelector(".table-scroll").scrollTop = 200;
  p.click(".motion-toggle input");
  assert.equal(p.document.querySelector(".table-scroll").scrollTop, 200);
});
