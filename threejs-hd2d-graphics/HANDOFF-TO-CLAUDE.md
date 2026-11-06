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
- 描画ループの一時停止・再開には正式API `pauseGraphics()` / `resumeGraphics()` を使ってください（2026-11-06追加）。内部メソッド `stopLoop` / `startLoop` の直接呼び出しは不要になりました。停止・再開は描画だけに効き、状態は保持されます。
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
