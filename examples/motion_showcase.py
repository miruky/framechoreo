"""Follow visible values through filtering, sorting, joining, and aggregation."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def make_story():
    orders = pd.DataFrame(
        {
            "商品": ["Atlas", "Bento", "Atlas", "Cup", "Bento", "Cup", "Other"],
            "売上": pd.Series([120, -20, 80, None, 60, 40, 30], dtype="Int64"),
        }
    )
    catalog = pd.DataFrame({"商品": ["Atlas", "Bento", "Cup"], "部門": ["Books", "Food", "Home"]})
    story = DataStory(title="売上の一行が、集計結果になるまで")
    source = story.table(orders, name="注文データ")
    products = story.table(catalog, name="商品マスター")
    kept = source.filter_rows(lambda df: df["売上"].ge(0).fillna(True), label="赤字の注文を除く")
    ranked = kept.sort_values("売上", ascending=False, label="売上の大きい順に並べる")
    joined = ranked.merge(
        products,
        on="商品",
        how="left",
        validate="many_to_one",
        label="商品マスターから部門を結合する",
    )
    total = joined.group_sum(
        by="部門", value="売上", dropna=False, label="同じ部門の売上が、一つの結果へ集まる"
    )
    story.annotate(source, note="7件の注文から、部門ごとの売上を説明します。", hold=4)
    story.annotate(kept, note="−20の注文を除きます。未入力の売上は残しておきます。", hold=4)
    story.annotate(ranked, note="値を変えずに、行の位置だけを並べ替えます。", hold=4)
    story.annotate(
        joined,
        note="青い値は商品マスターから来ます。Otherには一致する商品がありません。",
        highlight="部門",
        hold=5,
    )
    story.annotate(
        total,
        note="Booksの200を選ぶと120と80まで戻れます。未入力の売上は合計に使いません。",
        highlight="売上",
        hold=5,
    )
    expected = (
        orders.loc[orders["売上"].ge(0).fillna(True)]
        .sort_values("売上", ascending=False, kind="stable")
        .merge(catalog, on="商品", how="left", validate="many_to_one", sort=False)
        .groupby("部門", dropna=False, sort=False, observed=True)["売上"]
        .sum(min_count=1)
        .reset_index()
    )
    pd.testing.assert_frame_equal(total.to_pandas(), expected)
    assert [origin.value for origin in total.explain(0, "売上")] == [120, 80]
    return story, total


if __name__ == "__main__":
    story, result = make_story()
    output = Path(__file__).parent / "generated" / "motion-showcase.html"
    story.export_html(output, result=result, overwrite=True)
    print(result.to_pandas())
    print(output.resolve())
