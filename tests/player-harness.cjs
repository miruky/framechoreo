const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const path = require("node:path");

function fixture(count = 3, operation = "group_sum") {
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
  const total = (count * (count + 1)) / 2;
  const aggregateValue = { group_sum: total, group_mean: total / count, group_count: count }[
    operation
  ];
  const aggregateLabel = { group_sum: "Sum", group_mean: "Average", group_count: "Count" }[
    operation
  ];
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
        label: aggregateLabel,
        operation,
        columns: ["key", "v"],
        parents: ["f"],
        presentation: { hold_ms: 1000 },
        parameters: {
          by: ["key"],
          value: "v",
          dropna: false,
          sort: false,
          ...(operation === "group_sum" ? { min_count: 1 } : {}),
          excluded_rows: 0,
          groups: [{ output_row: 0, input_rows: sourceRows.map((r) => r.position) }],
        },
        rows: [
          {
            position: 0,
            cells: [cell("a"), cell(aggregateValue)],
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

function mount(data = fixture(), options = {}) {
  const serialized = JSON.stringify(data),
    encoded = options.compressed
      ? require("node:zlib").gzipSync(serialized).toString("base64")
      : serialized.replaceAll("<", "\\u003c");
  const dom = new JSDOM(
    '<!doctype html><main id="framechoreo-player"></main><script id="framechoreo-data" type="application/json"' +
      (options.compressed
        ? ' data-encoding="gzip-base64" data-json-bytes="' +
          (Buffer.byteLength(serialized) + (options.sizeOffset || 0)) +
          '"'
        : "") +
      ">" +
      encoded +
      "</script>",
    { runScripts: "outside-only", pretendToBeVisual: true },
  );
  const { window } = dom,
    document = window.document;
  if (options.compressed) {
    window.DecompressionStream = options.unsupported ? undefined : globalThis.DecompressionStream;
    window.Blob = globalThis.Blob;
    window.TextDecoder = globalThis.TextDecoder;
  }
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
  // Distinct, positive rectangles for the two tables and their cells. This
  // tests source/destination geometry without claiming to measure CSS layout.
  Object.defineProperty(window, "innerHeight", { value: 1200, configurable: true });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (options.rect) {
      const override = options.rect(this);
      if (override) return override;
    }
    const rect = (left, top, width, height) => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    });
    const row = this.closest(".data-row");
    const statusShift = document.querySelector(".motion-status")?.textContent ? 24 : 0;
    if (row) {
      const top = 500 + statusShift + (parseFloat(row.style.top) || 0);
      if (this === row) return rect(100, top, 346, 43);
      const wrap = this.closest(".cell-wrap"),
        index = wrap ? [...row.children].indexOf(wrap) - 1 : 0;
      return rect(146 + index * 100, top, 100, 40);
    }
    if (this.matches(".source-cell")) {
      const card = this.closest(".source-card");
      return rect(
        60,
        200 + statusShift + [...card.parentElement.children].indexOf(card) * 46,
        100,
        36,
      );
    }
    if (this.matches(".ref-table .cell")) {
      const tr = this.closest("tr"),
        index = [...tr.children].indexOf(this.closest("td"));
      return rect(
        100 + index * 100,
        170 + [...tr.parentElement.children].indexOf(tr) * 40,
        100,
        36,
      );
    }
    if (this.matches(".ref-table")) return rect(100, 150, 800, 600);
    if (this.matches(".table-scroll, .board")) return rect(100, 500 + statusShift, 800, 650);
    return rect(0, 0, 1024, 1200);
  };
  window.HTMLElement.prototype.animate = function (frames, options) {
    const node = this;
    const animation = {
      playState: "running",
      playbackRate: 1,
      remaining: options.duration + (options.delay || 0),
      frames,
      options,
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
  for (const file of ["model.js", "workbench.js", "player.js"])
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
    ready: () =>
      new Promise((resolve, reject) => {
        if (document.querySelector("main").dataset.ready) {
          resolve();
          return;
        }
        const observer = new window.MutationObserver(() => {
          if (document.querySelector("main").dataset.ready) {
            clearTimeout(timeout);
            observer.disconnect();
            resolve();
          }
        });
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error("Player did not finish loading"));
        }, 5000);
        observer.observe(document.querySelector("main"), { attributes: true });
      }),
    scene: () => document.querySelector(".operation")?.textContent,
    close: () => window.close(),
    setReduced: (value) => {
      media.matches = value;
      listeners.forEach((fn) => fn({ matches: value }));
    },
  };
}
module.exports = { mount, fixture };
