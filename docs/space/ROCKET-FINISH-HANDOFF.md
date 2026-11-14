# ロケット系素材の導入申し送り

2026-11-14。外部宛て送信はしていない。

基準コード：`feature/game-space-integration-20261114` / `96737e5c7593dfb07dd9fa022d0fe696c5996634`。Claudeの回収済み実装はこの統合ブランチで比較・採用済み。再度上書きマージしない。
素材正本：`feature/graphics-rocket-assets` / `80d522e7c21dec98bdc59ae4f7b630a0dab90bc1`、READMEとcontract v5。
作業先：`feature/game-rocket-finish-20261114`。mainへの直接pushはしない。

## Muse向け

26 GLBを原本SHAのまま保持。配置・段階・クリップの解釈はゲーム側 `space-models.ts` / `space-animation.ts`。S3のハッチ・機器室はopenクリップの終端、S4はclosed終端。塔はクリップ内の後退を使い、ゲームから二重移動させない。通路は動いた塔のAnchorへ追従する。

原GLBの外装等にUV属性がないことを確認したため、`space-materials.ts` で実行時の複製にUVを投影。胴体/カプセルはテンプレートの高さ帯とP4→P3→P2→P1の周方向に対応。汎用材は1mを基本とするボックス投影。原本バイナリは不変。この投影はゲーム用の接続処理であり、Muse納品GLBにUVが焼き込まれたという意味ではない。将来正式UVを内蔵する際は、既存属性を使う分岐へ切替えられる。

色画像は `assets/rocket/textures/`、実行用は `assets/build/rocket/*.webp`。台帳に寸法、透明、タイル種別を記載。対応面にはmaterial cloneだけを適用し、金属度・粗さを維持。色を法線として流用しない。縁は処理済みだが、全照明条件で継ぎ目が不可視であるという保証はしない。LOD間は同一色画像を共有。煙はdepthWrite=false、PC12枚、スマホ4枚。煙原画4枚は各Spriteに分配。

主人公スプライトは展示用GLBと独立。左右斜めを含む既存の8行、4コマの契約、可視高200pxと足元29pxを維持。既存通常服と同じ顔・頭身を参照した生成画像をセル単位で登録。将来の絵の修正は画像差替えのみで進行・セーブに影響しない。

## Claude／コード担当向け

`space-assets.json` は `scripts/export-space-contract.mjs` から実データに基づいて出力。55 icon ID → 同名item ID。未発見は「？」と分類ヒント、欠損時は既存の名前と記号にフォールバック。`SPACE_ICO` を既存アイコンAtlasより先に検索する。

`ASSETS_READY` がgzip JSONを展開してからUIを起動。GFX bundleもgzip化し、LOD0を入れても配布HTMLを16MiB以下に保つ。既存workbenchとpower-plantを流用し、重複品目を追加しない。科学設備6点は製作UIと設置済みサイトに所有状態を反映。

`S.space.suit` に応じて `heroAssetKey()` が男女の通常/宇宙服シートを選ぶ。新規セーブID不要。ロケット組立、試験失効、搭乗、発射前保存、二重発射防止、再読み込み、スキップ、初回記録と再演出の区別は既存SPACEを継続利用。推進・誘導・圧力・試験値は架空規格。実機の製造や誘導に使える数値は含めない。

カメラは全景・低角度・搭乗の状態で切替え、上昇はゲーム側トランスフォームのみ。発射タイムラインは hatch_close → corridor_retract → tower_retract → mount_release → 噴射 → 上昇 → 宇宙へ。

## 実機確認（オーナーのiPhone 17）

Safariで配布された通常版または検証版を開き、縦横それぞれで「宇宙へ → 発射サイト → 10秒の描画計測」。計測すると射点画面へ移り、結果はこの端末にだけ表示。画面を別アプリへ切替えると測定を中断する。測定値、iOS/Safariの版、向き、発射演出の操作感を記録する。自動のスマホ画面幅テストは実機FPSの代替ではない。
