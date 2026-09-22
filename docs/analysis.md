# Analysis walkthroughs and larger captures

FrameChoreo records explicit pandas operations and their value inputs. The analysis
profile supports a larger local workflow while keeping capture budgets visible.
It does not turn pandas into a distributed or out-of-core execution engine.

## A complete pipeline

Run the synthetic example from a source checkout:

```sh
python examples/large_analysis.py --rows 5000
python examples/large_analysis.py --rows 50000 --output examples/generated/analysis-50000.html
```

The example calculates quantity × unit price, filters orders, joins store regions,
sums revenue, ranks the regions, selects report columns, and renames the result.
It asserts full DataFrame equality with a separate ordinary pandas pipeline.

For an existing DataFrame, the recording API looks like this:

```python
from framechoreo import DataStory

story = DataStory.for_analysis(title="Regional sales")
orders = story.table(df, name="Orders")  # df contains region, quantity, and unit_price
valued = orders.calculate("revenue", left="quantity", op="multiply", right="unit_price")
total = valued.group_sum(by="region", value="revenue", dropna=False)
ranked = total.sort_values("revenue", ascending=False)
report = ranked.select_columns(["region", "revenue"]).rename_columns({"revenue": "sales"})
story.export_html("analysis.html", result=report, overwrite=True)
page = report.explain_page(0, "sales", offset=0, limit=50)
print(page.total, page.origins, page.has_next)
```

## Capture budgets

| Budget | `DataStory()` | `DataStory.for_analysis()` |
|---|---:|---:|
| Rows per step | 200 | 50,000 |
| Columns per step | 12 | 24 |
| Recorded steps, including sources | 20 | 50 |
| Cells across all captured snapshots | Unset | 2,000,000 |
| UTF-8 JSON bytes before HTML compression | 2,000,000 | 128,000,000 |

Budgets are applied together. A wide table may exhaust the cumulative cell budget
after only a few operations. Every snapshot, including unrelated branches, counts
toward `max_cells`; export includes only ancestors of the selected result. An empty
table still counts as a step. Limits raise `CaptureLimitError` without sampling or
appending a partial snapshot. Set positive custom limits when needed; the base
constructor accepts `max_cells=None` to leave that particular guard unset.

These are limits on recorded structure, not a precise RAM allowance. Python retains
the DataFrames and references. The browser retains the decoded story. Text length,
width, transformation count, and intermediate shapes all affect memory and file size.
`to_dict()` materializes the complete display dictionary; JSON/HTML export encodes
rows incrementally to avoid that second complete representation.

## Operation contracts

`calculate(name, left=..., op=..., right=...)` adds a new numeric column. Operations
are `add`, `subtract`, `multiply`, and `divide`. The left operand is a column; the
right operand is another column or a real numeric scalar. Boolean and duration
operands are not accepted. Existing columns are not overwritten. Pandas computes
the values, including dtype promotion, missing values, and overflow behavior.

Each calculated cell points to its actual operand cells in the same row, in left/right
order. A scalar constant is stored with the operation and does not invent a source
cell. Using the same operand twice preserves two uses. Arbitrary callback expressions,
cross-row calculations, and implicit dependency inference are not supported.

`sort_values(by, ascending=True, na_position="last")` uses stable pandas sorting.
`by` is a name or ordered list. `ascending` is a boolean or a matching list/tuple of
booleans; `na_position` is `first` or `last`. Tied values retain input order. Original
DataFrame index labels remain in `to_pandas()`, while provenance uses row positions.

`select_columns(columns)` chooses and orders unique existing columns. At least one
column is required. `rename_columns(mapping)` maps existing names to nonempty names
and rejects duplicate output names. Both retain references to the original cells.

`group_mean(by=..., value=..., dropna=..., sort=False)` averages a numeric,
non-boolean column. `group_count(...)` counts non-missing values of any supported
scalar type; it does not count all rows. Like `group_sum`, they use observed groups
and positional input references. Mean returns missing for an all-missing group;
count returns zero. Neither takes `min_count`. Group membership includes rows with
a missing value, while the aggregated value's inputs exclude those missing cells.
Run `python examples/group_aggregates.py` for both examples.

## Following values in motion

Run `python examples/motion_showcase.py` and open `examples/generated/motion-showcase.html`.
The example compares its complete result against ordinary pandas. It includes an
excluded negative sale, stable sorting, a repeated join input, an unmatched product,
and a missing value that does not contribute to the sum.

Join scenes show up to 12 distinct source cells relevant to the result preview.
They come directly from the recorded right-hand input. The full input remains
available in the expandable table and its inspection view. A wide display places
the cards beside the result; a narrow display uses a horizontal card strip.
Matched missing values retain their recorded source. Unmatched values have no
invented source or movement.

Grouping rows and results share a `G` number and a color; the six colors repeat,
so the labels remain necessary. Sum, mean, and count move their non-missing value
inputs, rather than entire rows. These are immediate inputs to the operation;
selecting the result follows them recursively to raw sources.

Motion uses measured positions of fully visible cells and is limited to 48 moving
values. Its counter describes inputs for the shown result rows, not the entire
dataset or the full recursive provenance count. Cells outside the current view
remain static. Expanded/paged tables stay static too. These display limits do not
change calculations or recorded provenance.

Forward adjacent steps animate. A direct chapter jump or backward navigation
does not invent a transformation between unrelated layouts. **Replay the movement**
repeats the transition through its preceding scene; expanded views and reduced
motion disable replay. Play/pause and speed apply to value and row movement.
Selecting a value, scrolling, resizing, changing views, or expanding the code
settles any movement whose geometry is no longer current. The reader's and OS
reduced-motion preferences remain effective. **Operation details** opens the recorded
operation without executing it.

## Browsing and tracing

The initial view remains a 12-row preview. **Browse all** opens tables with more than
200 rows in 100-row pages. Smaller expanded tables keep their existing all-row view.
Expanded tables scroll within the stage, with a fixed header. A table-row jump refers
to the recorded row number printed on the left, even when the grouping scene changes
the display order. Page numbers describe the current view, not original row identity.

The inspector prepares source counts once per selected cell, then expands only the
requested 50-input page. **Input number** jumps directly within that ordered list.
Raw source highlighting uses the reachable reference graph, not an expanded list of
every repeated use. Returning to the selected cell restores the scene, row page,
expanded view, and remaining playback hold.

`explain()` keeps its complete-list behavior and default 10,000-input guard.
`explain_page(row, column, offset=0, limit=50)` returns an immutable `OriginPage`:

- `origins`: a tuple containing at most `limit` source uses;
- `total`: the exact count, including repeated uses;
- `offset`: the requested zero-based source-use offset;
- `has_next`: whether more uses follow this page.

`limit` is from 1 through 10,000. Negative offsets are rejected; an offset at or
beyond the end returns an empty tuple. An all-missing sum with `min_count=0` may have
zero raw value inputs. Python integers and browser BigInt counts keep large repeated
use totals exact. Tests include a small graph representing 10^18 uses; this is not a
claim that the player holds 10^18 physical input rows.

## Portable compressed HTML

`to_html()` and `export_html()` accept `compression="auto"`, `"gzip"`, or `"none"`.
Auto considers gzip for JSON of at least 100,000 bytes and uses it only when the
base64 payload is smaller than the plain embedded representation. The JSON byte
budget is checked before compression. Standalone `to_json()` remains plain JSON.

Compressed stories include all assets and data and decompress locally with the
browser's built-in `DecompressionStream`. No CDN, API call, or Python server is used
for playback. Unsupported browsers receive an explicit error; produce an uncompressed
file with `compression="none"` when needed. The browser validates the decoded byte
count and releases the redundant serialized text after parsing. Share the exported
file itself. Very large notebook outputs may also encounter host-specific limits;
open an exported HTML file separately for larger analyses.

The browser API is documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream).
The Python export uses the standard library's [gzip implementation](https://docs.python.org/3/library/gzip.html).

## Data disclosure and practical limits

Filtering, choosing fewer columns, paging, and compression do not redact the ancestor
tables. Remove data that must not be shared before calling `story.table()`.
All columns and rows of the recorded ancestor tables are included.

The 50,000-order example was checked locally against pandas and in Chromium. Its
eight-row report has 10,946 raw value inputs behind the first total, counting quantities
and prices separately. A 116.2 MB JSON recording produces an approximately 10.9 MB
HTML file. This describes that synthetic workflow, not every 50,000-row dataset.

Performance varies with data and hardware. The implementation still stores snapshots
in memory and parses the whole story in the browser. Pagination bounds rendered rows,
not total data storage. Million-row workloads, disk-backed capture, Polars, arbitrary
aggregation, arbitrary pivot-table callbacks and video export remain outside this implementation.
