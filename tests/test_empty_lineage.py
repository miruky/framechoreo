"""Computed zeros do not consume the budget for raw source inputs."""

import pandas as pd
import pytest

from framechoreo import CaptureLimitError, DataStory


@pytest.mark.parametrize("present", [False, True])
def test_empty_aggregate_branches_do_not_exhaust_the_source_limit(present):
    story = DataStory()
    data = pd.DataFrame(
        {
            "key": range(6),
            "v": pd.Series([7 if present else pd.NA] + [pd.NA] * 5, dtype="Int64"),
        }
    )
    source = story.table(data)
    zero_filled = source.group_sum(by="key", value="v", dropna=False, min_count=0)
    lookup = story.table(pd.DataFrame({"key": range(6), "category": ["all"] * 6}))
    result = zero_filled.merge(lookup, on="key").group_sum(by="category", value="v", dropna=False)
    assert result.to_pandas().iat[0, 1] == (7 if present else 0)
    origins = result.explain(0, "v", max_sources=1)
    assert [(o.step_id, o.row, o.column, o.value) for o in origins] == (
        [(source.step_id, 0, "v", 7)] if present else []
    )


def test_repeated_computed_zeros_have_empty_lineage_at_default_limits():
    story = DataStory()
    source = story.table(
        pd.DataFrame({"key": ["all"] * 100, "v": pd.Series([pd.NA] * 100, dtype="Int64")})
    )
    result = source.group_sum(by="key", value="v", dropna=False, min_count=0)
    repeat = story.table(pd.DataFrame({"key": ["all"] * 100}))
    for _ in range(3):
        result = repeat.merge(result, on="key").group_sum(by="key", value="v", dropna=False)
    assert result.to_pandas().iat[0, 1] == 0
    assert result.explain(0, "v") == ()


def test_repeated_real_inputs_still_enforce_the_limit():
    story = DataStory()
    source = story.table(pd.DataFrame({"key": ["all"] * 6, "v": [7] * 6}))
    total = source.group_sum(by="key", value="v", dropna=False)
    repeated = source.merge(total, on="key").group_sum(by="key", value="v_y", dropna=False)
    assert len(repeated.explain(0, "v_y", max_sources=36)) == 36
    with pytest.raises(CaptureLimitError):
        repeated.explain(0, "v_y", max_sources=35)
