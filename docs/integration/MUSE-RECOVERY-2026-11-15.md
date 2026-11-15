# Muse 回収ラウンドの統合（2026-11-15、Claude）

- **統合ブランチ**：`feature/game-muse-recovery-20261115`
- **土台**：`feature/game-recipe-book-20261114` @ 645e3b8（街の最終統合 3f49c68・図鑑を含む。Muse の土台 34dd168 を含む）
- **取り込み**：`feature/graphics-recovery-20261115` @ 7e149fd（HANDOFF §39）を通常のマージで。

## 衝突と解消
`scripts/build.mjs` の 1 か所だけ衝突した。
- こちら側を残した：道のテクスチャを WebP で入れる処理と、予定地・足場・資材の山の共有テクスチャ（`ASSETS.sharedTex`）。
- Muse 側から足した：火山キット `ASSETS.volcanoKit`。
- Muse 側の「道の PNG をそのまま入れる」行は使わない（同じ鍵を WebP で上書きするため）。

ほかはそのまま入った：
- `ui.js` の 1 行（`attachWorld` へ `volcanoKit`）
- `render.ts`：火山キット・Waterfall2 の流れの筋・滝つぼの泡・ShoreFoam
- 工場の段階版 GLB と `construction-assets.json` の factory の stageNodes
- `assets/town-construction/`（原本。ビルドでは使わない）

`src/graphics` は `threejs-hd2d-graphics/src/graphics` と同一（diff なし）。

## 確認
| 確認 | 結果 |
|---|---|
| npm test | 合格 |
| typecheck | 合格 |
| build | `dist/index.html` 14.65MB（15.36MB。上限 16MiB） |
| e2e:play | 211 件合格 |
| e2e:construction | 48 件合格 |
| e2e:playthrough | 合格 |
| e2e:book | 38 件合格 |
| e2e:space（実 WebGL・SwiftShader） | 合格 |
| hero-8dir（実 WebGL） | 合格（男女・8 行） |
| construction-visual（実 WebGL、PC 1280×800・スマホ幅 390×844） | 合格（工場の段階版を含む 24 種・7 キット・道） |
| 火山・滝の撮影（実 WebGL・SwiftShader、検証モード） | 火山の火口・溶岩・キットの岩棚が表示される。滝は流れの筋と滝つぼの泡が出る。滝を反対（yaw 180）から見ると、雪の斜面に縞の影が出た（統合前からあったかは未確認） |
| 倉庫・工房 | 未接続（判断待ち） |

すべて SwiftShader か偽の描画での確認で、実機ではない。iPhone 17 の FPS は未測定。

## オーナーの判断待ち
- 倉庫（warehouse）・工房（workshop）を新しい建物にするか（§39 の相談 1・2）。下の「提案」。
- 植物（M3-02）：`docs/plants/PLANTS-INTEGRATION-PLAN.md`。
- GitHub Pages の自動公開（`feature/pages-auto-deploy` dfb7265）：未採用。理由は報告に書いた。

## 提案：倉庫・工房
決めること：ID・工程・資材・機能・登場の時期。
- **倉庫**
  - 今の「倉庫（storehouse、小屋のモデル）」とは寸法も入口も違う。storehouse を差し替えると、既存セーブの当たり判定が変わる。
  - 案 A：入れない。
  - 案 B：`warehouse`＝大きな倉庫（鉄の時代以降・石材＋木材＋鉄の部品）。
    - 機能は、今は保管の仕組みがないので「見た目と設備の置き場所」だけになる。
    - 機能のない建物を作るかどうかの判断が要る。
- **工房**
  - 作業台（bench）の上位として「金属の道具の工作」に必要な設備にする案。
  - これは既存のレシピの条件を変えるので、ボットのテストと既存セーブへの影響を調べてから。
- どちらも GLB はそのまま使えるが、軽量化（共有テクスチャ）を通すと 1 点およそ 0.3〜0.5MB 増える（未計測）。容量は植物の LOD1 と取り合いになる。
