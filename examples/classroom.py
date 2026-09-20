"""Unicode labels and numeric input, for a small classroom example."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory

if __name__ == "__main__":
    story = DataStory(title="提出済みの課題をクラスごとに集計")
    source = story.table(
        pd.DataFrame(
            {
                "クラス": ["A", "B", "A", "B", "C", "A"],
                "点数": [8, 7, 10, 5, 9, 6],
                "提出済み": [True, True, True, False, True, True],
            }
        ),
        name="課題の記録",
    )
    selected = source.filter_rows(lambda d: d["提出済み"], label="提出済みだけ残す")
    total = selected.group_sum(
        by="クラス", value="点数", dropna=False, label="クラスごとに点数を足す"
    )
    story.export_html(
        Path(__file__).parent / "generated" / "classroom.html", result=total, overwrite=True
    )
