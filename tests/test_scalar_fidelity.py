"""Native scalar precision survives capture, transformation, and serialization."""

import numpy as np
import pandas as pd
import pytest

from framechoreo import DataStory
from framechoreo.encoding import encode_cell


@pytest.mark.parametrize("dtype", ["float16", "float32", "Float32", "float64", "Float64"])
def test_serialized_pipeline_cells_match_positional_pandas_scalars(dtype):
    data = pd.DataFrame(
        {
            "key": ["a", "a", "b", "skip"],
            "amount": pd.Series([0.1, 0.2, 0.3, 0.4], dtype=dtype),
            "ticket": [2**60 + 1, 2**60 + 3, 2**60 + 5, 2**60 + 7],
        }
    )
    lookup = pd.DataFrame({"key": ["a"], "category": ["matched"]})
    story = DataStory()
    source = story.table(data)
    filtered = source.filter_rows(lambda df: df["key"] != "skip")
    right = story.table(lookup)
    joined = filtered.merge(right, on="key")
    total = joined.group_sum(by="category", value="amount", dropna=False)
    expected = (
        data.loc[data["key"] != "skip"]
        .merge(lookup, on="key", how="left", validate="many_to_one", sort=False)
        .groupby("category", dropna=False, sort=False, observed=True)["amount"]
        .sum(min_count=1)
        .reset_index()
    )
    pd.testing.assert_frame_equal(total.to_pandas(), expected, check_exact=True)
    records = {step["id"]: step for step in story.to_dict()["steps"]}
    for frame in [source, filtered, right, joined, total]:
        native = frame.to_pandas()
        for row in range(len(native)):
            for column, name in enumerate(native.columns):
                assert records[frame.step_id]["rows"][row]["cells"][column] == encode_cell(
                    native.iat[row, column]
                ), (dtype, frame.step_id, row, name)
                for origin in frame.explain(row, name):
                    record = records[origin.step_id]
                    source_column = record["columns"].index(origin.column)
                    assert record["rows"][origin.row]["cells"][source_column] == encode_cell(
                        origin.value
                    )


@pytest.mark.parametrize("dtype", ["float16", "float32", "Float32", "float64", "Float64"])
def test_float_special_values_and_large_integers_remain_separate(dtype):
    native = pd.DataFrame(
        {
            "number": pd.Series([-0.0, np.nan, np.inf, -np.inf], dtype=dtype),
            "id": [2**60 + 1, 2**60 + 3, 2**60 + 5, 2**60 + 7],
        }
    )
    story = DataStory()
    story.table(native)
    rows = story.to_dict()["steps"][0]["rows"]
    assert [r["cells"][0]["display"] for r in rows] == ["-0.0", "∅", "inf", "-inf"]
    assert [r["cells"][1]["value"] for r in rows] == [str(v) for v in native["id"]]
