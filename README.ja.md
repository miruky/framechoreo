# FrameChoreo

**pandasの加工過程を、元の値をたどれるアニメーションにするPythonライブラリです。**

行の絞り込み、表の結合、グループごとの合計を記録し、一つのHTMLへ書き出します。
読む人は工程を止めたり戻したり、値を選んで元の入力セルを確認できます。
再生時にPythonサーバーや外部通信は必要ありません。

初期版は、記事・授業・分析手順の説明に使う小さなデータを対象としています。
任意のpandasコードの自動追跡や、大規模なデータ基盤の監視は対象外です。

## インストール

初回公開の準備段階です。PyPIへ公開済みとは限りません。
Python 3.11以上で、ソースのルートから実行します。

```sh
python -m pip install .
python examples/sales_story.py
```

配布用wheelから入れる場合は次のとおりです。

```sh
python -m pip install dist/framechoreo-0.1.0-py3-none-any.whl
```

`examples/generated/sales.html` をブラウザーで開くと、実際のPython処理から
生成した説明が再生できます。`classroom.py` は日本語の題材です。
完全なコード例は[英語README](README.md#a-complete-story)にあります。

## 主な使い方

`DataStory.table()` でDataFrameを登録し、戻ってくる `StoryFrame` に対して
`filter_rows()`、`merge()`、`group_sum()` を実行します。
`to_pandas()` は記録した結果のコピー、`explain(行位置, 列名)` は元の値の一覧を返します。
行位置は0から数えます。画面では読みやすく1から表示します。

説明の注記・再生時の間・強調する列は、計算と分けて指定できます。

```python
story.annotate(total, note="合計を選ぶと元の売上が分かります。", hold=4, highlight="amount")
story.export_html("story.html", result=total, overwrite=True)
```

既存ファイルの上書きは `overwrite=True` を指定したときだけ行います。
ノートブックでは `story` や `total` を表示すると、iframe内にプレイヤーが表示されます。

## 対応範囲

- pandas 2.2.3以上、3.1未満を依存範囲としています。
- 行フィルター、inner/left結合、数値列のグループ別合計に対応します。
- 結合は `one_to_one` または `many_to_one` を検査します。
- 集計の `dropna` は明示指定です。欠損キーを集計から外すかを利用者が決めます。
- 既定の記録上限は1工程200行・12列、全20工程、JSONデータ2 MBです。
- プレイヤーは最初の12行を表示し、全記録を表示する操作も用意しています。
- 対応外のデータ・操作や上限超過を、黙って省略・推定することはありません。

Polars、pivot、melt、多対多結合、任意の集計、GIF/MP4出力は未対応です。
DataFrameのindexを行の識別子に使わないため、重複したindexも区別します。
数値計算はpandasの規則に従います。表示用の丸めで計算を変えることはありません。

## HTMLを共有するとき

**HTMLには元のテーブルが入り、フィルターで除外した行も含まれます。**
画面で隠れていることと、ファイルから消えていることは同じではありません。
共有用の合成データや適切に準備したデータを使ってください。
`story.export_info(result=total)` で、含まれる元テーブル名や記録件数を確認できます。

選択した結果に関係しない分岐は書き出しませんが、匿名化機能ではありません。
入力文字列はHTML内でデータとして扱い、任意のHTMLとして実行しません。
フィルターに渡す関数は、利用者が信頼する通常のPythonコードとして実行されます。

## 開発・検証

[開発手順](CONTRIBUTING.md)、[API](docs/api.md)、[設計](docs/design.md)、
[検証した範囲](docs/validation.md)を参照してください。
先行するPandas Tutor、Datamations、ipyvizzuとの違いは英語READMEに記載しています。

MIT License。Copyright © 2026 miruky。
