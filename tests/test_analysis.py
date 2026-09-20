"""Analysis pipelines retain pandas results and complete positional provenance."""

import base64
import gzip
import json
import re
import tracemalloc

import numpy as np
import pandas as pd
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from framechoreo import CaptureLimitError, DataStory


def test_analysis_pipeline_calculates_sorts_selects_and_renames():
    df = pd.DataFrame(
        {"store": ["b", "a", "a", "b"], "quantity": [2, 3, 1, 4], "price": [5, 4, 6, 2]},
        index=[9, 9, 3, 3],
    )
    story = DataStory.for_analysis()
    source = story.table(df)
    calculated = source.calculate("revenue", left="quantity", op="multiply", right="price")
    total = calculated.group_sum(by="store", value="revenue", dropna=False)
    result = (
        total.sort_values("revenue", ascending=False)
        .select_columns(["revenue", "store"])
        .rename_columns({"revenue": "sales"})
    )
    expected = (
        df.assign(revenue=df["quantity"] * df["price"])
        .groupby("store", dropna=False, sort=False, observed=True)["revenue"]
        .sum(min_count=1)
        .reset_index()
        .sort_values("revenue", ascending=False, kind="stable")
        .loc[:, ["revenue", "store"]]
        .rename(columns={"revenue": "sales"})
    )
    pd.testing.assert_frame_equal(result.to_pandas(), expected, check_exact=True)
    assert [(o.row, o.column, o.value) for o in result.explain(0, "sales")] == [
        (0, "quantity", 2),
        (0, "price", 5),
        (3, "quantity", 4),
        (3, "price", 2),
    ]
    assert json.loads(story.to_json()) == story.to_dict()


@pytest.mark.parametrize("op", ["add", "subtract", "multiply", "divide"])
def test_calculation_with_a_constant_matches_pandas(op):
    df = pd.DataFrame({"v": pd.Series([1, pd.NA, 3], dtype="Float32")})
    story = DataStory()
    source = story.table(df)
    result = source.calculate("answer", left="v", op=op, right=2)
    method = {"add": "add", "subtract": "sub", "multiply": "mul", "divide": "div"}[op]
    expected = df.assign(answer=getattr(df["v"], method)(2))
    pd.testing.assert_frame_equal(result.to_pandas(), expected, check_exact=True)
    assert [(o.row, o.column) for o in result.explain(1, "answer")] == [(1, "v")]


def test_stable_sort_keeps_row_identity_with_duplicate_indices_and_missing_keys():
    df = pd.DataFrame({"k": [2, 1, 1, None], "v": [20, 11, 12, 99]}, index=[4, 4, 4, 4])
    out = DataStory().table(df).sort_values("k", na_position="first")
    pd.testing.assert_frame_equal(
        out.to_pandas(), df.sort_values("k", kind="stable", na_position="first")
    )
    assert [out.explain(i, "v")[0].row for i in range(4)] == [3, 1, 2, 0]


@pytest.mark.parametrize("case", ["op", "overwrite", "text", "duplicate", "missing"])
def test_invalid_analysis_operations_do_not_append_a_step(case):
    story = DataStory()
    frame = story.table(pd.DataFrame({"v": [2], "text": ["two"]}))
    calls = {
        "op": lambda: frame.calculate("answer", left="v", op="eval", right=2),
        "overwrite": lambda: frame.calculate("v", left="v", op="add", right=2),
        "text": lambda: frame.calculate("answer", left="text", op="add", right=2),
        "duplicate": lambda: frame.rename_columns({"text": "v"}),
        "missing": lambda: frame.select_columns(["absent"]),
    }
    with pytest.raises(ValueError):
        calls[case]()
    assert len(story.to_dict()["steps"]) == 1


def test_cumulative_cell_limit_is_explicit_and_atomic():
    story = DataStory(max_rows=1000, max_cells=6)
    frame = story.table(pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]}))
    with pytest.raises(CaptureLimitError, match="max_cells"):
        frame.filter_rows([True, True, True])
    assert len(story.to_dict()["steps"]) == 1
    with pytest.raises(ValueError):
        story.max_cells = True
    assert story.max_cells == 6


def test_large_origin_pages_keep_exact_totals_order_and_multiplicity():
    story = DataStory(max_steps=50)
    source = story.table(pd.DataFrame({"k": ["a"] * 10, "v": [1] * 10}))
    repeat = story.table(pd.DataFrame({"k": ["a"] * 10}))
    result = source.group_sum(by="k", value="v", dropna=False)
    for _ in range(17):
        result = repeat.merge(result, on="k").group_sum(by="k", value="v", dropna=False)
    page = result.explain_page(0, "v", offset=10**18 - 2, limit=50)
    assert page.total == 10**18
    assert page.offset == 10**18 - 2
    assert [o.row for o in page.origins] == [8, 9]
    assert not page.has_next
    with pytest.raises(CaptureLimitError):
        result.explain(0, "v", max_sources=100)


def test_origin_pages_handle_empty_inputs_and_past_the_end():
    source = DataStory().table(pd.DataFrame({"k": ["a"], "v": pd.Series([pd.NA], dtype="Int64")}))
    result = source.group_sum(by="k", value="v", dropna=False, min_count=0)
    assert result.explain_page(0, "v").total == 0
    assert result.explain_page(0, "v").origins == ()
    assert source.explain_page(0, "v", offset=1).origins == ()
    for kwargs in [{"offset": -1}, {"limit": True}, {"limit": 0}]:
        with pytest.raises(ValueError):
            source.explain_page(0, "v", **kwargs)


def test_compressed_html_keeps_complete_data_and_is_repeatable():
    story = DataStory.for_analysis()
    story.table(pd.DataFrame({"v": ["</script> 日本語" + str(i) for i in range(1000)]}))
    html = story.to_html(compression="gzip")
    match = re.search(r'<script id="framechoreo-data"[^>]*>(.*?)</script>', html, re.S)
    assert 'data-encoding="gzip-base64"' in html
    decoded = gzip.decompress(base64.b64decode(match.group(1)))
    assert json.loads(decoded) == story.to_dict()
    assert html == story.to_html(compression="gzip")
    assert len(html) < len(story.to_html(compression="none"))
    story.max_export_bytes = 100
    with pytest.raises(CaptureLimitError):
        story.to_html(compression="gzip")


@given(
    rows=st.lists(
        st.tuples(
            st.sampled_from([0, 1, 2, None]),
            st.one_of(st.integers(-8, 8), st.none()),
            st.one_of(st.integers(-9, 9), st.none()),
        ),
        max_size=25,
    ),
    dropna=st.booleans(),
)
@settings(max_examples=80, deadline=None)
def test_composed_analysis_operations_preserve_independent_source_membership(rows, dropna):
    df = pd.DataFrame(rows, columns=["key", "quantity", "price"]).astype(
        {"key": "object", "quantity": "Int64", "price": "Int64"}
    )
    df.index = [i // 2 for i in range(len(df))]
    source = DataStory().table(df)
    result = (
        source.calculate("amount", left="quantity", op="multiply", right="price")
        .calculate("adjusted", left="amount", op="add", right=1)
        .rename_columns({"key": "segment"})
        .sort_values(["segment", "adjusted"], ascending=[True, False], na_position="first")
        .select_columns(["segment", "adjusted"])
        .group_sum(by="segment", value="adjusted", dropna=dropna)
    )
    sorted_native = df.assign(
        adjusted=df["quantity"] * df["price"] + 1, source_position=range(len(df))
    )
    sorted_native = sorted_native.rename(columns={"key": "segment"}).sort_values(
        ["segment", "adjusted"], ascending=[True, False], na_position="first", kind="stable"
    )
    expected = (
        sorted_native.groupby("segment", dropna=dropna, sort=False, observed=True)["adjusted"]
        .sum(min_count=1)
        .reset_index()
    )
    pd.testing.assert_frame_equal(result.to_pandas(), expected, check_exact=True)
    for row, key in enumerate(expected["segment"]):
        wanted = []
        for position in sorted_native["source_position"]:
            source_key, quantity, price = rows[position]
            same = (pd.isna(key) and source_key is None) or (not pd.isna(key) and source_key == key)
            if same and quantity is not None and price is not None:
                wanted.extend([(position, "quantity"), (position, "price")])
        assert [(o.row, o.column) for o in result.explain(row, "adjusted")] == wanted


def test_analysis_labels_and_repeated_arithmetic_operands_keep_their_meaning():
    story = DataStory()
    frame = story.table(pd.DataFrame({"v": [7]}))
    square = frame.calculate("square", left="v", op="multiply", right="v", label="x" * 400)
    assert square.to_pandas()["square"].tolist() == [49]
    assert [o.value for o in square.explain(0, "square")] == [7, 7]
    assert square.explain_page(0, "square", offset=1, limit=1).origins[0].value == 7


@pytest.mark.parametrize("compression", [None, [], True, "zip"])
def test_bad_compression_options_fail_explicitly(compression):
    story = DataStory()
    story.table(pd.DataFrame({"v": [1]}))
    with pytest.raises(ValueError, match="compression"):
        story.to_html(compression=compression)


def test_numpy_duration_is_not_a_numeric_calculation_constant():
    story = DataStory()
    frame = story.table(pd.DataFrame({"v": [2]}))
    with pytest.raises(ValueError, match="numeric"):
        frame.calculate("duration", left="v", op="multiply", right=np.timedelta64(1, "s"))
    assert len(story.to_dict()["steps"]) == 1


def test_compressed_export_does_not_build_an_expanded_html_escape_copy():
    from framechoreo.export import render_html

    story = DataStory.for_analysis()
    story.table(pd.DataFrame({"text": ["<" * 1024] * 1000}))
    data = story.to_json()
    size = len(data.encode("utf-8"))
    tracemalloc.start()
    try:
        html = render_html(data, story.title, "auto", compression="gzip")
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert 'data-encoding="gzip-base64"' in html
    assert peak < size * 3
