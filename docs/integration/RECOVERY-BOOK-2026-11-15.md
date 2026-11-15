# 回収統合版（131dfc8）へ図鑑を合わせた統合（2026-11-15、Claude）

- **統合ブランチ**：`feature/game-recovery-book-20261115`
- **土台**：GPT/Codex の回収統合版 `feature/game-recovery-integration-20261115` @ 131dfc8（PR #7）。
  - 親は Claude の最終版 3f49c68 と Muse の植物 310d5b8（その中に回収版 7e149fd）。
  - 詳細は `RECOVERY-INTEGRATION-2026-11-15.md`。
- **足した物**：Claude の `feature/game-muse-recovery-20261115` @ 0de09be を通常のマージで。
  - 131dfc8 に入っていなかった図鑑（`feature/game-recipe-book-20261114` @ 645e3b8：M2-01・M2-03・M1 の台帳）。
  - 回収版と植物の計画の文書。
  - 0de09be の中の 7e149fd のマージは、131dfc8 にも入っているので差分はない。

## 衝突と解消
衝突は `package.json` の scripts の 1 か所だけ。両方の行を残した：
- `e2e:book`
- `book:ledger`
- `e2e:space`
- `e2e:recovery`
- `e2e:construction-visual`

`scripts/build.mjs` は自動で合わさった。次の 2 つがどちらも残っていることを確かめた：
- Claude 側：共有テクスチャの圧縮（道の WebP・`ASSETS.sharedTex`）と、図鑑の差しこみ（`/*BOOK_UI*/`）。
- Muse 側：火山キットの同梱（`ASSETS.volcanoKit`）。

131dfc8 からの差分は図鑑とその文書・テストだけ。
- 建築の表示は `construction-visual.ts` の 1 本のまま。
- 次の物は 131dfc8 のまま：
  - 発射場の予約
  - ロケットの契約 v6・26 GLB
  - 追随噴射
  - 道の施工で草を採る仕組み
  - 火山の LOD1 の切り替え
  - Waterfall2・ShoreFoam
- `src/graphics` は `threejs-hd2d-graphics/src/graphics` と同一。

ゲームの決まりの変更が 1 つある（図鑑の作業で入れた物。131dfc8 の報告の「engine.js は 34dd168 から差分なし」はこのブランチでは成り立たない）：
- `engine.js` の `hasFacility`：建設の決まりでは、建物の設備は完成した建物があるときだけ使える。
- 移行で持ち物に残った設備は、建築の画面で置いてから使う。検証モードと以前の工作の決まりは変わらない。
- セーブ形式・アイテム ID は変えていない。

## 素材の状態（131dfc8 の報告のまま。このブランチで変えていない）
| 状態 | 素材 |
|---|---|
| ゲームに接続済み | 工場の段階版、火山キット（LOD1 は 35m より遠いか低品質のとき）、滝の流れの筋・泡、ShoreFoam |
| 既存の経路で導入済み・後継へ置換済み | 共有キットと道の画像 12 点、小屋・家の旧段階モデル |
| 原本を保管・ゲームの仕様待ち | 倉庫・工房と LOD、植物 8 種×2 形×LOD の 32 GLB |
| GPT 原画あり・正式適用待ち | 植物 8 点（`assets/plants/gpt-art`）、道 3 点（`assets/construction/gpt-art`） |

GPT 原画の正式適用を待っている理由：
- 植物：葉の 62 プリミティブに UV がない。
- 道：継ぎ目と既存の法線との整合を確かめていない。

ビルド・コードからは参照していない。正式の道は既存の物のまま。

## 確認（このブランチ）
結果は `validation-recovery-book-20261115.md`。

## 公開
このブランチは公開していない。
- 確認した時点で、公開中のページは前の版だった（14.15MB、図鑑のコードを含まない）。
- 公開のワークフローは、main とこのブランチの両方で手動（workflow_dispatch）だけ。
- このセッションからは GitHub の Actions・Pages の API に届かない。
- 公開には、オーナーがこの SHA を指定して承認することが要る。
