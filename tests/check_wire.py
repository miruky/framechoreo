"""Check Python-to-player provenance agreement. Run with Node.js available."""

import json
import subprocess
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd

from framechoreo import DataStory, col, where
from framechoreo.encoding import encode_cell


def main():
    cases = []
    for dropna in [False, True]:
        story = DataStory()
        source = story.table(
            pd.DataFrame(
                {"key": ["a", "a", None, "b"], "v": pd.Series([2, 3, pd.NA, 7], dtype="Int64")}
            ),
            name="Source",
        )
        aggregate = source.group_sum(by="key", value="v", dropna=dropna)
        joined = source.merge(aggregate, on="key")
        frames = [source, aggregate, joined, joined.group_sum(by="key", value="v_y", dropna=dropna)]
        cases.append((story, frames))
    special = DataStory()
    source = special.table(
        pd.DataFrame(
            {
                "__proto__": ["x", "x"],
                "constructor": [2**60, 1],
                'quoted"column': ['</script><img src=x onerror="alert(1)">', "∅"],
            }
        )
    )
    result = source.group_sum(by="__proto__", value="constructor", dropna=False)
    cases.append((special, [source, result]))
    precise = DataStory()
    source = precise.table(
        pd.DataFrame(
            {
                "time": pd.Series([np.datetime64(1500, "ps")], dtype=object),
                "zero": [-0.0],
                "decimal": [Decimal("1.00")],
            }
        )
    )
    cases.append((precise, [source, source.filter_rows([True])]))
    for dtype in ["float16", "float32", "Float32", "float64", "Float64"]:
        story = DataStory()
        source = story.table(
            pd.DataFrame(
                {
                    "key": ["a", "a", "b"],
                    "v": pd.Series([0.1, 0.2, 0.3], dtype=dtype),
                    "id": [2**60 + 1, 2**60 + 3, 2**60 + 5],
                }
            )
        )
        filtered = source.filter_rows([True, True, True])
        lookup = story.table(pd.DataFrame({"key": ["a"], "category": ["matched"]}))
        joined = filtered.merge(lookup, on="key")
        total = joined.group_sum(by="category", value="v", dropna=False)
        cases.append((story, [source, filtered, lookup, joined, total]))
    for present in [False, True]:
        story = DataStory()
        source = story.table(
            pd.DataFrame(
                {
                    "key": range(6),
                    "v": pd.Series([7 if present else pd.NA] + [pd.NA] * 5, dtype="Int64"),
                }
            )
        )
        filled = source.group_sum(by="key", value="v", dropna=False, min_count=0)
        lookup = story.table(pd.DataFrame({"key": range(6), "category": ["all"] * 6}))
        joined = filled.merge(lookup, on="key")
        total = joined.group_sum(by="category", value="v", dropna=False)
        cases.append((story, [source, filled, lookup, joined, total]))
    for operation in ["group_mean", "group_count"]:
        for dropna in [False, True]:
            story = DataStory()
            source = story.table(
                pd.DataFrame(
                    {"key": ["a", "a", None, "b"], "v": pd.Series([2, 3, pd.NA, 7], dtype="Int64")}
                ),
                name="Source",
            )
            aggregate = getattr(source, operation)(by="key", value="v", dropna=dropna)
            joined = source.merge(aggregate, on="key")
            repeated = getattr(joined, operation)(by="key", value="v_y", dropna=dropna)
            cases.append((story, [source, aggregate, joined, repeated]))
    contracts = []
    analysis = DataStory()
    source = analysis.table(
        pd.DataFrame(
            {
                "group": ["a", "b", "a", None],
                "units": [2, 3, 4, 5],
                "price": pd.Series([0.1, 0.2, np.nan, 0.4], dtype="float32"),
            }
        )
    )
    calculated = source.calculate("revenue", left="units", op="multiply", right="price")
    adjusted = calculated.calculate("adjusted", left="revenue", op="divide", right=2)
    total = adjusted.group_sum(by="group", value="adjusted", dropna=False)
    sorted_frame = total.sort_values("adjusted", ascending=False, na_position="first")
    selected = sorted_frame.select_columns(["adjusted", "group"])
    renamed = selected.rename_columns({"adjusted": "__proto__", "group": "constructor"})
    cases.append((analysis, [source, calculated, adjusted, total, sorted_frame, selected, renamed]))
    workflow = DataStory(language="ja", description="Cleaning and named summaries")
    raw = workflow.table(
        pd.DataFrame(
            {
                "key": [" A ", "A", "B", "B"],
                "v": ["10", "10", "bad", "30"],
                "day": ["2026-01-01"] * 4,
            }
        )
    )
    text = raw.string_transform("key", op="strip")
    numeric = text.to_numeric("v", errors="coerce")
    dated = numeric.to_datetime("day", format="%Y-%m-%d")
    filled = dated.fill_missing({"v": 0})
    deduped = filled.drop_duplicates()
    kept = deduped.drop_missing(subset="key")
    taken = kept.take_rows([2, 0, 2, 1])
    cast = taken.astype({"v": "Int64"})
    combined = workflow.concat([cast, kept], join="outer")
    summary = combined.group_agg(
        by="key",
        aggregations={
            "total": ("v", "sum"),
            "average": ("v", "mean"),
            "minimum": ("v", "min"),
            "maximum": ("v", "max"),
            "median": ("v", "median"),
            "count": ("v", "count"),
            "distinct": ("v", "nunique"),
        },
        dropna=False,
    )
    cases.append(
        (
            workflow,
            [raw, text, numeric, dated, filled, deduped, kept, taken, cast, combined, summary],
        )
    )
    reshaping = DataStory()
    wide = reshaping.table(pd.DataFrame({"id": ["b", "a"], "Jan": [1, 2], "Feb": [3.0, None]}))
    long = wide.melt(id_vars="id", value_vars=["Jan", "Feb"], var_name="month", value_name="amount")
    pivoted = long.pivot(index="id", columns="month", values="amount")
    cases.append((reshaping, [wide, long, pivoted]))
    for how in ["right", "outer"]:
        joining = DataStory()
        left = joining.table(pd.DataFrame({"sku": ["x", "y", None], "v": [1, 2, 3]}))
        right = joining.table(pd.DataFrame({"code": ["x", "z", None], "v": [4, 5, 6]}))
        joined = left.merge(right, left_on="sku", right_on="code", how=how, validate="one_to_one")
        cases.append((joining, [left, right, joined]))

    reserved = DataStory()
    source = reserved.table(pd.DataFrame({"key": ["a", "a"], "v": [1, 3]}))
    result = source.group_agg(
        by="key",
        aggregations={"func": ("v", "sum"), "engine": ("v", "mean"), "__proto__": ("v", "nunique")},
        dropna=False,
    )
    cases.append((reserved, [source, result]))
    gaps = DataStory()
    first = gaps.table(pd.DataFrame({"x": [1, 2], "id": ["a", "b"]}))
    second = gaps.table(pd.DataFrame({"y": [3], "id": ["c"]}))
    combined = gaps.concat([first, second, first])
    cases.append((gaps, [first, second, combined]))

    decisions = DataStory()
    source = decisions.table(
        pd.DataFrame(
            {
                "team": ["a", "b", "a", "b"],
                "sales": pd.Series([10, None, 30, 40], dtype="Int64"),
                "forecast": [None, 20, None, None],
                "target": [5, 15, 35, 35],
            }
        ),
        name="Decision input",
    )
    status = source.case_when(
        "status",
        column="sales",
        op="ge",
        value=col("target"),
        then="pass",
        otherwise="review",
    )
    effective = status.coalesce("effective", ["sales", "forecast"], default=0)
    running = effective.window("running", column="effective", op="cumsum", by="team")
    recent = running.window(
        "recent",
        column="effective",
        op="rolling_sum",
        by="team",
        size=2,
        min_periods=1,
    )
    selected = recent.filter_by("sales", op="ge", value=col("target"))
    cases.append((decisions, [source, status, effective, running, recent, selected]))

    extrema = DataStory()
    source = extrema.table(pd.DataFrame({"group": ["a", "b", "a"], "v": [3.0, 7.0, None]}))
    low = source.window("cumlow", column="v", op="cummin", by="group")
    high = low.window("cumhigh", column="v", op="cummax", by="group")
    recent_low = high.window(
        "recent_low", column="v", op="rolling_min", by="group", size=2, min_periods=1
    )
    recent_high = recent_low.window(
        "recent_high",
        column="v",
        op="rolling_max",
        by="group",
        size=2,
        min_periods=1,
    )
    cases.append((extrema, [source, low, high, recent_low, recent_high]))

    audited = DataStory()
    left = audited.table(pd.DataFrame({"key": ["a", "b", None], "amount": [10, 20, 30]}))
    right = audited.table(pd.DataFrame({"code": ["a", "a", None], "kind": ["x", "y", "z"]}))
    joined = left.merge(right, left_on="key", right_on="code", how="outer", validate="one_to_many")
    cases.append((audited, [left, right, joined]))

    self_join = DataStory()
    one = self_join.table(pd.DataFrame({"key": ["a", "b"], "v": [1, 2]}))
    twice = one.merge(one, on="key", validate="one_to_one")
    cases.append((self_join, [one, twice]))

    broadcast = DataStory()
    raw = broadcast.table(
        pd.DataFrame(
            {
                "group": ["a", "b", "a", None],
                "v": pd.array([2, 4, None, 7], dtype="Int64"),
                "flag": [True, False, True, False],
            }
        )
    )
    total = raw.group_transform("total", by="group", value="v", op="sum", dropna=True)
    rule = (where("v", "ge", 2) & where("group", "in", ["a", "b"])) | ~where("flag", "eq", True)
    chosen = total.case_when("decision", condition=rule, then=col("total"), otherwise=0)
    selected = chosen.filter_by(rule)
    cases.append((broadcast, [raw, total, chosen, selected]))

    ordered = DataStory()
    raw = ordered.table(
        pd.DataFrame(
            {
                "score": pd.array([90, 60, None, 10], dtype="Int64"),
                "vip": [False, True, False, False],
                "fallback": ["A", "B", "C", "D"],
            }
        )
    )
    selected = raw.case_select(
        "tier",
        cases=[
            (where("score", "ge", 80), "top"),
            (where("vip", "eq", True), "vip"),
            (where("score", "lt", 40), col("fallback")),
        ],
        otherwise="standard",
    )
    cases.append((ordered, [raw, selected]))

    nearby = DataStory()
    left = nearby.table(
        pd.DataFrame({"time": [1, 4, 5], "group": ["a", "a", "b"], "event": ["x", "y", "z"]})
    )
    right = nearby.table(
        pd.DataFrame({"time": [2, 3, 6], "group": ["a", "a", "b"], "reading": [10, 20, 30]})
    )
    joined = left.merge_asof(right, on="time", by="group", direction="nearest", tolerance=2)
    cases.append((nearby, [left, right, joined]))

    self_nearby = DataStory()
    source = self_nearby.table(pd.DataFrame({"time": [1, 2, 3], "v": [4, 5, 6]}))
    joined = source.merge_asof(source, on="time", allow_exact_matches=False)
    cases.append((self_nearby, [source, joined]))

    leaderboard = DataStory()
    source = leaderboard.table(
        pd.DataFrame(
            {
                "team": ["a", "b", "a", "a"],
                "score": pd.array([2, 5, 2, None], dtype="Int64"),
            }
        )
    )
    ranked = source.rank_within("rank", value="score", by="team", method="dense")
    cases.append((leaderboard, [source, ranked]))

    for story, frames in cases:
        checks = []
        for frame in frames:
            df = frame.to_pandas()
            for row in range(len(df)):
                for column in df.columns:
                    inputs = [
                        {
                            "step": o.step_id,
                            "row": o.row,
                            "column": o.column,
                            "cell": encode_cell(o.value),
                        }
                        for o in frame.explain(row, column)
                    ]
                    controls = [
                        {
                            "step": o.step_id,
                            "row": o.row,
                            "column": o.column,
                            "cell": encode_cell(o.value),
                        }
                        for o in frame.explain_controls(row, column)
                    ]
                    limit = max(1, len(inputs))
                    assert len(frame.explain(row, column, max_sources=limit)) == len(inputs)
                    checks.append(
                        {
                            "reference": {"step": frame.step_id, "row": row, "column": column},
                            "inputs": inputs,
                            "controls": controls,
                            "max_sources": limit,
                        }
                    )
        contracts.append({"data": story.to_dict(), "checks": checks})
    story = DataStory()
    source = story.table(
        pd.DataFrame({"key": ["all"] * 100, "v": pd.Series([pd.NA] * 100, dtype="Int64")})
    )
    total = source.group_sum(by="key", value="v", dropna=False, min_count=0)
    repeat = story.table(pd.DataFrame({"key": ["all"] * 100}))
    for _ in range(3):
        total = repeat.merge(total, on="key").group_sum(by="key", value="v", dropna=False)
    assert total.explain(0, "v", max_sources=1) == ()
    contracts.append(
        {
            "data": story.to_dict(),
            "checks": [
                {
                    "reference": {"step": total.step_id, "row": 0, "column": "v"},
                    "inputs": [],
                    "max_sources": 1,
                }
            ],
        }
    )
    large = DataStory(max_steps=50)
    source = large.table(pd.DataFrame({"k": ["a"] * 10, "v": [1] * 10}))
    repeat = large.table(pd.DataFrame({"k": ["a"] * 10}))
    total = source.group_sum(by="k", value="v", dropna=False)
    for _ in range(17):
        total = repeat.merge(total, on="k").group_sum(by="k", value="v", dropna=False)
    page = total.explain_page(0, "v", offset=10**18 - 2)
    contracts.append(
        {
            "data": large.to_dict(),
            "checks": [],
            "page_checks": [
                {
                    "reference": {"step": total.step_id, "row": 0, "column": "v"},
                    "offset": str(page.offset),
                    "total": str(page.total),
                    "inputs": [
                        {
                            "step": o.step_id,
                            "row": o.row,
                            "column": o.column,
                            "cell": encode_cell(o.value),
                        }
                        for o in page.origins
                    ],
                }
            ],
        }
    )
    proc = subprocess.run(
        ["node", str(Path(__file__).with_name("verify-wire.cjs"))],
        input=json.dumps(contracts),
        text=True,
        capture_output=True,
        check=True,
    )
    print(proc.stdout, end="")


if __name__ == "__main__":
    main()
