const test = require("node:test");
const assert = require("node:assert/strict");
const { mount } = require("./player-harness.cjs");
const growth = require("./fixtures/growth.json");
const rank = require("./fixtures/rank.json");

function choose(player, action, value) {
  const select = player.document.querySelector(`[data-action="${action}"]`);
  assert.ok(select);
  select.value = value;
  select.dispatchEvent(new player.window.Event("change", { bubbles: true }));
}

test("line view breaks at missing and infinite values while retaining inspection", (t) => {
  const player = mount(growth);
  t.after(player.close);
  player.click('.chapter[data-kind="window"]');
  player.click('[data-view="chart"]');
  choose(player, "chart-kind", "line");
  assert.equal(player.document.querySelectorAll(".chart-group-chip").length, 2);
  assert.equal(player.document.querySelectorAll(".plot-point").length, 5);
  assert.equal(player.document.querySelectorAll(".plot-segment").length, 3);
  assert.equal(player.document.querySelectorAll(".plot-axis").length, 4);
  choose(player, "chart-column", "fractional_change");
  assert.equal(player.document.querySelectorAll(".plot-point").length, 2);
  assert.equal(player.document.querySelectorAll(".plot-segment").length, 0);
  assert.equal(player.document.querySelectorAll(".unplotted-point").length, 3);
  player.click('.plot-point[data-row="3"]');
  assert.equal(player.document.querySelectorAll(".origins .origin").length, 2);
  player.click('[data-action="return-selection"]');
  assert.ok(player.document.activeElement.classList.contains("plot-point"));
});

test("scatter view lets each candidate point open its exact sources", (t) => {
  const player = mount(rank);
  t.after(player.close);
  player.click('.chapter[data-kind="rank_within"]');
  player.click('[data-view="chart"]');
  choose(player, "chart-column", "team_rank");
  choose(player, "chart-kind", "scatter");
  choose(player, "chart-x-column", "score");
  assert.equal(player.document.querySelectorAll(".chart-group-chip").length, 2);
  assert.equal(player.document.querySelectorAll(".plot-point").length, 5);
  assert.equal(player.document.querySelectorAll(".plot-segment").length, 0);
  assert.equal(player.document.querySelectorAll(".unplotted-point").length, 1);
  assert.equal(player.document.querySelector('.plot-point[data-row="0"]').dataset.group, "0");
  player.click('.plot-point[data-row="0"]');
  assert.equal(player.document.querySelectorAll(".origins .origin").length, 3);
});

test("finite values near the floating-point limits keep finite plot coordinates", (t) => {
  const story = structuredClone(growth);
  story.steps = story.steps.slice(0, 1);
  story.result = story.steps[0].id;
  story.timeline = [story.result];
  for (const [i, value] of ["-1e+308", "1e+308"].entries()) {
    story.steps[0].rows[i].cells[2] = { type: "float", value, display: value };
  }
  const player = mount(story);
  t.after(player.close);
  player.click('[data-view="chart"]');
  choose(player, "chart-kind", "line");
  const points = [...player.document.querySelectorAll(".plot-point")];
  assert.equal(points.length, 5);
  for (const point of points) {
    assert.ok(Number.isFinite(Number.parseFloat(point.style.left)));
    assert.ok(Number.isFinite(Number.parseFloat(point.style.top)));
  }
  assert.notEqual(points[0].style.top, points[1].style.top);
});
