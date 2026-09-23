"""Generate a large rolling window with compact exact range lineage."""

import json
from pathlib import Path

import pandas as pd

from framechoreo import DataStory

if __name__ == "__main__":
    story = DataStory.for_analysis(title="Which readings fell in this moving window?")
    source = story.table(
        pd.DataFrame(
            {
                "group": ["A"] * 1000,
                "value": pd.array([*range(500), None, *range(501, 1000)], dtype="Int64"),
            }
        ),
        name="Readings",
    )
    recent = source.window(
        "recent", column="value", op="rolling_sum", by="group", size=800, min_periods=1
    )
    payload = story.to_dict(result=recent)
    assert payload["schema_version"] == 2
    output = Path(__file__).parent / "fixtures" / "range_window.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(output)
