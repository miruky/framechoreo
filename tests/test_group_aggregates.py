"""group_mean and group_count follow group_sum's contract for membership and provenance.

group_count reports non-missing entries of a column, not the row count of the group.
"""

import pandas as pd
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from framechoreo import CaptureLimitError, DataStory, UnsupportedDataError


def test_group_mean_matches_pandas_and_explains(sales, products):
    story = DataStory(title="Sales")
    orders = story.table(sales, name="sales")
    catalog = story.table(products, name="products")
    paid = orders.filter_rows(lambda df: df["paid"])
    joined = paid.merge(catalog, on="product", how="left", validate="many_to_one")
    average = joined.group_mean(by="category", value="amount", dropna=False)
    expected = (
        sales.loc[sales["paid"]]
        .merge(products, on="product", how="left", validate="many_to_one", sort=False)
        .groupby("category", dropna=False, sort=False, observed=True)["amount"]
        .mean()
        .reset_index()
    )
    pd.testing.assert_frame_equal(average.to_pandas(), expected)
    assert [x.value for x in average.explain(0, "amount")] == [120, 150]
    assert "min_count" not in story.to_dict()["steps"][-1]["parameters"]


def test_group_count_matches_pandas_and_is_not_row_count():
    df = pd.DataFrame(
        {"k": ["a", "a", "a", "b"], "v": pd.Series([1, pd.NA, 3, pd.NA], dtype="Int64")}
    )
    story = DataStory()
    result = story.table(df).group_count(by="k", value="v", dropna=False)
    expected = df.groupby("k", dropna=False, sort=False, observed=True)["v"].count().reset_index()
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    counts = dict(zip(result.to_pandas()["k"], result.to_pandas()["v"], strict=True))
    row_counts = df.groupby("k", dropna=False, sort=False, observed=True).size().to_dict()
    assert counts == {"a": 2, "b": 0}
    assert counts != row_counts
    assert [o.value for o in result.explain(0, "v")] == [1, 3]
    assert result.explain(1, "v") == ()
    assert "min_count" not in story.to_dict()["steps"][-1]["parameters"]


@pytest.mark.parametrize("operation", ["group_mean", "group_count"])
@pytest.mark.parametrize("sort", [False, True])
@pytest.mark.parametrize("dropna", [False, True])
@pytest.mark.parametrize("categorical", [False, True])
def test_multiple_group_keys_and_categories(operation, sort, dropna, categorical):
    df = pd.DataFrame(
        {
            "a": ["b", "a", None, "b", "a", "b"],
            "b": [2, 1, 2, 1, 1, 2],
            "v": pd.Series([2, pd.NA, 5, 7, 3, -1], dtype="Int64"),
        }
    )
    if categorical:
        df["a"] = pd.Categorical(df["a"], categories=["a", "b", "unused"])
    method = getattr(DataStory().table(df), operation)
    result = method(by=["a", "b"], value="v", dropna=dropna, sort=sort)
    grouped = df.groupby(["a", "b"], dropna=dropna, sort=sort, observed=True)["v"]
    expected = (grouped.mean() if operation == "group_mean" else grouped.count()).reset_index()
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    for row, amount in enumerate(expected["v"]):
        origins = [origin.value for origin in result.explain(row, "v")]
        assert all(pd.notna(v) for v in origins)
        if operation == "group_count":
            assert len(origins) == amount
        elif origins:
            assert sum(origins) / len(origins) == amount
        else:
            assert pd.isna(amount)


def test_multiple_aggregate_columns_from_the_same_source():
    df = pd.DataFrame(
        {
            "region": ["east", "east", "west"],
            "price": pd.Series([10.0, 20.0, pd.NA], dtype="Float64"),
            "email": ["a@x.com", None, "b@x.com"],
        }
    )
    story = DataStory()
    source = story.table(df)
    average_price = source.group_mean(by="region", value="price", dropna=False)
    email_count = source.group_count(by="region", value="email", dropna=False)
    prices = average_price.to_pandas().set_index("region")["price"]
    assert prices.loc["east"] == 15.0
    assert pd.isna(prices.loc["west"])
    counts = email_count.to_pandas().set_index("region")["email"].to_dict()
    assert counts == {"east": 1, "west": 1}
    assert [o.value for o in average_price.explain(0, "price")] == [10.0, 20.0]
    assert [o.value for o in email_count.explain(0, "email")] == ["a@x.com"]
    mean_steps = story.to_dict(result=average_price)["steps"]
    count_steps = story.to_dict(result=email_count)["steps"]
    assert mean_steps[-1]["operation"] == "group_mean"
    assert mean_steps[-1]["parameters"]["value"] == "price"
    assert count_steps[-1]["operation"] == "group_count"
    assert count_steps[-1]["parameters"]["value"] == "email"


def test_group_count_accepts_non_numeric_columns():
    df = pd.DataFrame(
        {
            "k": ["a", "a", "b"],
            "label": ["x", None, "y"],
            "flag": pd.Series([True, None, False], dtype="boolean"),
            "when": pd.to_datetime(["2026-01-01", None, "2026-01-02"]),
        }
    )
    story = DataStory()
    f = story.table(df)
    assert f.group_count(by="k", value="label", dropna=False).to_pandas()["label"].tolist() == [
        1,
        1,
    ]
    assert f.group_count(by="k", value="flag", dropna=False).to_pandas()["flag"].tolist() == [1, 1]
    assert f.group_count(by="k", value="when", dropna=False).to_pandas()["when"].tolist() == [1, 1]


def test_group_mean_rejects_non_numeric_and_boolean_columns():
    df = pd.DataFrame({"k": ["a"], "label": ["x"], "flag": [True]})
    f = DataStory().table(df)
    with pytest.raises(UnsupportedDataError):
        f.group_mean(by="k", value="label", dropna=False)
    with pytest.raises(UnsupportedDataError):
        f.group_mean(by="k", value="flag", dropna=False)


def test_duplicate_index_is_not_identity(sales):
    sales.index = [0, 0, 1, 1, 2, 2]
    s = DataStory()
    f = s.table(sales)
    mean = f.group_mean(by="product", value="amount", dropna=False)
    count = f.group_count(by="product", value="amount", dropna=False)
    expected_mean = (
        sales.groupby("product", dropna=False, sort=False, observed=True)["amount"]
        .mean()
        .reset_index()
    )
    expected_count = (
        sales.groupby("product", dropna=False, sort=False, observed=True)["amount"]
        .count()
        .reset_index()
    )
    pd.testing.assert_frame_equal(mean.to_pandas(), expected_mean)
    pd.testing.assert_frame_equal(count.to_pandas(), expected_count)


def test_all_missing_group_mean_is_missing_and_count_is_zero():
    df = pd.DataFrame({"k": ["a", "a"], "v": pd.Series([pd.NA, pd.NA], dtype="Int64")})
    f = DataStory().table(df)
    mean = f.group_mean(by="k", value="v", dropna=False)
    assert pd.isna(mean.to_pandas().loc[0, "v"])
    assert mean.explain(0, "v") == ()
    count = f.group_count(by="k", value="v", dropna=False)
    assert count.to_pandas().loc[0, "v"] == 0
    assert count.explain(0, "v") == ()
    empty = f.filter_rows([False, False])
    assert empty.group_mean(by="k", value="v", dropna=False).to_pandas().empty
    assert empty.group_count(by="k", value="v", dropna=False).to_pandas().empty


def test_multiple_uses_preserve_multiplicity_mean_and_count():
    s = DataStory()
    source = s.table(pd.DataFrame({"k": ["a", "a"], "v": [2, 3]}), name="source")
    mean = source.group_mean(by="k", value="v", dropna=False)
    repeated_mean = source.merge(mean, on="k").group_mean(by="k", value="v_y", dropna=False)
    assert repeated_mean.to_pandas()["v_y"].tolist() == [2.5]
    # explain() traces raw source cells only; the mean cell is reused by both
    # merged rows, so its two raw inputs appear twice, not the averaged value.
    assert [x.value for x in repeated_mean.explain(0, "v_y")] == [2, 3, 2, 3]
    with pytest.raises(CaptureLimitError):
        repeated_mean.explain(0, "v_y", max_sources=3)

    count = source.group_count(by="k", value="v", dropna=False)
    repeated_count = source.merge(count, on="k").group_count(by="k", value="v_y", dropna=False)
    assert repeated_count.to_pandas()["v_y"].tolist() == [2]
    assert [x.value for x in repeated_count.explain(0, "v_y")] == [2, 3, 2, 3]


def test_explain_page_offsets_and_totals_match_for_mean_and_count():
    s = DataStory()
    source = s.table(pd.DataFrame({"k": ["a"] * 6, "v": list(range(6))}))
    mean = source.group_mean(by="k", value="v", dropna=False)
    page = mean.explain_page(0, "v", offset=2, limit=3)
    assert page.total == 6
    assert [o.value for o in page.origins] == [2, 3, 4]
    assert page.has_next is True
    last = mean.explain_page(0, "v", offset=5, limit=3)
    assert last.has_next is False
    assert [o.value for o in last.origins] == [5]

    count = source.group_count(by="k", value="v", dropna=False)
    cpage = count.explain_page(0, "v", offset=0, limit=50)
    assert cpage.total == 6
    assert cpage.has_next is False


def test_annotations_only_change_presentation_for_mean_and_count():
    s = DataStory()
    f = s.table(pd.DataFrame({"k": ["a", "a"], "v": [2, 3]}))
    mean_out = f.group_mean(by="k", value="v", dropna=False)
    before = mean_out.to_pandas()
    sources = mean_out.explain(0, "v")
    s.annotate(mean_out, note="Follow the average.", hold=3, highlight=["v"])
    pd.testing.assert_frame_equal(mean_out.to_pandas(), before)
    assert mean_out.explain(0, "v") == sources
    assert s.to_dict()["steps"][-1]["presentation"]["note"] == "Follow the average."


def test_bad_requests_do_not_append_steps_for_mean_and_count():
    s = DataStory()
    f = s.table(pd.DataFrame({"k": ["x"], "v": [1]}))
    before = len(s.to_dict()["steps"])
    for request in [
        lambda: f.group_mean(by="k", value="k", dropna=False),
        lambda: f.group_mean(by="k", value="v", dropna="false"),
        lambda: f.group_mean(by="k", value="v", dropna=False, sort="false"),
        lambda: f.group_count(by="k", value="k", dropna=False),
        lambda: f.group_count(by="k", value="v", dropna="false"),
        lambda: f.group_count(by="k", value="absent", dropna=False),
    ]:
        with pytest.raises(ValueError):
            request()
        assert len(s.to_dict()["steps"]) == before


@given(st.lists(st.tuples(st.sampled_from(["a", "b", None]), st.integers(-100, 100)), max_size=30))
@settings(max_examples=60, deadline=None)
def test_group_membership_and_values_generated_mean_and_count(data):
    df = pd.DataFrame(data, columns=["key", "value"]).astype({"value": "int64"})
    story = DataStory()
    f = story.table(df)
    mean = f.group_mean(by="key", value="value", dropna=False)
    count = f.group_count(by="key", value="value", dropna=False)
    expected_mean = (
        df.groupby("key", dropna=False, sort=False, observed=True)["value"].mean().reset_index()
    )
    expected_count = (
        df.groupby("key", dropna=False, sort=False, observed=True)["value"].count().reset_index()
    )
    pd.testing.assert_frame_equal(mean.to_pandas(), expected_mean)
    pd.testing.assert_frame_equal(count.to_pandas(), expected_count)
    for i, n in enumerate(expected_count["value"]):
        assert len(count.explain(i, "value")) == n
