# Muse への依頼：宇宙計画（2026-11-14 統合のあと）

あなたは『ゼロからの科学』のグラフィック担当（Muse）です。担当は 3D モデル・UV・材質・LOD・アニメーション・表示の確認です。
Claude（コードと統合）が、あなたの正式ロケット素材 13 点（`feature/graphics-rocket-assets` 80d522e、Codex 経由で取り込み済み）をゲームに接続しました。
実画面で確かめた結果をもとに、次の作業をお願いします。

## 作業の前提
- リポジトリ：`twilightgame1014/science-civilization-game`
- 土台にするブランチ：`feature/game-space-integration-20261114`（最新 96737e5。完了済み）。新しいブランチ `feature/graphics-space-round30` などで作業してください。main へ直接 push しないでください。
- `src/graphics/` はあなたの担当です。変えるときは、ゲーム側が使っている公開 API（`src/graphics/types.ts`）を壊さないでください。
- ゲーム側のファイル（`src/space-models.ts`・`src/space-visual.ts` など）に触れるときは、`threejs-hd2d-graphics/HANDOFF-TO-CLAUDE.md` の冒頭に対象ファイルを宣言してください（その間、Claude はそのファイルを書き換えません）。
- 正本：アイテム ID・セーブ・組立の状態・試験・演出の時刻はゲーム側（`src/game/space.js`）。モデルは見た目だけです。
- 1 ファイルの容量：`dist/index.html` は今 15.53 MB で、上限は 16 MB（テストで検査）。新しい素材は、この残り約 0.47 MB に収まる形でお願いします。収まらないときは、先に相談してください。
- 参考資料：
  - `docs/space/SPACE-INTEGRATION-2026-11-14.md`（統合の記録・不具合と修正）
  - `docs/space/MISSING-ASSETS.md`（不足素材の一覧）
  - `docs/space/evidence-20261114/`（実画面の画像。正式モデルの段階表示・4方向・低い角度・演出）
  - `assets/rocket/rocket-contract.json`・`assets/rocket/README.md`

## いまの接続のしかた（確認用）
- 読み込み：`src/space-models.ts`。13 モデルの LOD1 を gzip で埋め込み、GLTFLoader で読む。読めないときだけ `src/space-visual.ts` の仮表示。
- 発射サイト：18×18 の 1 区画。中心が `launch-pad` の原点、+Z が正面、入口はローカル (0,+10)。
- 段階の表示：ゲームは組込枠ごとに部品の表示を切り替えています（ノード名で判定）。
  - `Frame_*` は外装（skin）がないときだけ表示
  - `Propulsion*`・`PropSkirt*`・`Nozzle*`・`Fin*` は推進部（propulsion）を組み込んだら表示
  - `Capsule*`・`Hatch*`・`Nose*`・`Window*`・`RCS*` は搭乗区画（capsule）を組み込んだら表示
  - それ以外のメッシュは外装（skin）を組み込んだら表示
- 機体のまわりの設備（electronics-fab・computer-bench・test-terminal・power-distribution・life-support・suit-stand・spacesuit-display・parts-rack）は、ゲームが**決め打ちの位置**に置いています（`src/space-models.ts` の `positions`）。
- クリップ：`hatch_open`・`bay_open` は段階 3 の地上でだけ開いた姿勢。`tower_retract` と `corridor_retract` は発射の 3 秒後から、`mount_release` はさらに 2 秒後から。
- 上昇：ゲームが毎フレーム機体の高さを上げる（発射 7 秒後から、毎秒 12 マス）。噴射はゲームが作った円すい（仮）。

## 依頼（優先順）

### 1. 主人公を隠す公開 API（必須）
搭乗してから地上へ戻るまで、主人公はカプセルの中なので絵を出したくありません。
今は公開の口がないので、ゲームが `gfx.character.group.visible` を直接切り替えています（`src/space-visual.ts`）。
- 依頼：`setPlayerVisible(visible: boolean)` のような公開 API を `types.ts` に足してください。
- 足してくれたら、Claude が直接の切り替えをやめてその API へ移します。

### 2. 段階 S2 の部分外装と、ゲームの組込枠の対応（決めてほしい）
契約の S2 は「推進部の外装＋下部の外装 P1〜P3（P4 は開いて骨組みが見える）＋上部の一部」という**途中の姿**です。
ゲームは外装（skin）を 1 つの組込枠として扱うので、外装を付けた瞬間に全部の外装が出ます（S2 の途中の姿は今は使っていない）。
次のどちらかを選んでください。
- (a) S2 の途中の姿はゲームでは使わない（契約からも外す）。
- (b) 組込枠ごとに表示するノードの一覧を契約（`rocket-contract.json`）に書く。Claude が正規表現の判定をやめて、その一覧どおりに表示する。

### 3. 機体のまわりの設備の置き場所を契約に
設備 8 点の位置をゲームが決め打ちしているので、台の上の機器や塔と干渉していないかが保証されていません。
- 依頼：`launch-pad` に設備ごとの接続点（例：`Anchor_equip_fab`・`Anchor_equip_bench` …）を足すか、契約に置き場所の表（ローカル座標と向き）を書いてください。
- 実画面（`pc-S4-low-near.jpg`）では大きな干渉は見えませんでしたが、全方向の確認はできていません。

### 4. クリップの全姿勢の検品と、ゲームの時刻との合わせ
`animationsVerified` では `hatch_open` の終わりの姿勢だけが数値で確認されています。
- 依頼：8 クリップすべての、始め・途中・終わりの姿勢を確認してください。特に：
  - 通路の退避
  - 支持アームと保持アームの外れ方
  - ハッチと点検扉が開いた姿勢で、ほかの部品と重ならないこと
- そのうえで、ゲームの時刻（退避は 3 秒後から、保持の解除は 5 秒後から、上昇は 7 秒後から）でよいかを確かめてください。変えたいときは秒数で指示してください。
- 確認用の画面：検証モード（`dist/verify.html`）→ メニュー「宇宙へ」→ 下の「検証：宇宙計画の段階へ」で、発射サイトの設置・組込・試験・搭乗口への移動ができます。そのあと「打ち上げ」タブから搭乗して打ち上げてください。

### 5. 噴射と煙
噴射は今、ゲームが作った円すい（仮）です。契約には `Anchor_exhaust`・`Anchor_smoke_l`・`Anchor_smoke_r` があります。
- 依頼：噴射の炎と発射台の煙のエフェクトを用意してください。`playVisualEffect` の新しい種類か、モデル内のノードのどちらでもかまいません。
- 用意してくれたら、Claude がゲームの時刻につなぎます。

### 6. 宇宙服の正式 8 方向シート（GPT の原画のあと）
GPT が男女の宇宙服シートの原画を描きます（仕様は `assets/rocket/GPT-SPRITE-REQUEST.md`）。
- 依頼：既存の主人公シートと同じセル・足もと・可視高にそろえて仕上げてください。8 方向の自己点検（`HD2D.diag8Check`）に通ることも確かめてください。
- 置き場所：`assets/hero/`。ゲーム側の切り替えは Claude が作ります。
- いまの表示は、ゲームが重ねている仮の印（白い箱と透明な球）です。

### 7. テクスチャを貼る準備（GPT の原画のあと）
- 依頼：UV テンプレート 2 点（`uv-template-rocket-body.png`・`uv-template-capsule.png`）の最終確認をお願いします。GPT の原画が届いたら材質へ貼り、法線と粗さの調整もお願いします。
- 容量の制約（上の「前提」）に注意してください。必要なら解像度を下げるか、共有テクスチャの仕組み（`assets/build/nature-tex` と同じ方式）を使ってください。

### 8. LOD0 の扱い（相談）
今は容量のため LOD1 だけを同梱しています。近くで見たときに LOD1 で足りるか、見た目の判断をください。

### 9. `feature/graphics-round29-open-items`（5aeff1f）
この統合では確認していません。統合してほしい内容があれば、何を・どのファイルかを教えてください。

## 返してほしいもの
- ブランチ名とコミット。
- 変えたファイルの一覧（ゲーム側のファイルに触れたなら、その宣言）。
- 上の 1〜9 それぞれの状態：対応済み／一部／未着手／判断待ち。
- 確認した画面（方向・角度・段階・クリップの姿勢）と、確認していないこと。
- 容量の変化（`npm run build` の `dist/index.html` の MB）。
