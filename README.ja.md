# FrameChoreo

**pandasの加工過程を、値の入力元と判定理由までたどれるアニメーションにするPythonライブラリです。**

行の絞り込み、表の結合、グループごとの合計を記録し、一つのHTMLへ書き出します。
読む人は工程を止めたり戻したり、値を選んで元の入力セルを確認できます。
再生時にPythonサーバーや外部通信は必要ありません。

**インストール前に試す:** [単体で動くデモHTML](docs/index.html)を保存してブラウザーで
開けます。「Add the sales in each category」から Books の合計 `270` を選ぶと、
元の売上 `120` と `150` までたどれます。データは合成です。GitHub上では
HTMLのソースを眺めるのではなく、元ファイルをダウンロードしてください。

初期版は、記事・授業・分析手順の説明に使う小さなデータを対象としています。
大きめの分析には`DataStory.for_analysis()`で記録量を明示して広げられます。
任意のpandasコードの自動追跡や、大規模なデータ基盤の監視は対象外です。

## インストール

1.0.0rc6のローカル候補版です。まだ公開していません。
Python 3.11以上で、ソースのルートから実行します。

```sh
python -m pip install .
python examples/sales_story.py
```

配布用wheelから入れる場合は次のとおりです。

```sh
python -m pip install dist/framechoreo-1.0.0rc6-py3-none-any.whl
```

同じ版番号の未公開wheelを以前に導入している場合は、上のコマンドに
`--force-reinstall --no-deps` を追加して入れ替えてください。

`examples/generated/sales.html` をブラウザーで開くと、実際のPython処理から
生成した説明が再生できます。`classroom.py` は日本語の題材です。
完全なコード例は[英語README](README.md#a-complete-story)にあります。

`python examples/motion_showcase.py` では、抽出・並べ替え・結合・集計を説明する
日本語デモ `examples/generated/motion-showcase.html` を生成できます。
結合元のカードから結果のセルへ値が移動し、集計では欠損値を除いた入力が
同じ色・グループ番号の結果へ集まります。`Replay the movement` で動きを見直し、
`処理の内容` で処理コードを開けます。動かすのは画面内の値に限り、
すべての入力は結果のセルから調べられます。

## 主な使い方

`DataStory.table()` でDataFrameを登録し、戻ってくる `StoryFrame` に対して
`filter_rows()`、`merge()`、`group_sum()`・`group_mean()`・`group_count()` を実行します。
`group_count()` は列ごとの非欠損値の件数であり、行数ではありません。
`to_pandas()` は記録した結果のコピー、`explain(行位置, 列名)` は元の値の一覧を返します。
行位置は0から数えます。画面では読みやすく1から表示します。

条件の理由まで説明する場合は、`filter_by()` と `case_when()` を使います。
文字列は定数として扱い、別の列を参照する場合は `col("列名")` と明示します。
`coalesce()` は左から最初の欠損でない列を選びます。これらは結果の**値の入力元**と、
値や行を選んだ**判定の入力元**を分けて記録します。`explain_controls()` は後者、
`filter_decision(元の行位置)` は抽出条件の true/false/missing を返します。
画面にも別々の入力欄があり、除外行については不成立と比較欠損を分けて元行へ戻れます。
`where()`で作った条件は `&`・`|`・`~` で組み合わせられます。候補リストへの所属と
上下限の範囲も明示できます。欠損を含む判定はpandasの三値論理を使います。
`condition_breakdown(元の行位置)` で、AND/OR/NOTを組み合わせる前の各比較結果も
確認できます。画面の除外行と値の詳細にも、個別の判定結果を表示します。
`case_select()`では条件を優先順に並べ、最初に成立した分岐の値を使います。
欠損した判定は次の分岐へ進み、各分岐の結果と選択した値の入力元を表示します。

`merge()`の結果で `join_audit()` を呼ぶと、左右で相手が見つからなかった行、
複数行に広がった入力、重複キー、欠損キー同士の一致を確認できます。
`group_transform()`はグループの合計・平均・最小・最大・件数・ユニーク値数を、
元の各行を残したまま付けます。値の候補とグループ判定キーは分けて追跡できます。
`merge_asof()`は時刻などの昇順キーで、前・後・最も近い右行を選びます。
`asof_audit()`で選ばれなかった行や再利用された右行を確認できます。
`rank_within()`は同順位の方式を選び、グループ内順位の候補をたどれます。
`dropna()`・`fillna()`・`rename()`と、対応した集計に限る`groupby()`も使えます。
既存のpandasの書き方に近づけつつ、未対応操作の入力元を推測して記録しません。
大きなグループでは`group_transform()`と`rank_within()`の候補を共有して記録します。
各行で同じ入力元を複製しないため、5万行の一つのグループでも値の出所をページで確認できます。
`resample_time()`は時刻を固定幅の枠へ集計し、空の時間枠も残します。
時刻の枠ラベルと、集計に入った元の値・時刻を区別して表示します。

`window()` では現在の行順で、グループ別の前行値・差分・累計合計・累積最小/最大・
移動合計/平均/最小/最大を説明できます。日時順の分析なら先に `sort_values()` を使ってください。
`op="pct_change"`は現在値÷前の値−1という相対変化です。百分率にする場合は100倍します。
以下で、条件分岐から補完、窓計算、除外行の確認まで一通りのデモを生成します。

```sh
python examples/decision_window_workflow.py
python examples/compound_conditions_workflow.py
python examples/join_audit_workflow.py
python examples/group_transform_workflow.py
python examples/ordered_cases_workflow.py
python examples/asof_workflow.py
python examples/rank_workflow.py
python examples/growth_workflow.py
python examples/time_buckets_workflow.py
```

大きな累積・移動窓は対象行を共有して記録します。元の値を黙って省略せず、
`explain_page()`で末尾の入力まで確認できます。

一時停止は行の動きと再生時間を止め、再開・速度変更でも途中の位置を保ちます。
元の入力が多い場合は50件ずつページを送り、すべて確認できます。
結合相手の表も全行を開けます。元のセルへ移動すると、そのセルまで画面が移り、
キーボードの操作位置も引き継ぎます。欠損には表示を添え、文字列の「∅」と区別します。

「Clear selection」で選択を解除できます。合計が欠損になる場合は必要な入力件数を
説明し、整数の正確な足し算とpandasの結果が異なる場合は桁あふれの可能性を示します。
値を選ぶと列の型も確認できます。`float_precision.py` は、同じ「0.1」と表示される
`float32`と`float64`のキーが結合で一致しない例です。HTMLにも各型の表示を保ちます。

値を選ぶと参照情報まで画面が移り、キーボードの操作位置も移ります。
「Back to selected cell」で元の工程とセルへ戻れます。「全行表示」も保持します。
空文字・空白だけの文字列は引用符と表示を添え、欠損と区別します。元データは変えません。
`blank_strings.py` では、`notna()`が空文字や空白を残すことを確認できます。
「Reduce motion」の選択は、ファイルを開いている間の端末側の設定変更でも保持します。

説明の注記・再生時の間・強調する列は、計算と分けて指定できます。

```python
story.annotate(total, note="合計を選ぶと元の売上が分かります。", hold=4, highlight="amount")
story.export_html("story.html", result=total, overwrite=True)
```

既存ファイルの上書きは `overwrite=True` を指定したときだけ行います。
ノートブックでは `story` や `total` を表示すると、iframe内にプレイヤーが表示されます。

## 大きめの分析を記録する

`DataStory.for_analysis()`は、1工程5万行・24列、50工程、全工程の合計200万セル、
圧縮前JSON 128 MBを既定の上限とします。これらの上限は同時に適用されます。
行ごとの四則演算、並べ替え、列の選択・順序変更・改名も記録できます。

大きな表は100行ずつ表示し、行番号で直接移動できます。参照元も50件ずつ取り出し、
入力番号で移動できます。集計値の再利用回数を省略したり、計算を標本だけで行ったりはしません。

```sh
python examples/large_analysis.py --rows 50000
python examples/large_group_workflow.py --rows 50000
python examples/large_window_workflow.py --rows 50000
```

`examples/generated/analysis.html`に、5万件の売上計算から地域別ランキングまでの
説明を生成します。詳しい使い方は[分析と規模のガイド](docs/analysis.md)にあります。
大きなHTMLは自動で圧縮されます。対応ブラウザーでローカルに展開され、再生時の通信は不要です。

## 共有前に確認する

結果で非表示になった列や抽出で除外された行も、元表としてHTMLに含まれます。
`story.table(df, include_columns=[...])`で必要な列だけを取り込み、
`story.export_info()["sources"]`で実際に含まれる元表・列を確認してください。
`export_html(..., approved_source_columns={元表のstep_id: 列名のリスト})`を指定すると、
承認していない列や元表が追加されていた場合に書き出しを止めます。
承認した列の値が安全かどうかは人が確認する必要があります。

グラフは棒・折れ線・散布図から選べます。点を選ぶと、その値の入力元へ移動できます。
画面は使いやすさの検証途中で、外部の読者による確認手順は
[読者評価プロトコル](docs/reader-evaluation.md)に記載しています。
非圧縮で出す場合は`compression="none"`を指定します。

記録した表と展開後のデータはメモリに置きます。数百万行の分散処理や、メモリに収まらない
データの処理には対応していません。大きな記録はNotebookへの埋め込みより、HTMLファイルとして
開く方法を勧めます。

## 対応範囲

- pandas 2.2.3以上、3.1未満を依存範囲としています。
- 行の抽出、4種類の結合、前処理、縦横変換、名前付きの複数指標の集計に対応します。
  平均は非欠損の入力が無いグループを欠損のまま返し、`min_count`の設定はありません。
- `calculate()`で行ごとの数値計算、`sort_values()`で安定した並べ替えができます。
- `select_columns()`と`rename_columns()`で列を整理できます。
- 結合は `one_to_one`・`many_to_one`・`one_to_many` を検査します。
- 集計の `dropna` は明示指定です。欠損キーを集計から外すかを利用者が決めます。
- 既定の記録上限は1工程200行・12列、全20工程、JSONデータ2 MBです。
- プレイヤーは最初の12行を表示し、全記録を表示する操作も用意しています。
- 対応外のデータ・操作や上限超過を、黙って省略・推定することはありません。
- フィルターには1行につき一つの真偽値を渡します。単独の真偽値や辞書は受け付けません。
- 行名・列名・カテゴリのラベルもコピーし、入力の変更から記録を保護します。

Polars、多対多・cross結合、任意の集計コールバック、GIF/MP4出力は対象外です。
DataFrameのindexを行の識別子に使わないため、重複したindexも区別します。
数値計算はpandasの規則に従います。表示用の丸めで計算を変えることはありません。

## HTMLを共有するとき

**HTMLには元のテーブルが入り、フィルターで除外した行も含まれます。**
列の選択で落とした列も元のテーブルに残ります。圧縮やページ表示は匿名化ではありません。
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

## ノートブックで試す

ソースから任意のノートブック用ツールを追加し、[サンプル](examples/notebook.ipynb)を開けます。

```sh
python -m pip install ".[notebook]"
jupyter lab examples/notebook.ipynb
```

FrameChoreoを導入したPython環境のカーネルを使います。空のstoryには開始方法が表示され、
記録後はノートブック内で再生、値の追跡、選択の解除まで操作できます。

## 1.0候補のワークフロー

`drop_missing`・`fill_missing`・`drop_duplicates`による前処理、`astype`・`to_numeric`・
`to_datetime`による型変換、`string_transform`による文字の整形、`concat`による縦結合、
`melt`・`pivot`による縦横変換を追加しています。`group_agg`では、合計・平均・最小・最大・
中央値・非欠損の件数・ユニーク値数を、好きな結果列名でまとめられます。

結合はleft/inner/right/outerと、左右で異なるキー名に対応します。多対多結合は対象外です。

```sh
python examples/retail_workflow.py
python examples/reshape_workflow.py
```

生成先は`examples/generated/retail-workflow.html`と`reshape-workflow.html`です。
前者は2か月の注文を整えて6指標のレポートを作り、後者は月別の表を縦長・横長に変えて比較します。
どちらも通常のpandasで別に計算した結果と照合します。

読む人は「表を見る」「前後を比較」「データ品質」「グラフ」を切り替えられます。
値の検索や表示列の切替は表示上の操作で、計算結果や記録したデータは変えません。
グラフの棒も選べるため、見た結果から入力元を確認できます。

`DataStory(language="ja", description="分析の説明")`で日本語UIを選べます。
列名・表の名前・注記は利用者が指定した内容をそのまま表示します。
`story.annotate(frame, chapter="整える", note="...", hold=4)`で工程を章に分けられます。

詳しい契約・制限・0.1からの移行は[1.0ガイド](docs/v1.md)と[API](docs/api.md)を参照してください。
