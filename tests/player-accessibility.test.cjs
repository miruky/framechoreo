const test = require("node:test");
const assert = require("node:assert/strict");
const axe = require("axe-core");
const { mount } = require("./player-harness.cjs");
const growth = require("./fixtures/growth.json");
const rank = require("./fixtures/rank.json");
const buckets = require("./fixtures/time_buckets.json");

async function audit(player) {
  // The harness controls playback timers. Axe needs real timers for its async scan.
  player.window.setTimeout = setTimeout;
  player.window.clearTimeout = clearTimeout;
  player.window.eval(axe.source);
  const result = await player.window.axe.run(player.document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    // jsdom has no rendered pixels, so contrast needs a separate real-browser check.
    rules: { "color-contrast": { enabled: false } },
  });
  assert.deepEqual(
    Array.from(result.violations, (violation) => ({
      rule: violation.id,
      nodes: Array.from(violation.nodes, (node) => node.html),
    })),
    [],
  );
}

test("the initial story and inspected values pass DOM accessibility rules", async (t) => {
  const player = mount(growth);
  t.after(player.close);
  await audit(player);
  // Mount a separate page so playback's controlled clock remains deterministic.
  const inspected = mount(growth);
  t.after(inspected.close);
  inspected.click('.chapter[data-kind="window"]');
  inspected.click('.cell[data-row="2"][data-column="fractional_change"]');
  await audit(inspected);
});

test("scatter and time-bucket views pass DOM accessibility rules", async (t) => {
  const chart = mount(rank);
  t.after(chart.close);
  chart.click('.chapter[data-kind="rank_within"]');
  chart.click('[data-view="chart"]');
  const value = chart.document.querySelector('[data-action="chart-column"]');
  value.value = "team_rank";
  value.dispatchEvent(new chart.window.Event("change"));
  const kind = chart.document.querySelector('[data-action="chart-kind"]');
  kind.value = "scatter";
  kind.dispatchEvent(new chart.window.Event("change"));
  await audit(chart);
  const time = mount(buckets);
  t.after(time.close);
  time.click('.chapter[data-kind="time_resample"]');
  await audit(time);
});
