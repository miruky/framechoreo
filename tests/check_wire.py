"""Check Python-to-player provenance agreement. Run with Node.js available."""

import json
import subprocess
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd

from framechoreo import DataStory
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
                    limit = max(1, len(inputs))
                    assert len(frame.explain(row, column, max_sources=limit)) == len(inputs)
                    checks.append(
                        {
                            "reference": {"step": frame.step_id, "row": row, "column": column},
                            "inputs": inputs,
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
