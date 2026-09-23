"""A small complete example of decisions, running metrics, and row removal."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory, col


def build_story():
    story = DataStory(title="Weekly account decisions", language="en")
    source = story.table(
        pd.DataFrame(
            {
                "account": ["North", "South", "North", "South", "North", "South"],
                "week": ["W02", "W01", "W01", "W02", "W03", "W03"],
                "sales": pd.Series([140, 80, 110, None, 170, 125], dtype="Int64"),
                "forecast_sales": [None, None, None, 95, None, None],
                "target": [120, 100, 100, 100, 150, 120],
            }
        ),
        name="Weekly sales",
    )
    ordered = source.sort_values(["account", "week"], label="Order each account by week")
    story.annotate(
        ordered, chapter="Prepare", note="Window calculations use this visible row order."
    )
    selected = ordered.case_when(
        "status",
        column="sales",
        op="ge",
        value=col("target"),
        then="Met target",
        otherwise="Review",
        label="Choose status using sales and target",
    )
    story.annotate(selected, chapter="Decide", highlight="status")
    available = selected.coalesce(
        "effective_sales",
        ["sales", "forecast_sales"],
        label="Use forecast where recorded sales are missing",
    )
    previous = available.window(
        "previous_sales",
        column="effective_sales",
        op="lag",
        by="account",
        label="Find each account's previous week",
    )
    change = previous.window(
        "weekly_change",
        column="effective_sales",
        op="diff",
        by="account",
        label="Compare with the previous week",
    )
    average = change.window(
        "two_week_average",
        column="effective_sales",
        op="rolling_mean",
        by="account",
        size=2,
        min_periods=1,
        label="Average the last two recorded weeks",
    )
    running = average.window(
        "running_sales",
        column="effective_sales",
        op="cumsum",
        by="account",
        label="Add sales within each account",
    )
    story.annotate(running, chapter="Compare", highlight=["running_sales", "weekly_change"])
    result = running.filter_by(
        "sales", op="ge", value=col("target"), label="Keep weeks that met the target"
    )
    story.annotate(
        result,
        chapter="Review",
        note="Missing recorded sales produced Review even when a forecast was available.",
    )
    return story, result


if __name__ == "__main__":
    story, result = build_story()
    output = Path(__file__).parent / "generated" / "decision-window.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    story.export_html(output, result=result, overwrite=True)
    print(output)
