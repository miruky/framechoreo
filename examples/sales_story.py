"""A complete, synthetic filter → join → group → sum story."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def make_story():
    story = DataStory(title="Where did the sales total come from?")
    sales = story.table(
        pd.DataFrame(
            {
                "order": ["o01", "o02", "o03", "o04", "o05", "o06"],
                "product": ["P1", "P2", "P1", "P3", "P2", "P4"],
                "amount": [120, 80, 150, 60, 90, 40],
                "paid": [True, False, True, True, True, True],
            }
        ),
        name="Sales",
    )
    products = story.table(
        pd.DataFrame(
            {
                "product": ["P1", "P2", "P3"],
                "category": ["Books", "Stationery", "Stationery"],
            }
        ),
        name="Products",
    )
    paid = sales.filter_rows(lambda df: df["paid"], label="Keep paid orders")
    joined = paid.merge(
        products,
        on="product",
        how="left",
        validate="many_to_one",
        label="Attach product categories",
    )
    total = joined.group_sum(
        by="category", value="amount", dropna=False, label="Add the sales in each category"
    )
    story.annotate(paid, note="The unpaid order leaves the working table.", highlight="paid")
    story.annotate(
        joined,
        note="P4 has no matching product; its order is still present.",
        hold=4,
        highlight="category",
    )
    story.annotate(
        total, note="Select 270 to see its two original sales.", hold=4, highlight="amount"
    )
    return story, total


if __name__ == "__main__":
    story, total = make_story()
    target = Path(__file__).parent / "generated" / "sales.html"
    story.export_html(target, result=total, overwrite=True)
    print(total.to_pandas())
    print(target.resolve())
