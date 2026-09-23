"""Explicit condition trees preserve pandas three-valued decisions."""

from itertools import product

import pandas as pd
import pytest

from framechoreo import DataStory, col, where


def test_and_or_not_with_missing_comparisons_and_all_control_inputs():
    df = pd.DataFrame(
        {
            "score": pd.array([12, 7, None, 4], dtype="Int64"),
            "region": ["N", "S", "N", "N"],
            "paid": [True, True, False, True],
            "fallback": [100, 200, 300, 400],
        }
    )
    rule = (where("score", "ge", 10) & where("region", "in", ["N", "S"])) | ~where(
        "paid", "eq", True
    )
    with pytest.raises(TypeError):
        bool(rule)
    story = DataStory()
    source = story.table(df, name="raw")
    selected = source.filter_by(rule)
    expected = (
        df["score"].ge(10).astype("boolean") & df["region"].isin(["N", "S"]).astype("boolean")
    ) | ~df["paid"].eq(True).astype("boolean")
    pd.testing.assert_frame_equal(selected.to_pandas(), df[expected.fillna(False)])
    assert [selected.filter_decision(i) for i in range(4)] == ["true", "false", "true", "false"]
    assert [(o.row, o.column) for o in selected.explain_controls(1, "fallback")] == [
        (2, "score"),
        (2, "region"),
        (2, "paid"),
    ]
    assert selected.condition_breakdown(2) == (
        {"column": "score", "op": "ge", "outcome": "missing"},
        {"column": "region", "op": "in", "outcome": "true"},
        {"column": "paid", "op": "eq", "outcome": "false"},
    )
    detached = selected.condition_breakdown(2)
    detached[0]["outcome"] = "changed"
    assert selected.condition_breakdown(2)[0]["outcome"] == "missing"
    with pytest.raises(IndexError):
        selected.condition_breakdown(99)
    with pytest.raises(ValueError):
        source.condition_breakdown(0)
    chosen = source.case_when("selected", condition=rule, then=col("fallback"), otherwise=0)
    assert chosen.to_pandas()["selected"].tolist() == [100, 0, 300, 0]
    assert [(o.row, o.column) for o in chosen.explain(2, "selected")] == [(2, "fallback")]
    assert len(chosen.explain_controls(2, "selected")) == 3
    assert story.to_dict()["steps"][-1]["parameters"]["condition"]["kind"] == "any"
    assert chosen.condition_breakdown(2)[0]["outcome"] == "missing"


def test_missing_three_value_truth_table_and_membership_range():
    source = DataStory().table(
        pd.DataFrame({"x": pd.array([None, 3, 8], dtype="Int64"), "tag": ["a", "b", "a"]})
    )
    and_result = source.filter_by(where("x", "gt", 5) & where("tag", "eq", "b"))
    assert [and_result.filter_decision(i) for i in range(3)] == ["false", "false", "false"]
    or_result = source.filter_by(where("x", "gt", 5) | where("tag", "eq", "b"))
    assert [or_result.filter_decision(i) for i in range(3)] == ["missing", "true", "true"]
    between = source.filter_by("x", op="between", value=(3, 8))
    assert between.to_pandas()["x"].tolist() == [3, 8]
    assert between.condition_breakdown(0) == (
        {"column": "x", "op": "between", "outcome": "missing"},
    )
    included = source.filter_by("tag", op="in", value=["a"])
    assert included.to_pandas()["tag"].tolist() == ["a", "a"]


def test_between_can_use_two_column_bounds_with_duplicate_indices():
    df = pd.DataFrame(
        {
            "x": pd.array([5, 15, None], dtype="Int64"),
            "low": [0, 10, 0],
            "high": [10, 20, 10],
        },
        index=[4, 4, 4],
    )
    source = DataStory().table(df, name="raw")
    result = source.filter_by(where("x", "between", (col("low"), col("high"))))
    expected = df[df["x"].between(df["low"], df["high"]).fillna(False)]
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    assert [(o.row, o.column) for o in result.explain_controls(0, "x")] == [
        (0, "x"),
        (0, "low"),
        (0, "high"),
    ]


def test_all_27_three_valued_boolean_combinations_match_pandas():
    rows = list(product([True, False, None], repeat=3))
    df = pd.DataFrame(
        {
            name: pd.array([row[i] for row in rows], dtype="boolean")
            for i, name in enumerate(["a", "b", "c"])
        }
    )
    rule = (where("a", "eq", True) & where("b", "eq", True)) | ~where("c", "eq", False)
    source = DataStory().table(df, name="raw")
    selected = source.filter_by(rule)
    expected = (df["a"].eq(True) & df["b"].eq(True)) | ~df["c"].eq(False)
    assert [selected.filter_decision(i) for i in range(len(df))] == [
        "missing" if pd.isna(value) else "true" if value else "false" for value in expected.array
    ]
    pd.testing.assert_frame_equal(selected.to_pandas(), df[expected.fillna(False)])


def test_invalid_tree_does_not_append_history():
    story = DataStory()
    source = story.table(pd.DataFrame({"x": [1]}))
    rule = where("x", "eq", 1)
    for _ in range(9):
        rule = ~rule
    with pytest.raises(ValueError, match="depth"):
        source.filter_by(rule)
    breadth = [where("x", "eq", 1) for _ in range(33)]
    while len(breadth) > 1:
        breadth = [
            breadth[i] | breadth[i + 1] if i + 1 < len(breadth) else breadth[i]
            for i in range(0, len(breadth), 2)
        ]
    with pytest.raises(ValueError, match="32 comparisons"):
        source.filter_by(breadth[0])
    with pytest.raises(ValueError):
        source.filter_by(where("missing", "eq", 1))
    with pytest.raises(ValueError):
        source.case_when(
            "y", column="x", op="eq", condition=where("x", "eq", 1), then=1, otherwise=0
        )
    assert len(story.to_dict()["steps"]) == 1


def test_compound_literal_is_escaped_at_html_script_boundary():
    attack = '</script><img src=x onerror="alert(1)">'
    story = DataStory()
    result = story.table(pd.DataFrame({"tag": [attack, "safe"]})).filter_by(
        where("tag", "eq", attack) | where("tag", "eq", "safe")
    )
    html = story.to_html(result=result)
    assert attack not in html
    assert "\\u003c/script\\u003e" in html
