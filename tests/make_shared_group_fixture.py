"""Generate a schema-v2 story with two large shared group lineages."""

import json
from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def main() -> None:
    story = DataStory.for_analysis(title="How do large groups keep their sources?")
    source = story.table(
        pd.DataFrame(
            {
                "group": ["A"] * 600,
                "score": pd.array([*range(599), None], dtype="Int64"),
            }
        ),
        name="Scores",
    )
    total = source.group_transform("group_total", by="group", value="score", op="sum", dropna=False)
    rank = total.rank_within("rank", by="group", value="score")
    payload = story.to_dict(result=rank)
    assert payload["schema_version"] == 2
    output = Path(__file__).parent / "fixtures" / "shared_group.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(output)


if __name__ == "__main__":
    main()
