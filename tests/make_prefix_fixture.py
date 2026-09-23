"""Generate a large cumulative window with compact exact prefix lineage."""

import json
from pathlib import Path

import pandas as pd

from framechoreo import DataStory

if __name__ == "__main__":
    story = DataStory.for_analysis(title="How did the running value accumulate?")
    source = story.table(
        pd.DataFrame(
            {
                "group": ["A"] * 1000,
                "value": pd.array([*range(500), None, *range(501, 1000)], dtype="Int64"),
            }
        ),
        name="Readings",
    )
    running = source.window("running", column="value", op="cumsum", by="group")
    payload = story.to_dict(result=running)
    assert payload["schema_version"] == 2
    output = Path(__file__).parent / "fixtures" / "prefix_window.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(output)
