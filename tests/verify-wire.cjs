const fs = require("node:fs");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const contracts = JSON.parse(fs.readFileSync(0, "utf8"));
let cells = 0;
let pages = 0;
for (const { data, checks, page_checks = [] } of contracts) {
  model.scenes(data);
  for (const { reference, inputs, max_sources } of checks) {
    const actual = model
      .traceCell(data, reference, max_sources)
      .map(({ step, row, column, cell }) => ({ step, row, column, cell }));
    assert.deepEqual(actual, inputs);
    cells++;
  }
  for (const { reference, offset, total, inputs } of page_checks) {
    const actual = model.prepareTrace(data, reference).page(offset, 50);
    assert.equal(actual.total, total);
    assert.equal(actual.offset, offset);
    assert.deepEqual(
      actual.origins.map(({ step, row, column, cell }) => ({ step, row, column, cell })),
      inputs,
    );
    pages++;
  }
}
console.log(
  `Python and JavaScript agree on all ${cells} checked cells and ${pages} large provenance pages, including repeated inputs.`,
);
