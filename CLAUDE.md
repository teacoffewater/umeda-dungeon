# 梅田ダンジョン 3Dナビ — 作業ガイド

日本一複雑と噂の梅田地下街を3Dで案内するアプリ。**コンセプト: 地下にいる人が地下の中だけを移動するためのナビ。**
地上に出れば Google Maps で足りるので、地上出口・地上専用通路は表示も案内もしない（出口データは位置合わせと現地調査の基準点として内部保持のみ）。

- ビルドツール無しの静的サイト。`index.html` + `app.js`（esbuild のバンドル）だけで動く
- 公開先: https://teacoffewater.github.io/umeda-dungeon/ （GitHub Pages / `main` ブランチのルートを直接配信。**push した瞬間が本番デプロイ**）
- 現地調査モード: 同URL + `?survey=1`

## 変更したら必ずやる3つ

**1. `app.js` を再生成する**

`app.js` はビルド成果物だが git 追跡されている（Pages が配信するのはこれ）。`main.js` / `shops.js` / `survey.js` / `landmarks.js` / `detail_whity.js` などを編集したら:

```bash
npx esbuild main.js --bundle --outfile=app.js --format=iife
```

再生成せずに push すると、ソースだけ変わって**本番の挙動が一切変わらない**という事故になる。

**2. `index.html` の `?v=` を +1 する**

```html
<script defer src="./app.js?v=47"></script>   ← 47 を 48 に
```

スマホのブラウザキャッシュ対策。全コミットで実施している運用なので、忘れると「直したのに端末で直っていない」になる。

**3. 地図データを触ったら検証を通す**

```bash
python3 tools/validate_map.py    # 店舗位置・食い込み・飛地・縄張り・フロア連続性
python3 tools/floor_audit.py     # フロア接続監査（歩ける高さ基準）
```

`validate_map.py` は最後の行が `OK: ...` になれば合格（現状は合格状態）。

## ファイルの役割

### 手で編集するもの

| ファイル | 内容 |
|---|---|
| `main.js` | アプリ本体（3055行）。Three.jsシーン・歩行グラフ・ダイクストラ経路探索・案内文生成・UI |
| `index.html` | UI と CSS。640px以下はボトムシート表示のスマホレイアウト |
| `shops.js` | 店舗・エリアデータ（公式フロアマップから採録） |
| `landmarks.js` | 目印（金色のピン）と写真。現地調査の記録から手で追記する |
| `survey.js` | 現地調査モード（`?survey=1`） |
| `geo.js` | 座標の土台 metric-v1。`tools/data/frame.json` と同じ値（`tools/geo.py` が一致を検査） |
| `detail_maps.js` | 詳細地図を持つ施設の登録表。`detail_<zone>.js`（自動生成）を束ね、専用エリアのオフセット `origin` を決める |

### 自動生成（手編集しない）

| ファイル | 生成元 |
|---|---|
| `app.js` | `npx esbuild main.js --bundle --outfile=app.js --format=iife` |
| `detail_whity.js` | `python3 tools/extract_whity_pdf.py` → `python3 tools/gen_detail_whity.py`（`detail_maps.js` が束ねて main.js に渡す） |
| `ground_data.js` | `python3 tools/gen_ground.py`（OSMのビル外形+道路網） |
| `exits_data.js` | `python3 tools/gen_exits.py`（OSMの番号付き出入口 165件） |

ホワイティ詳細地図のパイプライン（素材は全てリポジトリに入っているので、クローンだけで再現できる）:

```
tools/data/floorguides/whity_2016_labeled.pdf   ← 2016年公式フロアガイド
  → tools/extract_whity_pdf.py  → tools/data/whity_2016.json
  → tools/gen_detail_whity.py   → detail_whity.js
```

## 座標系は2つある（最重要）

「広域」と「詳細」は**別の座標系**で、意図的に位置合わせしていない。これを混ぜると壊れる。

| | 広域地図 | ホワイティ詳細地図 |
|---|---|---|
| 座標 | 実座標 `metric-v1`（mx=東向きm / my=南向きm、北が上） | ガイド座標系（紙のフロアガイドの形そのまま） |
| 出典 | OSM + 案内図のトレース | 公式フロアガイドPDF |
| world変換 | `M2W = ([mx,my]) => [(mx-800)*0.5, (my-1100)*0.5]`、`UNIT_M = 2.0` | `G2W` |
| 粒度 | 店が「どのモールにあるか」まで（ホワイティは10エリアに集約） | 個々の店の並び位置 |

紙のフロアガイドはローカル座標のまま使い、案内もその中で完結させる。実座標に合わせて歪ませてはいけない（過去にやって差し戻した）。

フロアは `FLOOR_Y = { S1: 66, B1: 0, B2: -66 }`。UI表記は S1=浅層 / B1=中枢層 / B2=深層。視認性のため間隔は誇張してある。

## 設計方針（変えるときは先に相談する）

- **地上に出さない。** 地上出口・地上専用通路は表示も案内もしない
- **corridor ゾーン**（`nishi_umeda` / `sonechika`）は現地で施設として認識されない通路。施設レイヤー・地図ラベル・「ここから○○」案内に出さない
- **詳細地図を持つ施設は `detail_maps.js` の `DETAIL_MAPS` に登録したものだけ**（現在 `whity` / `avanza` / `dotica` / `dojima_flat` / `kanden_b1`(仮配置) / `kanden_b2` / 三番街の館×階4枚）。`enterDetail()` は未登録ゾーンでは何もしない。施設ごとに専用エリア（`origin`）を離して置き、互いに重ねない
- 詳細地図の案内に入る条件は「両端が**同じ施設**の詳細地図に載る店ノード」（`guidePosOf` は `type === 'shop'` かつ `DETAIL_MAPS[zone]` があるものだけ通す）。ゾーン地点を選ぶと広域案内のままになる
- **詳細地図を持つ施設のモール集約ドットは詳細地図への入口。** 出発地・目的地には設定しない（店を選ぶのは詳細地図の管轄）。三番街・イーマのように詳細地図が無い施設のドットは従来どおり館ノードを選択する

## 動作確認

```bash
npx -y http-server . -p 8931 -c-1     # → http://localhost:8931
```

ブラウザ自動操作で確認する場合の落とし穴:

- 検索ピッカーは `fill()` だと候補が出ない。`pressSequentially()` で入力し、候補は `.opt:visible` で拾う（非表示の候補が先頭にある）
- `window.__dbg` に `camera / controls / scene / THREE` と `dbgDetail() / dbgNav() / dbgReal() / dbgWalk()` がある。状態確認はこれが速い
- Three.js の Raycaster と `visible` は非表示オブジェクトも拾う。可視判定は親を遡って自前で確認する
- 詳細モードでは広域のルート線グループが `visible=false` になっている（同じ TubeGeometry が2本ある）

## 環境

- Node: `three`, `esbuild`（`npm i`）
- Python 3: `shapely`, `numpy`, `pymupdf`(fitz)。地図データ生成・検証スクリプトで使う

## 進め方

- `tasks/todo.md` — 残タスク。着手前に見る
- `tasks/lessons.md` — ユーザーからの指摘で得た教訓と技術メモ。**作業前に読む。同種の指摘を受けたら追記する**
- `docs/superpowers/specs/` — 設計仕様（metric座標フレーム、二層地図構造）
- `rebuild/` は .gitignore 済みのローカル作業用スクラッチ（重い作業画像）。無くても作業できる
- コミットメッセージは日本語。「何を・なぜ」を本文に書く（指摘 → 原因 → 修正 の形式が多い）
