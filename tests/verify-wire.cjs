const fs = require("node:fs");
const assert = require("node:assert/strict");
const model = require("../src/framechoreo/assets/model.js");
const contracts = JSON.parse(fs.readFileSync(0, "utf8"));
let cells = 0;
for (const { data, checks } of contracts) {
  model.scenes(data);
  for (const { reference, inputs } of checks) {
    const actual = model
      .traceCell(data, reference)
      .map(({ step, row, column, cell }) => ({ step, row, column, cell }));
    assert.deepEqual(actual, inputs);
    cells++;
  }
}
console.log(
  `Python and JavaScript agree on all ${cells} checked cells, including repeated aggregate inputs.`,
);
