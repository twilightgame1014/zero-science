# Claudeへの引き継ぎメモ（2026-11-06 最終版）

## GitHub経由で読む場合（ZIP送付は不要）

Claude / ChatGPT が GitHub 連携でこのリポジトリを直接読んでいる場合は、ZIPを送る必要はありません。このリポジトリ内の同名パスを使ってください。モジュール本体は `threejs-hd2d-graphics/`、研究室背景は `assets/lab-stages-3d-render/` です。ZIPファイルはローカルの配布用コピーで、リポジトリには含まれていません（`.gitignore` で除外）。

## 送るもの（ZIPで送る場合の3点）

1. **threejs-hd2d-graphics.zip**（HD-2Dグラフィックモジュール一式）
- 解凍して `src/graphics/` と `assets/` をプロジェクトに取り込む想定
- `node_modules/` は含んでいない（Three.js は npm で入れる）
2. **lab-stages-3d-render.zip**（研究室の進化段階背景・全4種＋対応表 README）
- メイン画面の背景として、研究段階に応じて切り替えて使う想定
3. **下の「コピペ用メッセージ」**（そのまま Claude に貼る）

送らなくていいもの：デモのビルド成果物（dist-demo）。デモは動作確認専用で、統合対象ではありません。

## コピペ用メッセージ（ここから）

---

Three.js製のHD-2Dグラフィックモジュールと、研究室背景アセットを受け取ったので、あなたの開発している科学文明再建ゲームに統合してください。GitHubリポジトリを直接読んでいる場合は、ZIPの代わりにこのリポジトリ内の同名パスを使ってください。


- ゲームシステム全般（状態管理・採集・反応・研究・建築判定・図鑑・セーブ・入力）は引き続きあなたが担当します。
- このモジュールは描画専用です。モジュール側からゲーム状態を書き換えるコードは追加しないでください。


1. ZIP内の `src/graphics/` をプロジェクトの `src/graphics/` に配置してください。
2. `npm install three` と `npm install -D @types/three` を実行してください。
3. `assets/` のスプライト・テクスチャをプロジェクトのアセット配置ルールに合わせて配置し、URLを初期化オプションで渡してください。
4. 統合方法の詳細は ZIP内の `INTEGRATION.md` に従ってください。APIの型定義は `src/graphics/types.ts` が正本です。


- 毎フレーム（または状態変化時）に `setPlayerVisualState` でプレイヤーの座標・向き・移動状態を渡してください。座標の正本はあなたの側です。
- 資源は `updateResourceVisual`、建築物は `addStructureVisual` / `removeStructureVisual`、演出は `playVisualEffect` を使ってください。存在・残量・設置可否の判定はすべてあなたの側で行い、モジュールには結果だけを渡してください。
- 主人公は2名分（男の子／女の子）のスプライトシートが同梱されています（透過処理済みの最終版）。どちらが有効かはあなたの側の状態で管理し、初期化時の `playerSpriteUrl` または実行中の `setPlayerSpriteSheet(url)` で表示を切り替えてください。女の子シートは2版あります：既定は `player-spritesheet-girl.png`（元絵の接地影あり）、影なし版は `player-spritesheet-girl-no-shadow.png` です。エンジン側は `shadow-blob.png` で足元影を別途描くため、影なし版を使うと影が二重になりません。


- 目標ルックは HD-2D（オクトパストラベラー系）：3Dの地形・建物＋2Dスプライト、夕景の温かい光、長い影、上下のボケ（チルトシフト）、光の滲み（ブルーム）です。
- ワールドの設計言語はタイルセット系リファレンスに基づきます：段丘状の崖地形（平らな段＋層状の岩肌）、崖に埋め込まれた石段と石垣、土の道と石畳、段差を落ちる滝、遠景の山並み（パララックス）。開始フィールドは「緑の段丘＋川＋滝」バイオームで実装済みです。雪原・乾燥地などのバイオームは将来の拡張で、必要になったら相談してください。
- モジュールにはポストエフェクトが実装済みです（`GraphicsOptions.postEffects`）。PCでは有効、モバイルでは `false` にして軽量化してください（未指定時は quality 連動：high=ON / low=OFF）。
- 時刻は `setWorldVisualState({ timeOfDay})` で渡してください。夕景（0.44前後）が最もルックが映えます。
- 建築物の仮モデルはテクスチャ付き（漆喰壁・茅葺き・瓦・石壁・木板）に更新済みです。本番モデルが用意できたら `registerFactory` で GLB 等に差し替え可能です。
- 別ZIPの研究室背景（4段階）は、研究段階に応じてメイン画面の背景として切り替えてください。段階との対応は ZIP内 README のとおりです。


1. 座標系：モジュールは右手系・Y軸上・1単位=1マス想定が既定です。違う場合は `GraphicsOptions.config.coordinates` の `scale` / `origin` で合わせてください（モジュール本体の改変は不要です）。
2. 地形：モジュール側に仮の地形関数（`src/graphics/utils.ts` の `terrainHeight`）があります。あなたの側に地形データがある場合は、どちらを正とするか決めてください。正があなたの側なら、その高さ関数に差し替える形で統合してください。
3. 建築物タイプ名：モジュールの対応タイプは workbench / campfire / kiln / smelter / hut / stone-house / laboratory / factory / power-plant / research-institute です。あなたのアイテム・建築IDと対応づけてください。未対応タイプは仮マーカー表示になります。


- ZIP内の `demo/` は描画モジュール単体の確認用デモです。統合には不要なので、プロジェクトには取り込まないでください（参考に動かす場合は `npm install` のうえ `npm run dev`。デモ内の村セットや検証用キー入力も統合対象外です）。

---

---

## 追補（2026-11-06：採取ノード状態表現＋実験器具アセット）

ブランチ `feature/graphics-harvest-and-assets`（world-polish の上に積み上げ）。

- **採取ノード**：`updateResourceVisual` に `phase: 'reacting'`（採取中の揺れ・
  明滅）を追加。`depleted` の見た目を拡充（木＝年輪付き切り株、岩＝破砕残骸、
  草/花＝刈り跡パッチ）。新タイプ `branch`（落ち枝）/`pebble`（小石）。
  状態の契約・寸法表は INTEGRATION.md §13。
- **制作情報**：`gfx.getResourceVisualSpecs()` でタイプ別の占有半径・幹半径・
  高さ・depleted 形態を取得できます（衝突判定はそちらの責務のまま）。
- **画風**：幹=樹皮、樹冠=葉斑、岩=割れ目のピクセルテクスチャを環境とノードで
  共有。環境の広葉樹に枝を追加。API 変更なし。
- **研究室背景は終了**：以前の「研究室背景（4段階）ZIP を背景に使う」指示は
  撤回されました。代わりに `assets/lab-apparatus/`（リポジトリ直下）の器具
  セット（bbmodel/gltf/透過スプライト、液体・炎は別レイヤー、段階対応表は
  同フォルダ README）を使って「実験台」に装置を並べる構成にしてください。
- **UIアイコン**：`assets/ui-icons/` に仕上げ済みの8種（lab / craft /
  encyclopedia / technology / journal / map / base / settings、192マスター
  ＋48/32実寸版、対応表は同フォルダ README）。現在の絵文字仮アイコンの
  差し替えに使えます。

### 追補2（2026-11-06）：自然の造形刷新＋静止時の歩行停止

- 草（円錐→切り抜き草むら）、茂み（単体球→瘤集合＋葉カード）、樹冠の
  輪郭、地面パッチ（単色ポリゴン→柔らかい斑テクスチャ）、根元の接地
  ディスク、岩の根元の汚れ・苔、幹の根張りを刷新しました（API変更なし、
  詳細は INTEGRATION.md §14）。
- **静止時の歩行アニメを修正**：従来は `moving:false` でも idleFps で
  歩行コマを低速再生していました。今は最後の方向の直立コマ（列0、
  両シート実物確認済み）に固定され、上下動も止まります。
- **Claude側への確認依頼**：壁に押し付けた状態など、実移動量ゼロでも
  `moving:true` を送っていませんか。グラフィックは `moving` を信頼する
  ので、その場合は足踏みして見えます。実移動ゼロ時は `moving:false` を
  送ってください。

## 補足（ユーザー向けメモ）

- 統合で困ったら、Claude の返答（エラー内容や、どの仕様が足りないか）をそのまま Muse に持ってきてください。グラフィック側の修正は Muse が担当します。
- 主人公の追加差分（表情、衣装違い、採取・実験などのアクションスプライト）が必要になったら Muse 側でシートを拡張できます。

### 追補3（2026-11-06）：GPT素材による森林改修（feature/graphics-gpt-forest）

- 素材はモジュール内の `gptTextures.ts` に同梱済み。統合は従来通り
  `src/graphics/` を originals と一致させるだけでよい（追加の配線なし）。
  API・状態契約の変更はなし。`RESOURCE_VISUAL_SPECS` の branch/pebble の
  height だけ実寸に合わせて更新した（0.78 / 0.49）。
- 対応表と加工内容は `assets/gpt-nature/README.md`。原画は同フォルダの
  `source/` に保管（写実旧シートと葉6種シートはオーナー指示で不採用）。
- 確認済み: スクラッチworktree（feature/game-exploration-home＋本グラフィック）
  の実画面で、スポーン空き地の草群落・落ち葉デカール・茂み・枝ノードを
  目視確認。単一ファイルは約3.1MBになる。
- 未確認: 実機FPS、川岸の砂利デカールの近接確認（次回ラウンドで可）。

### 追補4（2026-11-06）：未解決事項への対応（feature/graphics-claude-open-items）

gpt-forest の上に積んだブランチ。詳細は INTEGRATION.md §16。
- pauseGraphics/resumeGraphics を本流に取り込み（このブランチには両ツリー
  とも入っているので、そのまま使える）。
- GraphicsOptions.decor 実装（提案パッチと同形状）。ゲームが渡している
  `decor:{trees:false,...}` がそのまま効く。
- setNaturalObjects / updateNaturalObject を追加（除去セマンティクスは §16）。
  種類別インスタンス化は未実施で、性能の本丸として残してある。
- ノード（木・岩・鉱石・やぶ）に遮蔽フェード。highlighted は足元の輪に変更。
- 新タイプ: water / oil / ore / grass / bush。rock の結晶は ore へ移設し、
  景観岩の装飾結晶も廃止。natural.variant の basalt / flint に対応。
- 新構造物: waterwheel / steam-engine / distillation-tower / drilling-rig /
  bridge（橋の寸法と通行判断の分担は §16）。
- assets/icons/ に指定名の WebP 96×96 を書き出し（menu のみ原画なし）。
- 依頼5（水中の色）は水面修正で解決済みとして確認した。
- バイオーム（依頼3）は配置設計が前提のため未対応。§16 に必要な入力を明記。
- 検証: Claude の feature/game-walk-and-assets ＋本グラフィックでビルドし、
  pauseGraphics / setNaturalObjects が成果物に含まれることと実画面を確認。
  ゲート（typecheck / test 21/21 / build / e2e）全合格。

## 追補5: 水表現の刷新＋物質アイコン／環境テクスチャ（2026-11-06、feature/graphics-item-icons-water）
- 水を3層構成に刷新（川底リボン＋濡れ土バンド＋水深グラデーション水面）。
  波紋はドット調の短線2層、泡は浅瀬の途切れた帯、グリントは控えめ。
  調整は `config.water` の13パラメータ（INTEGRATION §17）。API 変更なし。
- 新規依存なし。モジュール外の制作ツール（Material Maker / Blender）は
  実行依存に含めていない。
- 物質アイコン137点を `assets/item-icons/` に独立納品（data.js 全件と
  1:1 照合済み）。読み込み方法と修正一覧は同フォルダ README。
- 環境テクスチャ8種を `assets/env-textures/` に独立納品（法線・モバイル版・
  反復プレビューつき）。地表への適用は統合側の作業。
- 検証: デモの川サンプルで PC／スマホ描画と波紋の動き（フレーム差分）
  を実測。ゲーム本体ビルド成功、test 33/33。e2e の1件失敗は素の
  game-walk-and-assets でも再現する既存事象（切り分け済み）。

## 追補6: 残件対応（フェード範囲・輪・草の見分け・見本区画・インスタンシング・アイコン整理）（2026-11-06、feature/graphics-fade-grass-instancing）

あなたの §9／§8 の残件への回答です。詳細は INTEGRATION.md §18。

1. **遮蔽フェード**：線分テストに「主人公の周りにかかる樹冠」を追加。
   ノードの木は主人公との水平距離 3.1×scale 以内、景観の樹冠は
   水平リーチ（半径+1.05）が主人公にかかればフェードします。
2. **足元の輪**：depthTest 無効・最前面描画に変更。森の中でも見えます。
3. **草の見分け**：景観タフトの背丈を抑制し、採取「草むら」を
   4面・高さ0.85・暖色寄りに変更（SPECS.grass.height も 0.85 に更新）。
   さらに全ノード周囲の景観カバー（草・花・ハーブ）をエンジンが
   自動で間引くので、採取対象と刈り跡が埋もれません。操作は不要です。
4. **見本区画**：`decor.clearings`（景観を生やさない円）を追加。
   デモに 12m 四方・中心 (-38, 30)・半径 9 の区画を用意しました。
   区画内のノード（setNaturalObjects、nature.js 形式 ID）：
   tree:-425,260 (scale 1.15) / tree:-340,255 (0.95) / rock:-435,340 /
   ore:-330,335 / bush:-385,350 / grass:-405,300 / grass:-360,290 /
   grass:-395,325（採取済み） / herb:-380,265（選択中） /
   flowers:-365,320 / branch:-410,330 / pebble:-345,305（flint） /
   water:-430,295 / oil:-335,270。
   ゲーム側で同じ clearing と一覧を渡せば同じ区画を再現できます。
5. **インスタンシング**：branch/pebble/herb/flowers/grass/water/oil と
   cut-patch を共有 InstancedMesh プール化。tree/rock/ore/bush は
   ノード固有マテリアルの都合でグループのまま（形状は全種共有化）。
   木・岩のインスタンス化は残件として残します。
6. **アイコン**：`assets/ui-icons/` に一本化（`assets/icons/` は
   転送 README のみ）。`menu` の仮アイコンを ui-icons に追加しました
   （GPT 原画なしの描画製。差し替え前提で使ってください）。

検証：モジュールの型チェック・ビルド通過、デモで区画・輪・草・
水/油プールの描画を撮影確認（verification/round9-2026-11-06/）。
実機 FPS は未検証です。


---

## 追補7（2026-11-07）: decor.stonework を追加

§9 の残件「石積みの描画を止める指定」に対応しました
（INTEGRATION §19）。

- `decor: { stonework: false }` で石段・擁壁（グループ名 `Stonework`）
  を描画しません。デフォルトは従来どおり表示です。
- ゲーム側で 3D 表示から取り除いている処理は、この指定に
  置き換えてください（シーン走査で隠す必要はなくなります）。
- 検証：型チェック・ビルド通過、デモで同じ場所の ON / OFF を撮影し、
  石段が消えることをシーン内の `Stonework` グループ有無でも確認。
  ゲーム本体での表示確認は統合時にそちらでお願いします。


---

## 追補8（2026-11-07）: 木の樹冠を枝葉カード方式に再構築

オーナー指示で、球体＋葉テクスチャの樹冠を廃止しました
（INTEGRATION §20）。

- 完成アセット: `assets/branch-cards/`（原画・加工済みスプライト・
  対応表）。実行時は `src/graphics/branchTextures.ts`（約 330 KB、
  WebP data URI）に同梱され、追加の読み込み処理は不要です。
- 配置方法: 景観の木・採取ノードの木とも、幹から伸びる枝に沿って
  枝スプレーカードを交差配置。樹形は wide / tall / young の3種。
  ノードの木は ID から決定的に選ばれるので、同じ木はいつも同じ
  姿です。景観の木は約 27 m 先で簡略樹冠（LOD）に切り替わります。
- 必要な描画設定: 特にありません（alphaTest 切り抜き前提で
  モジュール内に閉じています）。postEffects 等の既存設定で
  そのまま動きます。
- 当たり判定との分離: 従来どおり SPECS.tree の footprint（幹）
  のみが判定情報です。葉カードの矩形は判定に一切関与しません。
  footprintRadius / trunkRadius は不変、height は目安 3.6 のまま
  （tall 個体のみ最大約 3.8）。
- ついでに直したもの: 遮蔽フェード時に alphaTest 持ちの
  マテリアル（カード類）が丸ごと消える問題。フェード率に
  合わせて閾値も下げます（ノード全般に効きます）。
- 検証: モジュールの型チェック・ビルド通過、デモで同一場所の
  前後比較・近距離・スマホ幅・隣接フェードを確認
  （verification/trees-2026-11-07/）。あなたの
  feature/game-wilderness-start に載せた worktree では
  build 4.23 MB / test 49/49 / e2e すべて合格でしたが、開始
  地点の野原には木が画面内になく、樹冠の実ゲーム表示は
  未確認です。統合時の目視と実機 FPS 確認をお願いします。
