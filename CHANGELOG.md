# Changelog

## 0.1.0 — Unreleased

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
