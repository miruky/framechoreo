"""Analysis contracts: pandas values/dtypes and independently checked input identities."""

from decimal import Decimal

import pandas as pd
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from framechoreo import CaptureLimitError, DataStory


def refs(frame, row, column):
    return [(o.source, o.row, o.column) for o in frame.explain(row, column)]


@pytest.mark.parametrize("how", ["any", "all"])
def test_drop_missing_uses_selected_columns_and_keeps_duplicate_index(how):
    df = pd.DataFrame({"a": [1.0, None, None, 4.0], "b": [2.0, 3.0, None, 5.0]}, index=[0, 0, 1, 1])
    story = DataStory()
    result = story.table(df, name="raw").drop_missing(subset=["a", "b"], how=how)
    pd.testing.assert_frame_equal(result.to_pandas(), df.dropna(subset=["a", "b"], how=how))
    positions = [0, 3] if how == "any" else [0, 1, 3]
    assert [refs(result, i, "b") for i in range(len(positions))] == [
        [("raw", position, "b")] for position in positions
    ]


@pytest.mark.parametrize("keep", ["first", "last", False])
def test_deduplication_keeps_native_values_and_positional_identity(keep):
    df = pd.DataFrame({"key": ["x", "x", None, None, "y"], "v": [1, 2, 3, 4, 5]}, index=[7] * 5)
    result = DataStory().table(df, name="raw").drop_duplicates(subset="key", keep=keep)
    pd.testing.assert_frame_equal(result.to_pandas(), df.drop_duplicates(subset=["key"], keep=keep))
    positions = [
        i for i, duplicate in enumerate(df.duplicated(["key"], keep=keep)) if not duplicate
    ]
    assert [refs(result, i, "v") for i in range(len(positions))] == [
        [("raw", p, "v")] for p in positions
    ]


def test_fill_records_constants_without_inventing_raw_value_inputs():
    df = pd.DataFrame({"x": pd.Series([1, None, 3], dtype="Int64"), "label": ["a", None, "c"]})
    story = DataStory()
    result = story.table(df, name="raw").fill_missing({"x": 0, "label": "unknown"})
    pd.testing.assert_frame_equal(result.to_pandas(), df.fillna({"x": 0, "label": "unknown"}))
    assert result.explain(1, "x") == ()
    assert result.explain(1, "label") == ()
    assert refs(result, 0, "x") == [("raw", 0, "x")]
    p = story.to_dict()["steps"][-1]["parameters"]
    assert p["filled_positions"] == {"x": [1], "label": [1]}
    assert p["values"]["x"]["display"] == "0"


def test_numeric_datetime_string_and_type_conversions_keep_original_inputs():
    df = pd.DataFrame(
        {"n": [" 12 ", "oops", "7"], "day": ["2026-01-01", "bad", None], "s": [" A ", None, "B"]}
    )
    story = DataStory()
    source = story.table(df, name="raw")
    result = (
        source.to_numeric("n", errors="coerce")
        .to_datetime("day", format="%Y-%m-%d", errors="coerce")
        .string_transform("s", op="strip")
        .string_transform("s", op="lower")
    )
    expected = df.copy()
    expected["n"] = pd.to_numeric(df["n"], errors="coerce")
    expected["day"] = pd.to_datetime(df["day"], format="%Y-%m-%d", errors="coerce")
    expected["s"] = df["s"].str.strip().str.lower()
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    assert refs(result, 0, "s") == [("raw", 0, "s")]
    assert refs(result, 1, "n") == [("raw", 1, "n")]
    cast = result.astype({"n": "Int64"})
    pd.testing.assert_frame_equal(cast.to_pandas(), expected.astype({"n": "Int64"}))
    assert cast.explain(0, "n")[0].value == " 12 "


def test_take_can_reorder_and_repeat_rows_without_collapsing_sources():
    df = pd.DataFrame({"v": [5, 6, 7]}, index=[1, 1, 1])
    source = DataStory().table(df, name="raw")
    result = source.take_rows([2, 0, 2])
    pd.testing.assert_frame_equal(result.to_pandas(), df.iloc[[2, 0, 2]])
    assert [refs(result, i, "v") for i in range(3)] == [[("raw", p, "v")] for p in [2, 0, 2]]


@pytest.mark.parametrize("join", ["outer", "inner"])
def test_vertical_concat_handles_schema_gaps_repeated_frames_and_branches(join):
    story = DataStory()
    a = pd.DataFrame({"key": ["a", "b"], "x": [1, 2]})
    b = pd.DataFrame({"key": ["c"], "y": [3]})
    fa, fb = story.table(a, name="A"), story.table(b, name="B")
    result = story.concat([fa, fb, fa], join=join)
    pd.testing.assert_frame_equal(
        result.to_pandas(), pd.concat([a, b, a], join=join, ignore_index=True)
    )
    assert refs(result, 2, "key") == [("B", 0, "key")]
    assert refs(result, 4, "key") == [("A", 1, "key")]
    if join == "outer":
        assert result.explain(2, "x") == ()
        assert result.explain(0, "y") == ()
    assert len(story.to_dict()["steps"]) == 3


def test_melt_and_pivot_preserve_values_and_cell_origins():
    df = pd.DataFrame({"item": ["b", "a"], "Jan": [10, 20], "Feb": [30, 40]}, index=[0, 0])
    story = DataStory()
    source = story.table(df, name="raw")
    long = source.melt(
        id_vars="item", value_vars=["Jan", "Feb"], var_name="month", value_name="sales"
    )
    expected = df.melt(
        id_vars=["item"], value_vars=["Jan", "Feb"], var_name="month", value_name="sales"
    )
    pd.testing.assert_frame_equal(long.to_pandas(), expected)
    assert refs(long, 2, "sales") == [("raw", 0, "Feb")]
    assert long.explain(2, "month") == ()
    wide = long.pivot(index="item", columns="month", values="sales")
    pd.testing.assert_frame_equal(
        wide.to_pandas(),
        expected.pivot(index=["item"], columns="month", values="sales").reset_index(),
    )
    assert refs(wide, 0, "Feb") == [("raw", 1, "Feb")]


def test_pivot_distinguishes_absent_combinations_from_recorded_missing_values():
    df = pd.DataFrame(
        {"id": ["a", "a", "b"], "month": ["Jan", "Feb", "Jan"], "v": [1.0, None, 2.0]}
    )
    result = DataStory().table(df, name="raw").pivot(index="id", columns="month", values="v")
    pd.testing.assert_frame_equal(
        result.to_pandas(), df.pivot(index=["id"], columns="month", values="v").reset_index()
    )
    assert refs(result, 0, "Feb") == [("raw", 1, "v")]
    assert result.explain(1, "Feb") == ()


@pytest.mark.parametrize("dropna", [False, True])
@pytest.mark.parametrize("sort", [False, True])
def test_named_aggregation_matches_pandas_and_traces_each_metric(dropna, sort):
    df = pd.DataFrame(
        {
            "key": ["b", "a", "a", None, "b"],
            "v": pd.Series([1, 5, 3, 8, None], dtype="Int64"),
            "who": ["x", "x", "x", "y", "z"],
        }
    )
    story = DataStory()
    metrics = {
        "total": ("v", "sum"),
        "average": ("v", "mean"),
        "low": ("v", "min"),
        "high": ("v", "max"),
        "middle": ("v", "median"),
        "valid": ("v", "count"),
        "people": ("who", "nunique"),
    }
    result = story.table(df, name="raw").group_agg(
        by="key", aggregations=metrics, dropna=dropna, sort=sort
    )
    grouped = df.groupby(["key"], dropna=dropna, sort=sort, observed=True)
    expected = grouped.agg(**metrics).reset_index()
    expected["total"] = grouped["v"].sum(min_count=1).array
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    a = result.to_pandas().index[result.to_pandas()["key"].eq("a")][0]
    assert refs(result, int(a), "average") == [("raw", 1, "v"), ("raw", 2, "v")]
    assert refs(result, int(a), "people") == [("raw", 1, "who"), ("raw", 2, "who")]


@pytest.mark.parametrize("how", ["left", "inner", "right", "outer"])
def test_join_with_distinct_key_names_and_missing_sides(how):
    a = pd.DataFrame({"sku": ["a", "b", None], "v": [1, 2, 3]})
    b = pd.DataFrame({"code": ["a", "c", None], "v": [10, 20, 30]})
    story = DataStory()
    result = story.table(a, name="A").merge(
        story.table(b, name="B"), left_on="sku", right_on="code", how=how, validate="one_to_one"
    )
    pd.testing.assert_frame_equal(
        result.to_pandas(),
        a.merge(b, left_on="sku", right_on="code", how=how, validate="one_to_one", sort=False),
    )
    for row, record in result.to_pandas().iterrows():
        if pd.isna(record["v_x"]):
            assert result.explain(int(row), "v_x") == ()
        if pd.isna(record["v_y"]):
            assert result.explain(int(row), "v_y") == ()


def test_one_to_many_join_and_outer_coalesced_key():
    story = DataStory()
    a, b = pd.DataFrame({"k": ["x", "y"]}), pd.DataFrame({"k": ["x", "x", "z"], "v": [1, 2, 3]})
    result = story.table(a, name="A").merge(
        story.table(b, name="B"), on="k", how="outer", validate="one_to_many"
    )
    pd.testing.assert_frame_equal(
        result.to_pandas(), a.merge(b, on="k", how="outer", validate="one_to_many", sort=False)
    )
    assert refs(result, 3, "k") == [("B", 2, "k")]


def test_quality_profile_and_story_presentation_are_detached():
    story = DataStory(title="分析", description="処理の説明", language="ja")
    frame = story.table(pd.DataFrame({"k": ["x", "x", None], "v": [1, 1, 2]}))
    profile = frame.profile()
    assert profile["rows"] == 3 and profile["duplicate_rows"] == 1
    assert profile["columns"][0]["missing"] == 1
    assert profile["columns"][1]["unique"] == 2
    profile["columns"][0]["missing"] = 999
    assert frame.profile()["columns"][0]["missing"] == 1
    assert story.to_dict()["language"] == "ja"
    assert story.to_dict()["description"] == "処理の説明"


@pytest.mark.parametrize(
    "operation",
    [
        lambda f: f.drop_missing(subset=["absent"]),
        lambda f: f.fill_missing({"missing": 0}),
        lambda f: f.drop_duplicates(keep="middle"),
        lambda f: f.astype({"v": "not-a-dtype"}),
        lambda f: f.to_numeric("v", errors="ignore"),
        lambda f: f.to_datetime("v", format="", errors="ignore"),
        lambda f: f.string_transform("v", op="eval"),
        lambda f: f.take_rows([True]),
        lambda f: f.take_rows([99]),
        lambda f: f.melt(id_vars="v", value_vars="v"),
        lambda f: f.pivot(index="v", columns="v", values="v"),
        lambda f: f.group_agg(by="k", aggregations={"k": ("v", "sum")}, dropna=False),
        lambda f: f.group_agg(by="k", aggregations={"x": ("v", "callable")}, dropna=False),
    ],
)
def test_bad_workflow_requests_do_not_append_a_step(operation):
    story = DataStory()
    source = story.table(pd.DataFrame({"k": ["x", "y"], "v": ["1", "2"]}))
    with pytest.raises((ValueError, TypeError, IndexError)):
        operation(source)
    assert len(story.to_dict()["steps"]) == 1


def test_expanding_operations_respect_capture_guards():
    story = DataStory(max_rows=2)
    source = story.table(pd.DataFrame({"k": ["x", "y"], "a": [1, 2], "b": [3, 4]}))
    with pytest.raises(CaptureLimitError):
        story.concat([source, source])
    with pytest.raises(CaptureLimitError):
        source.melt(id_vars="k", value_vars=["a", "b"])
    assert len(story.to_dict()["steps"]) == 1


def test_empty_workflows_and_decimal_profiles():
    story = DataStory()
    frame = story.table(
        pd.DataFrame({"k": pd.Series([], dtype="str"), "v": pd.Series([], dtype="float64")})
    )
    for result in [
        frame.drop_missing(),
        frame.drop_duplicates(),
        frame.take_rows([]),
        story.concat([frame]),
        frame.group_agg(by="k", aggregations={"total": ("v", "sum")}, dropna=False),
    ]:
        assert result.to_pandas().empty
    decimal = story.table(pd.DataFrame({"x": [Decimal("1.00"), Decimal("NaN")]}))
    assert decimal.profile()["columns"][0]["missing"] == 1


def test_export_embeds_player_notice_separately_from_customer_content():
    from pathlib import Path

    story = DataStory(language="ja")
    story.table(pd.DataFrame({"data": ["Customer-owned text"]}))
    html = story.to_html(compression="none")
    license_text = (Path(__file__).parents[1] / "LICENSE").read_text().strip()
    assert license_text in html
    assert 'id="framechoreo-license"' in html
    assert 'lang="ja"' in html
    assert "データや説明文のライセンスは変更しません" in html


@settings(max_examples=80, deadline=None, derandomize=True)
@given(
    st.lists(
        st.tuples(st.sampled_from(["a", "b", None]), st.one_of(st.none(), st.integers(-100, 100))),
        max_size=12,
    ),
    st.booleans(),
    st.booleans(),
)
def test_named_metrics_property_matches_pandas_and_independent_membership(pairs, dropna, sort):
    df = pd.DataFrame(
        {
            "k": pd.Series([p[0] for p in pairs], dtype=object),
            "v": pd.Series([p[1] for p in pairs], dtype="Int64"),
        }
    )
    spec = {
        name: ("v", name) for name in ["sum", "mean", "median", "min", "max", "count", "nunique"]
    }
    result = (
        DataStory()
        .table(df, name="raw")
        .group_agg(by="k", aggregations=spec, dropna=dropna, sort=sort)
    )
    grouped = df.groupby(["k"], dropna=dropna, sort=sort, observed=True)
    expected = grouped.agg(**spec).reset_index()
    expected["sum"] = grouped["v"].sum(min_count=1).array
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    for i, row in expected.iterrows():
        key = None if pd.isna(row["k"]) else row["k"]
        members = [j for j, pair in enumerate(pairs) if pair[0] == key and pair[1] is not None]
        for metric in spec:
            assert refs(result, int(i), metric) == [("raw", j, "v") for j in members]


@settings(max_examples=80, deadline=None, derandomize=True)
@given(
    st.lists(
        st.tuples(
            st.one_of(st.none(), st.integers(-20, 20)), st.one_of(st.none(), st.integers(-20, 20))
        ),
        max_size=9,
    )
)
def test_reshape_property_preserves_each_value_source(pairs):
    df = pd.DataFrame(
        {
            "id": pd.Series([f"r{i}" for i in range(len(pairs))], dtype=object),
            "a": pd.Series([p[0] for p in pairs], dtype="Int64"),
            "b": pd.Series([p[1] for p in pairs], dtype="Int64"),
        }
    )
    source = DataStory().table(df, name="raw")
    long = source.melt(id_vars="id", value_vars=["a", "b"])
    expected = df.melt(id_vars=["id"], value_vars=["a", "b"])
    pd.testing.assert_frame_equal(long.to_pandas(), expected)
    for i in range(len(df)):
        assert refs(long, i, "value") == [("raw", i, "a")]
        assert refs(long, i + len(df), "value") == [("raw", i, "b")]
    wide = long.pivot(index="id", columns="variable", values="value")
    pd.testing.assert_frame_equal(
        wide.to_pandas(),
        expected.pivot(index=["id"], columns="variable", values="value").reset_index(),
    )


@pytest.mark.parametrize("value", [None, True, 1, [], {"x": "ja"}])
def test_language_assignment_is_atomic(value):
    story = DataStory(language="ja")
    with pytest.raises(ValueError):
        story.language = value
    assert story.language == "ja"


def test_empty_and_all_missing_text_columns_remain_missing():
    df = pd.DataFrame({"text": [None, None]})
    result = DataStory().table(df).string_transform("text", op="strip")
    pd.testing.assert_frame_equal(result.to_pandas(), df)


def test_duplicate_pivot_keys_fail_without_adding_a_record():
    story = DataStory()
    frame = story.table(pd.DataFrame({"id": ["x", "x"], "metric": ["v", "v"], "value": [1, 2]}))
    with pytest.raises(ValueError, match="duplicate"):
        frame.pivot(index="id", columns="metric", values="value")
    assert len(story.to_dict()["steps"]) == 1


def test_concat_preserves_index_when_requested_and_rejects_other_stories():
    story = DataStory()
    df = pd.DataFrame({"v": [1, 2]}, index=[4, 4])
    source = story.table(df)
    result = story.concat([source, source], ignore_index=False)
    pd.testing.assert_frame_equal(result.to_pandas(), pd.concat([df, df]))
    before = len(story.to_dict()["steps"])
    with pytest.raises(ValueError):
        story.concat([source, DataStory().table(df)])
    assert len(story.to_dict()["steps"]) == before


def test_datetime_utc_and_named_date_minimum_match_native_pandas():
    df = pd.DataFrame(
        {"k": ["x", "x"], "d": ["2026-01-01T00:00:00+09:00", "2026-01-02T00:00:00+09:00"]}
    )
    source = DataStory().table(df, name="raw")
    dated = source.to_datetime("d", format="ISO8601", utc=True)
    expected = df.copy()
    expected["d"] = pd.to_datetime(df["d"], format="ISO8601", utc=True)
    pd.testing.assert_frame_equal(dated.to_pandas(), expected)
    result = dated.group_agg(by="k", aggregations={"first": ("d", "min")}, dropna=False)
    pd.testing.assert_frame_equal(
        result.to_pandas(),
        expected.groupby(["k"], dropna=False, sort=False, observed=True)
        .agg(first=("d", "min"))
        .reset_index(),
    )
    assert refs(result, 0, "first") == [("raw", 0, "d"), ("raw", 1, "d")]


def test_shape_operations_keep_prototype_like_column_names_safe():
    df = pd.DataFrame({"__proto__": ["x"], "constructor": [2], "other": [3]})
    story = DataStory()
    source = story.table(df)
    long = source.melt(
        id_vars="__proto__",
        value_vars=["constructor", "other"],
        var_name="field",
        value_name="value",
    )
    wide = long.pivot(index="__proto__", columns="field", values="value")
    pd.testing.assert_frame_equal(
        wide.to_pandas(),
        df.melt(
            id_vars=["__proto__"],
            value_vars=["constructor", "other"],
            var_name="field",
            value_name="value",
        )
        .pivot(index=["__proto__"], columns="field", values="value")
        .reset_index(),
    )


def test_named_metrics_can_use_names_that_are_pandas_parameters():
    df = pd.DataFrame({"k": ["a", "a"], "v": [1, 3]})
    metrics = {
        "func": ("v", "sum"),
        "engine": ("v", "mean"),
        "engine_kwargs": ("v", "count"),
        "__proto__": ("v", "max"),
    }
    result = DataStory().table(df, name="raw").group_agg(by="k", aggregations=metrics, dropna=False)
    expected = pd.DataFrame(
        {"k": ["a"], "func": [4], "engine": [2.0], "engine_kwargs": [2], "__proto__": [3]}
    )
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    assert refs(result, 0, "func") == [("raw", 0, "v"), ("raw", 1, "v")]
