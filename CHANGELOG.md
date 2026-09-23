# Changelog

## 1.0.0rc2 — Unpublished candidate

- Add explicit conditional choices, comparison-based filtering, and first-present fallback columns with value and decision inputs kept separate.
- Add per-input-row true/false/missing decisions and a browser audit that links excluded rows to their recorded inputs.
- Add grouped lag, difference, cumulative sum/min/max, and fixed rolling sum/mean/min/max using current row order and precise window-member references.
- Bound window provenance to 250,000 explicit references rather than silently sampling a large cumulative explanation.
- Add a complete weekly decision/window example, malformed-payload checks, randomized pandas comparisons, and browser inspector tests.

## 1.0.0rc1 — Unpublished candidate

- Add missing-value handling, deduplication, explicit row selection, dtype and numeric/date conversion, and string normalization.
- Add vertical concatenation, melt/pivot reshaping, and named multi-metric grouping with seven reducers.
- Extend validated joins to right/outer and one-to-many relationships, with separate left/right keys.
- Add native quality profiles and reader views for searching, visible columns, before/after comparison, quality inspection, and charts.
- Add Japanese controls, descriptions, chapter navigation, branch/table inspection, and a value-input step list.
- Preserve group colors through sorting and move recorded reshape/arithmetic inputs into their destinations.
- Add complete retail and reshape workflows, property tests, malformed-payload checks, and an embedded player-only MIT notice.

## 0.1.0 — Local development history

- Animate recorded join inputs from compact source cards and non-missing aggregate values into their actual destination cells.
- Add group numbers and tinted rows, distinguish selected values from source highlights, and provide replay with shared pause/speed controls.
- Keep motion bounded to fully visible cells and settle it on scrolling, resizing, inspection, or layout changes; make operation code expandable.
- Add a Japanese motion showcase and regression checks for geometry, clipping, repeated inputs, missing values, and playback cleanup.
- Add `group_mean` and `group_count`, consistent with `group_sum`'s membership and value-input tracing; `group_count` reports non-missing entries per group, not the row count.
- Add an opt-in analysis profile with larger row budgets and a cumulative cell limit.
- Record row-wise numeric calculations, stable sorting, column selection, and renaming.
- Add exact, bounded provenance pages and direct row/input navigation for larger stories.
- Bound large table rendering to 100 rows per page and keep expanded tables in a scrolling stage.
- Stream JSON rows, compact mutation signatures, and collect grouping members in one pass.
- Add portable gzip HTML with local browser decoding and an uncompressed fallback option.
- Add a complete 50,000-order analysis example and cross-language paging verification.

- Reveal and focus value origins, with a return control that restores the selected scene, row view, and playback hold.
- Preserve the reader's reduced-motion choice across system preference changes.
- Distinguish empty/whitespace-only strings from missing values without changing recorded data.
- Add a blank-string filtering example and regression tests for inspection navigation.

- Preserve native float16/float32 text across snapshots and Python/browser provenance.
- Show the selected column dtype, with a floating-point join example.
- Count reachable source inputs before expansion, so reused computed zeros do not exhaust lineage limits.

- Preserve sub-nanosecond NumPy datetime text and reject representation-changing predicates.
- Validate live configuration, make frame identities read-only, and separate traversal budgets from capture caps.
- Bound header/decimal display text and safely represent the minimum-count setting.
- Check recorded result, types, references, and operation counts together.
- Explain missing sums and possible integer overflow; add selection clearing and aligned table columns.
- Use indexed highlighting for large provenance lists while retaining multiplicity.
- Add a runnable notebook and automated isolated-kernel verification.

- Detach index, column, and categorical buffers; reject even tiny predicate mutations.
- Correct NumPy duration and missing-value encodings, and reject invalid Unicode early.
- Require boolean overwrite flags and positional boolean masks; validate presentation options.
- Stop JSON serialization at its byte limit.
- Preserve playback position on pause, resume, and speed changes; pause row animations too.
- Page through all value origins and inspect complete right-side inputs with focus restoration.
- Distinguish missing markers and duplicate source names, and validate recorded references on load.
- Add DOM control tests, cross-language provenance checks, version-matrix checks, and automated fresh-wheel checks.

- Explicit pandas capture for row filtering, validated inner/left joins, and grouped sums.
- Detached snapshots and positional row identity, including duplicate DataFrame indices.
- Value-input tracing with repeated-source preservation and bounded traversal.
- Author notes, playback hold times, and highlighted columns.
- Self-contained HTML with animations, step navigation, source inspection, and reduced-motion support.
- Sandbox-based notebook representation, typed value display, and guarded file export.
- Synthetic examples, Python and player-model tests, and source/wheel packaging.
