import datetime as dt
import json
from decimal import Decimal

import numpy as np
import pandas as pd
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from framechoreo import CaptureLimitError, DataStory, UnsupportedDataError


@pytest.mark.parametrize("sort", [False, True])
@pytest.mark.parametrize("dropna", [False, True])
@pytest.mark.parametrize("categorical", [False, True])
def test_multiple_group_keys_and_categories(sort, dropna, categorical):
    df = pd.DataFrame(
        {
            "a": ["b", "a", None, "b", "a", "b"],
            "b": [2, 1, 2, 1, 1, 2],
            "v": pd.Series([2, pd.NA, 5, 7, 3, -1], dtype="Int64"),
        }
    )
    if categorical:
        df["a"] = pd.Categorical(df["a"], categories=["a", "b", "unused"])
    result = DataStory().table(df).group_sum(by=["a", "b"], value="v", dropna=dropna, sort=sort)
    expected = (
        df.groupby(["a", "b"], dropna=dropna, sort=sort, observed=True)["v"]
        .sum(min_count=1)
        .reset_index()
    )
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    for row, amount in enumerate(expected["v"]):
        values = [origin.value for origin in result.explain(row, "v")]
        if values:
            assert sum(values) == amount
        else:
            assert pd.isna(amount)


@given(
    st.lists(st.tuples(st.sampled_from(["a", "b", "c", None]), st.integers(-50, 50)), max_size=20)
)
@settings(max_examples=60, deadline=None)
def test_generated_merge_lineage(data):
    left = pd.DataFrame(data, columns=["k", "v"]).astype({"v": "int64", "k": "object"})
    right = pd.DataFrame({"k": ["a", "b", None], "tag": ["A", "B", "MISSING"]}).astype(
        {"k": "object"}
    )
    story = DataStory()
    merged = story.table(left, name="left").merge(story.table(right, name="right"), on="k")
    expected = left.merge(right, on="k", how="left", validate="many_to_one", sort=False)
    pd.testing.assert_frame_equal(merged.to_pandas(), expected)
    for i in range(len(expected)):
        assert merged.explain(i, "v")[0].row == i
        assert merged.explain(i, "v")[0].value == left.iat[i, 1]
        if pd.isna(expected.iat[i, 2]):
            assert merged.explain(i, "tag") == ()
        else:
            assert merged.explain(i, "tag")[0].value == expected.iat[i, 2]


def test_empty_right_and_empty_inner():
    s = DataStory()
    left = s.table(pd.DataFrame({"k": [1, 2], "v": [10, 20]}))
    right = s.table(
        pd.DataFrame({"k": pd.Series([], dtype="int64"), "name": pd.Series([], dtype="str")})
    )
    result = left.merge(right, on="k")
    assert result.to_pandas()["name"].isna().all()
    assert result.explain(0, "name") == ()
    empty = left.merge(right, on="k", how="inner")
    assert empty.to_pandas().empty
    assert "No rows remain" in s.to_html(result=empty)


def test_self_join_and_column_index_metadata():
    df = pd.DataFrame({"k": [1, 2], "v": [3, 4]})
    df.columns = pd.Index(df.columns, name="fields", dtype="object")
    s = DataStory()
    f = s.table(df)
    merged = f.merge(f, on="k", suffixes=("", "_other"), validate="one_to_one")
    pd.testing.assert_frame_equal(
        merged.to_pandas(),
        df.merge(
            df, on="k", how="left", suffixes=("", "_other"), validate="one_to_one", sort=False
        ),
    )
    assert merged.explain(0, "v_other")[0].value == 3


def test_multiple_uses_preserve_multiplicity():
    s = DataStory()
    source = s.table(pd.DataFrame({"k": ["a", "a"], "v": [2, 3]}), name="source")
    total = source.group_sum(by="k", value="v", dropna=False)
    repeated = source.merge(total, on="k")
    repeated_total = repeated.group_sum(by="k", value="v_y", dropna=False)
    assert repeated_total.to_pandas()["v_y"].tolist() == [10]
    assert [x.value for x in repeated_total.explain(0, "v_y")] == [2, 3, 2, 3]
    with pytest.raises(CaptureLimitError):
        repeated_total.explain(0, "v_y", max_sources=3)


def test_scalar_encoding_preserves_information():
    df = pd.DataFrame(
        {
            "time": [pd.Timestamp("2026-01-01T00:00:00.123456789+09:00")],
            "duration": [pd.Timedelta(1, unit="ns")],
            "decimal": [Decimal("0.00000000000000000001")],
            "boolean": [np.bool_(True)],
            "infinity": [float("inf")],
            "day": [dt.date(2026, 1, 2)],
        }
    )
    payload = DataStory().table(df)._story.to_dict()
    cells = payload["steps"][0]["rows"][0]["cells"]
    assert cells[0]["value"] == "2026-01-01T00:00:00.123456789+09:00"
    assert cells[1]["value"] == "P0DT0H0M0.000000001S"
    assert cells[2]["value"] == "1E-20"
    json.dumps(payload, allow_nan=False)


def test_bad_requests_do_not_append_steps():
    s = DataStory()
    f = s.table(pd.DataFrame({"k": ["x"], "v": [1]}))
    for request in [
        lambda: f.group_sum(by="k", value="k", dropna=False),
        lambda: f.group_sum(by="k", value="v", dropna="false"),
        lambda: f.group_sum(by="k", value="v", dropna=False, min_count=-1),
        lambda: f.merge(f, on="k", how="outer"),
        lambda: f.merge(f, on=["absent"]),
    ]:
        with pytest.raises(ValueError):
            request()
        assert len(s.to_dict()["steps"]) == 1
    with pytest.raises(IndexError):
        f.explain(-1, "v")
    with pytest.raises(KeyError):
        f.explain(0, "absent")


def test_disclosure_and_export_limits():
    s = DataStory(max_columns=2)
    f = s.table(pd.DataFrame({"x": ["VISIBLE", "FILTERED_SECRET"], "keep": [True, False]}))
    out = f.filter_rows(lambda d: d["keep"])
    assert "FILTERED_SECRET" in s.to_html(result=out)
    info = s.export_info(result=out)
    assert info["rows_across_snapshots"] == 3
    assert info["includes_filtered_out_rows"] is True
    with pytest.raises(CaptureLimitError):
        s.table(pd.DataFrame({"a": [1], "b": [2], "c": [3]}))
    with pytest.raises(CaptureLimitError):
        s.table(pd.DataFrame({"a": ["x" * 20001]}))
    with pytest.raises(UnsupportedDataError):
        s.table(pd.DataFrame({"a": [b"bytes"]}))
    with pytest.raises(ValueError):
        s.to_html(theme="url(evil)")
