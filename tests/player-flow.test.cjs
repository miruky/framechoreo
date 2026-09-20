const test = require("node:test");
const assert = require("node:assert/strict");
const { mount, fixture } = require("./player-harness.cjs");
const { mergeFixture } = require("./motion-fixtures.cjs");

test("join values travel from their visible right-input cells to the recorded output cells", (t) => {
  const p = mount(mergeFixture());
  t.after(p.close);
  p.click(".chapter:nth-child(2)");
  assert.equal(p.document.querySelector(".reference").open, false);
  assert.equal(p.document.querySelectorAll(".source-cell").length, 2);
  const flights = [...p.document.querySelectorAll(".value-flight")];
  assert.equal(flights.length, 3);
  assert.deepEqual(
    flights.map((n) => Number(n.dataset.sourceRow)),
    [0, 1, 0],
  );
  assert.deepEqual(
    flights.map((n) => Number(n.dataset.targetRow)),
    [0, 2, 3],
  );
  for (const flight of flights) {
    assert.equal(flight.dataset.sourceStep, "R");
    assert.equal(flight.dataset.sourceColumn, "score");
    assert.equal(flight.dataset.targetStep, "M");
    assert.equal(flight.dataset.targetColumn, "score");
    assert.equal(flight.getAttribute("aria-hidden"), "true");
    assert.equal(flight.querySelector("button"), null);
    const source = p.document
      .querySelector(`.source-cell[data-row="${flight.dataset.sourceRow}"][data-column="score"]`)
      .getBoundingClientRect();
    const target = p.document
      .querySelector(`.data-row .cell[data-row="${flight.dataset.targetRow}"][data-column="score"]`)
      .getBoundingClientRect();
    assert.equal(parseFloat(flight.style.left), source.left);
    assert.equal(parseFloat(flight.style.top), source.top);
    const animation = p.animations.find((a) => a.node === flight);
    assert.equal(
      animation.frames.at(-1).transform,
      `translate(${target.left - source.left}px, ${target.top - source.top}px)`,
    );
  }
  p.tick(3000);
  assert.equal(p.document.querySelectorAll(".value-flight").length, 0);
});

for (const operation of ["group_sum", "group_mean", "group_count"]) {
  test(`${operation} moves only contributing values, including their first member`, (t) => {
    const data = fixture(3, operation);
    const missing = { type: "missing", value: null, display: "∅" };
    data.steps[0].rows[1].cells[1] = missing;
    data.steps[1].rows[1].cells[1] = missing;
    data.steps[2].rows[0].cell_parents.v.splice(1, 1);
    const value = { group_sum: 4, group_mean: 2, group_count: 2 }[operation];
    data.steps[2].rows[0].cells[1] = {
      type: "integer",
      value: String(value),
      display: String(value),
    };
    const p = mount(data);
    t.after(p.close);
    p.click(".chapter:nth-child(3)");
    p.click(".chapter:nth-child(4)");
    const flights = [...p.document.querySelectorAll(".value-flight")];
    assert.deepEqual(
      flights.map((n) => Number(n.dataset.sourceRow)),
      [0, 2],
    );
    assert.ok(
      flights.every((n) => n.dataset.sourceColumn === "v" && n.dataset.targetColumn === "v"),
    );
    assert.equal(
      p.document.querySelectorAll('.data-row.ghost[data-transition="converge"]').length,
      0,
    );
    assert.match(p.document.querySelector(".motion-status").textContent, /2 of 2/);
    assert.match(p.document.querySelector(".legend").textContent, /non-missing/);
  });
}

test("a direct chapter jump does not invent a transformation between unrelated layouts", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".chapter:last-child");
  assert.equal(p.animations.length, 0);
  p.click('[data-action="replay-motion"]');
  assert.equal(p.document.querySelectorAll(".value-flight").length, 3);
});

test("group formation has its own explanation, not the aggregation legend", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".chapter:nth-child(3)");
  assert.doesNotMatch(p.document.querySelector(".legend").textContent, /merged into|single result/);
  assert.match(p.document.querySelector(".group-band").textContent, /G1/);
});

test("manual movement can be paused and resumed on the final scene", (t) => {
  const p = mount();
  t.after(p.close);
  p.click(".chapter:nth-child(3)");
  p.click(".chapter:nth-child(4)");
  assert.match(p.document.querySelector(".primary").textContent, /Pause/);
  p.click(".primary");
  assert.ok(p.animations.some((a) => a.playState === "paused"));
  p.tick(4000);
  assert.equal(p.scene(), "SUM");
  p.click(".primary");
  assert.equal(p.scene(), "SUM");
  assert.ok(p.animations.some((a) => a.playState === "running"));
});

for (const event of ["resize", "scroll"]) {
  test(`${event} settles flights whose coordinates are no longer current`, (t) => {
    const p = mount(mergeFixture());
    t.after(p.close);
    p.click(".chapter:nth-child(2)");
    assert.equal(p.document.querySelectorAll(".value-flight").length, 3);
    (event === "resize" ? p.window : p.document.querySelector(".table-scroll")).dispatchEvent(
      new p.window.Event(event),
    );
    assert.equal(p.document.querySelectorAll(".value-flight").length, 0);
    assert.equal(p.animations.filter((a) => ["running", "paused"].includes(a.playState)).length, 0);
  });
}

test("offscreen source cells are counted but never given a fictitious departure point", (t) => {
  const p = mount(mergeFixture(), {
    rect: (node) =>
      node.matches('.source-cell[data-row="0"]')
        ? { left: 300, right: 400, top: 2000, bottom: 2036, width: 100, height: 36 }
        : null,
  });
  t.after(p.close);
  p.click(".chapter:nth-child(2)");
  const flights = [...p.document.querySelectorAll(".value-flight")];
  assert.equal(flights.length, 1);
  assert.equal(flights[0].dataset.sourceRow, "1");
  assert.match(p.document.querySelector(".motion-status").textContent, /1 of 3/);
});

test("an actual missing right value still has a source, unlike an unmatched result", (t) => {
  const data = mergeFixture(),
    missing = { type: "missing", value: null, display: "∅" };
  data.steps[1].rows[0].cells[1] = missing;
  data.steps[2].rows[0].cells[2] = missing;
  data.steps[2].rows[3].cells[2] = missing;
  const p = mount(data);
  t.after(p.close);
  p.click(".chapter:nth-child(2)");
  const flights = [...p.document.querySelectorAll(".value-flight")];
  assert.equal(flights.length, 3);
  assert.equal(flights[0].querySelector(".flight-value").textContent, "∅");
  assert.ok(flights.every((n) => n.dataset.targetRow !== "1"));
  assert.doesNotMatch(
    p.document.querySelector(".legend").textContent,
    /grey values found no match/,
  );
});

test("wide numeric cells use compact tokens aligned with the original value edge", (t) => {
  const p = mount(mergeFixture(), {
    rect: (node) => {
      if (node.matches('.source-cell[data-column="score"]'))
        return { left: 40, top: 150, right: 340, bottom: 190, width: 300, height: 40 };
      if (node.matches('.data-row .cell[data-column="score"]'))
        return { left: 150, top: 550, right: 610, bottom: 590, width: 460, height: 40 };
      return null;
    },
  });
  t.after(p.close);
  p.click(".chapter:nth-child(2)");
  const flight = p.document.querySelector(".value-flight");
  assert.equal(flight.style.width, "160px");
  assert.equal(flight.style.left, "180px");
  assert.equal(
    p.animations.find((a) => a.node === flight).frames.at(-1).transform,
    "translate(270px, 400px)",
  );
});

test("zero-input groups display a result without inventing moving values", (t) => {
  const data = fixture(3, "group_count"),
    missing = { type: "missing", value: null, display: "∅" };
  for (const step of data.steps.slice(0, 2)) for (const row of step.rows) row.cells[1] = missing;
  data.steps[2].rows[0].cell_parents.v = [];
  data.steps[2].rows[0].cells[1] = { type: "integer", value: "0", display: "0" };
  const p = mount(data);
  t.after(p.close);
  p.click(".chapter:nth-child(3)");
  p.click(".chapter:nth-child(4)");
  assert.equal(p.document.querySelectorAll(".value-flight").length, 0);
  assert.equal(p.document.querySelector('.data-row .cell[data-column="v"]').textContent, "0");
  assert.match(p.document.querySelector(".motion-status").textContent, /0 of 0/);
});

test("a wide join caps moving values while preserving the full input count", (t) => {
  const data = mergeFixture(8),
    names = Array.from({ length: 6 }, (_, i) => "score" + i);
  data.steps[1].columns = ["key", ...names];
  for (const row of data.steps[1].rows)
    row.cells = [row.cells[0], ...names.map(() => row.cells[1])];
  data.steps[2].columns = ["key", "name", ...names];
  for (const row of data.steps[2].rows) {
    row.cells = row.cells.slice(0, 2).concat(names.map(() => row.cells[2]));
    const refs = row.cell_parents.score;
    delete row.cell_parents.score;
    for (const name of names) row.cell_parents[name] = refs.map((r) => ({ ...r, column: name }));
  }
  const p = mount(data);
  t.after(p.close);
  p.click(".chapter:nth-child(2)");
  assert.equal(p.document.querySelectorAll(".value-flight").length, 48);
  assert.match(p.document.querySelector(".motion-status").textContent, /48 of 66/);
});

test("reduced motion and expanded tables keep the flow static", (t) => {
  const p = mount(mergeFixture(12));
  t.after(p.close);
  p.setReduced(true);
  p.click(".chapter:nth-child(2)");
  assert.equal(p.document.querySelectorAll(".value-flight").length, 0);
  assert.match(p.document.querySelector(".motion-status").textContent, /Motion is reduced/);
  p.setReduced(false);
  p.click('[data-action="show-rows"]');
  assert.equal(p.document.querySelector('[data-action="replay-motion"]').disabled, true);
  assert.equal(p.document.querySelectorAll(".data-row").length, 16);
  assert.match(
    p.document.querySelector(".motion-status").textContent,
    /Expanded tables stay still/,
  );
});

test("changing speed updates all live flights and changing chapters removes them", (t) => {
  const p = mount(mergeFixture());
  t.after(p.close);
  p.click(".chapter:nth-child(2)");
  const select = p.document.querySelector(".speed select");
  select.value = "2";
  select.dispatchEvent(new p.window.Event("change"));
  assert.ok(p.animations.every((a) => a.playbackRate === 2));
  p.click(".chapter:first-child");
  assert.equal(p.document.querySelectorAll(".value-flight").length, 0);
  assert.equal(p.animations.filter((a) => ["running", "paused"].includes(a.playState)).length, 0);
});

test("opening the optional code explanation settles movement before the layout changes", (t) => {
  const p = mount(mergeFixture());
  t.after(p.close);
  p.click(".chapter:nth-child(2)");
  assert.equal(p.document.querySelectorAll(".value-flight").length, 3);
  const detail = p.document.querySelector(".operation-code");
  assert.equal(detail.open, false);
  detail.open = true;
  detail.dispatchEvent(new p.window.Event("toggle"));
  assert.equal(p.document.querySelectorAll(".value-flight").length, 0);
  assert.equal(p.animations.filter((a) => ["running", "paused"].includes(a.playState)).length, 0);
  assert.match(p.document.querySelector(".code").textContent, /merge/);
});
