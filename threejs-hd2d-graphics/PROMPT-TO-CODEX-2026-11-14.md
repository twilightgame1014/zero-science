# Codex／GPT（コード担当）への統合プロンプト — 2026-11-14（Muse）

ラウンド29の取り込みと、未導入分の配置・置換・再測定の
依頼です。契約の正本は INTEGRATION.md §34。作業は
TEAM_RULES どおり（feature ブランチ、ゲート全行、
main へのマージはオーナー判断）。

## 1. ラウンド29の取り込み

- ブランチ `feature/graphics-round29-open-items` の
  `src/graphics` ツリーを統合側へ取り込む（両ツリー
  byte 一致が前提。差分があったら取り込みを止めて報告）。
- 追加素材：`assets/volcano-kit/`、
  `assets/ui-science/` の設計パッケージ、
  `threejs-hd2d-graphics/GPT-REQUEST-VOLCANO-2026-11-11.md`。
- この回、Muse は**ゲーム側ファイルを一切変更して
  いない**。統合時の衝突はモジュール側に寄せること。

## 2. 火山キットの配置（未導入分）

- `assets/volcano-kit/README.md` の寸法・アンカーで
  火山エリアに景観として配置する（ash-grass-tuft、
  ash-shrub、basalt-outcrop-l/s、cooled-lava-chunk、
  crater-rim-shelf、fallen-block、ore-outcrop、
  scree-cluster）。
- 景観専用。当たり判定・採取系には触れない。
  LOD1 への切替距離はゲーム側の判断でよい。
- 登山道（TERRAIN.TRAILS.volcano）と硫黄・鉱石の
  ノード位置と重ならないよう散布すること。

## 3. §24.2 の受け口への置き換え

- `src/world/render.ts` で private の buildChunk／
  radii を使って外周チャンクを作っている箇所を、
  `config.world.chunkRange` の宣言と
  `gfx.setTerrainField({min, max} | null)` に
  置き換える（契約は §34.2）。
- 水面と背景リングの大きさは構築時に決まる。
  広い範囲が要るなら初期 config で宣言すること。

## 4. ロケット素材の導入（未導入分・要点のみ）

- 正本はブランチ `feature/graphics-rocket-assets`
  （tip 80d522e）の
  `threejs-hd2d-graphics/PROMPT-TO-GPT-CODEX-2026-11-14.md`
  と `assets/rocket/README.md`／`rocket-contract.json`
  v5。ここでは要点だけ繰り返す。
- 配置：発射台を原点に、支援塔は −X 4.6 m、搭乗
  コリドーは塔側アンカー接続。発射場のワールド位置は
  config 値＋暫定平坦地デフォルト（最終位置は
  オーナー判断）。
- 組立段階 S0–S4 は README のノードリストどおりの
  可視切替（権威は README）。S3 では hatch_open／
  bay_open の最終フレームを表示。
- 発射シーケンス順序：hatch_close → corridor_retract
  → tower_retract → mount_release → ゲーム側の上昇。
  モデルアニメとゲーム側移動を二重に適用しない。
- C 設備は既存の workbench／power-plant と重複
  させない。宇宙服スプライト（GPT 側）待ちで導入を
  止めない。
- GLB は編集しない。不整合は Muse に報告する。
  テクスチャの捏造・文字の焼き込み禁止。

## 5. 再測定と目視の依頼

- 火山の明るさ：§26.2 と同じ物差し（中央70%×65%
  平均輝度）と視点で統合後に再測定し、結果を
  CLAUDE-TO-MUSE §35 に記録すること。Muse 側の
  実測は §34.3（岩棚 19.1→約21、火口縁 24.5→26.6、
  部分改善）。まだ暗いと判断する場合は、§34.3 の
  (a) 火山タイル自体の明色化（GPT）／(b) 帯係数の
  専用アトリビュート化、どちらを採るかオーナーと
  決めて Muse に返すこと。
- 景観草と採取草の読み分け（§34.4）：実地で
  区別できるか目視し、結果を §35 に一言残すこと。

## 6. 禁止・留保事項

- アイテム ID は変更しない。
- GLB は編集しない（不整合は Muse に報告）。
- main へのマージはオーナーの判断。
- 発電所の建設条件と「発展した街」の段階定義は
  オーナー未決定のまま触らないこと。
- §34.5 のノード再設計は着手しない（判断待ち）。

## 7. 報告形式

- 取り込みコミット、配置したキットと座標、
  render.ts 置換の差分範囲、再測定値（§35）、
  ゲート結果（未実行は未実行と明記）、未確認事項。
