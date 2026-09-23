# Validation scope for 1.0.0rc3

This is an unpublished local candidate checked on macOS on 2026-09-23. It is not a
claim of universal pandas coverage, cross-browser certification, or demonstrated
teaching effectiveness. [The 1.0 guide](v1.md) defines the intended surface.

## Python and pandas

The complete **244-test Python suite** passed in all five local environments:

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

Two existing property tests each exercise up to 80 generated cases for named metrics
and melt/pivot round trips. Boundaries include empty and all-missing tables,
duplicate indices, right-only join rows, missing schema fields, repeated frames,
nullable types, UTC conversion, reserved/prototype-like field names, rejected
arguments, and expansion beyond capture limits. The reserved-name regression
confirmed that a metric named `func` must not become a pandas method argument.
The new tests compare conditional choices, first-present fallback, nine window
operations, and explicit filtering against pandas. Randomized cases cover nullable
values and group boundaries across 35 generated cases. A 1,000-row cumulative
example confirms that the 250,000-reference guard fails without appending a
partial step. A cross-version regression also checks the exact missing
representation produced by grouped
text `shift` on pandas 2.2 and 3.0.
The rc3 cases cover unmatched inputs on both sides of inner/outer joins,
one-to-many fanout, null-key matching, row-preserving group metrics,
all-missing/empty groups, and compound three-valued conditions with range and
membership clauses. All 27 combinations of three nullable booleans are checked
against pandas. Group broadcasts fail clearly before 250,000 explicit
references, with no partial step appended.

## Browser model and controls

The JavaScript suite uses Node.js 26.9.0, jsdom, synthetic geometry, and a controlled
clock. It checks the actual player controls, legacy stories, all four reader views,
search, column visibility, comparison selection, origin return, table catalogs,
Japanese labels, signed/unsafe chart values, group identity, malformed metadata,
and recorded movement for joins, named metrics, melt, pivot, and arithmetic.
It also checks decision inputs separately from value inputs, malformed
conditional/window/coalesce references, the excluded-row audit, and source-row
navigation, join audit links, group-colored repeated metrics, and nested
condition-tree validation. Atomic comparison outcomes are recombined into the
final decision. **143 JavaScript tests** passed.
Synthetic rectangles test correspondence; they do not measure browser CSS layout.

The Python/JavaScript wire check compares **1,100 value cells, 138 control-source
uses**, and a page near the end of 10^18 logical repeated source uses. This is
a small repeated-reference graph, not 10^18 physical rows. The checks include
the new operations, schema gaps, reserved metric names, and repeated inputs. No
tests are skipped to accommodate a result.
The new decision workflow contributes conditional, fallback, grouped-window,
and explicit-filter references to this cross-language comparison.
It also includes rc3 join audits (including a self-join), group transforms,
and compound condition trees.

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
For the new weekly example, selecting a constant `Review` result showed no raw
value input and two separate comparison inputs; the filter audit distinguished
one false comparison from one missing comparison. At 390×844 the document width
remained 390 pixels, and selecting the excluded missing row focused its original
sales cell. This checks the actual HTML and browser layout, beyond jsdom geometry.
The new join example visibly separated one unmatched row on each side, a
one-to-many expansion, two repeated right keys, and one null-key match. The
group-transform example showed the repeated metric with matching group colors
and value movement. The compound-condition audit displayed all three checked
fields of each excluded row and the AND/OR/NOT truth-value formula. At 390×844,
both the join and compound examples
stayed within a 390-pixel document width.

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
The rc3 fresh-install smoke also executes conditional selection, coalescing,
cumulative windows, explicit filtering, compound outcomes, join audits, group
transforms, and their decision/value provenance with
runtime socket connections blocked. The checked wheel and sdist hashes are in
the local `V1拡張3/distribution.json` release evidence.

The repository configures Linux/macOS/Windows CI. That remote matrix has **not**
been run while publication is on hold. Actual GUI checks here cover Chromium;
Safari, Firefox, and accessibility certification remain outside the evidence.
The implementation retains snapshots in memory and has finite capture/display
limits; these checks do not establish suitability for arbitrary or unbounded data.

Earlier 0.1 measurements and frontend checks are retained in
[the historical validation record](validation-0.1.md). In particular, its memory
and timing measurements describe the earlier revision, not a benchmark of 1.0.0rc3.
