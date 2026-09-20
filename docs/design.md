# Design and correctness boundaries

FrameChoreo has four layers: pandas calculations, recorded correspondence, a
JSON display model, and a bundled player. It is an explicit wrapper with a small
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
The player checks step identities, ancestry, cell references, and group membership
before rendering. These structural checks do not independently recompute pandas.

Only ancestors of the selected result are exported. All their captured rows travel
with the file, including filtered rows. The producer must prepare data for sharing.

The JSON schema is experimental in 0.x. Self-contained HTML includes the matching
player and is the primary sharing format. No external font, CDN, telemetry, API
key, server, or third-party rendering service is used.

## Deliberate boundaries

The library does not promise arbitrary code tracing, a semantic explanation of
user callbacks, many-to-many joins, streaming capture, large-dataset visualization,
SQL semantics, or mathematical behavior different from pandas. Unsupported
operations remain unsupported instead of producing guessed provenance.

The implementation is independent. Related work includes Pandas Tutor,
Datamations, and ipyvizzu; their existence is acknowledged in the README.
