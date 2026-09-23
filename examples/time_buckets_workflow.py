"""Aggregate two sensors into three-minute buckets, preserving empty intervals."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def build_story():
    df = pd.DataFrame(
        {
            "time": pd.to_datetime(
                [
                    "2026-01-01 10:00",
                    "2026-01-01 10:01",
                    "2026-01-01 10:02",
                    "2026-01-01 10:06",
                    "2026-01-01 10:07",
                ]
            ),
            "sensor": ["A", "B", "A", "A", "B"],
            "reading": [20.0, 30.0, 22.0, 24.0, 31.0],
        }
    )
    story = DataStory(title="What happened in each three-minute interval?", language="en")
    source = story.table(df, name="Sensor readings")
    result = source.resample_time(
        on="time",
        by="sensor",
        value="reading",
        rule="3min",
        op="mean",
        label="Compare three-minute sensor windows",
    )
    parts = []
    for sensor, group in df.groupby("sensor", sort=False):
        part = group.resample("3min", on="time")["reading"].mean().reset_index()
        part.insert(0, "sensor", sensor)
        parts.append(part)
    pd.testing.assert_frame_equal(result.to_pandas(), pd.concat(parts, ignore_index=True))
    story.annotate(result, note="Neither sensor reported a reading in the middle interval.")
    return story, result


if __name__ == "__main__":
    story, result = build_story()
    output = Path(__file__).parent / "generated" / "time-buckets.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    story.export_html(output, result=result, overwrite=True)
    print(output)
