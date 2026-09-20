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
    contracts = []
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
