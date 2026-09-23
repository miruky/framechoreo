"""Ordered, multi-branch decisions preserve priority and every checked input."""

import pandas as pd
import pytest

from framechoreo import DataStory, col, where


def test_first_true_branch_wins_and_missing_checks_continue():
    df = pd.DataFrame(
        {
            "score": pd.array([90, 60, None, 10], dtype="Int64"),
            "vip": [False, True, False, False],
            "fallback": ["A", "B", "C", "D"],
        }
    )
    story = DataStory()
    source = story.table(df, name="raw")
    result = source.case_select(
        "tier",
        cases=[
            (where("score", "ge", 80), "top"),
            (where("vip", "eq", True), "vip"),
            (where("score", "lt", 40), col("fallback")),
        ],
        otherwise="standard",
    )
    assert result.to_pandas()["tier"].tolist() == ["top", "vip", "standard", "D"]
    assert [result.case_decision(i)["selected_case"] for i in range(4)] == [0, 1, None, 2]
    assert result.case_decision(2)["outcomes"] == ["missing", "false", "missing"]
    assert result.explain(0, "tier") == ()
    assert [(o.row, o.column) for o in result.explain(3, "tier")] == [(3, "fallback")]
    assert [(o.row, o.column) for o in result.explain_controls(3, "tier")] == [
        (3, "score"),
        (3, "vip"),
        (3, "score"),
    ]
    decision = result.case_decision(0)
    decision["outcomes"][0] = "changed"
    assert result.case_decision(0)["outcomes"][0] == "true"
    assert story.to_dict()["steps"][-1]["parameters"]["selected_cases"] == [0, 1, None, 2]


def test_overlapping_branches_match_pandas_first_match_priority():
    df = pd.DataFrame({"x": [1, 2, 3]})
    source = DataStory().table(df)
    result = source.case_select(
        "label",
        cases=[(where("x", "ge", 1), "first"), (where("x", "ge", 2), "second")],
        otherwise="base",
    )
    native = pd.Series(["base"] * 3).case_when(
        [(df["x"].ge(1), "first"), (df["x"].ge(2), "second")]
    )
    assert result.to_pandas()["label"].tolist() == native.tolist()
    assert result.case_decision(2)["outcomes"] == ["true", "true"]
    assert result.case_decision(2)["selected_case"] == 0


def test_selected_and_default_columns_keep_distinct_value_origins():
    source = DataStory().table(
        pd.DataFrame({"flag": [1, 0], "preferred": ["X", "Y"], "fallback": ["A", "B"]}),
        name="raw",
    )
    result = source.case_select(
        "chosen",
        cases=[(where("flag", "eq", 1), col("preferred"))],
        otherwise=col("fallback"),
    )
    assert result.to_pandas()["chosen"].tolist() == ["X", "B"]
    assert [(o.row, o.column) for o in result.explain(0, "chosen")] == [(0, "preferred")]
    assert [(o.row, o.column) for o in result.explain(1, "chosen")] == [(1, "fallback")]
    assert [result.case_decision(i)["selected_case"] for i in range(2)] == [0, None]


def test_bad_branch_requests_are_atomic():
    story = DataStory()
    source = story.table(pd.DataFrame({"x": [1]}))
    with pytest.raises(ValueError):
        source.case_select("bad", cases=[])
    with pytest.raises(ValueError, match="ordered sequence"):
        source.case_select("bad", cases=iter([(where("x", "eq", 1), 2)]))
    with pytest.raises(ValueError):
        source.case_select("bad", cases=[(where("missing", "eq", 1), 2)])
    with pytest.raises(ValueError):
        source.case_select("bad", cases=[(where("x", "eq", 1), 2)] * 17)
    with pytest.raises(ValueError):
        source.case_decision(0)
    assert len(story.to_dict()["steps"]) == 1


def test_ordered_cases_on_empty_table_keep_schema_without_decisions():
    empty = pd.DataFrame({"score": pd.Series(dtype="Int64")})
    result = (
        DataStory()
        .table(empty)
        .case_select("tier", cases=[(where("score", "ge", 80), "top")], otherwise="review")
    )
    assert result.to_pandas().empty
    assert result.to_pandas().columns.tolist() == ["score", "tier"]
