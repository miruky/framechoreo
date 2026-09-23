"""Grouped metrics broadcast to original rows with exact candidate inputs."""

import pandas as pd
import pytest

from framechoreo import DataStory


@pytest.mark.parametrize("op", ["sum", "mean", "min", "max", "count", "nunique"])
@pytest.mark.parametrize("dropna", [False, True])
def test_group_transform_matches_pandas_and_traces_group_candidates(op, dropna):
    df = pd.DataFrame(
        {"group": ["a", "a", None, "b"], "value": pd.array([2, None, 5, 7], dtype="Int64")},
        index=[4, 4, 4, 4],
    )
    story = DataStory()
    result = story.table(df, name="raw").group_transform(
        "metric",
        by="group",
        value="value",
        op=op,
        dropna=dropna,
    )
    grouped = df.groupby("group", dropna=dropna, sort=False, observed=True)["value"]
    expected = (
        grouped.transform(lambda s: s.sum(min_count=1)) if op == "sum" else grouped.transform(op)
    )
    output = df.copy()
    output["metric"] = expected.array
    pd.testing.assert_frame_equal(result.to_pandas(), output)
    assert [(origin.row, origin.column) for origin in result.explain(0, "metric")] == [(0, "value")]
    assert [(origin.row, origin.column) for origin in result.explain(1, "metric")] == [(0, "value")]
    assert [(origin.row, origin.column) for origin in result.explain_controls(0, "metric")] == [
        (0, "group"),
        (1, "group"),
    ]
    if dropna:
        assert result.explain(2, "metric") == ()
        assert [(o.row, o.column) for o in result.explain_controls(2, "metric")] == [(2, "group")]


def test_group_transform_count_accepts_text_and_all_missing_group():
    df = pd.DataFrame({"g": ["a", "a", "b"], "text": [None, None, "x"]})
    source = DataStory().table(df, name="raw")
    count = source.group_transform("present", by="g", value="text", op="count", dropna=False)
    distinct = source.group_transform("distinct", by="g", value="text", op="nunique", dropna=False)
    assert count.to_pandas()["present"].tolist() == [0, 0, 1]
    assert distinct.to_pandas()["distinct"].tolist() == [0, 0, 1]
    assert count.explain(0, "present") == ()
    assert [(o.row, o.column) for o in distinct.explain(2, "distinct")] == [(2, "text")]


def test_group_transform_empty_and_all_excluded_inputs():
    empty = pd.DataFrame({"g": pd.Series(dtype="str"), "v": pd.Series(dtype="float64")})
    story = DataStory()
    result = story.table(empty).group_transform("total", by="g", value="v", op="sum", dropna=False)
    assert result.to_pandas().empty
    assert story.to_dict()["steps"][-1]["parameters"]["groups"] == []
    missing = pd.DataFrame({"g": [None, None], "v": [1.0, 2.0]})
    result = (
        DataStory()
        .table(missing)
        .group_transform("average", by="g", value="v", op="mean", dropna=True)
    )
    assert result.to_pandas()["average"].isna().all()
    assert result.explain(0, "average") == ()


def test_group_transform_rejects_invalid_options():
    story = DataStory()
    source = story.table(pd.DataFrame({"g": ["a", "a"], "v": [1, 2]}))
    with pytest.raises(ValueError):
        source.group_transform("bad", by="g", value="v", op="median", dropna=False)
    with pytest.raises(ValueError):
        source.group_transform("bad", by="g", value="v", op="mean", dropna=False, min_count=2)
    assert len(story.to_dict()["steps"]) == 1


def test_large_group_transform_shares_references_without_losing_sources():
    analysis = DataStory.for_analysis()
    big = analysis.table(pd.DataFrame({"g": ["x"] * 1000, "v": range(1000)}))
    total = big.group_transform("total", by="g", value="v", op="sum", dropna=False)
    assert total.to_pandas()["total"].iloc[0] == 499500
    payload = analysis.to_dict(result=total)
    assert payload["schema_version"] == 2
    assert payload["steps"][-1]["parameters"]["lineage_encoding"] == "shared_group"
    assert payload["steps"][-1]["rows"][0]["cell_parents"]["total"] == []
    assert payload["steps"][-1]["rows"][0]["cell_controls"]["total"] == []
    assert len(analysis.to_json(result=total)) < 1_000_000
    assert len(total.explain_controls(0, "total")) == 1000
    page = total.explain_page(0, "total", offset=998, limit=5)
    assert page.total == 1000
    assert [origin.row for origin in page.origins] == [998, 999]
