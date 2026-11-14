# 街づくりの最終統合（2026-11-14、Claude）

- **ブランチ**：`feature/game-city-final-20261114`。土台は `feature/game-city-recover-20261114` の 8563c7f。
- **A と B の関係**：
  - 8563c7f は、A（`feature/game-city-formal-assets-20261114` 34dd168）を土台にしている。
  - そこへ B（`feature/game-city-playthrough-20261114` 2ad10e2）の案内と通し確認を回収した統合版である。
  - 判断の表は `RECOVER-2026-11-14.md`。
- **重複の扱い**：A と B の統合は済んでいたので、やり直していない。このブランチで足したのは、下の既知の問題の修正と、同じビルドでの確認だけ。

## 統合済みの確認（8563c7f の時点で済み、ここで同じビルドを確かめ直した）
- 正式素材：24 建物 46 工程・施工キット 7 点・道 3 種の色と法線。仮表示へ戻していない（`construction-visual.ts` の 1 本）。
- 工程の表示：
  - 一覧 k は「工程 k の完了直後」の姿。
  - 施工中は、終わった工程の数（stage）−1 の一覧を出す。
  - 工程 0 の施工中と予定地は、建物のノードを出さない（`tests/e2e/construction-visual.mjs` の「stage zero has no future building」）。
- B の案内：
  - 不足から建設・作り方・実習への入口
  - 完成した設備の「次に使う所」
  - 工作の入口の工程
  - 通し確認 `tests/e2e/playthrough.mjs`
- 素材の受け取り口：
  - 二重の実装はない。B の受け取り口は取り込まず、A の 1 本にした。
  - 配信用の素材の生成も `scripts/make-construction-glb.py` の 1 本。
  - Muse の原本 `assets/construction` は変えていない。配信用は `assets/build/construction`。

## このブランチの修正
- 完成・新発見の通知が、現場の画面（案内の枠）の見出しに重なる既知の問題を直した。
  - 枠を開いている間は、枠の上に 64px の帯をあけ、通知はその帯に 1 行・最新の 1 件だけ出す。
  - 枠を閉じると今までどおり。
  - 変更：`ui.js` の openModal・closeModal で `html.modal-on`、`template.html` の CSS。
  - 確認：`tests/e2e/construction.mjs` が PC とスマホ幅で、通知 3 件のときに重なりが 0 件であることを測る。

## 確認（同じビルド）
| 確認 | 結果 |
|---|---|
| `npm test`（セーブ v6・旧セーブの移行・資材の二重取得なし・道の草刈り・発射サイトの予約・正式素材の構造を含む） | 合格 |
| typecheck | 合格 |
| build | 合格、14.03MB |
| e2e：play | 合格 |
| e2e：construction（通知の重なりを追加） | 合格 |
| e2e：playthrough（PC とスマホ幅） | 合格 |
| e2e：construction-visual（実 WebGL、PC とスマホ幅） | 合格 |
| e2e：space（実 WebGL） | 合格 |
| e2e：hero-8dir | 合格 |

実 WebGL はヘッドレス Chromium＋SwiftShader（エミュレーション）。実機（iPhone 17 など）の表示と FPS は未確認。
