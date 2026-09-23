"""A three-valued decision built from range, membership, and NOT clauses."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory, where


def build_story():
    story = DataStory(title="Why was each order reviewed?", language="en")
    source = story.table(
        pd.DataFrame(
            {
                "amount": pd.array([120, 80, None, 400, None], dtype="Int64"),
                "region": ["North", "South", "North", "North", "South"],
                "priority": [False, False, True, False, False],
                "order": ["A", "B", "C", "D", "E"],
            }
        ),
        name="Orders",
    )
    rule = (
        where("amount", "between", (100, 300)) & where("region", "in", ["North", "South"])
    ) | ~where("priority", "eq", False)
    routed = source.case_when(
        "route",
        condition=rule,
        then="Fast lane",
        otherwise="Review",
        label="Choose route from the complete rule",
    )
    story.annotate(
        routed,
        note="All three clauses are recorded even when another clause determines the result.",
    )
    result = routed.filter_by(rule, label="Keep orders that passed the rule")
    story.annotate(result, note="False and missing outcomes have distinct reasons in the audit.")
    return story, result


if __name__ == "__main__":
    story, result = build_story()
    output = Path(__file__).parent / "generated" / "compound-conditions.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    story.export_html(output, result=result, overwrite=True)
    print(output)
