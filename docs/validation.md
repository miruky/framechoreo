# Validation scope for 1.0.0rc6

This is an unpublished local candidate checked on macOS on 2026-09-23. It is not a
claim of universal pandas coverage, cross-browser certification, or demonstrated
teaching effectiveness. [The 1.0 guide](v1.md) defines the intended surface.

## Python and pandas

The Python suite passed with 292 tests in each local environment below:

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
The tests compare conditional choices, first-present fallback, ten window
operations, and explicit filtering against pandas. Randomized cases cover nullable
values and group boundaries across 35 generated cases. A 1,000-row cumulative
example and a fixed rolling example retain exact late input pages through compact
membership encoding. A cross-version regression also checks the exact missing
representation produced by grouped text `shift` on pandas 2.2 and 3.0.
The rc3 cases cover unmatched inputs on both sides of inner/outer joins,
one-to-many fanout, null-key matching, row-preserving group metrics,
all-missing/empty groups, and compound three-valued conditions with range and
membership clauses. All 27 combinations of three nullable booleans are checked
against pandas. Large group broadcasts now use shared references instead of
stopping at 250,000 repeated entries.
The rc4 cases compare all three as-of directions against pandas, including
group restrictions, datetime tolerance, exact-match exclusion, a self-join,
empty inputs, duplicate right timestamps, equidistant matches, and duplicate
left index labels. Ordered cases cover priority, nullable outcomes, selected
column values, copied decision reports, invalid
requests, default column values, and an empty table. Rank tests compare all five
tie policies in both sort directions with missing values and duplicate indices;
missing grouping keys are also checked against pandas. Rejected options must
leave the story unchanged. Global rank is also exercised. A regression
uses `datetime.timedelta` to keep pandas 2.2 with current NumPy warning-clean.
The rc5 cases compare grouped `pct_change` with missing values and a zero
denominator, fixed-width resampling with empty bins, right-closed UTC bins,
invalid time spans, and positional inputs. Large group metrics and ranks now
retain exact late source pages after switching to shared references.
The rc6 cases check capture-time source allowlists, exact reviewed-export
approvals, pandas-style grouped authoring, compact cumulative prefixes and
rolling ranges, and missing-window controls. Mypy checks the typed source.

## Browser model and controls

The JavaScript suite passed 167 tests with Node.js 26.9.0, jsdom, synthetic geometry, and a controlled
clock. It checks the actual player controls, legacy stories, all four reader views,
search, column visibility, comparison selection, origin return, table catalogs,
Japanese labels, signed/unsafe chart values, group identity, malformed metadata,
and recorded movement for joins, named metrics, melt, pivot, and arithmetic.
It also checks decision inputs separately from value inputs, malformed
conditional/window/coalesce references, the excluded-row audit, and source-row
navigation, join audit links, group-colored repeated metrics, and nested
condition-tree validation. Atomic comparison outcomes are recombined into the
final decision. rc4 adds malformed branch, nearby-join and rank-reference
checks and verifies their visible inspector and audit controls. rc5 adds shared
schema validation, time-bin coverage, fractional-change inputs, and their visible
player controls. rc6 adds keyboard-reachable line/scatter points, compact
window validation, and axe-core DOM accessibility checks for initial,
inspection, chart, and time-bucket states. Color contrast is excluded from
jsdom because it lacks rendered pixels. In actual Chromium at 390 pixels wide,
the light-theme group legend, chart caption, and plot-axis labels measured
13.74:1, 5.09:1, and 5.09:1 against their backgrounds. These spot checks do
not certify every color, state, browser, or screen reader.
Synthetic rectangles test correspondence; they do not measure browser CSS layout.

The Python/JavaScript wire check passed 1,238 value cells, 3,192 control-source
uses, and four large provenance pages. It compares current value/control references,
a page near the end of 10^18 logical repeated source uses, and late
page from shared group lineage. The 10^18 case is
a small repeated-reference graph, not 10^18 physical rows. The checks include
the new operations, schema gaps, reserved metric names, and repeated inputs. No
tests are skipped to accommodate a result.
The new decision workflow contributes conditional, fallback, grouped-window,
and explicit-filter references to this cross-language comparison.
It also includes rc3 join audits (including a self-join), group transforms,
and compound condition trees. rc4 adds ordered cases, near-key matches
(including a self-join), and grouped ranks. rc5 also compares compressed group
references (including an excluded large-group row), a fractional-change window,
and empty time bins. rc6 adds compact cumulative and rolling-window pages.

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
For rc4, the in-app Chromium player showed ordered case outcomes, the selected
third-branch column value and repeated decision inputs. The as-of example showed
the selected left/right timestamp pairs, one unmatched event, one unused right
reading, one reused right reading, and a readable three-minute tolerance. A
selected rank showed both tied candidate scores and separate group-key inputs.
At 390×844, the ordered-case inspector and nearby-join audit each stayed within
the 390-pixel document width; wide tables scroll within their own stage.
The rc5 time-bucket page showed six colored bins, including two empty intervals;
the fractional-change inspector kept both inputs behind an infinite result.
Their 390×844 document width stayed at 390 pixels. The 50,000-row shared-group
HTML opened in Chromium, displayed its ranked result, and jumped to source-use
number 50,000. This checks interaction, not a cross-browser performance guarantee.
The rc6 Chromium check showed separate labeled North and South line series,
inspected a plotted result, and kept the document within 390 pixels while the
plot scrolled internally. The 50,000-row cumulative HTML opened, reached the
last result, paged directly to value input 50,000, and focused source row 50,000.
Safari also opened the compressed 50,000-row story and performed that last-input
navigation. A fixed rolling-range story is covered by Python, JavaScript,
cross-language, and fresh-install checks, but not a 50,000-row GUI exercise.

The notebook check executes the shipped notebook in an isolated kernel, inspects
its rich-output markup, and shuts the kernel down. The sandboxed player can also be
checked separately in a browser. A kernel check alone does not verify every notebook
frontend or screen reader.
The 50,000-row analysis example also completed, producing eight result rows and
an 11,187,317-byte self-contained HTML file. This is a smoke run, not a
performance benchmark for the newer operations.
The rc6 50,000-row cumulative example produced a 3,610,665-byte HTML file,
and the 50,000-row shared-group example produced a 4,603,551-byte file. These
are synthetic smoke runs, not repeatable timing or memory benchmarks.

## Distribution and scope

Release checks build the wheel from the sdist, check both package metadata files,
compare archive contents with the source, and install outside the checkout in a new
virtual environment. The installed smoke test blocks runtime socket connections
and exercises the README example, a 1,000-row analysis, and cleaning through named
aggregation, melt, and pivot. The player assets and player-only MIT notice must be
present in the installed package and HTML output.
The fresh-install smoke also executes conditional selection, coalescing,
cumulative windows, explicit filtering, compound outcomes, join audits, group
transforms, ordered cases, near-key joins, ranks, and their decision/value
provenance, shared group and window references, fractional change, time buckets,
and reviewed source-column approval with
runtime socket connections blocked. The checked wheel and sdist hashes are in
the local `公開準備1/distribution.json` release evidence.

The project dependency audit with pip-audit 2.10.1 reported no known
vulnerabilities in its resolved pandas, NumPy, python-dateutil, and six versions
on this date. `npm audit` reported none in the player-test dependencies. These
database checks are point-in-time findings, not a general security guarantee.

The repository configures Linux/macOS/Windows CI. That remote matrix has **not**
been run while publication is on hold. Actual GUI checks here cover selected
Chromium and Safari cases. Firefox, screen-reader use, complete color-contrast
coverage, and the independent reader study remain outside the evidence.
The implementation retains snapshots in memory and has finite capture/display
limits; these checks do not establish suitability for arbitrary or unbounded data.

Earlier 0.1 measurements and frontend checks are retained in
[the historical validation record](validation-0.1.md). In particular, its memory
and timing measurements describe the earlier revision, not a benchmark of 1.0.0rc6.
