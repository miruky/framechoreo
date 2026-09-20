import pandas as pd
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from framechoreo import CaptureLimitError, DataStory, UnsupportedDataError


def test_filter_merge_sum_matches_pandas_and_explains(sales, products):
    story = DataStory(title="Sales")
    orders = story.table(sales, name="sales")
    catalog = story.table(products, name="products")
    paid = orders.filter_rows(lambda df: df["paid"])
    joined = paid.merge(catalog, on="product", how="left", validate="many_to_one")
    total = joined.group_sum(by="category", value="amount", dropna=False)
    expected = (
        sales.loc[sales["paid"]]
        .merge(products, on="product", how="left", validate="many_to_one", sort=False)
        .groupby("category", dropna=False, sort=False, observed=True)["amount"]
        .sum(min_count=1)
        .reset_index()
    )
    pd.testing.assert_frame_equal(total.to_pandas(), expected)
    assert [x.value for x in total.explain(0, "amount")] == [120, 150]
    assert [x.row for x in total.explain(0, "amount")] == [0, 2]
    assert all(x.source == "sales" for x in total.explain(0, "amount"))
    assert total.explain(1, "category")[0].source == "products"
    assert joined.explain(4, "category") == ()


def test_snapshots_survive_caller_mutation(sales):
    story = DataStory()
    frame = story.table(sales, name="original")
    sales.loc[0, "amount"] = 999
    result = frame.to_pandas()
    result.loc[0, "amount"] = -1
    assert frame.to_pandas().loc[0, "amount"] == 120
    payload = story.to_dict()
    payload["steps"][0]["name"] = "changed"
    assert story.to_dict()["steps"][0]["name"] == "original"


def test_duplicate_index_is_not_identity(sales):
    sales.index = [0, 0, 1, 1, 2, 2]
    s = DataStory()
    f = s.table(sales).filter_rows(lambda d: d["paid"])
    assert [f.explain(i, "amount")[0].row for i in range(5)] == [0, 2, 3, 4, 5]
    pd.testing.assert_frame_equal(f.to_pandas(), sales.loc[sales["paid"]])


def test_predicate_evaluated_once_and_mutation_rejected(sales):
    s = DataStory()
    f = s.table(sales)
    calls = []

    def predicate(d):
        calls.append(1)
        return d["paid"]

    f.filter_rows(predicate)
    assert calls == [1]

    def mutation(d):
        d.loc[0, "amount"] = 999
        return d["paid"]

    before = len(s.to_dict()["steps"])
    with pytest.raises(ValueError, match="mutat"):
        f.filter_rows(mutation)
    assert len(s.to_dict()["steps"]) == before
    assert f.to_pandas().loc[0, "amount"] == 120


@pytest.mark.parametrize("mask", [[1, 0], [True], ["yes", "no"]])
def test_bad_masks_rejected(mask):
    f = DataStory().table(pd.DataFrame({"x": [1, 2]}))
    with pytest.raises(ValueError):
        f.filter_rows(mask)


def test_nullable_mask_and_empty():
    f = DataStory().table(pd.DataFrame({"x": [1, 2]}))
    result = f.filter_rows(pd.Series([True, pd.NA], dtype="boolean"))
    assert result.to_pandas()["x"].tolist() == [1]
    empty = f.filter_rows([False, False])
    assert empty.to_pandas().empty


def test_series_mask_alignment_rejected():
    f = DataStory().table(pd.DataFrame({"x": [1, 2]}, index=["a", "b"]))
    with pytest.raises(ValueError, match="index"):
        f.filter_rows(pd.Series([True, False], index=["b", "a"]))


def test_merge_rejects_many_to_many_and_mixed_stories(sales, products):
    s = DataStory()
    left = s.table(sales)
    duplicated = s.table(pd.concat([products, products.iloc[[0]]], ignore_index=True))
    with pytest.raises(pd.errors.MergeError):
        left.merge(duplicated, on="product", validate="many_to_one")
    with pytest.raises(ValueError, match="validate"):
        left.merge(duplicated, on="product", validate="many_to_many")
    with pytest.raises(ValueError, match="same story"):
        left.merge(DataStory().table(products), on="product")


def test_merge_nullable_keys_and_suffix_lineage():
    s = DataStory()
    a = pd.DataFrame({"k": [None, "x"], "v": [10, 20]})
    b = pd.DataFrame({"k": [None, "x"], "v": [100, 200]})
    merged = s.table(a, name="a").merge(s.table(b, name="b"), on="k")
    pd.testing.assert_frame_equal(merged.to_pandas(), a.merge(b, on="k", how="left", sort=False))
    assert merged.explain(0, "v_x")[0].value == 10
    assert merged.explain(0, "v_y")[0].value == 100


@pytest.mark.parametrize("dropna,expected", [(False, 460), (True, 420)])
def test_group_missing_categories(sales, products, dropna, expected):
    s = DataStory()
    joined = s.table(sales).filter_rows(lambda x: x["paid"]).merge(s.table(products), on="product")
    result = joined.group_sum(by="category", value="amount", dropna=dropna)
    assert result.to_pandas()["amount"].sum() == expected


def test_all_missing_and_empty_groups():
    s = DataStory()
    df = pd.DataFrame({"k": ["a", "a"], "v": pd.Series([pd.NA, pd.NA], dtype="Int64")})
    f = s.table(df)
    result = f.group_sum(by="k", value="v", dropna=False)
    assert pd.isna(result.to_pandas().loc[0, "v"])
    assert result.explain(0, "v") == ()
    assert (
        f.filter_rows([False, False]).group_sum(by="k", value="v", dropna=False).to_pandas().empty
    )


def test_limits_and_unsupported_values_are_atomic():
    s = DataStory(max_rows=1, max_columns=2, max_steps=1)
    with pytest.raises(CaptureLimitError):
        s.table(pd.DataFrame({"x": [1, 2]}))
    assert s.to_dict()["steps"] == []
    with pytest.raises(UnsupportedDataError):
        s.table(pd.DataFrame({"x": [[1, 2]]}))
    with pytest.raises(UnsupportedDataError):
        s.table(pd.DataFrame([[1, 2]], columns=["x", "x"]))
    s.table(pd.DataFrame({"x": [1]}))
    with pytest.raises(CaptureLimitError):
        s.table(pd.DataFrame({"x": [2]}))


def test_ancestor_export_excludes_unrelated_data():
    s = DataStory()
    selected = s.table(pd.DataFrame({"x": [1]}), name="selected")
    s.table(pd.DataFrame({"secret": ["DO_NOT_EXPORT"]}), name="unrelated")
    assert [x["name"] for x in s.to_dict(result=selected)["steps"]] == ["selected"]


def test_explanation_keeps_large_integer_precision_in_mixed_numeric_row():
    large = 2**60 + 1
    f = DataStory().table(pd.DataFrame({"large": [large], "fraction": [0.5]}))
    origin = f.explain(0, "large")[0]
    assert int(origin.value) == large


def test_annotations_only_change_presentation():
    s = DataStory()
    f = s.table(pd.DataFrame({"k": ["a", "a"], "v": [2, 3]}))
    out = f.group_sum(by="k", value="v", dropna=False)
    before = out.to_pandas()
    sources = out.explain(0, "v")
    s.annotate(out, note="Follow the values, then pause.", hold=4, highlight=["v"])
    pd.testing.assert_frame_equal(out.to_pandas(), before)
    assert out.explain(0, "v") == sources
    assert s.to_dict()["steps"][-1]["presentation"] == {
        "note": "Follow the values, then pause.",
        "hold_ms": 4000,
        "highlight": ["v"],
    }
    with pytest.raises(ValueError):
        s.annotate(out, hold=float("nan"))
    with pytest.raises(ValueError):
        s.annotate(out, highlight=["absent"])


@given(st.lists(st.tuples(st.sampled_from(["a", "b", None]), st.integers(-100, 100)), max_size=30))
@settings(max_examples=60, deadline=None)
def test_group_membership_and_values_generated(data):
    df = pd.DataFrame(data, columns=["key", "value"]).astype({"value": "int64"})
    f = DataStory().table(df).group_sum(by="key", value="value", dropna=False)
    expected = (
        df.groupby("key", dropna=False, sort=False, observed=True)["value"]
        .sum(min_count=1)
        .reset_index()
    )
    pd.testing.assert_frame_equal(f.to_pandas(), expected)
    for i, amount in enumerate(expected["value"]):
        assert sum(x.value for x in f.explain(i, "value")) == amount
