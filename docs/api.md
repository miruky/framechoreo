# API reference

## DataStory

```python
DataStory(title="A data story", *, max_rows=200, max_columns=12,
          max_steps=20, max_export_bytes=2_000_000)
```

Limits are positive integers. Source tables count as recorded steps. Exceeding a
limit raises `CaptureLimitError`; capture does not silently sample. A text cell is
limited to 20,000 characters. `max_export_bytes` covers UTF-8 JSON data, not bundled
player assets.

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

### Export methods

```python
story.to_dict(result=frame)
story.to_json(result=frame)
story.to_html(result=frame, theme="auto")
story.export_html("story.html", result=frame, theme="auto", overwrite=False)
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
JSON is encoded incrementally and stops once its byte limit is exceeded.

In Jupyter, `_repr_html_()` embeds the same player in a sandboxed `srcdoc` iframe.
Notebook trust and the host's iframe policy can affect rendering.

## StoryFrame

### filter_rows

```python
selected = frame.filter_rows(lambda df: df["paid"], label="Keep paid orders")
```

The predicate is evaluated once on a copy. Mutating that copy is rejected. A
boolean Series, boolean sequence, or boolean array may also be passed directly.
Series indices must equal the table index in the same order; other masks use row
positions. A nullable boolean mask treats missing entries as false, like pandas.
Integers or strings are not coerced into booleans.
Scalar booleans, dictionaries, and unordered sets are rejected. Missing mask values
require a nullable boolean dtype. Input comparison is exact, including small
floating-point changes.

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
nonnegative integer. All-missing groups remain missing with the default `min_count=1`.

The grouping scene presents member rows; the summing scene presents the computed
result. Summed cells trace non-missing numeric value inputs. Group-key cells trace
their input key cells. These are value inputs, not a proof of every possible causal
dependency of a calculation.

### to_pandas and explain

```python
df_copy = frame.to_pandas()
origins = frame.explain(0, "amount", max_sources=10_000)
```

`to_pandas()` returns a copy. `explain` takes a zero-based output row position, not
an index label. Each immutable `CellOrigin` has `source`, `step_id`, `row`, `column`,
and `value`. The player's visible row numbers start at one.

Repeated use of a source cell is preserved in the tuple. Empty lineage does not
guess a match from equal values. A bounded traversal raises `CaptureLimitError`
when there are too many source inputs. The browser shows up to 50 origin buttons
per page, with controls to visit every recorded origin. Inspecting an origin reveals
and focuses its source cell. Right-hand join inputs can be opened in full; an
intermediate right input is identified as an input rather than as an original source.
Duplicate source names receive distinct display labels without changing source IDs.

## Errors

`FrameChoreoError` derives from `ValueError`. `CaptureLimitError` and
`UnsupportedDataError` specialize it. Invalid options use `ValueError`, invalid
row positions use `IndexError`, and missing columns in `explain` use `KeyError`.
Pandas operation exceptions, such as `pandas.errors.MergeError`, retain their type.
Failed operations do not append a partial step.
