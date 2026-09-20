# Changelog

## 0.1.0 — Unreleased

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
