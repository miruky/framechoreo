# FrameChoreo

**Explain pandas workflows with interactive tables, charts, and separate value and decision provenance.**

Record cleaning, conversions, joins, reshaping, and grouped metrics. Readers can
follow values in motion, compare before and after, inspect data quality, search
records, switch to a chart, and trace both values and explicit decisions to their
recorded inputs. The exported HTML
contains its player and recorded data: no Python server, account, or network access
is needed to replay it.

[日本語](README.ja.md) · [API](docs/api.md) · [Design](docs/design.md) · [Examples](examples/)

FrameChoreo is for teachers, technical writers, and analysts explaining how a
result was made. **1.0.0rc3 is a local release candidate; it has not been published.**
Operations are explicit and their results follow pandas. [The 1.0 guide](docs/v1.md)
defines the supported workflow, reader features, and compatibility boundaries.

## Install

The first release is being prepared; do not assume it is available on PyPI yet.
From a source checkout, with Python 3.11 or newer:

```sh
python -m pip install .
```

Or install the prepared wheel:

```sh
python -m pip install dist/framechoreo-1.0.0rc3-py3-none-any.whl
```

If you installed an earlier unreleased wheel with the same version, add
`--force-reinstall --no-deps` to replace that local installation.

Runtime dependencies are pandas and NumPy. A browser runs the exported player;
Node.js is only needed for the player-model development tests.

## A complete story

```python
import pandas as pd
from framechoreo import DataStory

story = DataStory(title="Where did the sales total come from?")
sales = story.table(
    pd.DataFrame(
        {
            "product": ["P1", "P2", "P1", "P3", "P2", "P4"],
            "amount": [120, 80, 150, 60, 90, 40],
            "paid": [True, False, True, True, True, True],
        }
    ),
    name="Sales",
)
products = story.table(
    pd.DataFrame(
        {
            "product": ["P1", "P2", "P3"],
            "category": ["Books", "Stationery", "Stationery"],
        }
    ),
    name="Products",
)

paid = sales.filter_rows(lambda df: df["paid"], label="Keep paid orders")
joined = paid.merge(
    products,
    on="product",
    how="left",
    validate="many_to_one",
    label="Attach product categories",
)
total = joined.group_sum(
    by="category",
    value="amount",
    dropna=False,
    label="Add the sales in each category",
)
story.annotate(total, note="Select 270 to inspect its two input sales.", hold=4, highlight="amount")

story.export_html("sales-story.html", result=total)
assert total.to_pandas()["amount"].tolist() == [270, 150, 40]
assert [int(x.value) for x in total.explain(0, "amount")] == [120, 150]
```

Open `sales-story.html` in a modern browser. Select **Sum**, select `270`, then
select an input cell to inspect the source table. The unmatched `P4` order remains
in the missing-category group because `dropna=False` was explicit.

Exports refuse to replace existing files unless `overwrite=True` is supplied.
In a trusted Jupyter notebook, displaying `total` or `story` uses a sandboxed
iframe through `_repr_html_()`.

## Operation coverage

| Operation | Contract |
|---|---|
| `table(df)` | Copies a source DataFrame; supports unique, nonempty string column names and scalar cells |
| `filter_rows(predicate)` | Evaluates a callable once on a copy, or accepts a boolean mask; rejects input mutation and ambiguous Series alignment |
| `filter_by(column, op=..., value=...)` | Explicit condition with true/false/missing outcomes for every input row and an excluded-row audit |
| `where(...)` with `&`, `\|`, `~` | Compose up to 32 comparisons with pandas three-valued logic; supports membership and inclusive ranges |
| `case_when(name, column=..., op=..., value=..., then=..., otherwise=...)` | Chooses a value while separating the chosen value input from comparison inputs; `col("field")` denotes a column operand |
| `coalesce(name, [...], default=...)` | Takes the first non-missing field in each row and shows every checked candidate |
| `window(name, column=..., op=..., by=...)` | Grouped lag/difference, cumulative sum/min/max, and rolling sum/mean/min/max in current row order |
| `merge(...)` / `join_audit()` | Left/inner/right/outer with validated cardinality; inspect unmatched inputs, fanout, duplicate keys, and missing-key matches |
| `group_sum(by=..., value=..., dropna=...)` | Numeric non-boolean values, explicit missing-key policy, `min_count=1` by default, observed categorical groups |
| `group_mean(by=..., value=..., dropna=...)` | Numeric non-boolean values; a group with no non-missing values is missing, since pandas skips missing values with no `min_count` to set |
| `group_count(by=..., value=..., dropna=...)` | Counts non-missing entries of any supported column type per group; this is not the row count, and a fully missing group counts as zero |
| `group_transform(name, by=..., value=..., op=..., dropna=...)` | Repeat a group's sum/mean/min/max/count/nunique beside each original row with exact candidate inputs |
| `calculate(name, left=..., op=..., right=...)` | Row-wise add/subtract/multiply/divide with a numeric column or scalar; records actual operands |
| `sort_values(by, ...)` | Stable sorting with retained positional provenance |
| `select_columns([...])` / `rename_columns({...})` | Choose, reorder, and rename columns while retaining their inputs |
| `drop_missing(...)` / `fill_missing({...})` | Explicit removal or scalar imputation, with a distinction between original values and introduced constants |
| `drop_duplicates(...)` / `take_rows([...])` | Native duplicate policies and explicit row selection, including repeated positions |
| `astype({...})` / `to_numeric(...)` / `to_datetime(...)` | Explicit types and parsing policies; dates require a format |
| `string_transform(..., op=...)` | Strip, lower, upper, and casefold for string-or-missing fields |
| `story.concat([...])` | Vertical combination, inner/outer column alignment, and multiple recorded inputs |
| `melt(...)` / `pivot(...)` | Long/wide reshaping with exact positional value references; pivot does not aggregate |
| `group_agg(...)` | Named sum, mean, min, max, median, count, and nunique metrics in one step |
| `profile()` | Native missing, unique, duplicate, and dtype summaries, detached from the snapshot |
| `annotate(frame, ...)` | Adds a note, chapter, playback hold time, and highlighted columns without changing calculations |
| `explain(row, column)` | Returns source value inputs, preserving repeated use of the same source cell |
| `explain_controls(row, column)` / `filter_decision(input_row)` / `condition_breakdown(input_row)` | Separates decision inputs, the final outcome, and each comparison's outcome |
| `explain_page(row, column, offset=..., limit=...)` | Bounded pages with exact totals, including repeated use of an aggregate |
| `to_html` / `export_html` | Self-contained player; light, dark, or automatic theme |

The default limits are **200 rows per step, 12 columns, 20 steps, and 2 MB of
serialized story data**. These are capture guards, not a benchmark. Limits raise
errors rather than sample silently. The player initially shows up to 12 rows;
**Show all** reveals small tables; tables over 200 rows use **Browse all**, 100-row
pages, and a row-number jump. Calculations use all captured rows.
Origin lists are paginated in groups of 50, and the complete right-hand join input
can be inspected. Pause freezes row motion and keeps the remaining scene time;
resuming and changing speed preserve progress.
**Clear selection** removes the inspection highlights. Sum explanations report
insufficient non-missing inputs and flag recorded integer sums that differ from
exact addition, helping identify dtype overflow while preserving the pandas result.
Selecting a cell also shows its column dtype. Native float16/float32 formatting is
retained; equal short decimal text can still hide different floating-point values.
Conditional, fallback, and window steps show decision inputs separately from the
cells that supplied the result value. An explicit filter lists removed rows as
false or missing comparisons and opens the original row. These features are
illustrated by `python examples/decision_window_workflow.py`. A long cumulative
calculation can exceed the separate 250,000-reference provenance cap and raises
instead of exporting a partial explanation.
The same cap applies when a `group_transform` repeats a large group metric.
Compound rules and join audits have their own complete examples.
Selecting a value brings its origins into view and moves keyboard focus there.
**Back to selected cell** restores the table and row, including an expanded row view.
Empty and whitespace-only strings have visible labels and quoted text; their
recorded values are unchanged. The reader's reduced-motion choice is retained
when the operating system's motion setting changes while the file is open.

## Larger analysis walkthroughs

Use `DataStory.for_analysis()` to opt into a larger capture budget: 50,000 rows per
step, 24 columns, 50 steps, 2 million cells across all snapshots, and 128 MB of JSON.
These budgets apply together; they are not a guarantee that every combination fits
every device. No data is silently sampled.

The player renders large tables in 100-row pages and source uses in 50-input pages.
Both have direct number jumps. Source totals retain exact repeated-use counts even
when they exceed JavaScript's ordinary integer range. HTML compression is automatic
for larger payloads and uses the browser's built-in gzip support; use
`compression="none"` for an uncompressed export.

Run `python examples/large_analysis.py --rows 50000` for a complete calculation,
filter, join, aggregation, ranking, column selection, and renaming example.
See [analysis and scale](docs/analysis.md) for the API, measurements, and memory limits.

## What the file contains

**An exported story includes its ancestor source tables, including filtered-out
rows and columns removed by selection.** Paging and compression do not remove data
from the file. Use synthetic
or appropriately prepared data when sharing examples. `story.export_info()` shows
the source names, snapshot row count, and serialized size before writing.

Only ancestors of the selected `result` are exported. Unrelated branches are
excluded, but this is not an anonymization feature. Strings are escaped when
embedded and displayed as text. Input callbacks are trusted Python code, not a sandbox.

## Boundaries

- This is an explicit wrapper, not an automatic tracer. Raw pandas operations on
  `frame.to_pandas()` are not recorded.
- Many-to-many joins, arbitrary aggregation callbacks, nested-object expansion,
  Polars, GIF, and MP4 export are outside this release candidate.
- Large integer values are encoded as strings for browser display. Arithmetic,
  including dtype and overflow behavior, follows pandas.
- Nested objects, bytes, complex numbers, duplicate columns, and non-string column
  names are rejected. DataFrame index labels are preserved by `to_pandas()` but
  are not exported as display columns; source positions identify rows.
- NumPy datetimes keep their native text precision, including sub-nanosecond units.
  All displayed strings, including column names and decimal representations, are
  bounded to 20,000 Unicode characters. Grouped `min_count` is bounded to `2**53 - 1`
  so its displayed setting remains exact in JavaScript.
- Scalar or dictionary filter masks are rejected; supply one boolean per row.
  Text must be valid Unicode for UTF-8 export. Missing values carry a visible
  marker, and selecting a cell reveals its encoded value type.
- A filter records which rows remain, not every cell read by arbitrary Python code.
  Sum explanations omit missing numeric inputs; group membership and `min_count`
  remain in the operation record.
- Story JSON is a versioned display model, not a pandas round-trip serializer.
  Self-contained HTML bundles its matching player; pin the version for direct JSON integration.

## Run the examples

```sh
python examples/sales_story.py
python examples/missing_values.py
python examples/classroom.py
python examples/float_precision.py
python examples/blank_strings.py
python examples/group_aggregates.py
python examples/motion_showcase.py
python examples/retail_workflow.py
python examples/reshape_workflow.py
python examples/decision_window_workflow.py
python examples/compound_conditions_workflow.py
python examples/join_audit_workflow.py
python examples/group_transform_workflow.py
python examples/large_analysis.py --rows 5000
```

The generated HTML files appear in `examples/generated/`. Every example uses
synthetic data. See [validation scope](docs/validation.md) for the environments and
checks performed on the prepared release.
The floating-point example shows why float32 and float64 keys can both display
`0.1` yet fail to join, while `0.5` matches exactly in both types.
The blank-string example shows why `notna()` retains empty strings and spaces.
The motion showcase follows a small Japanese sales example through filtering,
sorting, joining, and summing. Join values travel from labeled source cards to
their recorded destinations; non-missing aggregate inputs converge into the result.
Group numbers accompany the colors. **Replay the movement** repeats a transition,
and **Operation details** opens the recorded operation summary. See [motion limits](docs/analysis.md#following-values-in-motion).

The retail workflow combines two monthly files, cleans them, joins a product catalog,
and produces six named metrics. The reshape workflow follows monthly values through
melt, grouped summaries, pivot, and a difference calculation. Both assert complete
DataFrame equality with separate ordinary pandas pipelines.

Use `DataStory(language="ja", description="...")` for Japanese controls. Column names,
source names, labels, and notes remain authored content. Both themes, the searchable
table, before/after comparison, quality panel, and inspectable chart work offline.
Search and column visibility affect the view only. The HTML includes the MIT notice
for the bundled player; it does not change the license of the data or narrative.

For a complete notebook example, install the optional notebook tools from the
source checkout and open [examples/notebook.ipynb](examples/notebook.ipynb):

```sh
python -m pip install ".[notebook]"
jupyter lab examples/notebook.ipynb
```

The empty story displays a short hint; a recorded result displays the interactive
player. Run the cells in the Python environment where FrameChoreo is installed.

## Related work

[Pandas Tutor](https://pandastutor.com/) already visualizes many table transformations
and their input/output relationships. [Datamations](https://microsoft.github.io/datamations/)
animates analysis pipelines; its official guide demonstrates R/dplyr workflows.
[ipyvizzu](https://github.com/vizzuhq/ipyvizzu) builds animated charts.

FrameChoreo explores explicit pandas semantics, separate value/decision inputs,
and a bundled player for portable table stories. The broader ideas of animation and provenance
are not new. This implementation is independent; no code from those projects is
vendored.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for tests and packaging, and
[SECURITY.md](SECURITY.md) for data handling and vulnerability reports.

MIT licensed. Copyright © 2026 miruky.
