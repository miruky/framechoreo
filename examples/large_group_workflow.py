"""Broadcast and rank a large group without repeating its lineage in the exported JSON."""

import argparse
import json
from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def build_story(rows: int = 1000):
    df = pd.DataFrame({"team": ["A"] * rows, "score": [i % 1000 for i in range(rows)]})
    story = DataStory.for_analysis(title=f"How did {rows:,} scores shape the group result?")
    source = story.table(df, name="Scores")
    total = source.group_transform("group_total", by="team", value="score", op="sum", dropna=False)
    ranked = total.rank_within("position", by="team", value="score", method="dense")
    expected = df.copy()
    expected["group_total"] = df.groupby("team", dropna=False)["score"].transform(
        lambda values: values.sum(min_count=1)
    )
    expected["position"] = df.groupby("team", dropna=False)["score"].rank(
        method="dense", ascending=False
    )
    pd.testing.assert_frame_equal(ranked.to_pandas(), expected)
    story.annotate(
        ranked,
        note="Group candidates are stored once and remain traceable from every row.",
    )
    return story, ranked


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=1000)
    parser.add_argument(
        "--output", type=Path, default=Path(__file__).parent / "generated" / "large-group.html"
    )
    args = parser.parse_args()
    if not 1 <= args.rows <= 50_000:
        parser.error("--rows must be between 1 and 50000")
    story, result = build_story(args.rows)
    path = story.export_html(args.output, result=result, overwrite=True)
    print(
        json.dumps(
            {
                "input_rows": args.rows,
                "result_rows": len(result.to_pandas()),
                "first_rank_value_inputs": result.explain_page(0, "position").total,
                "html_bytes": path.stat().st_size,
            }
        )
    )
