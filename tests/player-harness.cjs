const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const path = require("node:path");

function fixture(count = 3) {
  const cell = (value) => ({
    type: typeof value === "number" ? "integer" : "string",
    value: String(value),
    display: String(value),
  });
  const sourceRows = Array.from({ length: count }, (_, i) => ({
    position: i,
    cells: [cell("a"), cell(i + 1)],
    parents: [],
    cell_parents: {},
  }));
  const filteredRows = sourceRows.map((row, i) => ({
    ...row,
    parents: [{ step: "s", row: i }],
    cell_parents: {
      key: [{ step: "s", row: i, column: "key" }],
      v: [{ step: "s", row: i, column: "v" }],
    },
  }));
  return {
    format: "framechoreo.story",
    schema_version: 1,
    library_version: "0.1.0",
    pandas_version: "3.0.6",
    title: "Playback test",
    result: "g",
    timeline: ["s", "f", "g"],
    steps: [
      {
        id: "s",
        name: "Input",
        label: "Input",
        operation: "source",
        columns: ["key", "v"],
        rows: sourceRows,
        parents: [],
        parameters: {},
        presentation: { hold_ms: 1000 },
      },
      {
        id: "f",
        name: "Filtered",
        label: "Keep the rows",
        operation: "filter",
        columns: ["key", "v"],
        rows: filteredRows,
        parents: ["s"],
        parameters: { removed_rows: 0, selected_rows: sourceRows.map((row) => row.position) },
        presentation: { hold_ms: 2000 },
      },
      {
        id: "g",
        name: "Total",
        label: "Sum",
        operation: "group_sum",
        columns: ["key", "v"],
        parents: ["f"],
        presentation: { hold_ms: 1000 },
        parameters: {
          by: ["key"],
          value: "v",
          dropna: false,
          sort: false,
          min_count: 1,
          excluded_rows: 0,
          groups: [{ output_row: 0, input_rows: sourceRows.map((r) => r.position) }],
        },
        rows: [
          {
            position: 0,
            cells: [cell("a"), cell((count * (count + 1)) / 2)],
            parents: sourceRows.map((r) => ({ step: "f", row: r.position })),
            cell_parents: {
              key: sourceRows.map((r) => ({ step: "f", row: r.position, column: "key" })),
              v: sourceRows.map((r) => ({ step: "f", row: r.position, column: "v" })),
            },
          },
        ],
      },
    ],
  };
}

function mount(data = fixture()) {
  const dom = new JSDOM(
    '<!doctype html><main id="framechoreo-player"></main><script id="framechoreo-data" type="application/json">' +
      JSON.stringify(data).replaceAll("<", "\\u003c") +
      "</script>",
    { runScripts: "outside-only", pretendToBeVisual: true },
  );
  const { window } = dom,
    document = window.document;
  let now = 0,
    nextId = 0;
  const timers = new Map(),
    animations = [];
  window.setTimeout = (callback, delay = 0) => {
    const id = ++nextId;
    timers.set(id, { callback, at: now + delay });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  window.performance.now = () => now;
  const listeners = [];
  const media = { matches: false, addEventListener: (_, listener) => listeners.push(listener) };
  window.matchMedia = () => media;
  window.HTMLElement.prototype.scrollIntoView = function () {
    this.dataset.scrolled = "true";
  };
  window.HTMLElement.prototype.animate = function (_, options) {
    const node = this;
    const animation = {
      playState: "running",
      playbackRate: 1,
      remaining: options.duration,
      deadline: 0,
      timer: null,
      onfinish: null,
      play() {
        if (this.playState === "finished" || this.playState === "idle") return;
        this.playState = "running";
        this.deadline = now + this.remaining / this.playbackRate;
        this.timer = window.setTimeout(() => {
          this.playState = "finished";
          this.remaining = 0;
          this.onfinish?.();
        }, this.remaining / this.playbackRate);
      },
      pause() {
        if (this.playState !== "running") return;
        this.remaining = Math.max(0, (this.deadline - now) * this.playbackRate);
        window.clearTimeout(this.timer);
        this.playState = "paused";
      },
      cancel() {
        window.clearTimeout(this.timer);
        this.playState = "idle";
      },
      updatePlaybackRate(rate) {
        const running = this.playState === "running";
        if (running) this.pause();
        this.playbackRate = rate;
        if (running) this.play();
      },
      node,
    };
    animation.play();
    animations.push(animation);
    return animation;
  };
  window.fetch = () => {
    throw new Error("Player must not use the network");
  };
  for (const file of ["model.js", "player.js"])
    window.eval(fs.readFileSync(path.join(__dirname, "../src/framechoreo/assets", file), "utf8"));
  const tick = (ms) => {
    const until = now + ms;
    let loops = 0;
    while (true) {
      const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at);
      if (!due.length) break;
      if (++loops > 1000) throw new Error("Timer loop");
      const [id, t] = due[0];
      now = t.at;
      timers.delete(id);
      t.callback();
    }
    now = until;
  };
  const click = (selector) => {
    const button = document.querySelector(selector);
    if (!button) throw new Error("Missing control: " + selector);
    button.focus();
    button.click();
  };
  return {
    window,
    document,
    click,
    tick,
    animations,
    scene: () => document.querySelector(".operation")?.textContent,
    close: () => window.close(),
    setReduced: (value) => {
      media.matches = value;
      listeners.forEach((fn) => fn({ matches: value }));
    },
  };
}
module.exports = { mount, fixture };
