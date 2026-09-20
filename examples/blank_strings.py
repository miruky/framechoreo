"""Missing values, empty strings, and spaces have different filtering behavior."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory

if __name__ == "__main__":
    story = DataStory(title="Missing, empty, or just spaces?")
    rows = story.table(
        pd.DataFrame(
            {
                "entry": ["Word", "Empty", "Two spaces", "Tab", "Missing"],
                "text": ["ready", "", "  ", "\t", None],
            }
        ),
        name="Imported text",
    )
    kept = rows.filter_rows(lambda df: df["text"].notna(), label="Keep non-missing text")
    story.annotate(
        rows,
        note="Select a text cell to distinguish missing values, empty strings, and whitespace.",
        highlight="text",
    )
    story.annotate(
        kept,
        note="notna() keeps empty strings and whitespace. Only the missing value is excluded.",
        highlight="text",
        hold=5,
    )
    assert kept.to_pandas()["text"].tolist() == ["ready", "", "  ", "\t"]
    story.export_html(
        Path(__file__).parent / "generated" / "blank-strings.html",
        result=kept,
        overwrite=True,
    )
