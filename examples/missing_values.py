"""Keep or drop missing group keys explicitly, then compare the two stories."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory

if __name__ == "__main__":
    for dropna in [False, True]:
        story = DataStory(title="Missing categories: " + ("excluded" if dropna else "kept"))
        source = story.table(
            pd.DataFrame(
                {
                    "category": ["Books", "Books", "Stationery", None],
                    "amount": pd.Series([120, 150, 90, 40], dtype="Int64"),
                }
            ),
            name="Orders",
        )
        result = source.group_sum(by="category", value="amount", dropna=dropna)
        story.export_html(
            Path(__file__).parent / "generated" / f"missing-{dropna}.html",
            result=result,
            overwrite=True,
        )
        print("dropna=", dropna, result.to_pandas()["amount"].sum())
