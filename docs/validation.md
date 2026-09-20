# Validation scope for 0.1.0

Local checks were performed on macOS with CPython 3.13.14 on 2026-09-20.
The Python suite passed with pandas **2.2.3** and **3.0.6**. The test suite includes
generated input cases and full DataFrame comparisons, rather than comparing only
printed values.

The covered behaviors include:

- Filter, join, and sum results against ordinary pandas, including dtypes and column metadata.
- Source-cell identities with duplicate indices and repeated values.
- Missing join keys, unmatched rows, duplicate right keys, empty results, and nullable sums.
- Multiple grouping keys and categorical columns, with both sorting and missing-key policies.
- Repeated use of an aggregate, retaining repeated source inputs.
- Large-integer precision in mixed numeric rows and browser serialization.
- Source-copy isolation, failed-operation atomicity, and capture limits.
- Presentation annotations that do not change data or provenance.
- Script-boundary escaping, self-contained assets, notebook iframe markup, and file replacement guards.

Player-model tests cover scene construction, source resolution, multiplicity,
unknown lineage, limits, result-annotation timing, and data-only treatment of names. These tests use Node.js
and do not require a browser or network.

The generated sales story was also opened in the Codex in-app Chromium browser.
Its computed totals, source-cell inspection, play/pause, backward navigation, and
annotation timing were checked interactively. Additional synthetic stories checked
empty results, the 12-row preview and show-all controls, and HTML-like strings being
displayed as literal text. A 390-pixel viewport kept the page within its width while
the table scrolled internally. The reduced-motion control and both light and dark
themes were inspected. This is a focused functional check, not a cross-browser
certification or accessibility audit.

The repository includes a GitHub Actions matrix for Linux, macOS, Windows, and
multiple Python versions. That remote matrix has **not** been run as part of this
local preparation. Other platforms and browser versions remain unverified here.

Tests passing does not establish teaching effectiveness, production suitability for
large datasets, or equivalence for unsupported pandas operations. The package's
documented operation and data limits are part of its supported scope.
