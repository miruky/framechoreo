# Design and correctness boundaries

FrameChoreo has four layers: pandas calculations, recorded correspondence, a
JSON display model, and a bundled player. It is an explicit wrapper with a documented
operation surface. It does not monkey-patch pandas or execute user code in the
browser.

## Snapshots and identity

Each source and transformation is assigned a step ID. A row is identified by its
step and positional row number, independently of pandas index labels. Data is
copied on capture and on `to_pandas()`. Scalar-only capture makes the snapshot
boundary tractable; nested mutable objects are rejected. Axis buffers and
categorical dictionaries are copied explicitly because a pandas deep copy can
still share those buffers. Predicate mutation checks compare exact values.

Filter lineage comes from the accepted boolean mask. Merge lineage comes from
a key-only pandas merge with positional markers. The public result comes from a
separate ordinary pandas merge, preserving its column metadata. Group membership
comes from the native GroupBy object and its group numbers.

For a sum, value-input references omit missing numeric inputs. Row membership,
grouping keys, and minimum-count settings are retained separately. Repeated
references are intentional: adding an aggregate twice must show its inputs twice.
Tracing first computes capped source counts over the reachable cell graph. Shared
cells are counted once for this pass, while each reference contributes its count.
Only branches with raw inputs are then expanded, preserving order and multiplicity.
This avoids enumerating repeated empty branches created by `min_count=0` sums.

## Presentation

Annotations, pauses, and column highlights are separate from calculations. The
main timeline follows the primary input of each transformation. Secondary merge
inputs remain available for inspection. A grouped sum has two scenes so the
group membership can be read before the values collapse into a result.

The player moves recorded rows with DOM animations. It respects reduced-motion
preferences, does not autoplay on load, and stops at the last scene. Playback never
reruns pandas. Pausing keeps both row motion and remaining scene time; changing
speed preserves progress. Visible row limits are disclosed and do not change
calculations. Origin pages and a full right-input view keep recorded data reachable.
Selecting a cell focuses and reveals the origins section. A separate return location
keeps the selected scene, row expansion, and hold time, even when tracing fails or
the reader visits another source table. The player's motion preference is separate
from the system's preference, so system changes do not erase the reader's choice.

Empty and whitespace-only strings are quoted and labeled by the renderer. This does
not alter their encoded values or collapse them into missing values.

## Serialization

Numbers have typed display encodings. In particular, integers use decimal strings
so values above JavaScript's safe-integer range do not change in the browser.
Date/time values use ISO representations, and column dtypes are recorded. This is
a display format, not a general-purpose pandas round-trip serializer.
Column-array scalar reads retain the native formatting of float16/float32 values;
tuple iteration could otherwise box them as Python floats and alter their text.
The selected column dtype is visible alongside the cell's display type.

Capture rejects invalid Unicode before serialization. JSON encoding stops at the
configured byte limit instead of first constructing an arbitrarily large string.
Encoding writes rows incrementally rather than constructing the entire display
dictionary first. Scalar mutation signatures retain exact values in compact tuples,
and their comparison streams the second pass. Group membership is collected once,
rather than scanning every input for each output group.
The player checks step identities, ancestry, cell references, and group membership
before rendering. These structural checks do not independently recompute pandas.

Only ancestors of the selected result are exported. All their captured rows travel
with the file, including filtered rows and columns removed by selection. The producer
must prepare data for sharing. Larger HTML payloads can be gzip/base64 encoded; the
browser parses them locally and releases the redundant serialized text. No record
is removed by compression.

The analysis profile adds a cumulative cell budget. Large table views use 100-row
pages; source-use lists use 50-input pages and counted subtree skipping. The player
validates and indexes a story at load and reuses that index for inspection. Source
highlighting uses reachable cells without expanding every repeated source use.

JSON is a versioned display model; it is not a general pandas round-trip format.
Self-contained HTML includes the matching player and is the primary sharing format. No external font, CDN, telemetry, API
key, server, or third-party rendering service is used.

## Deliberate boundaries

The library does not promise arbitrary code tracing, a semantic explanation of
user callbacks, many-to-many joins, streaming or disk-backed capture, unbounded datasets,
SQL semantics, or mathematical behavior different from pandas. Unsupported
operations remain unsupported instead of producing guessed provenance.

The implementation is independent. Related work includes Pandas Tutor,
Datamations, and ipyvizzu; their existence is acknowledged in the README.

## Workflow and reader layers in the 1.0 candidate

Cleaning selections retain positional identities. Conversions retain their original
value inputs. Constant fills record the constant and its missing positions without
inventing a raw value reference. Concatenation retains each input's identity, including
repeated use and fields absent from an input. Melt labels come from the schema;
pivot checks unique key pairs and maps each value position independently of index labels.
Named metrics compute separate pandas reductions and keep separate candidate references.
Reserved output names such as `func` do not become arguments to pandas `agg`.

Profiles are pandas-native summaries, generated from immutable snapshots. The browser
checks profile shape and missing counts. Uniqueness and duplicate statistics follow
pandas, not approximate comparisons of display strings.

`workbench.js` owns reader-only view state: search, visible fields, comparison,
quality, and charts. The player retains calculation and lineage state. Returning from
an origin restores the reader view as well as the recorded selection. Plot lengths
are approximate, while value text and provenance are authoritative recordings. No
recorded DataFrame is recomputed or edited in the browser.

Movement uses recorded immediate cell references, measured visible endpoints, and
a bounded number of tokens. Reshape labels and absent combinations do not create
fake source cells. Group identity follows recorded row ancestry through sorting and
other row-preserving operations. View changes settle movement rather than reuse stale
coordinates. These are explanatory animations, not a simulation of pandas internals.
