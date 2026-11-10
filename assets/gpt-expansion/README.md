# GPT拡張素材（ワールド拡張ラウンド17、2026-11-07）

オーナーが統合プロンプトで生成した10枚のGPT原画を、切り出し・
タイリング補正・モデリングしてゲーム投入可能な形にしたもの。
原画は `source/` にそのまま保存（上書きしない）。

## 対応表

| 原画 | 内容 | 加工済み | 投入先 |
|---|---|---|---|
| sheet-01-conifer-sprays.jpg | 針葉樹スプレー2×2 | sprays/conifer-{cedar,pine,young,tip}.png | 針葉樹ノード（種はIDシードで決定） |
| sheet-02-snow-sprays.jpg | 雪スプレー2×2 | sprays/snow-{conifer,broadleaf,shrub,icicle}.png | tree:conifer-snow / tree:winter / bush:snow |
| sheet-03-ground-a.jpg | 地面前半2×2 | ground/ground-{forest,mud,sand-dry,sand-wet}.png | 地形スプラット（forest/mud/sand 使用、sand-wet は予備） |
| sheet-04-ground-b.jpg | 地面後半2×2 | ground/ground-{volcanic,snow-raw,snow-clean,desert,path,path-plain}.png | path-plain をスプラット使用。他はエリア実装時の予備（snow は足跡除去版が snow-clean） |
| sheet-05-lava.jpg | 溶岩全面 | ground/lava-albedo.png + lava-emissive.png | lava ノード（発光は割れ目のみ） |
| sheet-06-shore-plants.jpg | 水辺・乾燥植物2×2 | sprays/{reed,lily,dry-shrub,palm-frond}.png | grass:reed / lily / bush:dry / tree:palm |
| sheet-07-village-props.jpg | 集落小物・自由配置 | props/*.png（11点）→ models/*.glb（11点） | 集落小物モデル（props.json に寸法・占有） |
| sheet-08-npc-guide.jpg | NPC案内役4×4 | npc/guide.png + guide/frame-r{0-3}c{0-3}.png + guide-walk.gif | NPCスプライト（仕様は npc/README 相当をINTEGRATION §23に記載） |
| sheet-09-npc-resident.jpg | NPC住民4×4 | npc/resident.* | 同上 |
| sheet-10-npc-craftsman.jpg | NPC職人4×4 | npc/craftsman.* | 同上 |

## 加工方針

- スプレー・小物・NPCの切り出しはアイコンで実績のある方式：
  境界フラッドフィル＋rembg（isnet-general-use）セグメンテーション
  ゲート＋縁のにじみ除去、αは二値。白一括削除はしない（雪・白髪・
  布・花が残ることをマゼンタ合成で全点確認）。
  - 雪シートはセグメンテーション合体方式（白背景に白い雪が溶ける
    ため）。針葉樹の小枝先（右下）はゲート方式で消えたため合体
    方式で復旧した。
- 地面は不透明のまま quadrant 切り出し→焼き込み照明の平坦化→
  ハーフロール・クロスフェードでタイリング化、2×2プレビューで確認。
  雪原の足跡は43箇所を検出して拡散インペイントで除去（rawも保存）。
  土の道はわだち有り（ground-path）と弱めた版（path-plain）の2種。
- 溶岩は色と発光を分離：アルベドは割れ目を沈めた暗い殻、
  発光マスクは割れ目のオレンジ抽出（被覆率 約1.3%＝線状のみ）。
- NPCは均等分割でなく各フレームのα外接矩形で切り出し、キャラ
  ごとに単一スケール（中央値高さ→205px/256pxセル）で正規化、
  足元基準点をセル下端29pxに統一（主人公シートと同仕様）。
  脚の入れ替わりは下部1/3のα差分で全行確認済み。
- 小物モデルは建物と同じパイプライン（Blender、GPT建物テクスチャ
  共有、ContactShadow付き、金属部品なし、看板に文字なし）。

## スクリプト（再実行可能）

- tools/process_sprays_ground.py — スプレー切り出し＋地面＋溶岩
- tools/cut_props.py — 小物の連結成分切り出し
- tools/build_props.py — 小物GLBビルダー（buildings のヘルパー流用）
- tools/process_npcs.py — NPC正規化＋歩行GIF
- tools/bundle_expansion.py — モジュール用 expansionTextures.ts 生成

process-report.json / npc/npc-report.json / props-measured.json に
加工数値を保存。
