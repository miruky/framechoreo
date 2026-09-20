"""Short decimal text can hide different floating-point join keys."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory

if __name__ == "__main__":
    story = DataStory(title="Why does only 0.5 match?")
    readings = story.table(
        pd.DataFrame({"key": pd.Series([0.1, 0.5], dtype="float32"), "reading": [3, 4]}),
        name="Readings with float32 keys",
    )
    labels = story.table(
        pd.DataFrame({"key": pd.Series([0.1, 0.5], dtype="float64"), "label": ["tenth", "half"]}),
        name="Labels with float64 keys",
    )
    joined = readings.merge(labels, on="key", label="Match floating-point keys")
    story.annotate(
        readings,
        note="Select a key to inspect its column dtype. These readings use float32.",
        highlight="key",
    )
    story.annotate(
        joined,
        note=(
            "Both tables display 0.1, but its float32 and float64 approximations differ. "
            "0.5 is exact in both types and matches. Open the right input to compare column dtypes."
        ),
        highlight="key",
        hold=6,
    )
    result = joined.to_pandas()
    assert pd.isna(result.loc[0, "label"])
    assert result.loc[1, "label"] == "half"
    story.export_html(
        Path(__file__).parent / "generated" / "float-precision.html",
        result=joined,
        overwrite=True,
    )
