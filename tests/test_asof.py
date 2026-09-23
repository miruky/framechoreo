"""Nearest-time joins retain pandas output and positional matches."""

from datetime import timedelta

import pandas as pd
import pytest

from framechoreo import DataStory


@pytest.mark.parametrize("direction", ["backward", "forward", "nearest"])
def test_asof_matches_pandas_and_keeps_actual_right_input(direction):
    left = pd.DataFrame(
        {"time": [1, 4, 5, 9], "group": ["a", "a", "b", "b"], "amount": [10, 20, 30, 40]},
        index=[7, 7, 7, 7],
    )
    right = pd.DataFrame(
        {"time": [2, 3, 6, 8], "group": ["a", "a", "b", "b"], "quote": [100, 110, 200, 220]}
    )
    story = DataStory()
    result = story.table(left, name="Events").merge_asof(
        story.table(right, name="Quotes"),
        on="time",
        by="group",
        direction=direction,
        tolerance=2,
    )
    expected = pd.merge_asof(left, right, on="time", by="group", direction=direction, tolerance=2)
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    audit = result.asof_audit()
    assert len(audit["matched_right_rows"]) == len(left)
    assert audit["left_unmatched"] == [i for i, v in enumerate(expected["quote"]) if pd.isna(v)]
    for row, right_row in enumerate(audit["matched_right_rows"]):
        origins = result.explain(row, "quote")
        assert [(o.source, o.row, o.column) for o in origins] == (
            [] if right_row is None else [("Quotes", right_row, "quote")]
        )
        controls = [(o.source, o.row, o.column) for o in result.explain_controls(row, "quote")]
        assert controls == [
            ("Events", row, "time"),
            ("Events", row, "group"),
            *(
                []
                if right_row is None
                else [("Quotes", right_row, "time"), ("Quotes", right_row, "group")]
            ),
        ]
    audit["matched_right_rows"][0] = 999
    assert result.asof_audit()["matched_right_rows"][0] != 999


def test_asof_exact_match_policy_and_datetime_tolerance():
    left = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-01-01 10:00", "2026-01-01 10:02", "2026-01-01 10:05"]),
            "event": ["a", "b", "c"],
        }
    )
    right = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-01-01 10:00", "2026-01-01 10:03"]),
            "value": [4, 9],
        }
    )
    story = DataStory()
    result = story.table(left).merge_asof(
        story.table(right),
        on="time",
        direction="backward",
        tolerance=timedelta(minutes=3),
        allow_exact_matches=False,
    )
    pd.testing.assert_frame_equal(
        result.to_pandas(),
        pd.merge_asof(
            left,
            right,
            on="time",
            direction="backward",
            tolerance=timedelta(minutes=3),
            allow_exact_matches=False,
        ),
    )
    assert result.asof_audit()["matched_right_rows"] == [None, 0, 1]
    assert result.explain(0, "value") == ()


def test_asof_rejects_unsorted_or_invalid_requests_without_a_step():
    story = DataStory()
    left = story.table(pd.DataFrame({"time": [5, 1], "v": [1, 2]}))
    right = story.table(pd.DataFrame({"time": [1, 3], "w": [3, 4]}))
    with pytest.raises(ValueError):
        left.merge_asof(right, on="time")
    with pytest.raises(ValueError):
        left.merge_asof(right, on="time", direction="sideways")
    assert len(story._steps) == 2
    with pytest.raises(ValueError):
        left.asof_audit()


def test_self_asof_join_preserves_distinct_left_and_right_positions():
    df = pd.DataFrame({"time": [1, 2, 3], "v": [10, 20, 30]})
    source = DataStory().table(df, name="raw")
    result = source.merge_asof(source, on="time", allow_exact_matches=False)
    pd.testing.assert_frame_equal(
        result.to_pandas(), pd.merge_asof(df, df, on="time", allow_exact_matches=False)
    )
    assert result.asof_audit()["matched_right_rows"] == [None, 0, 1]
    assert [(o.row, o.column) for o in result.explain(2, "v_y")] == [(1, "v")]


@pytest.mark.parametrize("direction", ["backward", "forward", "nearest"])
def test_asof_duplicate_right_times_and_nearest_tie_follow_pandas(direction):
    left = pd.DataFrame({"time": [1, 2, 3], "event": ["a", "b", "c"]})
    right = pd.DataFrame({"time": [1, 1, 3, 3], "reading": [10, 11, 30, 31]})
    story = DataStory()
    result = story.table(left).merge_asof(story.table(right), on="time", direction=direction)
    expected = pd.merge_asof(left, right, on="time", direction=direction)
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    for row, reading in enumerate(expected["reading"]):
        right_row = right.index[right["reading"] == reading][0]
        assert result.asof_audit()["matched_right_rows"][row] == right_row
        assert [(o.row, o.column) for o in result.explain(row, "reading")] == [
            (right_row, "reading")
        ]


def test_asof_rejects_cross_story_bad_group_and_suffixes_without_a_step():
    story = DataStory()
    left = story.table(pd.DataFrame({"time": [1], "group": ["a"]}))
    right = story.table(pd.DataFrame({"time": [1], "group": ["a"], "v": [1]}))
    foreign = DataStory().table(pd.DataFrame({"time": [1], "v": [2]}))
    with pytest.raises(ValueError):
        left.merge_asof(foreign, on="time")
    with pytest.raises(ValueError):
        left.merge_asof(right, on="time", by="time")
    with pytest.raises(ValueError):
        left.merge_asof(right, on="time", suffixes=("left",))
    with pytest.raises(ValueError):
        left.merge_asof(right, on="time", by="missing")
    assert len(story._steps) == 2


def test_asof_empty_sides_and_rejected_exact_flag():
    left = pd.DataFrame({"time": [1], "event": ["a"]})
    empty_right = pd.DataFrame(
        {"time": pd.Series(dtype="int64"), "reading": pd.Series(dtype="float64")}
    )
    story = DataStory()
    source = story.table(left)
    result = source.merge_asof(story.table(empty_right), on="time")
    assert result.to_pandas()["reading"].isna().all()
    assert result.asof_audit()["left_unmatched"] == [0]
    with pytest.raises(ValueError):
        source.merge_asof(result, on="time", allow_exact_matches="false")
    empty_left = pd.DataFrame({"time": pd.Series(dtype="int64"), "event": pd.Series(dtype="str")})
    story2 = DataStory()
    joined = story2.table(empty_left).merge_asof(story2.table(left), on="time")
    assert joined.to_pandas().empty
    assert joined.asof_audit()["matched_right_rows"] == []
