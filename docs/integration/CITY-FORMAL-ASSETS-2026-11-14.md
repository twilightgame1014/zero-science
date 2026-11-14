# 街づくり正式素材のゲーム導入

基準：PR #5 / 305b714 → Muse f62e075 → feature/game-city-formal-assets-20261114（PR #6）。mainへは未マージ。

## 導入

- Muse原本：assets/constructionの共有GLB7点、道路ベースカラー3点・法線3点をそのまま保持。source-hashes.jsonで正本のGit blob SHAと一致を検査。
- 24建物46段階：stageNodesは「工程完了後」の累積一覧。施工中はstage-1を表示し、将来の部品を出さない。GLTFLoaderと同じsanitizeNodeNameで照合。完成した建物の表示は既存の正式モデルに引き継ぎ、施工キットを撤去。
- 予定地の杭・縄・輪郭、搬入量に応じた資材、工程の高さに応じた足場・横木・板・筋交い・梯子を共有キットから配置。傾斜では柱の足を個別に合わせる。
- 道3種：1セル2mにつきUVを1回。ベースカラーはsRGB、法線は色変換なし・normalScale 0.5。地面追従とpolygonOffsetを維持。外周0.18mの頂点色を実際の地面の頂点色へ寄せて暗くし、隣接セル間には縁を付けない。接続部品の追加は不要。
- roadConnectorsを建物の道路接続判定へ使用。入口・占有形状・衝突・保存のIDは不変。
- 道施工の草刈り、通常収量、再生抑制、二重取得防止は前回実装を維持。
- ロケットGLB・契約v6・追随噴射・発射手順は不変。PR #4のv5検証結果は当時の版の記録として扱い、現行v6へ戻し変更はしない。任意提案の炎延長は今回は実施しない。

## 配信用コピー

scripts/prepare-construction.pyでassets/build/constructionを作成。原GLBを変更せず、埋込み画像だけWebP（最大512px）へ圧縮。ノード・変換・メッシュ・アクセサ・画像以外のbufferViewデータが原本と一致することを7点すべてで検査済み。生成物をコミットしており、通常ビルドにはPython不要。

ビルドは15.04MB（上限16MB以内）。既存の建物軽量GLB・共有テクスチャを工程表示にも再利用。施工時間の進み具合だけではモデルを再生成せず、段階や搬入量が変わった時に表示を更新する。

## 検証

- ローカルnpm test / typecheck / build：合格。
- 新しいconstruction-visual.test：24建物46段階の実GLBノード、正規化、7キット、回転、完成時の片付け、タイマー更新時の再生成抑制、道路UV・地形追従・セル接続を確認。画像を除いたモデルで構造を検査し、テクスチャの表示とは区別。
- construction-visual E2E：実ゲーム・実WebGL・PC1280×800とスマホ幅390×844。7キット、工程0/1/完成、回転、道路3色画像・3法線、保存・再読込みを検査。建築状態を投入するfixtureであり、通常採集からの通し操作は既存construction E2E/ボットが担当。
- 手動：IABの実ゲームに一時的な状態切替ボタンを置き、足場・資材・完成時撤去・道路3種を目視確認。スクリーンショットはevidence-city-formal-20261114。撮影用UIは配布HTMLには含めない。iPhone実機の撮影ではない。
- 最終CI：core／construction／space／heroの全4ジョブ合格。検証SHA a36f036918abf0875b53bc0ac162f34b86aa6d1d（18d416dからテストの再読込み待ち条件のみ修正）。https://github.com/twilightgame1014/science-civilization-game/actions/runs/43607844555 。内訳はevidence-city-formal-20261114/ci-summary.jsonを参照。

## 素材依頼への判断と残事項

道3種の画像はMuseの手続き生成による正式納品を採用。重複制作を避け、GPTによる追加画像生成は今回0点。法線はMuseの納品データを使用し、色画像を法線と称してはいない。
今回の施工・道路素材について、Museの追加納品待ちはない。iPhone17実機の表示・FPS・発熱、および人による通常ゲーム全行程の遊びやすさは未確認。別進行のClaude修正は、回収後にこのブランチと差分比較して統合する。
