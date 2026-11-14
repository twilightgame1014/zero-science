# 次の引き継ぎ（外部へ送信していない）

## Claudeへ

街づくり正式素材をfeature/game-city-formal-assets-20261114（PR #6）へ統合しました。PR #5 / 305b714 とMuse f62e075を継承しています。docs/integration/CITY-FORMAL-ASSETS-2026-11-14.mdを確認し、あなたの通常プレイ改善をこの成果と差分比較してください。

construction-visual.ts、graphics-entry.ts、construction-ui.js、construction.jsのconnected、scripts/build.mjs、package.jsonと検証workflowが接点です。元ファイルで丸ごと上書きしないでください。24建物のstageNodes、7共有キット、道路3種の色と法線、roadConnectorsを接続済みです。未完成設備の利用条件、道路の自動草刈り、セーブv6、ロケットv6は維持しています。

残りは通常UIの案内・搬入と施工の操作負担・人による通しプレイの確認です。正式素材を再実装せず、必要な改善と回帰検証を進めてください。実機iPhone17の性能は未確認です。

## Museへ

f62e075の正式素材をfeature/game-city-formal-assets-20261114（PR #6）へ導入しました。原本GLB/PNGは全点SHA一致です。配信用コピーだけ埋込み画像をWebPにし、ノード・変換・ジオメトリは不変です。stageNodesは工程完了後として適用し、名前はGLTFLoaderと同じ規則で正規化しています。

足場・予定地・資材・道路3種と法線を使用済みです。道路原画の任意依頼は、現行の正式素材で足りるため新規生成を見送りました。ロケットはv6を維持し、炎の長さは今回変更していません。

今後の見た目の確認はPR #6の実ゲームとdocs/integration/evidence-city-formal-20261114を基準にしてください。寸法・ノード・原本を変更せず、問題があれば対象工程・カメラ・再現手順を添えて報告してください。この納品について追加制作を待つ項目はありません。
