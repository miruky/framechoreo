"""Regression cases found while auditing recorded data and public options."""

from decimal import Decimal

import numpy as np
import pandas as pd
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from framechoreo import CaptureLimitError, DataStory, UnsupportedDataError


def test_a_tiny_float_mutation_is_rejected_without_changing_history():
    story = DataStory()
    frame = story.table(pd.DataFrame({"v": [1.0]}))

    def mutate(df):
        df.loc[0, "v"] += 1e-9
        return [True]

    with pytest.raises(ValueError, match="mutate"):
        frame.filter_rows(mutate)
    assert len(story.to_dict()["steps"]) == 1
    assert frame.explain(0, "v")[0].value == 1.0


@pytest.mark.parametrize("axis", ["index", "columns"])
def test_captured_axes_do_not_share_source_buffers(axis):
    labels = np.array(["original"], dtype=object)
    df = pd.DataFrame({"v": [1.0]})
    setattr(df, axis, pd.Index(labels, copy=False))
    frame = DataStory().table(df)
    labels[0] = "changed"
    assert list(getattr(frame.to_pandas(), axis)) == ["original"]


@pytest.mark.parametrize("axis", ["index", "columns"])
def test_returned_axes_do_not_share_snapshot_buffers(axis):
    frame = DataStory().table(pd.DataFrame({"v": [1.0]}, index=["row"]))
    copy = frame.to_pandas()
    getattr(copy, axis).values[0] = "changed"
    assert list(getattr(frame.to_pandas(), axis)) == (["row"] if axis == "index" else ["v"])


def test_categorical_labels_are_detached_from_the_input():
    categories = np.array(["a", "b"], dtype=object)
    df = pd.DataFrame(
        {"key": pd.Categorical(["a", "b"], categories=pd.Index(categories, copy=False))}
    )
    frame = DataStory().table(df)
    categories[0] = "changed"
    assert frame.to_pandas()["key"].tolist() == ["a", "b"]


@pytest.mark.parametrize("mask", [True, False, np.bool_(True), {"wrong-index": True}])
def test_scalar_and_mapping_masks_are_not_silently_interpreted(mask):
    story = DataStory()
    frame = story.table(pd.DataFrame({"v": [1]}))
    with pytest.raises(ValueError, match="mask|boolean"):
        frame.filter_rows(mask)
    assert len(story.to_dict()["steps"]) == 1


@pytest.mark.parametrize("missing", [np.timedelta64("NaT", "ns"), Decimal("NaN")])
def test_missing_scalar_variants_use_the_missing_encoding(missing):
    story = DataStory()
    story.table(pd.DataFrame({"value": pd.Series([missing], dtype=object)}))
    assert story.to_dict()["steps"][0]["rows"][0]["cells"][0] == {
        "type": "missing",
        "value": None,
        "display": "∅",
    }


def test_numpy_timedelta_is_a_duration_not_an_integer():
    story = DataStory()
    story.table(pd.DataFrame({"value": pd.Series([np.timedelta64(3, "ns")], dtype=object)}))
    cell = story.to_dict()["steps"][0]["rows"][0]["cells"][0]
    assert cell["type"] == "duration"
    assert cell["value"] == "P0DT0H0M0.000000003S"


def test_overwrite_requires_an_actual_boolean(tmp_path):
    story = DataStory()
    story.table(pd.DataFrame({"v": [1]}))
    target = tmp_path / "keep.html"
    target.write_text("keep this file")
    with pytest.raises(ValueError, match="overwrite"):
        story.export_html(target, overwrite="false")
    assert target.read_text(encoding="utf-8") == "keep this file"


def test_invalid_unicode_is_rejected_before_a_snapshot_is_committed():
    story = DataStory()
    with pytest.raises(UnsupportedDataError, match="Unicode|UTF-8"):
        story.table(pd.DataFrame({"value": ["\ud800"]}))
    assert story.to_dict()["steps"] == []


def test_huge_hold_has_the_documented_validation_error():
    story = DataStory()
    frame = story.table(pd.DataFrame({"v": [1]}))
    with pytest.raises(ValueError, match="hold"):
        story.annotate(frame, hold=10**400)


def test_categorical_axes_and_multiindex_levels_are_detached():
    labels = np.array(["a", "b"], dtype=object)
    index = pd.MultiIndex.from_arrays(
        [pd.Categorical(["a", "b"], categories=pd.Index(labels, copy=False)), [1, 2]],
        names=["category", "number"],
    )
    df = pd.DataFrame({"v": [1, 2]}, index=index)
    frame = DataStory().table(df)
    labels[0] = "changed"
    expected = pd.MultiIndex.from_arrays(
        [pd.Categorical(["a", "b"], categories=["a", "b"]), [1, 2]], names=["category", "number"]
    )
    pd.testing.assert_index_equal(frame.to_pandas().index, expected, exact=True)


def test_json_limit_counts_utf8_bytes_and_keeps_valid_unicode():
    story = DataStory(title="日本語の説明")
    story.table(pd.DataFrame({"名前": ["あいうえお 😀"]}))
    text = story.to_json()
    size = len(text.encode("utf-8"))
    story.max_export_bytes = size
    assert story.to_json() == text
    story.max_export_bytes = size - 1
    with pytest.raises(CaptureLimitError):
        story.to_json()


@given(
    rows=st.lists(
        st.tuples(
            st.sampled_from([0, 1, 2, None]),
            st.one_of(st.integers(-50, 50), st.none()),
            st.booleans(),
        ),
        max_size=25,
    ),
    dropna=st.booleans(),
    sort=st.booleans(),
    min_count=st.integers(0, 3),
)
@settings(max_examples=120, deadline=None)
def test_complete_pipeline_matches_pandas_and_independent_input_membership(
    rows, dropna, sort, min_count
):
    df = pd.DataFrame(rows, columns=["key", "v", "keep"]).astype(
        {"key": "object", "v": "Int64", "keep": "bool"}
    )
    df.index = [i // 2 for i in range(len(df))]
    lookup = pd.DataFrame(
        {
            "key": pd.Series([0, 1, None], dtype=object),
            "category": pd.Categorical(
                ["shared", "shared", "null-match"], categories=["shared", "null-match", "unused"]
            ),
        }
    )
    story = DataStory()
    source = story.table(df, name="Measurements")
    joined = source.filter_rows(lambda frame: frame["keep"]).merge(story.table(lookup), on="key")
    result = joined.group_sum(
        by="category", value="v", dropna=dropna, sort=sort, min_count=min_count
    )
    expected = (
        df.loc[df["keep"]]
        .merge(lookup, on="key", how="left", validate="many_to_one", sort=False)
        .groupby("category", dropna=dropna, sort=sort, observed=True)["v"]
        .sum(min_count=min_count)
        .reset_index()
    )
    pd.testing.assert_frame_equal(result.to_pandas(), expected, check_exact=True)
    categories = {0: "shared", 1: "shared", None: "null-match"}
    for position, category in enumerate(expected["category"]):
        wanted = None if pd.isna(category) else category
        members = [
            i
            for i, (key, value, keep) in enumerate(rows)
            if keep and value is not None and categories.get(key) == wanted
        ]
        assert [origin.row for origin in result.explain(position, "v")] == members
