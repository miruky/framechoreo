"""Explain the first matching branch in an ordered customer triage."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory, col, where


def build_story():
    story = DataStory(title="Which service lane did each case enter?", language="en")
    source = story.table(
        pd.DataFrame(
            {
                "score": pd.array([90, 60, None, 10], dtype="Int64"),
                "vip": [False, True, False, False],
                "fallback_lane": ["A", "B", "C", "D"],
            }
        ),
        name="Service cases",
    )
    result = source.case_select(
        "lane",
        cases=[
            (where("score", "ge", 80), "High score"),
            (where("vip", "eq", True), "VIP"),
            (where("score", "lt", 40), col("fallback_lane")),
        ],
        otherwise="Standard review",
        label="Choose the first matching lane",
    )
    story.annotate(
        result,
        note="Case 3 has a missing score and reaches Standard review; case 4 uses lane D.",
    )
    return story, result


if __name__ == "__main__":
    story, result = build_story()
    output = Path(__file__).parent / "generated" / "ordered-cases.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    story.export_html(output, result=result, overwrite=True)
    print(output)
