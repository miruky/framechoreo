# Reader evaluation protocol

FrameChoreo's automated tests check recorded behavior, not whether a new reader
understands an explanation. This is a ready-to-run study protocol, not a claim
that participants have been tested.

Recruit at least five people who have not built FrameChoreo: a mix of learners,
analysts, and people who teach or review analysis. Give each person the same
synthetic HTML files and a modern browser. Do not show source code or explain
the controls first. Collect no personal dataset, account, or credential.

| Task | File | Success criterion | Time limit |
|---|---|---|---:|
| Find the two raw sales values behind Books revenue | `retail-workflow.html` | Identifies both source rows and says that the result uses two values | 3 min |
| Explain why one weekly row was excluded | `decision-window.html` | Distinguishes a false comparison from a missing comparison | 3 min |
| Identify which reading was used for the second event | `asof.html` | Names the selected right row and its timestamp | 3 min |
| Explain the empty middle sensor interval | `time-buckets.html` | Identifies an empty bucket and does not invent a zero-valued reading | 3 min |
| Inspect the last input of a large rank | `large-group-50000.html` | Reaches input number 50,000 and returns to the selected result | 4 min |

For each task, record whether the answer was correct, elapsed time, any wrong
interpretation, keyboard-only completion, and one short quote about confusion.
Have an observer note where the person first looked and which control they tried.
Ask at the end whether they thought hidden or filtered-out rows were absent from
the file; this is a critical data-sharing misunderstanding.

Before claiming a stable 1.0 reader experience, aim for at least four of five
participants completing each of the first four tasks without a hint, zero
critical misunderstandings about exported data, and no keyboard trap. Review
every failed task, revise the player or explanation, and repeat the affected
task with new participants. Keep consent and observations outside the source
repository; publish only aggregate, non-identifying findings if participants
agree. This protocol does not replace a screen-reader or color-contrast audit.
