# 制作済み成果の回収統合（GPT/Codex、2026-11-15）

リポジトリは `twilightgame1014/zero-science`（旧名 science-civilization-game、同じrepository ID 1447675652）。基準は34dd1689e529643912ecad823e5514225b333577。
採用先は `feature/game-recovery-integration-20261115`。この報告を含むコミットが統合結果です。

## 履歴と競合

- Claudeの最終版3f49c6808936790b16c88cc142de6badade20c44は34dd168の子孫。8563c7の回収と通知表示修正を含む。
- Museの植物納品310d5b87bddc72ef04d8b6fc186eb1fa487bd9a6は、回収版7e149fd0de20371711520f844e50a8ecd582ee38の子孫。
- Claude最終版にMuse植物納品を通常マージ。双方の履歴を保持。競合はscripts/build.mjsの1か所。ClaudeのWebP・共有テクスチャ圧縮とMuseのvolcanoKit収録を両方残した。
- construction-visual.tsを唯一の施工表示として維持。construction-stage.ts、stagedBuildingType、CONS.setMuseの第二実装は追加しない。
- ロケット原本・契約v6、space-models.ts、engine.js、space.js、construction.jsは34dd168から差分なし。追随噴射と草の通常収量付与、IDとセーブ形式を維持。

## 成果ごとの採用状況

|区分|対象・元SHA|採用内容／実ゲームの確認|
|---|---|---|
|回収して導入|Claude案内・追加テスト：2ad10e2/a81e63d → 3f49c68|建設待ち・施工中、不足から材料／建設／実習へ、完成後の次の用途。construction/playthrough e2e。通常UIから作業台・たき火・かまどと最初の実験まで。全宇宙進行は別のボット・space e2eで確認|
|回収して導入|建築二重実装整理：a81e63d → 3f49c68|現行の正式表示1本＋材質別キット結合・軽量生成1本。24建物46段階を単体検査、construction-visual e2eで段階・ロード・再読込みを確認|
|回収して導入|発射場予約：5521e9の指摘 → 3f49c68|18×18の向き付き歩行可能／建築不可の範囲。space-reserve.testの26件、道路・再配置・経路・再読込みを含む|
|回収して導入|工場：37a82c9 → 7e149fd|factory-stagedを既存factoryのテンプレートに採用。原本→build/buildings-lite/factory.glb→ASSETS.buildings→正式建物読込み→construction-visualのstageNodes。evidenceのfactory-stage2、runtime.jsonのwallsLower/wallsUpperを確認|
|別パスで導入済み|共有キット・道路：37a82c9/f62e075|assets/town-construction側の12ファイルはassets/constructionへ同一内容で回収済み。圧縮版からASSETS.construction→construction-visualで使用。原本を重複制作しない|
|後継へ置換済み|hut-staged/house-staged：37a82c9|Muse回収契約で既存モデル＋stageNodesに吸収済みと判定。旧GLBを再導入しない|
|回収して導入|火山キット：5aeff1f → 7e149fd|assets/volcano-kit→buildのASSETS.volcanoKit→ui.attachWorld→world/render.ts→実ゲーム37配置、失敗0。pc/phone-volcanoの実ゲーム撮影（検証用カメラ）。地形・採集ID・収量は不変|
|回収して導入|滝・泡・水際：GPT原画＋7e149fd|assets/gpt-env→既存envTextures埋込み→world/render.ts。Waterfall2の一本に水筋とスクロールを接続、泡2面とShoreFoam34点。実テクスチャ画像のロードと実ゲーム画面を確認|
|後継へ置換済み|WaterfallKitの形状|ゲームの落ち口と形状が一致しないのでMuseがWaterfall2へ水筋・泡処理を移植。旧位置のWaterfallKitを追加配置しない。decor.waterfall=falseを維持|
|未導入・理由|warehouse/workshop＋LOD：37a82c9 → 7e149fd|原本は回収済み。既存の建物ID・用途・占有範囲に対応せず、新規建物の仕様が必要。今回の「未着手機能を増やさない」に従い、候補保管。勝手に既存作業台／倉庫へ置換しない|
|未導入・理由|植物8種×2形状×LOD：310d5b8|32 GLB・契約・元データを回収済み。植物の採集ID割当ては未定。葉の62プリミティブにはUVなし。採集仕様やUVを捏造せず正式適用待ち。別ファイルplant-uv-audit参照|
|原画制作済み・正式適用待ち|GPT植物8点・道路3点|generated-art-20261115.jsonに全11点。寸法とアルファを検査。葉カードUV、タイル継ぎ目、道路法線との整合はMuse仕上げ待ち。原本と縮小版を別納品、正式道路は既存品を維持|

火山の制作済みLOD1も接続しました。35mより遠い場合、または低品質設定では既存LOD1へ切り替え、原本のない種類はLOD0を維持。ゲームの地形・配置・GLBは変更しません。工場LOD1も原本保管で、工程表示はノード対応を検証済みのLOD0派生を使用します。これらを全LOD導入済みとは報告しません。

## 検証と証跡

`evidence-recovery-20261115/` は今回の実ゲームWebGL画面。PC 1280×800とスマホ幅390×844。検証用に場所・施工状態・撮影カメラを設定し、通常ゲームのレンダラーで表示。別の素材一覧デモではない。火山は景観を見やすい外側から撮影。通常操作での到達確認とは分ける。

`validation-recovery-20261115.json` に実行結果を記録する。実機iPhone 17、Android、実GPUの性能測定、人が初回採集から宇宙まで通して遊ぶ確認は未実施。SwiftShaderの画面を実機FPSと呼ばない。

## main・公開版との区別

調査時mainは004e0bc105c73e88848c29522d4ddba1c4258f3c。PR #1〜#6はopenで未マージ。
公開URLは https://twilightgame1014.github.io/zero-science/ 。最新の成功したPages公開記録はActions run 43611668145、feature/pages-auto-deployのdfb7265fdafe5ca125adf5e754df87f0dcc90cd5（build/deploy成功）。このブランチは今回の統合版とは異なる。

今回mainへ直接pushせず、古いPRを順番にマージせず、配信ワークフローも起動していない。feature/pages-auto-deployの「全ブランチpushで公開」設定は、この回収版へ無条件ではコピーしない。公開は統合版をレビュー後に明示的に選ぶ必要がある。ブラウザキャッシュまで同一SHAと確認したものではなく、上記はGitHubの成功した配信記録に基づく。
