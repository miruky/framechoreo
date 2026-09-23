"""Show how ties and missing values affect each team's leaderboard."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def build_story():
    story = DataStory(title="How did each team get its rank?", language="en")
    source = story.table(
        pd.DataFrame(
            {
                "team": ["A", "B", "A", "A", "B", "A"],
                "player": ["A1", "B1", "A2", "A3", "B2", "A4"],
                "score": pd.array([10, 7, 10, None, 5, 20], dtype="Int64"),
            }
        ),
        name="Scores",
    )
    ranked = source.rank_within(
        "team_rank",
        by="team",
        value="score",
        method="dense",
        ascending=False,
        label="Rank each team's recorded scores",
    )
    story.annotate(ranked, note="Equal scores share a rank; missing scores remain unranked.")
    result = ranked.sort_values(["team", "team_rank"], label="Put each leaderboard in order")
    return story, result


if __name__ == "__main__":
    story, result = build_story()
    output = Path(__file__).parent / "generated" / "rank.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    story.export_html(output, result=result, overwrite=True)
    print(output)
