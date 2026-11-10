# Codex への依頼（2026-11-08、ゲーム側統合の引き継ぎ）

```text
# ゲーム側統合タスク（Codex へ、Muse から）

## 背景
科学文明再建ゲーム『ゼロからの科学』の開発。体制は、オーナー
（最終判断・マージ）、GPT（監督・仕様）、Claude（主任エンジニア、
一時不在）、Muse（グラフィックス担当）、そして今回の統合担当
としてあなた。リポジトリが唯一の正。作業はすべてブランチ＋PRで
行い、main へ直接 push しないこと。

## ベースと成果物
- ベースブランチ： feature/game-8dir（0244863）
- 新しいブランチ feature/game-codex-integration を切って作業し、
  ベースへのドラフト PR を作ること。
- 結果は docs/handoff/CODEX-TO-MUSE-2026-11-08.md にも残すこと
  （変更点・ゲート結果・未確認事項）。

## 取り込むもの（グラフィックス側の2ラウンド）
どちらも threejs-hd2d-graphics/src/graphics/ の内容で、ゲーム側の
src/graphics/ を上書きするのが取り込み手順（両ツリー byte 一致が
原則）。feature/graphics-camera-focus-fade は 8dir-fix を含むので、
実際は後者のツリーで一度上書きすれば両方入る。

1. feature/graphics-8dir-fix（a01b2ba）— 8方向スプライトの
   行フリーズ修正（INTEGRATION §31）
   - モジュール同梱の検証を先に実行： node
     threejs-hd2d-graphics/tools/test-8dir.mjs → 全合格のはず。
   - 取り込み後、そちらの diag8Check（src/graphics-entry.ts）が
     通るようになる。4方向フォールバックが外れ、男女とも
     8方向表示になることを確認すること。
   - 可能なら setPlayerVisualState に facing（W3.face、そのまま
     ラジアン・atan2(x, z)）も渡すこと（任意だが推奨）。
     speed は既に渡しているので継続。
2. feature/graphics-camera-focus-fade（6eff8eb）— §23 対応
   （INTEGRATION §32）
   - setCameraTarget({x, z, y}) の y が注視点の高さになった。
     カメラの高さ固定＋毎フレームの打ち消しのワークアラウンドを
     外し、主人公の実高さ（足元の worldHeight）を y に渡すこと。
   - 草むら・薬草・花と風景の低い植生のフェードはモジュール側で
     自動。ゲーム側の変更は不要だが、効いていることの確認を。

## スコープ外（やらないこと）
- src/graphics/ の直接編集（上書きのみ。直したい点があれば
  ハンドオフ文書に書く）
- ゲームロジック・進行・セーブ等の設計変更
- 地形 shim の撤去（移行ステップc は Claude の判断待ち）
- main へのマージ（オーナーの仕事）
- 未決定事項の決定：発電所の建てられる条件、「発展した街」の
  定義（DQ3 素材の導入時期）

## 必須チェック（結果を正直に報告、未実施は未実施と書く）
- npm test / npm run typecheck / npm run build / npm run e2e

## 受け入れ条件
- 男女とも8方向で移動・停止・壁への接触・カメラ回転が正しい
- 斜め移動が縦横より速くならない
- 坂を登ってもカメラが追随し、主人公が画面外へ出ない
- 低い角度で手前の草やぶが薄くなり、主人公が半分隠れない
- 60fps でのカメラの残りのずれ：測れる環境なら実測値、
  無理なら「未測定」と明記

不明点は推測で進めず、ハンドオフ文書に質問として残すこと。
```
