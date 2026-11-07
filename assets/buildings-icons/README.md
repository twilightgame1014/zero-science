# buildings-icons — 道具・設備・実験操作アイコン（2026-11-07）

GPT生成シート7点（`source/` に原画を保存）から、ゲームの既存IDに合わせて
個別PNG化したアイコンセット。IDと日本語名は `src/game/data.js` の
道具（T）・研究設備（F）・実験操作（ops）と1:1で照合済み。

## 構成

- `icons/<tools|facilities|ops>/<id>.png` — 256pxマスター（透過、αは{0,255}に二値化済み）
- `icons128/<...>/<id>.png` — 128px版
- `atlas.png` / `atlas.json` — 全62点を1枚にまとめたアトラス（256pxセル×8列）と座標表。atlas.json のキーは `カテゴリ/ID` 形式（例 `ops/filter`）。設備と操作で同じID `filter`（ろ過器／ろ過）が衝突するため、素のIDでは引けない
- `previews/contact-{32,48,64}-{light,dark}.png` — 実表示サイズの識別性確認シート
- `tools/process_icons.py` — 切り出しパイプライン（再実行可能）
- `process-log.json` — シート別の色にじみ除去ピクセル数など処理記録

## 対応表（ID → ファイル）

### 道具 tools（20）— 原画 tool-icons.jpg（4×5）
| ID | 名称 | ファイル |
|---|---|---|
| pot | 土器 | icons/tools/pot.png |
| crucible | るつぼ | icons/tools/crucible.png |
| knife | 石のナイフ | icons/tools/knife.png |
| axe | 石のおの | icons/tools/axe.png |
| hammer | 石のハンマー | icons/tools/hammer.png |
| pickaxe | 石のつるはし | icons/tools/pickaxe.png |
| firedrill | 火おこし棒 | icons/tools/firedrill.png |
| torch | たいまつ | icons/tools/torch.png |
| candle | ろうそく | icons/tools/candle.png |
| basket | 採集かご | icons/tools/basket.png |
| notebook | 研究ノート | icons/tools/notebook.png |
| ironpick | 鉄のつるはし | icons/tools/ironpick.png |
| ironaxe | 鉄のおの | icons/tools/ironaxe.png |
| balance | てんびん | icons/tools/balance.png |
| thermometer | 温度計 | icons/tools/thermometer.png |
| bottle | ガラスのびん | icons/tools/bottle.png |
| bellows | ふいご | icons/tools/bellows.png |
| battery | ボルタ電池 | icons/tools/battery.png |
| cylinder | 鋼のボンベ | icons/tools/cylinder.png |
| rig | 掘削やぐら | icons/tools/rig.png |

原画の時点で指定どおりの造形（石のナイフ=打製石刃、火おこし棒=棒+火床、
ふいご=送風器、ボルタ電池=金属板の積層、ボンベ=バルブ付き圧力容器、
ガラスのびん=ガラス容器）になっており、形状の描き直しはしていない。

### 設備 facilities（19）— 原画 facility-icons.jpg（4×5、最終行3点）
| ID | 名称 | ファイル | 備考 |
|---|---|---|---|
| bench | 作業台 | icons/facilities/bench.png | **差し替え**（下記） |
| campfire | たき火 | icons/facilities/campfire.png | |
| rack | 乾燥台 | icons/facilities/rack.png | |
| filter | ろ過器 | icons/facilities/filter.png | |
| mill | 石臼 | icons/facilities/mill.png | |
| kiln | かまど | icons/facilities/kiln.png | data.js名は「かまど」。3Dの kiln（窯）とは別設備として統合しない |
| charkiln | 炭焼き窯 | icons/facilities/charkiln.png | |
| fermenter | 発酵つぼ | icons/facilities/fermenter.png | |
| furnace | 簡易炉 | icons/facilities/furnace.png | 3Dの smelter に対応 |
| still | 蒸留器 | icons/facilities/still.png | |
| storehouse | 倉庫 | icons/facilities/storehouse.png | |
| electrolyzer | 電気分解装置 | icons/facilities/electrolyzer.png | |
| waterwheel | 水車 | icons/facilities/waterwheel.png | |
| generator | 水力発電機 | icons/facilities/generator.png | |
| blastfurnace | 高炉 | icons/facilities/blastfurnace.png | |
| steamengine | 蒸気機関 | icons/facilities/steamengine.png | |
| refinery | 精留塔 | icons/facilities/refinery.png | 3Dの distillation-tower に対応 |
| reactor | 化学反応装置 | icons/facilities/reactor.png | |
| eaf | 電気炉 | icons/facilities/eaf.png | |

**bench の修正**: 設備シートの作業台には現代工具（のこぎり・かんな・万力）が
描かれていたため、初期設定に合わせて、建物シート1の作業台（石器・縄・かごが
載った丸太の作業台）の切り抜きに差し替えた。元の設備シート版は採用していない。

### 実験操作 ops（23）— 原画 op-icons-1.jpg / op-icons-2.jpg / op-icons-revised.jpg
| ID | 名称 | ファイル | 原画 |
|---|---|---|---|
| crush | 破砕 | icons/ops/crush.png | op-icons-1 |
| grind | 粉砕 | icons/ops/grind.png | **revised（石臼）優先** |
| mix | 混合 | icons/ops/mix.png | op-icons-1 |
| wash | 水洗 | icons/ops/wash.png | op-icons-1 |
| filter | 濾過 | icons/ops/filter.png | op-icons-1 |
| settle | 沈降 | icons/ops/settle.png | op-icons-1 |
| heat | 加熱 | icons/ops/heat.png | op-icons-1 |
| cool | 冷却 | icons/ops/cool.png | **revised（銅壺+水鉢）優先** |
| evaporate | 蒸発 | icons/ops/evaporate.png | op-icons-1 |
| crystallize | 結晶化 | icons/ops/crystallize.png | op-icons-1 |
| dry | 乾燥 | icons/ops/dry.png | op-icons-1 |
| dissolve | 溶解 | icons/ops/dissolve.png | op-icons-1 |
| burn | 燃焼 | icons/ops/burn.png | op-icons-2 |
| fire | 焼成 | icons/ops/fire.png | op-icons-2 |
| char | 炭化 | icons/ops/char.png | op-icons-2 |
| shape | 成形 | icons/ops/shape.png | op-icons-2 |
| smelt | 製錬 | icons/ops/smelt.png | op-icons-2 |
| melt | 溶融 | icons/ops/melt.png | op-icons-2 |
| ferment | 発酵 | icons/ops/ferment.png | op-icons-2（泡立つ発酵つぼ。ウイルス記号ではない） |
| distill | 蒸留 | icons/ops/distill.png | op-icons-2 |
| electrolyze | 電気分解 | icons/ops/electrolyze.png | op-icons-2 |
| crack | 熱分解 | icons/ops/crack.png | op-icons-2 |
| polymerize | 重合 | icons/ops/polymerize.png | op-icons-2 |

シート1の旧・粉砕（すり鉢）と旧・冷却（土器+水鉢）は revised を優先し不採用
（process-log.json に superseded として記録）。加熱・燃焼・焼成、製錬・溶融、
蒸発・蒸留はすべて別絵で重複なし。

## 仕上げ方法

- 背景除去は「白に近く、かつ画像端からたどれる画素」だけを透過。
  建物シートはクリーム色背景を色距離で判定。
- さらに、輪郭に囲まれて端からたどれない「白ポケット」（枠の内側・
  取っ手のアーチ下・吊り下げ物の間・配線や配管の隙間・机の下など、
  物体越しに見えている背景白）も透過する。判定はセグメンテーション
  （rembg / isnet-general-use）の前景マスクとの照合：フラッドフィルで
  前景になった画素でも、モデルが確信を持って背景と判定した画素は
  除外する（シート全体で計86,667px）。ガラス・紙・細い配線はモデルが
  前景として保持する。仕上げに、大面積でほぼ純白かつ平坦な連結成分を
  背景とするポケット除去（process-log.json の whitePockets）も併用。
  全62点をマゼンタ背景で目視確認済み。
- 輪郭の色にじみ（淡く低彩度な縁画素）は最寄りの内側色で置換（シート毎に
  約2,300〜12,600px、process-log.json 参照）。
- セル均等割りではなく、各セルのαバウンディングボックスで切り抜き、
  256pxキャンバスに長辺208pxで中央配置。αは二値化し半透明の滲みを残さない。
- 32/48/64pxのコンタクトシート（明・暗背景）で識別性と縁を確認済み。

## 注意

- 既存の `assets/item-icons/`（物質137点）とは別カテゴリ。本セットは
  道具・設備・操作の62点のみで、物質アイコンは置き換えない。
- UIへの組み込み（絵文字アイコンからの差し替え）はClaude側の作業。
