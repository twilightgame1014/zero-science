# 確認の記録：外観違い（倉庫・工房）と main 限定の自動公開（2026-11-15）

対象：`feature/game-town-variants-pages-20261115` の c85f392（ビルドの `version.json` の SHA）＋ 文書だけのコミット。

## 手元の確認
| 確認 | 結果 |
|---|---|
| npm test（`construction-looks.test.mjs` 35 件・`pages-workflow.test.mjs` 11 件を含む） | 合格 |
| npm run typecheck | 合格 |
| npm run build | `dist/index.html` 15,533,707 バイト（14.81MB。上限 16MiB） |
| e2e：play | 211 件合格 |
| e2e：construction | 48 件合格 |
| e2e：looks（新規、PC 1280×800・スマホ幅 390×844・旧セーブ） | 25 件合格 |
| e2e：playthrough | 合格 |
| e2e：construction-visual（実WebGL） | 合格 |
| e2e：recovery（実WebGL） | 合格 |
| e2e：space（実WebGL） | 合格 |
| e2e：8dir | 合格 |
| e2e：8dir --suit | 合格 |
| e2e：camera-focus | 合格 |
| e2e：book | 38 件合格 |

## GitHub での確認
- このブランチへの push（bd1473a）で動いたのは「テスト」（test.yml、run 43667070247、成功）だけ。
- 公開のワークフローは動いていない（feature への push では公開されない）。

## 実WebGL（SwiftShader）での見た目：`evidence-looks-20261115/`
- 次の物を並べて撮った（PC とスマホ幅）：
  - 工房の建物と標準の作業台
  - 大きな倉庫と標準の倉庫（hut）
  - 大きな倉庫の工程 2 の施工中（基礎＋足場）
  - 工房の建物の予定地（キットだけ）
- 完成した建物の種類は `result.json`。
- モデルの読み込み（解析）の時間：工房 31〜44ms、倉庫 45〜60ms（CPU の描画。実機の値ではない）。

## 確認していないこと
- main へ入れたあとの公開ワークフローの実際の動き：
  - build・verify・deploy
  - version.json の配信
  - 先端でない SHA を公開しないこと
- iPhone 17 などの実機・実 GPU の FPS。
- 人の手で最初から宇宙まで通して遊ぶこと。
