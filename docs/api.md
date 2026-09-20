# API reference

## DataStory

```python
DataStory(title="A data story", *, max_rows=200, max_columns=12,
          max_steps=20, max_export_bytes=2_000_000, max_cells=None)
```

Limits are positive integers. Source tables count as recorded steps. Exceeding a
limit raises `CaptureLimitError`; capture does not silently sample. A text cell is
limited to 20,000 characters; the same bound applies to column names and other
displayed scalar strings. `max_export_bytes` covers UTF-8 JSON data, not bundled
player assets or the compressed file size. `max_cells`, when set, limits the sum of
row count × column count across all captured snapshots, including unrelated branches.

`DataStory.for_analysis()` sets larger defaults: 50,000 rows, 24 columns, 50 steps,
128,000,000 JSON bytes, and 2,000,000 cumulative cells. All budgets apply together.
See [analysis and scale](analysis.md) for a complete example and resource limits.

The title and limits can be reassigned and are validated on each assignment. A
failed assignment preserves the previous value. Lowering capture limits does not
change existing records or their lineage traversal budget.

### table

```python
frame = story.table(df, name="Sales")
```

Copies the DataFrame and records it as a source. Supported cells are strings,
booleans, real integer/float scalars, missing values, Decimal, date/time values,
and durations. NumPy timedelta scalars are encoded as durations; their `NaT` and
Decimal NaNs are missing values. NumPy floating scalars use their native text
formatting. Mutable nested objects and unsupported types are rejected. Columns
must have unique, nonempty string names. The original index is preserved internally
but is not automatically published as a displayed column.

Axis buffers and categorical dictionaries are detached as well as ordinary data.
Unpaired Unicode surrogates are rejected during capture, before a snapshot is added.
Whitespace-only column names are rejected. NumPy datetime scalars retain their
native string precision rather than being converted through pandas Timestamp;
FrameChoreo records the values already stored in the supplied DataFrame.
Cells are read from individual column arrays, preserving float16/float32 scalar
formatting without coercing a mixed numeric row. The inspector shows the selected
column's dtype. Equal short decimal text does not imply equal values across float
precisions; `examples/float_precision.py` demonstrates this with join keys.

### annotate

```python
story.annotate(frame, note="Follow the amount column", hold=4, highlight=["amount"])
```

Replaces the presentation settings for that step. `note` is at most 600 characters;
`hold` is a finite number of seconds from 1 through 30; `highlight` is a column name
or a sequence of column names. Neither data nor lineage is recalculated. A grouped
sum creates grouping and summing scenes, both using the step's hold time. The note
appears only in the summing scene, once the result exists.

Playback first holds the current scene. Pause freezes active row animations and
retains the remaining hold time. Resuming or changing speed continues from that
point. Manual scene navigation resets the selected scene's hold time.
Selecting a value settles the visual transition before inspection, so temporary
animation rows do not remain beside the recorded result.
The origins section receives focus and scrolls into view. **Back to selected cell**
restores the scene, expanded row view, and remaining playback hold saved at selection.
If the cell was in the right-input preview, its table opens for inspection.
The reader's reduced-motion choice is kept for the lifetime of the player; the
system preference always suppresses motion while enabled.

### Export methods

```python
story.to_dict(result=frame)
story.to_json(result=frame)
story.to_html(result=frame, theme="auto", compression="auto")
story.export_html("story.html", result=frame, theme="auto", overwrite=False, compression="auto")
story.export_info(result=frame)
```

`result` defaults to the most recently recorded step. Only that step's ancestors
are included. An empty story can return an empty dictionary payload, but cannot
export a player. The dictionary is detached from the story and can be changed by
the caller without mutating capture history.

`theme` is `auto`, `light`, or `dark`. HTML includes the data and all player assets.
Strings are escaped at the script boundary, and rendered with text APIs. A Content
Security Policy blocks external resources and form submissions.

File writing uses a temporary file in the destination directory. Existing files
are protected by an exclusive hard link when `overwrite=False`; overwrite mode uses
`os.replace`. Filesystems that do not support these operations may raise `OSError`.
There is no unsafe fallback that overwrites an existing file silently.
`overwrite` must be an actual boolean; the string `"false"` is rejected.
JSON is encoded one row at a time and stops once its byte limit is exceeded,
without materializing a second complete story dictionary. `compression` is `auto`,
`gzip`, or `none`. Auto compresses JSON of at least 100,000 bytes when beneficial.
The byte limit is enforced before compression. A browser without built-in gzip
decompression needs an export using `compression="none"`.

In Jupyter, `_repr_html_()` embeds the same player in a sandboxed `srcdoc` iframe.
Notebook trust and the host's iframe policy can affect rendering.
Displaying an empty story shows a short start hint; explicit HTML export still
requires a recorded table.

## StoryFrame

### calculate, sort_values, select_columns, and rename_columns

```python
valued = frame.calculate("revenue", left="quantity", op="multiply", right="unit_price")
adjusted = valued.calculate("half", left="revenue", op="divide", right=2)
ranked = adjusted.sort_values("revenue", ascending=False, na_position="last")
report = ranked.select_columns(["region", "revenue"]).rename_columns({"revenue": "sales"})
```

All four methods accept a display `label`. Calculations add a new column using
numeric, non-boolean operands and one of `add`, `subtract`, `multiply`, or `divide`.
Duration constants and arbitrary callback expressions are rejected. References
record same-row operands in left/right order; constants are stored in the operation.
Pandas determines missing values, dtype promotion, division, and overflow behavior.

Sorting is stable. Multiple keys accept a matching list or tuple of boolean
`ascending` settings. Column selection requires unique existing names; renaming
requires an existing-name mapping and unique, nonempty output names. These operations
retain positional provenance even when the DataFrame index contains duplicates.
Selecting fewer columns does not remove those columns from ancestor tables in HTML.

### filter_rows

```python
selected = frame.filter_rows(lambda df: df["paid"], label="Keep paid orders")
```

The predicate is evaluated once on a copy. Changes to its cells, axes, dtypes, or
duplicate-label policy are rejected. The `attrs` dictionary is copied but is not
checked for mutation; it is outside the displayed data and provenance contract.
A boolean Series, boolean sequence, or boolean array may also be passed directly.
Series indices must equal the table index in the same order; other masks use row
positions. A nullable boolean mask treats missing entries as false, like pandas.
Integers or strings are not coerced into booleans.
Scalar booleans, dictionaries, and unordered sets are rejected. Missing mask values
require a nullable boolean dtype. Input comparison is exact, including small
floating-point changes. Cell type and representation are compared too, so signed
zero, Decimal scale, and datetime fold changes cannot hide behind numeric equality.

This tracks retained rows. It does not infer every input cell accessed inside an
arbitrary predicate. External side effects of a user callback are the caller's
responsibility.

### merge

```python
joined = left.merge(
    right,
    on="product",
    how="left",
    validate="many_to_one",
    suffixes=("_x", "_y"),
    label="Attach categories",
)
```

Both frames must belong to the same story. `on` is one column or a sequence of
columns present on both sides. `how` is `left` or `inner`. `validate` accepts
`many_to_one`/`m:1` or `one_to_one`/`1:1`. `suffixes` contains two strings.

Pandas computes the result, including dtypes, index behavior, missing keys, and
validation errors. A separate key-only merge carries private positional markers
for correspondence. Markers never enter the returned DataFrame.

The left side supplies output key-cell lineage; the right key is matching context,
not another copy of the output value. A right-hand output cell with no match has
no source value inputs. Pandas matches null keys with null keys; this is not SQL's
usual null-join behavior.

### group_sum

```python
total = frame.group_sum(
    by="category", value="amount", dropna=False, min_count=1, sort=False, label="Total by category"
)
```

`by` is one column or a sequence. `value` is a distinct numeric, non-boolean column.
`dropna` is required: true excludes missing group keys, false retains them.
`observed=True` is always used for categorical grouping. `min_count` is a
nonnegative integer no greater than `2**53 - 1`, so the player can show the setting
exactly. All-missing groups remain missing with the default `min_count=1`.

The grouping scene presents member rows; the summing scene presents the computed
result. Summed cells trace non-missing numeric value inputs. Group-key cells trace
their input key cells. These are value inputs, not a proof of every possible causal
dependency of a calculation.

The inspector explains results with too few non-missing inputs and the zero returned
from empty value inputs with `min_count=0`. For integer sums it can compare recorded
inputs using exact integer addition and flag a possible dtype overflow. These
focused diagnostics preserve the recorded pandas value and are not a general
verification of arbitrary calculations.

For text cells, the player distinguishes empty strings and whitespace-only strings
with a small label. These values use JSON-style quoting in the table and inspector,
so tabs and newlines are visible. The displayed type description distinguishes an
empty string from a string containing literal quote marks. Exported cell values,
`to_pandas()`, and `CellOrigin.value` retain the original text.

### to_pandas and explain

```python
df_copy = frame.to_pandas()
origins = frame.explain(0, "amount", max_sources=10_000)
```

`to_pandas()` returns a copy. `explain` takes a zero-based output row position, not
an index label. Each immutable `CellOrigin` has `source`, `step_id`, `row`, `column`,
and `value`. The player's visible row numbers start at one.

Repeated use of a source cell is preserved in the tuple. Empty lineage does not
guess a match from equal values. Reachable cells are counted once before repeated
source uses are expanded. Computed values with no raw inputs, such as an all-missing
sum with `min_count=0`, do not consume `max_sources`. A count above that limit raises
`CaptureLimitError` before building the origin list. The browser shows up to 50 origin buttons
per page, with controls to visit every recorded origin. Inspecting an origin reveals
and focuses its source cell. Right-hand join inputs can be opened in full; an
intermediate right input is identified as an input rather than as an original source.
Duplicate source names receive distinct display labels without changing source IDs.
`StoryFrame.step_id` is read-only. Constructing a handle for an unknown step fails
immediately. The player can clear its current selection, and uses a lookup set for
highlights while keeping repeated origins in the displayed provenance list.

### explain_page

```python
page = frame.explain_page(0, "sales", offset=0, limit=50)
page.origins  # tuple[CellOrigin, ...]
page.total  # exact number of source uses, including repetitions
page.offset  # zero-based offset in that ordered list
page.has_next
```

This returns an immutable `OriginPage`. Offsets are nonnegative integers, and page
sizes are from 1 through 10,000. Past-end offsets return an empty tuple. Subtrees
before the requested slice are skipped by their counts, without expanding all their
source uses. The browser uses the same approach for 50-input pages and direct jumps,
with exact BigInt counts. Its inspector no longer requires building the complete
list under `explain()`'s default 10,000-input limit.

## Errors

`FrameChoreoError` derives from `ValueError`. `CaptureLimitError` and
`UnsupportedDataError` specialize it. Invalid options use `ValueError`, invalid
row positions use `IndexError`, and missing columns in `explain` use `KeyError`.
Pandas operation exceptions, such as `pandas.errors.MergeError`, retain their type.
Failed operations do not append a partial step.
