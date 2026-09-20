# Validation scope for 0.1.0

Local checks were performed on macOS on 2026-09-20. All **57 Python tests** passed
in each environment below. The suite configures up to 240 generated examples across three
property tests, plus full DataFrame comparisons and independent source-membership
checks.

| Python | pandas | NumPy |
|---|---|---|
| 3.11.15 | 2.2.3 | 1.26.4 |
| 3.12.13 | 3.0.6 | 2.5.3 |
| 3.13.14 | 2.2.3 | 2.5.3 |
| 3.13.14 | 3.0.6 | 2.5.3 |
| 3.14.6 | 3.0.6 | 2.5.3 |

The covered behaviors include:

- Filter, join, and sum results against ordinary pandas, including dtypes and column metadata.
- Source-cell identities with duplicate indices and repeated values.
- Missing join keys, unmatched rows, duplicate right keys, empty results, and nullable sums.
- Multiple grouping keys and categorical columns, with both sorting and missing-key policies.
- Repeated use of an aggregate, retaining repeated source inputs.
- Large-integer precision in mixed numeric rows and browser serialization.
- Source-copy isolation, failed-operation atomicity, and capture limits.
- Detached axis/category buffers, exact predicate-mutation checks, and unambiguous masks.
- NumPy durations, missing-value variants, Unicode validation, and UTF-8 byte limits.
- Presentation annotations that do not change data or provenance.
- Script-boundary escaping, self-contained assets, notebook iframe markup, and file replacement guards.

All **25 JavaScript tests** passed with Node.js 25.9.0. Model tests cover scene
construction, source resolution, multiplicity, malformed references, limits,
annotation timing, and distinct labels for missing values and duplicate names.
DOM tests use jsdom and a controlled clock to exercise the actual player controls:
play/pause/resume, remaining hold time, speed changes, animation pausing, focus,
origin pagination, and complete right-input inspection. They do not measure browser
layout. The cross-language check compares source inputs from Python and JavaScript.

The generated sales story was also opened in the Codex in-app Chromium browser.
Its computed totals, source-cell inspection, play/pause, backward navigation, and
annotation timing were checked interactively. Additional synthetic stories checked
empty results, the 12-row preview and show-all controls, and HTML-like strings being
displayed as literal text. A 390-pixel viewport kept the page within its width while
the table scrolled internally. The reduced-motion control and both light and dark
themes were inspected. This is a focused functional check, not a cross-browser
certification or accessibility audit.

The follow-up inspection also reached the 60th source input through pagination,
opened all 15 rows of a filtered right-hand input, confirmed focus on a requested
source cell, distinguished a missing key from the literal string `∅`, and checked
long labels in a 390-pixel light-themed viewport.

The distribution check audits wheel/sdist contents and installs a wheel in a new
virtual environment outside the checkout. It runs the README example with runtime
connections blocked. This check is included in the release workflow, alongside
building the wheel from the sdist and validating package metadata.

The repository includes a GitHub Actions matrix for Linux, macOS, Windows, and
multiple Python versions. That remote matrix has **not** been run as part of this
local preparation. Other platforms and browser versions remain unverified here.

Tests passing does not establish teaching effectiveness, production suitability for
large datasets, or equivalence for unsupported pandas operations. The package's
documented operation and data limits are part of its supported scope.
