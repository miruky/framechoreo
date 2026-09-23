"""Explain store revenue's fractional change from the previous month."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def build_story():
    df = pd.DataFrame(
        {
            "month": pd.to_datetime(
                ["2026-01-01", "2026-01-01", "2026-02-01", "2026-02-01", "2026-03-01"]
            ),
            "store": ["North", "South", "North", "South", "North"],
            "revenue": pd.array([0, 100, 80, 150, 120], dtype="Int64"),
        }
    )
    story = DataStory(title="How did monthly revenue change?", language="en")
    source = story.table(df, name="Monthly revenue")
    result = source.window(
        "fractional_change",
        column="revenue",
        op="pct_change",
        by="store",
        label="Compare each store with its previous month",
    )
    expected = df.groupby("store", sort=False, dropna=False)["revenue"].pct_change(fill_method=None)
    output = df.copy()
    output["fractional_change"] = expected.array
    pd.testing.assert_frame_equal(result.to_pandas(), output)
    story.annotate(
        result,
        note="North starts from zero, so its February fractional change is infinite.",
    )
    return story, result


if __name__ == "__main__":
    story, result = build_story()
    output = Path(__file__).parent / "generated" / "growth.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    story.export_html(output, result=result, overwrite=True)
    print(output)
