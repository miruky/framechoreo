"""Ranks keep pandas tie policies and the full candidate set."""

import pandas as pd
import pytest

from framechoreo import CaptureLimitError, DataStory


@pytest.mark.parametrize("method", ["average", "min", "max", "dense", "first"])
@pytest.mark.parametrize("ascending", [False, True])
def test_group_rank_matches_pandas_with_ties_and_missing_values(method, ascending):
    df = pd.DataFrame(
        {
            "team": ["A", "B", "A", "A", "B", "A"],
            "score": pd.array([10, 7, 10, None, 5, 20], dtype="Int64"),
        },
        index=[4, 4, 4, 5, 5, 5],
    )
    source = DataStory().table(df, name="raw")
    ranked = source.rank_within(
        "rank", by="team", value="score", method=method, ascending=ascending
    )
    expected = df.groupby("team", sort=False, dropna=False)["score"].rank(
        method=method, ascending=ascending, na_option="keep"
    )
    out = df.copy()
    out["rank"] = expected.array
    pd.testing.assert_frame_equal(ranked.to_pandas(), out)
    assert [(o.row, o.column) for o in ranked.explain(0, "rank")] == [
        (0, "score"),
        (2, "score"),
        (5, "score"),
    ]
    assert [(o.row, o.column) for o in ranked.explain_controls(0, "rank")] == [
        (0, "team"),
        (2, "team"),
        (5, "team"),
    ]
    assert ranked.explain(3, "rank") == ()
    assert [(o.row, o.column) for o in ranked.explain_controls(3, "rank")] == [
        (3, "team"),
        (3, "score"),
    ]


def test_global_rank_and_invalid_options():
    df = pd.DataFrame({"value": [3.0, 1.0, 3.0]})
    story = DataStory()
    source = story.table(df)
    rank = source.rank_within("position", value="value", method="dense")
    pd.testing.assert_series_equal(
        rank.to_pandas()["position"],
        df["value"].rank(method="dense", ascending=False).rename("position"),
    )
    with pytest.raises(ValueError):
        source.rank_within("bad", value="value", method="random")
    assert len(story._steps) == 2


def test_missing_group_key_is_ranked_and_invalid_types_are_rejected_atomically():
    df = pd.DataFrame({"team": ["A", None, None], "score": [9.0, 3.0, 7.0]})
    story = DataStory()
    source = story.table(df)
    rank = source.rank_within("rank", by="team", value="score")
    expected = df.groupby("team", dropna=False)["score"].rank(
        method="dense", ascending=False, na_option="keep"
    )
    pd.testing.assert_series_equal(rank.to_pandas()["rank"], expected.rename("rank"))
    assert [(o.row, o.column) for o in rank.explain(1, "rank")] == [
        (1, "score"),
        (2, "score"),
    ]
    with pytest.raises(ValueError):
        source.rank_within("bad", by="score", value="score")
    with pytest.raises(ValueError):
        source.rank_within("bad", value="score", ascending="false")
    with pytest.raises(ValueError):
        source.rank_within("bad", value="team")
    assert len(story._steps) == 2


def test_rank_reference_expansion_fails_without_partial_step():
    story = DataStory.for_analysis()
    source = story.table(pd.DataFrame({"g": ["one"] * 1000, "v": range(1000)}))
    with pytest.raises(CaptureLimitError, match="250,000"):
        source.rank_within("rank", by="g", value="v")
    assert len(story._steps) == 1


def test_empty_rank_keeps_an_empty_numeric_result():
    empty = pd.DataFrame({"score": pd.Series(dtype="float64")})
    result = DataStory().table(empty).rank_within("rank", value="score")
    assert result.to_pandas().empty
    assert result.to_pandas().columns.tolist() == ["score", "rank"]
