# Validation scope for 1.0.0rc1

This is an unpublished local candidate checked on macOS on 2026-09-22. It is not a
claim of universal pandas coverage, cross-browser certification, or demonstrated
teaching effectiveness. [The 1.0 guide](v1.md) defines the intended surface.

## Python and pandas

The complete **196-test Python suite** passed in all five local environments:

| Python | pandas | NumPy |
|---|---|---|
| 3.11.15 | 2.2.3 | 1.26.4 |
| 3.12.13 | 3.0.6 | 2.5.3 |
| 3.13.14 | 2.2.3 | 2.5.3 |
| 3.13.14 | 3.0.6 | 2.5.3 |
| 3.14.6 | 3.0.6 | 2.5.3 |

The existing precision, snapshot isolation, callback mutation, budget, atomic-file,
compression, and lineage tests remain. New cases compare cleaning, conversions,
concatenation, reshaping, extended joins, named reductions, and quality profiles
against pandas and independent positional input expectations.

Two new property tests each exercise up to 80 generated cases for named metrics
and melt/pivot round trips. Boundaries include empty and all-missing tables,
duplicate indices, right-only join rows, missing schema fields, repeated frames,
nullable types, UTC conversion, reserved/prototype-like field names, rejected
arguments, and expansion beyond capture limits. The reserved-name regression
confirmed that a metric named `func` must not become a pandas method argument.

## Browser model and controls

The JavaScript suite uses Node.js 25.9.0, jsdom, synthetic geometry, and a controlled
clock. It checks the actual player controls, legacy stories, all four reader views,
search, column visibility, comparison selection, origin return, table catalogs,
Japanese labels, signed/unsafe chart values, group identity, malformed metadata,
and recorded movement for joins, named metrics, melt, pivot, and arithmetic.
Synthetic rectangles test correspondence; they do not measure browser CSS layout.

The Python/JavaScript wire check compares **803 cells** and a page near the end of
10^18 logical repeated source uses. This is a small repeated-reference graph, not
10^18 physical rows. The checks include the new operations, schema gaps, reserved
metric names, and repeated inputs. No tests are skipped to accommodate a result.

## Interactive checks

The retail and reshape examples independently compute expected DataFrames with
pandas and assert full equality. Retail produces Books revenue 2700; reshape
produces North growth 70 from 150 + 220 − 100 − 200.

The in-app Chromium browser is used to inspect the real player, including Japanese
chapter navigation, comparison, quality, chart selection, raw input inspection,
search, visible fields, and returning to the chosen view. At 390×844, the retail
page stayed within 390 pixels; searching `bad` after choosing the quantity column
showed two of five input rows. Selecting Books revenue 2700 from its chart reached
raw values 1, 900, 2, 900 and restored focus to the bar on return.

The notebook check executes the shipped notebook in an isolated kernel, inspects
its rich-output markup, and shuts the kernel down. The sandboxed player can also be
checked separately in a browser. A kernel check alone does not verify every notebook
frontend or screen reader.

## Distribution and scope

Release checks build the wheel from the sdist, check both package metadata files,
compare archive contents with the source, and install outside the checkout in a new
virtual environment. The installed smoke test blocks runtime socket connections
and exercises the README example, a 1,000-row analysis, and cleaning through named
aggregation, melt, and pivot. The player assets and player-only MIT notice must be
present in the installed package and HTML output.

The repository configures Linux/macOS/Windows CI. That remote matrix has **not**
been run while publication is on hold. Actual GUI checks here cover Chromium;
Safari, Firefox, and accessibility certification remain outside the evidence.
The implementation retains snapshots in memory and has finite capture/display
limits; these checks do not establish suitability for arbitrary or unbounded data.

Earlier 0.1 measurements and frontend checks are retained in
[the historical validation record](validation-0.1.md). In particular, its memory
and timing measurements describe the earlier revision, not a benchmark of 1.0.0rc1.
