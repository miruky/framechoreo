"""A complete, synthetic cleaning-to-report workflow, with every result checked."""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def make_story(language="ja"):
    ja = language == "ja"

    def title(en, jp):
        return jp if ja else en

    january = pd.DataFrame(
        {
            "order_id": ["A01", "A02", "A03", "A03", "A04"],
            "item": [" Pen ", "BOOK", "cup", "cup", "book"],
            "units": ["2", "1", "bad", "bad", None],
            "unit_price": ["100", "900", "400", "400", "900"],
            "date": ["2026-01-10", "2026-01-11", "2026-01-12", "2026-01-12", "wrong date"],
        }
    )
    february = pd.DataFrame(
        {
            "order_id": ["B01", "B02", "B03", "B04", None],
            "item": ["pen", "Book", "CUP", "poster", "pen"],
            "units": ["3", "2", "1", "2", "1"],
            "unit_price": ["100", "900", "400", "250", "100"],
            "date": ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"],
        }
    )
    catalog = pd.DataFrame(
        {"code": ["pen", "book", "cup"], "department": ["Stationery", "Books", "Home"]}
    )
    story = DataStory(
        title=title(
            "From messy orders to a report you can explain",
            "ばらばらの注文データから、根拠をたどれる売上レポートへ",
        ),
        description=title(
            "Combine two months, repair types and missing values, deduplicate, "
            "join a catalog, and compare six metrics.",
            "2か月分のデータを結合し、型・欠損・重複を整え、商品マスターと照合して6つの指標にまとめます。",
        ),
        language=language,
    )
    a = story.table(january, name=title("January orders", "1月の注文"))
    b = story.table(february, name=title("February orders", "2月の注文"))
    combined = story.concat(
        [a, b], label=title("Combine monthly files", "月別ファイルを一つにする")
    )
    trimmed = combined.string_transform(
        "item", op="strip", label=title("Trim product names", "商品名の余分な空白を取る")
    )
    normalized = trimmed.string_transform(
        "item", op="lower", label=title("Normalize letter case", "商品名の大文字・小文字をそろえる")
    )
    numeric = normalized.to_numeric(
        ["units", "unit_price"],
        errors="coerce",
        label=title("Parse quantity and price", "数量と単価を数値にする"),
    )
    dates = numeric.to_datetime(
        "date",
        format="%Y-%m-%d",
        errors="coerce",
        label=title("Parse order dates", "注文日を日付として読み取る"),
    )
    complete = dates.drop_missing(
        subset=["order_id", "date", "unit_price"],
        label=title("Require ID, date and price", "注文番号・日付・単価がそろった行を残す"),
    )
    unique = complete.drop_duplicates(
        subset="order_id", label=title("One row per order", "重複する注文を一つにする")
    )
    filled = unique.fill_missing(
        {"units": 0}, label=title("Make the quantity policy explicit", "読めない数量を0として扱う")
    )
    typed = filled.astype(
        {"units": "Int64"},
        label=title("Store nullable integer quantities", "数量を欠損対応の整数型にそろえる"),
    )
    products = story.table(catalog, name=title("Product catalog", "商品マスター"))
    joined = typed.merge(
        products,
        left_on="item",
        right_on="code",
        how="left",
        validate="many_to_one",
        label=title("Attach departments", "商品マスターから部門を付ける"),
    )
    analysis_fields = joined.select_columns(
        ["order_id", "item", "department", "units", "unit_price"],
        label=title("Keep the analysis fields", "分析に使う列を残す"),
    )
    valued = analysis_fields.calculate(
        "revenue",
        left="units",
        op="multiply",
        right="unit_price",
        label=title("Calculate revenue per order", "数量と単価から注文ごとの売上を計算する"),
    )
    metrics = {
        "revenue_total": ("revenue", "sum"),
        "average_order": ("revenue", "mean"),
        "orders": ("order_id", "count"),
        "products": ("item", "nunique"),
        "median_order": ("revenue", "median"),
        "largest_order": ("revenue", "max"),
    }
    summary = valued.group_agg(
        by="department",
        aggregations=metrics,
        dropna=False,
        label=title("Six metrics from the same groups", "同じ部門から6つの指標をまとめる"),
    )
    ranked = summary.sort_values(
        "revenue_total",
        ascending=False,
        label=title("Rank departments by revenue", "売上の大きい部門から並べる"),
    )
    names = (
        {
            "department": "部門",
            "revenue_total": "売上合計",
            "average_order": "平均売上",
            "orders": "注文件数",
            "products": "商品種類",
            "median_order": "売上中央値",
            "largest_order": "最大売上",
        }
        if ja
        else {}
    )
    result = ranked.rename_columns(names, label="部門別の売上レポート") if ja else ranked
    story.annotate(
        a,
        chapter=title("01 · Inputs", "01 · 取り込む"),
        note=title(
            "All records are synthetic. Raw inputs remain available throughout the story.",
            "合成データです。加工で除いた行も、元の表から確認できます。",
        ),
        hold=4,
    )
    story.annotate(
        trimmed,
        chapter=title("02 · Clean", "02 · 整える"),
        note=title(
            "Compare before and after, or inspect column quality.",
            "「前後を比較」「データ品質」で、加工による変化を確認できます。",
        ),
        hold=4,
    )
    story.annotate(
        filled,
        note=title(
            "For this example, unreadable quantities are explicitly replaced by zero. "
            "The zero is a constant, not a source value.",
            "この例では、読めない数量を明示的に0で補います。この0は元データの値ではなく、指定した定数です。",
        ),
        hold=4,
    )
    story.annotate(
        joined,
        chapter=title("03 · Enrich", "03 · 照合・計算する"),
        note=title(
            "The join matches item against code. Poster has no catalog entry.",
            "item列とcode列で照合します。posterには対応する商品マスターがありません。",
        ),
        hold=5,
    )
    story.annotate(
        summary,
        chapter=title("04 · Explain", "04 · まとめて説明する"),
        note=title(
            "Select any metric to inspect its own inputs. "
            "Different metrics can use different columns.",
            "指標ごとに集計元の列が異なります。値を選ぶと、その指標に使った入力まで戻れます。",
        ),
        hold=5,
    )

    expected = pd.concat([january, february], ignore_index=True)
    expected["item"] = expected["item"].str.strip().str.lower()
    for c in ["units", "unit_price"]:
        expected[c] = pd.to_numeric(expected[c], errors="coerce")
    expected["date"] = pd.to_datetime(expected["date"], format="%Y-%m-%d", errors="coerce")
    expected = expected.dropna(subset=["order_id", "date", "unit_price"]).drop_duplicates(
        "order_id"
    )
    expected["units"] = expected["units"].fillna(0).astype("Int64")
    expected = expected.merge(
        catalog, left_on="item", right_on="code", how="left", validate="many_to_one", sort=False
    )
    expected["revenue"] = expected["units"] * expected["unit_price"]
    grouped = expected.groupby(["department"], dropna=False, sort=False, observed=True)
    report = grouped.agg(**metrics).reset_index()
    report["revenue_total"] = grouped["revenue"].sum(min_count=1).array
    report = report.sort_values("revenue_total", ascending=False, kind="stable").rename(
        columns=names
    )
    pd.testing.assert_frame_equal(result.to_pandas(), report)
    assert int(report.iloc[0, 1]) == 2700
    return story, result


if __name__ == "__main__":
    story, result = make_story()
    output = Path(__file__).parent / "generated" / "retail-workflow.html"
    story.export_html(output, result=result, overwrite=True)
    print(result.to_pandas())
    print(output.resolve())
