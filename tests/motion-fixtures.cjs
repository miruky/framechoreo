function dropnaGroupFixture() {
  const cell = (type, value, display = value) => ({ type, value, display });
  const num = (n) => cell("integer", String(n));
  const str = (s) => cell("string", s);
  const missing = () => cell("missing", null, "∅");
  const sourceRows = [
    { position: 0, cells: [str("A"), num(1)], parents: [], cell_parents: {} },
    { position: 1, cells: [str("A"), num(2)], parents: [], cell_parents: {} },
    { position: 2, cells: [missing(), num(9)], parents: [], cell_parents: {} },
  ];
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
    title: "Convergence test",
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
        parameters: { removed_rows: 0, selected_rows: [0, 1, 2] },
        presentation: { hold_ms: 1000 },
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
          dropna: true,
          sort: false,
          min_count: 1,
          excluded_rows: 1,
          groups: [{ output_row: 0, input_rows: [0, 1] }],
        },
        rows: [
          {
            position: 0,
            cells: [str("A"), num(3)],
            parents: [
              { step: "f", row: 0 },
              { step: "f", row: 1 },
            ],
            cell_parents: {
              key: [
                { step: "f", row: 0, column: "key" },
                { step: "f", row: 1, column: "key" },
              ],
              v: [
                { step: "f", row: 0, column: "v" },
                { step: "f", row: 1, column: "v" },
              ],
            },
          },
        ],
      },
    ],
  };
}

function mergeFixture(extra = 0) {
  const cell = (type, value, display = value) => ({ type, value, display });
  const str = (s) => cell("string", s);
  const num = (n) => cell("integer", String(n));
  const missing = () => cell("missing", null, "∅");
  const leftRows = [
    { position: 0, cells: [str("k1"), str("Alice")], parents: [], cell_parents: {} },
    { position: 1, cells: [str("k2"), str("Bob")], parents: [], cell_parents: {} },
    { position: 2, cells: [missing(), str("Carol")], parents: [], cell_parents: {} },
    { position: 3, cells: [str("k1"), str("Dana")], parents: [], cell_parents: {} },
  ];
  for (let i = 0; i < extra; i++)
    leftRows.push({
      position: 4 + i,
      cells: [str("k1"), str("Extra" + i)],
      parents: [],
      cell_parents: {},
    });
  const rightRows = [
    { position: 0, cells: [str("k1"), num(10)], parents: [], cell_parents: {} },
    { position: 1, cells: [missing(), num(99)], parents: [], cell_parents: {} },
  ];
  const merged = (li, ri, keyCell, name, scoreCell) => ({
    position: null,
    cells: [keyCell, name, scoreCell],
    parents:
      ri === null
        ? [{ step: "L", row: li }]
        : [
            { step: "L", row: li },
            { step: "R", row: ri },
          ],
    cell_parents: {
      key: [{ step: "L", row: li, column: "key" }],
      name: [{ step: "L", row: li, column: "name" }],
      score: ri === null ? [] : [{ step: "R", row: ri, column: "score" }],
    },
  });
  const mergedRows = [
    merged(0, 0, str("k1"), str("Alice"), num(10)),
    merged(1, null, str("k2"), str("Bob"), missing()),
    merged(2, 1, missing(), str("Carol"), num(99)),
    merged(3, 0, str("k1"), str("Dana"), num(10)),
    ...Array.from({ length: extra }, (_, i) =>
      merged(4 + i, 0, str("k1"), str("Extra" + i), num(10)),
    ),
  ].map((row, i) => ({ ...row, position: i }));
  return {
    format: "framechoreo.story",
    schema_version: 1,
    library_version: "0.1.0",
    pandas_version: "3.0.6",
    title: "Merge inflow test",
    result: "M",
    timeline: ["L", "M"],
    steps: [
      {
        id: "L",
        name: "Left",
        label: "Left",
        operation: "source",
        columns: ["key", "name"],
        rows: leftRows,
        parents: [],
        parameters: {},
        presentation: { hold_ms: 1000 },
      },
      {
        id: "R",
        name: "Right",
        label: "Right",
        operation: "source",
        columns: ["key", "score"],
        rows: rightRows,
        parents: [],
        parameters: {},
        presentation: { hold_ms: 1000 },
      },
      {
        id: "M",
        name: "Joined",
        label: "Joined",
        operation: "merge",
        columns: ["key", "name", "score"],
        rows: mergedRows,
        parents: ["L", "R"],
        parameters: {
          on: ["key"],
          how: "left",
          validate: "many_to_one",
          suffixes: ["_x", "_y"],
          unmatched_rows: 1,
        },
        presentation: { hold_ms: 1000 },
      },
    ],
  };
}

module.exports = { dropnaGroupFixture, mergeFixture };
