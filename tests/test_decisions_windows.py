"""Conditional and ordered calculations keep value inputs separate from decisions."""

import pandas as pd
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from framechoreo import CaptureLimitError, DataStory, col


def origins(frame, row, field):
    return [(o.source, o.row, o.column) for o in frame.explain(row, field)]


def test_case_when_traces_only_selected_value_and_both_comparison_columns():
    source = pd.DataFrame(
        {
            "score": pd.Series([12, 7, None], dtype="Int64"),
            "limit": [10, 10, 10],
            "pass": ["yes", "yes", "yes"],
            "fail": ["no", "no", "no"],
        },
    )
    source.index = [8, 8, 8]
    story = DataStory()
    result = story.table(source, name="raw").case_when(
        "status",
        column="score",
        op="ge",
        value=col("limit"),
        then=col("pass"),
        otherwise=col("fail"),
    )
    assert result.to_pandas()["status"].tolist() == ["yes", "no", "no"]
    assert origins(result, 0, "status") == [("raw", 0, "pass")]
    assert origins(result, 1, "status") == [("raw", 1, "fail")]
    assert origins(result, 2, "status") == [("raw", 2, "fail")]
    assert [(o.row, o.column) for o in result.explain_controls(0, "status")] == [
        (0, "score"),
        (0, "limit"),
    ]
    assert result.explain_controls(0, "score") == ()
    step = story.to_dict()["steps"][-1]
    assert step["parameters"]["outcomes"] == ["true", "false", "missing"]
    assert step["rows"][0]["cell_controls"]["status"][0]["column"] == "score"


def test_case_when_constant_branches_have_no_invented_value_origin():
    frame = DataStory().table(pd.DataFrame({"x": [2, 0]}), name="raw")
    result = frame.case_when(
        "label", column="x", op="gt", value=0, then="positive", otherwise="other"
    )
    assert result.to_pandas()["label"].tolist() == ["positive", "other"]
    assert result.explain(0, "label") == ()
    assert [(o.row, o.column) for o in result.explain_controls(1, "label")] == [(1, "x")]
    missing = frame.case_when(
        "nullable", column="x", op="is_missing", then=None, otherwise=col("x")
    )
    assert missing.explain(0, "nullable")[0].value == 2
    assert missing.explain_controls(0, "nullable")[0].column == "x"


def test_filter_by_records_missing_and_rejected_decisions():
    frame = pd.DataFrame({"score": pd.Series([12, 7, None], dtype="Int64"), "id": [1, 2, 3]})
    story = DataStory()
    result = story.table(frame, name="raw").filter_by("score", op="ge", value=10)
    pd.testing.assert_frame_equal(result.to_pandas(), frame.iloc[[0]])
    assert story.to_dict()["steps"][-1]["parameters"]["outcomes"] == ["true", "false", "missing"]
    assert [result.filter_decision(i) for i in range(3)] == ["true", "false", "missing"]
    assert [(o.row, o.column) for o in result.explain_controls(0, "id")] == [(0, "score")]
    assert origins(result, 0, "id") == [("raw", 0, "id")]


def test_missingness_conditions_and_text_lag_across_multiple_keys():
    df = pd.DataFrame(
        {
            "region": ["N", "N", "N", "N"],
            "store": ["a", "b", "a", "a"],
            "memo": ["first", "other", None, "last"],
        }
    )
    df.index = [4, 4, 5, 5]
    source = DataStory().table(df, name="raw")
    missing = source.filter_by("memo", op="is_missing")
    assert missing.to_pandas()["store"].tolist() == ["a"]
    assert [missing.filter_decision(i) for i in range(4)] == ["false", "false", "true", "false"]
    lag = source.window("previous_memo", column="memo", op="lag", by=["region", "store"])
    expected = df.groupby(["region", "store"], sort=False, dropna=False)["memo"].shift()
    pd.testing.assert_series_equal(
        lag.to_pandas()["previous_memo"], expected.rename("previous_memo")
    )
    assert origins(lag, 3, "previous_memo") == [("raw", 2, "memo")]


def test_coalesce_uses_first_present_value_and_records_checked_fields():
    frame = pd.DataFrame({"primary": [None, 20, None], "backup": [5, 99, None]})
    frame.index = [8, 8, 8]
    story = DataStory()
    result = story.table(frame, name="raw").coalesce("effective", ["primary", "backup"], default=0)
    assert result.to_pandas()["effective"].tolist() == [5.0, 20.0, 0.0]
    assert [origins(result, i, "effective") for i in range(3)] == [
        [("raw", 0, "backup")],
        [("raw", 1, "primary")],
        [],
    ]
    assert [
        [(o.row, o.column) for o in result.explain_controls(i, "effective")] for i in range(3)
    ] == [
        [(0, "primary"), (0, "backup")],
        [(1, "primary")],
        [(2, "primary"), (2, "backup")],
    ]
    assert story.to_dict()["steps"][-1]["parameters"]["selected_columns"] == [
        "backup",
        "primary",
        None,
    ]


@pytest.mark.parametrize(
    "op",
    [
        "lag",
        "diff",
        "cumsum",
        "cummin",
        "cummax",
        "rolling_sum",
        "rolling_mean",
        "rolling_min",
        "rolling_max",
    ],
)
def test_window_matches_grouped_pandas_and_exact_member_origins(op):
    frame = pd.DataFrame({"g": ["a", "a", "b", "a", "b"], "v": [2.0, None, 5.0, 4.0, 9.0]})
    story = DataStory()
    result = story.table(frame, name="raw").window(
        "out", column="v", op=op, by="g", periods=1, size=2, min_periods=1
    )
    grouped = frame.groupby("g", sort=False, dropna=False)["v"]
    expected = {
        "lag": grouped.shift(1),
        "diff": grouped.diff(1),
        "cumsum": grouped.cumsum(),
        "cummin": grouped.cummin(),
        "cummax": grouped.cummax(),
        "rolling_sum": grouped.transform(lambda s: s.rolling(2, min_periods=1).sum()),
        "rolling_mean": grouped.transform(lambda s: s.rolling(2, min_periods=1).mean()),
        "rolling_min": grouped.transform(lambda s: s.rolling(2, min_periods=1).min()),
        "rolling_max": grouped.transform(lambda s: s.rolling(2, min_periods=1).max()),
    }[op]
    pd.testing.assert_series_equal(result.to_pandas()["out"], expected.rename("out"))
    expected_rows = {
        "lag": [1],
        "diff": [3, 1],
        "cumsum": [0, 3],
        "cummin": [0, 3],
        "cummax": [0, 3],
        "rolling_sum": [3],
        "rolling_mean": [3],
        "rolling_min": [3],
        "rolling_max": [3],
    }[op]
    assert [(o.row, o.column) for o in result.explain(3, "out")] == [
        (i, "v") for i in expected_rows
    ]
    assert origins(result, 3, "g") == [("raw", 3, "g")]
    if op in ("cumsum", "cummin", "cummax"):
        assert [(o.row, o.column) for o in result.explain_controls(3, "out")] == [
            (0, "g"),
            (3, "g"),
        ]


def test_window_boundary_and_missing_values_do_not_claim_nonexistent_input():
    frame = pd.DataFrame({"v": pd.Series([1, None, 3], dtype="Int64")})
    source = DataStory().table(frame, name="raw")
    lag = source.window("previous", column="v", op="lag", periods=1)
    assert lag.explain(0, "previous") == ()
    assert origins(lag, 2, "previous") == [("raw", 1, "v")]
    rolling = source.window("total", column="v", op="rolling_sum", size=2)
    assert pd.isna(rolling.to_pandas().loc[1, "total"])
    assert origins(rolling, 1, "total") == [("raw", 0, "v")]
    cumulative = source.window("running", column="v", op="cumsum")
    assert cumulative.explain(1, "running") == ()
    assert [(o.row, o.column) for o in cumulative.explain_controls(1, "running")] == [(1, "v")]


def test_window_uses_missing_group_keys_and_rejects_provenance_explosion():
    df = pd.DataFrame({"g": [None, "x", None], "v": [1.0, 2.0, 3.0]})
    result = DataStory().table(df, name="raw").window("previous", column="v", op="lag", by="g")
    pd.testing.assert_series_equal(
        result.to_pandas()["previous"],
        df.groupby("g", dropna=False, sort=False)["v"].shift().rename("previous"),
    )
    assert origins(result, 2, "previous") == [("raw", 0, "v")]
    story = DataStory.for_analysis()
    source = story.table(pd.DataFrame({"v": range(1000)}))
    with pytest.raises(CaptureLimitError, match="250,000"):
        source.window("running", column="v", op="cumsum")
    assert len(story.to_dict()["steps"]) == 1


@settings(max_examples=35, deadline=None)
@given(
    st.lists(
        st.tuples(st.sampled_from(["a", "b"]), st.one_of(st.integers(-20, 20), st.none())),
        min_size=1,
        max_size=8,
    )
)
def test_conditional_and_grouped_window_randomized_against_pandas(records):
    groups, values = zip(*records, strict=True)
    df = pd.DataFrame({"g": groups, "v": pd.array(values, dtype="Int64")})
    source = DataStory(max_steps=15).table(df, name="raw")
    conditional = source.case_when(
        "flag", column="v", op="ge", value=0, then="nonnegative", otherwise="other"
    )
    mask = df["v"].ge(0).fillna(False)
    assert conditional.to_pandas()["flag"].tolist() == [
        "nonnegative" if value else "other" for value in mask
    ]
    filtered = source.filter_by("v", op="ge", value=0)
    pd.testing.assert_frame_equal(filtered.to_pandas(), df[mask])
    assert filtered.to_pandas().index.tolist() == [i for i, value in enumerate(mask) if value]
    for op in (
        "lag",
        "diff",
        "cumsum",
        "cummin",
        "cummax",
        "rolling_sum",
        "rolling_mean",
        "rolling_min",
        "rolling_max",
    ):
        result = source.window("out", column="v", op=op, by="g", size=3, min_periods=1)
        grouped = df.groupby("g", sort=False, dropna=False)["v"]
        if op == "lag":
            expected = grouped.shift(1)
        elif op == "diff":
            expected = grouped.diff(1)
        elif op == "cumsum":
            expected = grouped.cumsum()
        elif op == "cummin":
            expected = grouped.cummin()
        elif op == "cummax":
            expected = grouped.cummax()
        elif op == "rolling_sum":
            expected = grouped.transform(lambda s: s.rolling(3, min_periods=1).sum())
        elif op == "rolling_min":
            expected = grouped.transform(lambda s: s.rolling(3, min_periods=1).min())
        elif op == "rolling_max":
            expected = grouped.transform(lambda s: s.rolling(3, min_periods=1).max())
        else:
            expected = grouped.transform(lambda s: s.rolling(3, min_periods=1).mean())
        pd.testing.assert_series_equal(result.to_pandas()["out"], expected.rename("out"))


@pytest.mark.parametrize(
    "run_case",
    [
        lambda f: f.case_when("y", column="x", op="eval", value=1, then=0, otherwise=1),
        lambda f: f.case_when("y", column="missing", op="eq", value=1, then=0, otherwise=1),
        lambda f: f.filter_by("x", op="gt", value=col("missing")),
        lambda f: f.window("y", column="x", op="rolling_sum", size=0),
        lambda f: f.window("y", column="x", op="lag", periods=0),
    ],
)
def test_invalid_requests_leave_history_unchanged(run_case):
    story = DataStory()
    source = story.table(pd.DataFrame({"x": [1, 2]}))
    with pytest.raises((ValueError, TypeError)):
        run_case(source)
    assert len(story.to_dict()["steps"]) == 1
