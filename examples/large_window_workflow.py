"""Explain a large cumulative series with shared exact prefix lineage."""

import argparse
import json
from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def build_story(rows: int = 1000):
    df = pd.DataFrame({"day": range(rows), "amount": range(rows)})
    story = DataStory.for_analysis(title=f"How did {rows:,} rows accumulate?")
    source = story.table(df, name="Amounts")
    result = source.window("running", column="amount", op="cumsum")
    expected = df.copy()
    expected["running"] = df["amount"].cumsum()
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    story.annotate(result, note="Select any total to inspect its exact ordered inputs.")
    return story, result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=1000)
    parser.add_argument(
        "--output", type=Path, default=Path(__file__).parent / "generated" / "large-window.html"
    )
    args = parser.parse_args()
    if not 1 <= args.rows <= 50_000:
        parser.error("--rows must be between 1 and 50000")
    story, result = build_story(args.rows)
    path = story.export_html(args.output, result=result, overwrite=True)
    last_page = result.explain_page(args.rows - 1, "running", offset=args.rows - 1)
    print(
        json.dumps(
            {
                "input_rows": args.rows,
                "result_rows": len(result.to_pandas()),
                "last_total_value_inputs": last_page.total,
                "last_origin_row": last_page.origins[0].row,
                "html_bytes": path.stat().st_size,
            }
        )
    )
