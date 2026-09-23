"""Match events to the latest earlier sensor reading within three minutes."""

from datetime import timedelta
from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def build_story():
    story = DataStory(title="Which reading was available at each event?", language="en")
    events = story.table(
        pd.DataFrame(
            {
                "time": pd.to_datetime(
                    [
                        "2026-01-01 10:00:00",
                        "2026-01-01 10:02:00",
                        "2026-01-01 10:02:30",
                        "2026-01-01 10:05:00",
                    ]
                ),
                "sensor": ["A", "A", "A", "B"],
                "event": ["start", "check", "check again", "finish"],
            }
        ),
        name="Events",
    )
    readings = story.table(
        pd.DataFrame(
            {
                "time": pd.to_datetime(
                    [
                        "2026-01-01 10:00:00",
                        "2026-01-01 10:03:00",
                        "2026-01-01 10:04:00",
                    ]
                ),
                "sensor": ["A", "A", "B"],
                "reading": [20, 24, 31],
            }
        ),
        name="Readings",
    )
    result = events.merge_asof(
        readings,
        on="time",
        by="sensor",
        direction="backward",
        tolerance=timedelta(minutes=3),
        allow_exact_matches=False,
        label="Attach the most recent earlier reading",
    )
    story.annotate(
        result, note="The first exact-time reading is excluded; a later reading can be reused."
    )
    return story, result


if __name__ == "__main__":
    story, result = build_story()
    output = Path(__file__).parent / "generated" / "asof.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    story.export_html(output, result=result, overwrite=True)
    print(output)
