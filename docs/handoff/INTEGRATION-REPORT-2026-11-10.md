# 統合の棚卸しと修正（2026-11-10、Claude）

作業ブランチ：`feature/game-integration-20261110`（土台 `feature/game-codex-integration` 5d49eea）。`main` へは push していない。公開もしていない。

## 0. 着手時のリモートの状態（2026-11-10 取得）
| ブランチ | 先端 | 内容 | この統合での扱い |
|---|---|---|---|
| `feature/game-codex-integration` | 5d49eea | game-8dir＋Muse 第25・26ラウンド＋Codex の facing 接続・e2e の整備 | **土台** |
| `feature/game-camera-height` | b38f067 | 第24ラウンド＋カメラの高さの固定（打ち消し方式）・記録 | 合流（カメラは §32.1 の口で作り直し） |
| `feature/game-8dir` | 0244863 | 8方向シート・自己点検 | 土台に含まれる |
| `feature/graphics-camera-focus-fade` | d08fd51（Codex は 6eff8eb を取り込み。差は文書1つ） | 第25・26ラウンドの描画モジュール | `src/graphics` を d08fd51 とバイト一致に |
| `feature/graphics-8dir-fix` | a01b2ba | 第25ラウンド | focus-fade に含まれる |
| `feature/graphics-round24` | d654c9b | 第24ラウンド | focus-fade に含まれる |
| `main` | 004e0bc | 文書 | すべての作業ブランチに含まれる |

公開版：GitHub Pages は無効（`has_pages: false`）、手動の公開ワークフローは一度も実行されていない。
Claude が更新していた claude.ai の非公開ページ（Artifact）は `feature/game-camera-height` b38f067 のビルド。それ以外の公開先は**未確認**。

## 1. 要望ごとの状態
（記号：◎＝実装済み／実描画で確認、○＝実装済み／偽モジュールの e2e・単体テストで確認、△＝部分実装、×＝未実装、□＝実装済み／未統合）

| 要望 | 状態 | ブランチ・コミット | 主なファイル | 根拠 |
|---|---|---|---|---|
| ドラッグで視点変更（横360°・縦・ピンチ／ホイール・PC とスマホ） | ◎ | b7cbd66 → この統合 | `src/game/ui.js`（探索カメラ・入力） | e2e 211、実WebGL（§3） |
| 地形でカメラが上下しない | ◎（今回） | 61105b8・ea5b1be | `ui.js` の `camFrame`・`camLook` | 実WebGL：坂でカメラの world Y の幅 5.5e-7・俯角一定（`tests/e2e/camera-focus-fade.mjs`）、起伏で 3e-4（§3） |
| 地面近くまで下げられる | ◎（正投影の範囲で） | 61105b8 | 同上 | 平らな野で実角 1.87°（ズームで 0.42°）、画面の中心は足もと＋0.30〜0.34（§3） |
| 明示の再センタリング | ◎（今回） | 61105b8 | `ui.js`（🎯主人公に合わせる）・`template.html` | e2e（ボタンの出し方）。実描画は未撮影 |
| 男女の8方向・連続 facing・停止・壁・静止中の一周 | ◎ | 0244863・58f2b0b・Muse a01b2ba | `ui.js`・`graphics-entry.ts` | `tests/e2e/hero-8dir.mjs` 男女とも全合格（カメラ統合後） |
| 斜めの速さの正規化 | ◎ | 既存 | `ui.js` | hero-8dir の diagonal speed |
| 停止・壁接触で歩行停止 | ◎ | eaac209 | `ui.js` の `updateWalk` | e2e・hero-8dir |
| クリック移動が遅い端末で着かない | ◎（今回の修正） | ea5b1be | `ui.js` の移動 | 修正前は通過点のまわりを往復（Codex の土台でも再現）、修正後は到着 |
| 全面マップと HUD・文字選択の抑止 | ○ | 既存 | `ui.js`・`template.html` | e2e |
| 自然物の採取と保存 | ○ | 459cccf ほか | `nature.js` | 単体 64・e2e |
| 建物の配置・移動・撤去・当たり判定 | ○ | a6ec65c | `nature.js`・`ui.js` | e2e |
| 検証モード（全解放・別セーブ） | ○ | 4a91855 | `engine.js`・`ui.js` | 単体 18・e2e |
| 研究室の背景（SVG） | ○ | 既存 | `ui.js` の `labBackground` | e2e |
| 道具・設備・操作・物質のアイコン | ○ | c3c8ef0 ほか | `ui.js`・アトラス | 全174物質・23操作にアイコンあり（§4）。石のナイフは道具アイコン |
| 7エリア・山・海岸・NPC・約9倍の探索範囲 | ○ | 7690379・5768e57 | `src/world/shape.ts`・`nature.js` | 単体 54（9.44倍） |
| 外の野（境界を越えた探索・帰還・保存・再訪） | △（試験範囲 半径250） | 93bd452 | `shape.ts`・`nature.js`・`render.ts` | 単体（ID・保存・経路）、実WebGL（§3）。無限ではない |
| 歩く速さ | ○（変更なし） | 554d1b2 から毎秒7マス | `ui.js` | 「速すぎる」の記録はリポジトリに見つからない。歩く絵は実移動量に連動（Muse §31、speed） |
| 発展した街のモデル21点（DQ3） | ×（意図的） | — | — | ビルドに入っていない。段階の定義待ち（オーナー／GPT） |
| 施設 ID のない建物の対応 | □（暫定・未確認） | 既存 | `ui.js` の `STRUCT_PLAN` | 小屋＝倉庫、研究所＝蒸留器、工場＝電気炉、発電所＝蒸気機関＋発電機、研究施設＝反応器 |
| 景観の草と採れる草の見分け | × | — | — | Muse 依頼（未解決 8） |
| 木のインスタンス化・距離 LOD | × | — | — | Muse 依頼（未解決 12）。描画回数は §3 |

## 2. 取り込んだもの・残した差分
- 取り込んだ：codex-integration（5d49eea）、camera-height（b38f067）の文書・記録・カメラの入力と衝突の仕組み、focus-fade（d08fd51）の描画モジュール。
- 置き換えた：camera-height の「setViewportInsets と distance で毎フレーム打ち消す」高さの固定 → §32.1 の `setCameraTarget({x,z,y})` で、y を基準の高さから渡す。
  Codex 統合の「y に足もとの地形の高さ（追随）」と既存の自動の俯角の引き上げ（`camNeed`）も廃止（オーナーの確定仕様）。
- 残した差分：なし（どのブランチの機能も落としていない。8方向・カメラの両方の実描画テストが通る）。
