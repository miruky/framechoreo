"""Wide monthly data -> long records -> grouped metrics -> a wide comparison."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def make_story(language="ja"):
    ja = language == "ja"

    def label(en, jp):
        return jp if ja else en

    data = pd.DataFrame(
        {
            "store": ["N-A", "N-B", "S-A"],
            "region": ["North", "North", "South"],
            "Jan": pd.Series([100, 200, 300], dtype="Int64"),
            "Feb": pd.Series([120, None, 320], dtype="Int64"),
            "Mar": pd.Series([150, 220, 340], dtype="Int64"),
        }
    )
    story = DataStory(
        title=label(
            "Follow values as a table changes shape", "表の形が変わっても、値の出どころを見失わない"
        ),
        description=label(
            "Unpivot monthly fields, summarize by region and month, "
            "and rebuild a comparison table.",
            "月別の列を縦長にし、地域と月ごとに集計して、比較しやすい横長の表へ戻します。",
        ),
        language=language,
    )
    source = story.table(data, name=label("Monthly store sales", "店舗別の月次売上"))
    long = source.melt(
        id_vars=["store", "region"],
        value_vars=["Jan", "Feb", "Mar"],
        var_name="month",
        value_name="sales",
        label=label("One month per row", "月別の列を縦に並べる"),
    )
    observed = long.drop_missing(
        subset="sales", label=label("Keep recorded sales", "売上が記録された行を残す")
    )
    summary = observed.group_agg(
        by=["region", "month"],
        aggregations={
            "total": ("sales", "sum"),
            "average": ("sales", "mean"),
            "stores": ("sales", "count"),
        },
        dropna=False,
        label=label("Regional monthly metrics", "地域と月ごとに売上をまとめる"),
    )
    wide = summary.pivot(
        index="region",
        columns="month",
        values="total",
        label=label("Rebuild month columns", "月を列にして比較する"),
    )
    ordered = wide.select_columns(
        ["region", "Jan", "Feb", "Mar"], label=label("Order the months", "月の順番をそろえる")
    )
    result = ordered.calculate(
        "growth",
        left="Mar",
        op="subtract",
        right="Jan",
        label=label("Compare March with January", "3月と1月の差を計算する"),
    )
    story.annotate(
        source,
        chapter=label("01 · Shape", "01 · 形を変える"),
        note=label("All data is synthetic.", "合成データです。"),
        hold=4,
    )
    story.annotate(
        long,
        note=label(
            "Each sales cell retains its original month column. Month labels come from the schema.",
            "売上の値は元の月のセルへ戻れます。月のラベルは列名から作っています。",
        ),
        hold=4,
    )
    story.annotate(summary, chapter=label("02 · Summarize", "02 · 集計する"), hold=4)
    story.annotate(
        wide,
        chapter=label("03 · Compare", "03 · 比べる"),
        note=label(
            "Pivot does not aggregate again; duplicate key pairs would be an error.",
            "ここでは再集計しません。地域と月が重複していれば、pivotはエラーにします。",
        ),
        hold=4,
    )
    story.annotate(
        result,
        note=label(
            "North's growth of 70 traces back to 150, 220, 100, and 200.",
            "Northの差分70を選ぶと、150・220・100・200の元の値まで戻れます。",
        ),
        hold=5,
    )

    tidy = data.melt(
        id_vars=["store", "region"],
        value_vars=["Jan", "Feb", "Mar"],
        var_name="month",
        value_name="sales",
    ).dropna(subset=["sales"])
    grouped = tidy.groupby(["region", "month"], dropna=False, sort=False, observed=True)
    totals = grouped["sales"].sum(min_count=1).reset_index()
    expected = totals.pivot(index=["region"], columns="month", values="sales").reset_index()[
        ["region", "Jan", "Feb", "Mar"]
    ]
    expected["growth"] = expected["Mar"] - expected["Jan"]
    pd.testing.assert_frame_equal(result.to_pandas(), expected)
    assert [o.value for o in result.explain(0, "growth")] == [150, 220, 100, 200]
    return story, result


if __name__ == "__main__":
    story, result = make_story()
    output = Path(__file__).parent / "generated" / "reshape-workflow.html"
    story.export_html(output, result=result, overwrite=True)
    print(result.to_pandas())
    print(output.resolve())
