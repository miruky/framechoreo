"""Familiar pandas-style methods retain FrameChoreo's explicit contracts."""

import pandas as pd
import pytest

from framechoreo import DataStory, RecordedGroupBy


def test_pandas_style_chain_matches_native_pipeline_and_keeps_lineage():
    df = pd.DataFrame(
        {"group": ["A", "A", "B", None], "amount": [10.0, None, 30.0, 4.0], "keep": [1, 1, 1, 0]}
    )
    source = DataStory().table(df, name="raw")
    cleaned = (
        source.dropna(subset="keep").fillna({"amount": 0.0}).rename(columns={"amount": "sales"})
    )
    expected = df.dropna(subset="keep").fillna({"amount": 0.0}).rename(columns={"amount": "sales"})
    pd.testing.assert_frame_equal(cleaned.to_pandas(), expected)
    grouped = cleaned.groupby("group", dropna=False)
    assert isinstance(grouped, RecordedGroupBy)
    summary = grouped.agg(total=("sales", "sum"), entries=("sales", "count"))
    native = (
        expected.groupby("group", dropna=False, sort=False, observed=True)
        .agg(total=("sales", "sum"), entries=("sales", "count"))
        .reset_index()
    )
    pd.testing.assert_frame_equal(summary.to_pandas(), native)
    assert [origin.value for origin in summary.explain(0, "total")] == [10.0]


def test_selected_grouped_sum_and_transform_match_pandas():
    df = pd.DataFrame({"g": ["A", "A", "B"], "v": [2.0, 3.0, 4.0]})
    source = DataStory().table(df)
    selection = source.groupby("g", dropna=False)["v"]
    total = selection.sum()
    repeated = selection.transform("group_total", "sum")
    pd.testing.assert_frame_equal(
        total.to_pandas(),
        df.groupby("g", dropna=False, sort=False)["v"].sum(min_count=1).reset_index(),
    )
    expected = df.copy()
    expected["group_total"] = df.groupby("g", dropna=False, sort=False)["v"].transform("sum")
    pd.testing.assert_frame_equal(repeated.to_pandas(), expected)
    assert [(origin.row, origin.column) for origin in repeated.explain(1, "group_total")] == [
        (0, "v"),
        (1, "v"),
    ]


def test_unsupported_pandas_style_requests_fail_before_recording():
    story = DataStory()
    source = story.table(pd.DataFrame({"g": ["A"], "v": [1.0]}))
    with pytest.raises(ValueError):
        source.groupby("g", dropna="false")
    with pytest.raises(ValueError):
        source.groupby("g", dropna=False, sort=True)["v"].transform("out", "sum")
    with pytest.raises(ValueError):
        source.fillna(0)
    with pytest.raises(ValueError):
        source.rename(columns={"missing": "new"})
    assert len(story._steps) == 1
