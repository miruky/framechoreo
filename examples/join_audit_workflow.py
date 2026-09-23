"""See missing-key matches, unmatched inputs, and one-to-many fanout."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def build_story():
    story = DataStory(title="What happened to each join input?", language="en")
    orders = story.table(
        pd.DataFrame({"sku": ["A", "B", None], "amount": [120, 80, 45]}), name="Orders"
    )
    catalog = story.table(
        pd.DataFrame(
            {"code": ["A", "A", "C", None], "category": ["Books", "Sale", "Home", "Unknown"]}
        ),
        name="Catalog",
    )
    joined = orders.merge(
        catalog,
        left_on="sku",
        right_on="code",
        how="outer",
        validate="one_to_many",
        label="Match catalog records to orders",
    )
    story.annotate(
        joined,
        note="The unmatched, repeated, and missing-key inputs remain inspectable.",
        highlight=["sku", "code", "category"],
    )
    return story, joined


if __name__ == "__main__":
    story, result = build_story()
    output = Path(__file__).parent / "generated" / "join-audit.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    story.export_html(output, result=result, overwrite=True)
    print(output)
