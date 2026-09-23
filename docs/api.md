# API reference

## DataStory

```python
DataStory(title="A data story", *, max_rows=200, max_columns=12,
          max_steps=20, max_export_bytes=2_000_000, max_cells=None,
          language="en", description="")
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
story.annotate(
    frame, note="Follow the amount column", hold=4, highlight=["amount"], chapter="Explain"
)
```

Replaces the presentation settings for that step. `note` is at most 600 characters;
`hold` is a finite number of seconds from 1 through 30; `highlight` is a column name
or a sequence of column names. `chapter` is an optional label of at most 100 characters. Neither data nor lineage is recalculated. A grouped
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

### Explicit and compound decisions

```python
from framechoreo import col, where

status = frame.case_when(
    "status",
    column="sales",
    op="ge",
    value=col("target"),
    then="Met target",
    otherwise="Review",
)
selected = status.filter_by("sales", op="ge", value=col("target"))
effective = frame.coalesce("effective", ["sales", "forecast_sales"], default=0)
rule = (where("sales", "ge", col("target")) & where("region", "in", ["North", "South"])) | ~where(
    "priority", "eq", False
)
selected = frame.filter_by(rule)
labelled = frame.case_when("route", condition=rule, then="Fast lane", otherwise="Review")
```

`case_when` adds a column by testing one existing `column`. `filter_by` retains
only rows for which that explicit comparison is true. Supported operators are
`eq`, `ne`, `lt`, `le`, `gt`, `ge`, `is_missing`, and `is_not_missing`. The two
missingness operators require `value=None`; comparisons require a non-missing
literal or `col("other_field")`. Strings are **literal values** unless wrapped
in `col()`. `case_when` accepts literals or `col()` for `then` and `otherwise`,
including a missing literal such as `None`. A comparison yielding pandas missing
is recorded as `missing`; it selects `otherwise` in `case_when` and excludes the
row in `filter_by`. This follows nullable-boolean filtering while preserving
the reason. For an arbitrary callable or mask, use `filter_rows`; callback
dependencies are not guessed.

`where(column, op, value)` creates an immutable `Condition`. Combine conditions
with `&` (all), `|` (any), and `~` (not); Python's `and`/`or` are rejected to
prevent accidental truth testing. `filter_by(rule)` and
`case_when(..., condition=rule)` accept the tree while the original single-column
forms remain available. Clauses are evaluated as pandas nullable booleans, with
its three-valued AND/OR/NOT results. **All clauses are evaluated**; there is no
short-circuiting, so each recorded condition cell really was read. A tree has
at most 32 comparisons and depth 8. `in` accepts an ordered sequence of at most
1,000 scalar candidates, including an empty sequence. `between` accepts two
inclusive bounds; each can be a literal or `col("bound_field")`. pandas determines
whether a missing membership or range comparison becomes false or missing.
For trees built with `where`, each atomic comparison outcome is recorded. The
browser shows those checks separately from the combined result and verifies
that applying AND/OR/NOT to them yields the recorded final outcome. The
inspector also shows the truth-value formula, so a `NOT` clause's effect is
visible without treating an atomic check as the final decision.

The chosen branch's cell is a **value input**; comparison cells are **control
inputs**. A literal branch has no invented source value. `filter_by` records a
`true`/`false`/`missing` outcome for every input row, including removed rows.
Use `filtered.filter_decision(input_row)` with the original zero-based row
position to inspect the decision in Python. The player lists excluded rows,
distinguishes false and missing comparisons, and links back to the input row.
`filtered.condition_breakdown(input_row)` (also available on a `case_when`
result) returns detached `{"column", "op", "outcome"}` entries for atomic
comparisons before enclosing NOT/AND/OR operators. The final result remains
available through `filter_decision` or the recorded `case_when` outcome.
For a compound rule, the audit shows the first three checked fields of each
excluded row and the complete field count. The inspector retains repeated
control uses when the same field appears in multiple clauses.

### Ordered cases

```python
route = frame.case_select(
    "route",
    cases=[
        (where("score", "ge", 80), "High score"),
        (where("vip", "eq", True), "VIP"),
        (where("score", "lt", 40), col("fallback_route")),
    ],
    otherwise="Standard review",
)
route.case_decision(0)  # selected_case and every case's outcome
```

`cases` is an ordered sequence of 1–16 `(Condition, replacement)` pairs. All
conditions are evaluated, and the first **true** case supplies the value. A
false or missing case continues to the next one. If none is true, `otherwise`
is used; it defaults to a missing literal. Strings are literals, and `col()`
marks a source column. `case_decision(row)` returns a detached zero-based
selected case index (or `None`) and the ordered true/false/missing outcomes.
Atomic clause outcomes are also recorded. Across all cases there can be at
most 32 comparisons, with each condition tree at most depth 8. This explicit
missing policy is FrameChoreo's contract; do not infer it from pandas
`Series.case_when`'s handling of nullable masks.

Only the selected column replacement becomes a value input. Every case's
compared fields become decision inputs, including later cases that were still
evaluated after an earlier true case. Repeated checks retain repeated input
uses. The player identifies the selected branch and shows each case in priority
order alongside the source value.

`coalesce` checks named columns from left to right, choosing the first non-missing
cell. Tested cells are control inputs; only the chosen cell is a value input.
When all candidates are missing, it uses the explicit scalar `default` (missing
by default) with no source value input. This method adds a field; it does not
overwrite or erase the original fields. Pandas determines the new field's dtype.

### window

```python
ordered = frame.sort_values(["account", "week"])
previous = ordered.window("previous", column="sales", op="lag", by="account")
change = previous.window("change", column="sales", op="diff", by="account")
running = change.window("running", column="sales", op="cumsum", by="account")
average = running.window(
    "recent",
    column="sales",
    op="rolling_mean",
    by="account",
    size=3,
    min_periods=1,
)
```

`op` is `lag`, `diff`, `cumsum`, `cummin`, `cummax`, `rolling_sum`,
`rolling_mean`, `rolling_min`, or `rolling_max`. `by` is optional
and partitions rows by one or more keys, including missing keys. The current
row order is the calculation order; this method does not sort dates. `periods`
is a positive row offset for `lag`/`diff`; `size` is a positive number of rows
for the four rolling operations. Fixed rolling windows default to
`min_periods=size`; an explicit value from zero through `size` is accepted.
`lag` accepts any supported scalar column. Other operations require a numeric,
non-boolean column. Actual results and dtype follow pandas' corresponding
operations. `diff` records both arithmetic operands; cumulative and rolling
metrics record their non-missing candidate values, including those considered
for a minimum or maximum. Group-key and missing-window decisions are kept
separately. Cumulative results at a missing current row have no value input
and retain that missing cell as a control input.

Explicit window provenance is limited to 250,000 value plus control references
per operation. A larger expansion raises `CaptureLimitError` before adding a
step. This is separate from row/cell/JSON capture budgets; a long cumulative
sequence can hit it even when its input table fits the analysis profile.

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
columns present on both sides. `how` is `left`, `inner`, `right`, or `outer`. `validate` accepts
`many_to_one`/`m:1`, `one_to_one`/`1:1`, or `one_to_many`/`1:m`. `suffixes` contains
two strings. Use `left_on` and `right_on` instead of `on` for different key names;
the key lists must have equal length. Many-to-many and cross joins are rejected.

Pandas computes the result, including dtypes, index behavior, missing keys, and
validation errors. A separate key-only merge carries private positional markers
for correspondence. Markers never enter the returned DataFrame.

For shared keys, a matched row uses the left key as its value input. A right-only
row uses the right key. Otherwise the right key is matching context,
not another copy of the output value. A right-hand output cell with no match has
no source value inputs. Pandas matches null keys with null keys; this is not SQL's
usual null-join behavior.

`joined.join_audit()` returns a detached dictionary describing both input tables:
`left_match_counts`, `right_match_counts`, `left_unmatched`, `right_unmatched`,
`left_fanout`, `right_fanout`, `left_duplicate_keys`,
`right_duplicate_keys`, and `null_key_output_rows`. The last list uses output
row positions; the other position lists refer to their original input table.
Unmatched inputs include rows omitted by an inner join and rows retained without
a partner by an outer join. Match counts count actual paired output rows, so a
one-to-many expansion has a left count above one. The player links the first
12 rows of each nonempty audit category to the recorded input table and keeps
both complete inputs available. Older story payloads without audit metadata
remain readable; this method applies to newly recorded merge results.

### merge_asof

```python
from datetime import timedelta

nearby = events.merge_asof(
    readings,
    on="time",
    by="sensor",
    direction="backward",
    tolerance=timedelta(minutes=3),
    allow_exact_matches=False,
)
nearby.asof_audit()
```

Both frames belong to the same story and must already be sorted ascending by
the shared `on` key. `by` optionally restricts matching to equal shared group
fields; differently named ordered/group fields and index joins are outside this
method. `direction` is `backward`, `forward`, or `nearest`. The optional pandas
`tolerance` and the boolean `allow_exact_matches` control eligibility. pandas
chooses at most one right row per left row and determines the result's values,
dtypes, and tie behavior. Invalid sorting or incompatible key/tolerance types
raise instead of creating a partial step.

`asof_audit()` returns detached `matched_right_rows`, `left_unmatched`,
`right_usage_counts`, `right_unused`, and `right_reused`. The matched-right list
has one zero-based right position or `None` per left row. Right value cells trace
only the selected right input; their decision inputs show the left and selected
right ordered/group keys. For unmatched rows, only left keys can be shown as
direct comparison context; the implementation does not claim to enumerate every
eligible or rejected right candidate. The player offers links to unmatched,
unused, reused, and selected input rows. It validates positional references
but does not independently re-run pandas' nearest-key selection in JavaScript.

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

### group_mean and group_count

```python
average = frame.group_mean(by="category", value="amount", dropna=False, sort=False)
present = frame.group_count(by="category", value="amount", dropna=False, sort=False)
```

Both share `group_sum`'s `by`, `dropna`, and `sort` contract, including observed
categorical grouping and group membership coming from the keys alone, independent
of the value column's own missing entries. Neither accepts `min_count`: pandas has
no such setting for `mean` or `count`, so the recorded parameters omit that key
entirely, and the player rejects a story that adds one.

`group_mean` requires a numeric, non-boolean `value` column, matching `group_sum`.
A group with no non-missing values is missing, since `mean` skips missing values
by default and there is no minimum count to configure. `group_count` accepts a
`value` column of any supported scalar type; it reports **the number of non-missing
entries of that column per group, not the number of rows**, so a fully missing
group counts as zero rather than becoming missing.

Both trace the same non-missing value cells that `group_sum` traces for the same
inputs, so repeated use, empty lineage, and paging behave identically. The default
label is `"Group and average"` for `group_mean` and `"Group and count"` for
`group_count`.

### group_transform

```python
totals = frame.group_transform("team_total", by="team", value="amount", op="sum", dropna=False)
average = frame.group_transform("team_average", by="team", value="amount", op="mean", dropna=False)
```

This adds one field while preserving every original row and index label. `op`
is `sum`, `mean`, `min`, `max`, `count`, or `nunique`. `sum` uses `min_count=1`
unless an explicit nonnegative integer is supplied; other reducers reject a
`min_count` argument. Sum/mean/min/max require numeric, non-boolean values;
count/nunique accept any supported scalar column. `dropna` explicitly controls
whether rows with missing grouping keys receive a metric or a missing result.
`sort=False` and `observed=True` are fixed because the original row order is
preserved. Pandas computes each result and dtype.

Each repeated metric traces the group's non-missing candidate value cells.
Grouping-key cells are distinct control inputs; an excluded row has no group
value input and retains its own missing key as control. Group numbers and colors
continue through subsequent row-preserving steps. A group broadcast can multiply
the number of explicit references, so this operation raises `CaptureLimitError`
above 250,000 value/control references rather than silently sampling them.

### rank_within

```python
ranked = frame.rank_within("team_rank", value="score", by="team", method="dense", ascending=False)
```

`by` is optional; omitting it ranks the whole table. Numeric non-boolean values
are required. The five tie methods are `average`, `min`, `max`, `dense`, and
`first`; `dense` and descending order are this wrapper's defaults. pandas
computes the rank and dtype with missing values kept unranked. Every
non-missing candidate in the row's group is a value input, including tied
values; group-key cells are separate decision inputs. A missing current value
has no rank value input and retains that source value as decision context.
Group numbers and colors survive subsequent sorting. Explicit provenance is
bounded at 250,000 references for this operation.

For text cells, the player distinguishes empty strings and whitespace-only strings
with a small label. These values use JSON-style quoting in the table and inspector,
so tabs and newlines are visible. The displayed type description distinguishes an
empty string from a string containing literal quote marks. Exported cell values,
`to_pandas()`, and `CellOrigin.value` retain the original text.

### to_pandas and explain

```python
df_copy = frame.to_pandas()
origins = frame.explain(0, "amount", max_sources=10_000)
decisions = frame.explain_controls(0, "amount", max_sources=10_000)
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
`explain_controls` returns the current step's deciding source-cell uses separately
from `explain`'s value inputs. It applies to `case_when`, `case_select`,
`filter_by`, `coalesce`, `window`, `group_transform`, `merge_asof` right values,
and `rank_within`. Other steps return an
empty tuple; in particular, it does not infer dependencies inside an arbitrary
`filter_rows` callback. The browser lists at most 24 immediate decision inputs
in one view, with their input table and row. Python can return all raw control
sources subject to `max_sources`.

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

## Workflow operations (1.0 candidate)

`language` is `en` or `ja`; `description` is plain text of at most 2,000 characters.
They can be reassigned with validation. Neither translates authored data or changes results.

### Quality profile

`frame.profile()` returns a fresh dictionary with `rows`, `column_count`,
`missing_cells`, `duplicate_rows`, and `columns`. Each column entry contains
`name`, `dtype`, `missing`, and `unique`. Unique counts use pandas `nunique(dropna=True)`;
duplicate rows use `duplicated()` across all columns, excluding the index.
Profiles describe recorded tables, independently of a reader's search or hidden columns.

### Cleaning and conversion

```python
frame.drop_missing(subset=None, how="any", label="Remove missing rows")
frame.fill_missing({"units": 0}, label="Fill missing values")
frame.drop_duplicates(subset=None, keep="first", label="Remove duplicate rows")
frame.take_rows([2, 0, 2], label="Choose rows")
frame.astype({"units": "Int64"}, label="Change column types")
frame.to_numeric(["units", "price"], errors="coerce", label="Parse numeric values")
frame.to_datetime("date", format="%Y-%m-%d", errors="raise", utc=False)
frame.string_transform("product", op="strip", label="Normalize text")
```

- `drop_missing`: `subset=None` means all fields; `how` is `any` or `all`. It keeps
  native pandas index and dtype behavior while recording retained row positions.
- `fill_missing`: a nonempty mapping from existing fields to supported, non-missing
  scalar constants. Pandas dtype compatibility still applies. Filled cells have no
  raw value input; the constant and filled positions are recorded. The preceding
  missing cell remains available as context in the input table.
- `drop_duplicates`: `subset=None` compares all fields. `keep` is `first`, `last`,
  or the actual boolean `False`. Index labels are not compared.
- `take_rows`: an ordered sequence of nonnegative positions, allowing repeated rows.
  Booleans and out-of-range positions are rejected. Native duplicate-label rules apply.
- `astype`: a nonempty mapping to pandas dtype strings; conversion errors raise.
- `to_numeric` / `to_datetime`: one field or an ordered list, with `errors` equal to
  `raise` or `coerce`. Dates require a nonempty format. `utc` is an actual boolean.
  Coerced missing results still trace to the original input, such as invalid text.
- `string_transform`: `strip`, `lower`, `upper`, or `casefold`, for string-or-missing
  fields. Mixed non-string inputs are rejected. An entirely missing field stays missing.

Conversions retain references to the old field. These are recorded operation inputs,
not an inference of arbitrary Python dependencies. Failed requests do not append a step.

### Vertical combination

```python
combined = story.concat([january, february], join="outer", ignore_index=True)
```

Inputs must belong to the same story and the sequence must not be empty. `join` is
`outer` (union of columns in first-seen order) or `inner` (shared columns in the first
input's order). At least one output field is required. `ignore_index=False` retains
native indices; provenance always uses positions. Reusing the same frame retains
repeated uses. A field absent from an input has no source value reference.

### Long and wide tables

```python
long = frame.melt(
    id_vars=["store"], value_vars=["Jan", "Feb"], var_name="month", value_name="sales"
)
wide = long.pivot(index="store", columns="month", values="sales")
```

`melt` requires explicit, disjoint identifier/value fields. An empty `id_vars` list
is allowed. Output names must be distinct; `value_name` must not already exist.
The result uses `ignore_index=True`. Value cells point to the original column and
row. The variable label comes from the column name and has no raw data-cell input.

`pivot` does not aggregate. Duplicate index/column pairs raise a pandas error.
The index, column-label field, and value field must be distinct. Generated labels
must be nonempty strings and cannot collide with index names. Multi-field indices
are supported. Absent combinations have no input cell; an explicitly recorded
missing value keeps its actual input reference. Numeric pivot labels, multiple
value fields, and MultiIndex output columns are not supported.

### Named aggregation

```python
summary = frame.group_agg(
    by="region",
    dropna=False,
    sort=False,
    min_count=1,
    aggregations={
        "revenue_total": ("revenue", "sum"),
        "average": ("revenue", "mean"),
        "orders": ("order_id", "count"),
        "products": ("item", "nunique"),
    },
)
```

Each output name maps to `(input_column, reducer)`; lists of two strings also work.
Result names are unique and outside the grouping keys; input fields must also be
outside the keys. Reducers are `sum`, `mean`, `min`, `max`, `median`, `count`, and
`nunique`. Sum/mean/median require numeric, non-boolean dtypes. Min/max follow pandas
comparability rules. Count and nunique accept all supported scalar columns.
`observed=True` is fixed. `min_count` applies to sums and uses the same range/default
as `group_sum`; missing group keys follow the required `dropna` choice.

Every metric points to its own non-missing input cells. Min/max/median record all
candidate values, not only the winning value; nunique retains duplicate candidates
as recorded uses even though it counts distinct values. Group keys retain membership
references. Constants and values introduced by missing table combinations do not
invent raw source cells. Arbitrary reducers and aggregation callbacks are unsupported.
