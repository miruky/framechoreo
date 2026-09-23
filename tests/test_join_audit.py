"""Join audits cover input rows lost by inner joins and fanout in outer joins."""

import pandas as pd
import pytest

from framechoreo import DataStory


@pytest.mark.parametrize("how", ["inner", "left", "right", "outer"])
def test_join_audit_records_both_inputs_and_null_key_matches(how):
    left = pd.DataFrame({"sku": ["a", "b", None], "amount": [10, 20, 30]}, index=[7, 7, 7])
    right = pd.DataFrame({"code": ["a", "a", "c", None], "category": ["x", "y", "z", "null"]})
    story = DataStory()
    result = story.table(left, name="Orders").merge(
        story.table(right, name="Catalog"),
        left_on="sku",
        right_on="code",
        how=how,
        validate="one_to_many",
    )
    pd.testing.assert_frame_equal(
        result.to_pandas(),
        left.merge(
            right, left_on="sku", right_on="code", how=how, validate="one_to_many", sort=False
        ),
    )
    audit = result.join_audit()
    assert audit["left_match_counts"] == [2, 0, 1]
    assert audit["right_match_counts"] == [1, 1, 0, 1]
    assert audit["left_unmatched"] == [1]
    assert audit["right_unmatched"] == [2]
    assert audit["left_fanout"] == [0]
    assert audit["right_duplicate_keys"] == [0, 1]
    assert len(audit["null_key_output_rows"]) == 1
    audit["left_match_counts"][0] = 999
    assert result.join_audit()["left_match_counts"][0] == 2
    exported = story.to_dict()["steps"][-1]["parameters"]["audit"]
    assert exported["right_unmatched"] == [2]


def test_inner_join_audit_exposes_removed_rows_not_in_result():
    story = DataStory()
    left = story.table(pd.DataFrame({"k": ["match", "lost"], "v": [1, 2]}), name="Left")
    right = story.table(pd.DataFrame({"k": ["match", "unused"], "w": [3, 4]}), name="Right")
    result = left.merge(right, on="k", how="inner", validate="one_to_one")
    assert result.to_pandas()["k"].tolist() == ["match"]
    assert result.join_audit()["left_unmatched"] == [1]
    assert result.join_audit()["right_unmatched"] == [1]
    with pytest.raises(ValueError, match="merge"):
        left.join_audit()
