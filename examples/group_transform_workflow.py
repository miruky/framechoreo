"""Attach group totals to each row before calculating contribution shares."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def build_story():
    story = DataStory(title="How much did each order contribute?", language="en")
    source = story.table(
        pd.DataFrame(
            {
                "team": ["Blue", "Red", "Blue", "Red", "Blue"],
                "order": ["B1", "R1", "B2", "R2", "B3"],
                "sales": pd.array([100, 80, None, 120, 40], dtype="Int64"),
            }
        ),
        name="Orders",
    )
    totals = source.group_transform(
        "team_total",
        by="team",
        value="sales",
        op="sum",
        dropna=False,
        label="Attach each team's sales total",
    )
    story.annotate(totals, note="One group total is repeated beside each original order.")
    shares = totals.calculate(
        "share",
        left="sales",
        op="divide",
        right="team_total",
        label="Calculate each order's share",
    )
    result = shares.group_transform(
        "valid_orders",
        by="team",
        value="sales",
        op="count",
        dropna=False,
        label="Count orders with recorded sales",
    )
    story.annotate(result, note="Missing sales are group members but not numeric candidates.")
    return story, result


if __name__ == "__main__":
    story, result = build_story()
    output = Path(__file__).parent / "generated" / "group-transform.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    story.export_html(output, result=result, overwrite=True)
    print(output)
