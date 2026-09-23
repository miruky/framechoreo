"""Fractional changes use pandas values and both positional inputs."""

import pandas as pd
import pytest

from framechoreo import DataStory, UnsupportedDataError


@pytest.mark.parametrize("periods", [1, 2])
def test_grouped_fractional_change_matches_pandas_with_zero_and_missing(periods):
    df = pd.DataFrame(
        {
            "store": ["A", "B", "A", "A", "B", "A"],
            "sales": pd.array([0, 100, 10, None, 50, 20], dtype="Int64"),
        },
        index=[4, 4, 4, 5, 5, 5],
    )
    source = DataStory().table(df, name="raw")
    result = source.window("change", column="sales", op="pct_change", by="store", periods=periods)
    expected = df.groupby("store", sort=False, dropna=False)["sales"].pct_change(
        periods=periods, fill_method=None
    )
    output = df.copy()
    output["change"] = expected.array
    pd.testing.assert_frame_equal(result.to_pandas(), output)
    assert [(o.row, o.column) for o in result.explain(2, "change")] == (
        [(2, "sales"), (0, "sales")] if periods == 1 else [(2, "sales")]
    )
    if periods == 1:
        assert result.to_pandas()["change"].iloc[2] == float("inf")
    assert result.explain_page(2, "change").total == (2 if periods == 1 else 1)


def test_fractional_change_rejects_non_numeric_input_without_a_step():
    story = DataStory()
    source = story.table(pd.DataFrame({"flag": [True, False]}))
    with pytest.raises(UnsupportedDataError):
        source.window("growth", column="flag", op="pct_change")
    with pytest.raises(ValueError):
        source.window("growth", column="flag", op="pct_change", periods=0)
    assert len(story._steps) == 1
