8方向の行選びが固まるため4方向にフォールバックしていたゲームへ、Muse §31/§32を統合します。カメラには主人公の実際の足元の高さを渡し、手前の低い植生のフェードを有効にします。

- ベース：`feature/game-8dir` (`0244863`)。取り込み元：`feature/graphics-camera-focus-fade` (`6eff8eb`)。
- `threejs-hd2d-graphics/src/graphics/` 全体をゲーム側へそのまま上書き。両ツリー各24ファイルが取り込み元とbyte一致し、モジュールの独自編集はありません。
- ゲーム側は連続 `facing` と既存 `speed` を渡し、停止・壁接触時は向きを保持。カメラの注視点へworldHeightを渡します。
- ロジック・進行・セーブ形式・地形・shim・発電所の条件・DQ3導入時期は変更していません。

検証：`npm test`（194件＋全174種到達）、`npm run typecheck`、`npm run build`、`CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run e2e`（211項目）すべて合格。E2Eは一時HTTPサーバーで配信し、file URL制限がある環境でも全件を実行できます。

追加で全カメラ角の8方向単体検証、男女の実WebGLで移動・停止・壁・カメラ回転・斜め速度、坂の追随、植生フェードを検証しています。実機60fpsの残差・iPhone Safariは未測定です。12°以下は既存の地形回避処理が平地でも約20.56°へ引き上げるため未確認で、扱いを質問として残しています。

変更内容・ゲートの実行結果・測定条件・未確認事項・質問は [CODEX-TO-MUSE-2026-11-08.md](https://github.com/twilightgame1014/science-civilization-game/blob/feature/game-codex-integration/docs/handoff/CODEX-TO-MUSE-2026-11-08.md) に記載しています。オーナーのレビュー・最終マージ用ドラフトです。
