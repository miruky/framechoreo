"""Fixed-width time buckets retain pandas results and exact source membership."""

import pandas as pd
import pytest

from framechoreo import CaptureLimitError, DataStory, UnsupportedDataError


@pytest.mark.parametrize("op", ["sum", "mean", "count"])
def test_grouped_resample_matches_pandas_with_empty_and_missing_bins(op):
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
            "reading": pd.array([1, 2, None, 4, 5], dtype="Int64"),
        },
        index=[7, 7, 7, 8, 8],
    )
    story = DataStory()
    result = story.table(df, name="raw").resample_time(
        on="time", value="reading", rule="3min", op=op, by="sensor"
    )
    parts = []
    for sensor, group in df.groupby("sensor", sort=False, dropna=False):
        native = group.resample("3min", on="time", closed="left", label="left")["reading"]
        part = (native.sum(min_count=1) if op == "sum" else getattr(native, op)()).reset_index()
        part.insert(0, "sensor", sensor)
        parts.append(part)
    pd.testing.assert_frame_equal(result.to_pandas(), pd.concat(parts, ignore_index=True))
    assert result._snapshot.parameters["empty_bins"] == [1, 4]
    assert [(o.row, o.column) for o in result.explain(0, "reading")] == [(0, "reading")]
    assert result.explain(1, "reading") == ()
    assert result.explain(1, "time") == ()
    assert [(o.row, o.column) for o in result.explain_controls(0, "reading")] == [
        (0, "time"),
        (2, "time"),
        (0, "sensor"),
    ]


def test_right_closed_utc_bins_match_pandas_and_preserve_generated_labels():
    df = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-01-01 10:00Z", "2026-01-01 10:03Z", "2026-01-01 10:06Z"]),
            "value": [1.0, 2.0, 3.0],
        }
    )
    story = DataStory()
    result = story.table(df).resample_time(
        on="time", value="value", rule="3min", closed="right", bin_label="right", origin="epoch"
    )
    native = df.resample("3min", on="time", closed="right", label="right", origin="epoch")[
        "value"
    ].sum(min_count=1)
    pd.testing.assert_frame_equal(result.to_pandas(), native.reset_index())
    assert result._snapshot.parameters["bins"] == [
        {"input_rows": [0], "key_row": 0},
        {"input_rows": [1], "key_row": 0},
        {"input_rows": [2], "key_row": 0},
    ]
    assert result.explain(0, "time") == ()
    assert [(o.row, o.column) for o in result.explain_controls(0, "time")] == [(0, "time")]


def test_missing_group_key_and_text_count_keep_empty_intervals():
    df = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-01-01 10:00", "2026-01-01 10:06"]),
            "sensor": [None, None],
            "message": ["ready", None],
        }
    )
    result = (
        DataStory()
        .table(df)
        .resample_time(on="time", by="sensor", value="message", rule="3min", op="count")
    )
    assert result.to_pandas()["message"].tolist() == [1, 0, 0]
    assert result.to_pandas()["sensor"].isna().all()
    assert [(o.row, o.column) for o in result.explain(0, "message")] == [(0, "message")]
    assert result.explain(1, "message") == ()


def test_resample_rejects_bad_time_rule_and_excessive_expansion_atomically():
    story = DataStory()
    source = story.table(
        pd.DataFrame({"time": pd.to_datetime(["2026-01-02", "2026-01-01"]), "v": [1, 2]})
    )
    with pytest.raises(ValueError):
        source.resample_time(on="time", value="v", rule="1D")
    with pytest.raises(ValueError):
        source.resample_time(on="time", value="v", rule="1ME")
    with pytest.raises(ValueError):
        source.resample_time(on="time", value="v", rule="1D", closed="middle")
    assert len(story._steps) == 1
    long_story = DataStory()
    long_source = long_story.table(
        pd.DataFrame({"time": pd.to_datetime(["2026-01-01", "2030-01-01"]), "v": [1, 2]})
    )
    with pytest.raises(CaptureLimitError, match="too many buckets"):
        long_source.resample_time(on="time", value="v", rule="1s")
    assert len(long_story._steps) == 1
    text = DataStory().table(pd.DataFrame({"time": ["2026-01-01"], "v": [1]}))
    with pytest.raises(UnsupportedDataError):
        text.resample_time(on="time", value="v", rule="1D")


def test_empty_time_table_keeps_an_empty_result():
    df = pd.DataFrame(
        {"time": pd.Series(dtype="datetime64[ns]"), "value": pd.Series(dtype="float64")}
    )
    result = DataStory().table(df).resample_time(on="time", value="value", rule="1h")
    assert result.to_pandas().empty
    assert result.to_pandas().columns.tolist() == ["time", "value"]
