"""A complete recorded analysis; use --rows 50000 for the larger demonstration."""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from framechoreo import DataStory


def build_story(rows: int = 5000):
    ids = np.arange(rows)
    orders = pd.DataFrame(
        {
            "order": ids + 1,
            "store": [f"S{i % 100:03d}" for i in ids],
            "quantity": ids % 7 + 1,
            "unit_price": (ids % 19 + 1) * 10,
        }
    )
    catalog = pd.DataFrame(
        {
            "store": [f"S{i:03d}" for i in range(100)],
            "region": [f"Region {i % 8 + 1}" for i in range(100)],
        }
    )
    story = DataStory.for_analysis(title=f"From {rows:,} orders to regional revenue")
    source = story.table(orders, name="Orders")
    stores = story.table(catalog, name="Store regions")
    calculated = source.calculate("revenue", left="quantity", op="multiply", right="unit_price")
    retained = calculated.filter_rows(lambda df: df["revenue"] >= 100, label="Keep revenue ≥ 100")
    joined = retained.merge(stores, on="store", label="Attach each store's region")
    total = joined.group_sum(by="region", value="revenue", dropna=False, label="Revenue by region")
    ranked = total.sort_values("revenue", ascending=False, label="Rank the regions")
    selected = ranked.select_columns(["region", "revenue"], label="Choose report columns")
    result = selected.rename_columns({"revenue": "sales"}, label="Regional sales report")
    expected = orders.assign(revenue=orders["quantity"] * orders["unit_price"])
    expected = (
        expected.loc[expected["revenue"] >= 100]
        .merge(catalog, on="store", how="left", validate="many_to_one", sort=False)
        .groupby("region", dropna=False, sort=False, observed=True)["revenue"]
        .sum(min_count=1)
        .reset_index()
        .sort_values("revenue", ascending=False, kind="stable")
        .rename(columns={"revenue": "sales"})
    )
    pd.testing.assert_frame_equal(result.to_pandas(), expected, check_exact=True)
    story.annotate(
        source, note="Browse the recorded orders or jump to a table row. Every order is retained."
    )
    story.annotate(
        calculated,
        note="Revenue uses quantity × unit price from the same row.",
        highlight="revenue",
    )
    story.annotate(
        result,
        note=(
            "Select a total to browse the original quantities and prices. "
            "Repeated uses remain visible."
        ),
        highlight="sales",
        hold=5,
    )
    return story, result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=5000)
    parser.add_argument(
        "--output", type=Path, default=Path(__file__).parent / "generated" / "analysis.html"
    )
    args = parser.parse_args()
    if not 1 <= args.rows <= 50_000:
        parser.error("--rows must be between 1 and 50000")
    story, result = build_story(args.rows)
    path = story.export_html(args.output, result=result, overwrite=True)
    print(
        json.dumps(
            {
                "input_rows": args.rows,
                "result_rows": len(result.to_pandas()),
                "first_total_value_inputs": result.explain_page(0, "sales").total,
                "html_bytes": path.stat().st_size,
            }
        )
    )
