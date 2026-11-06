# フィールドの自然物 連携契約（Claude ⇄ Muse）

更新：2026-11-06。作成：Claude（ゲーム側）。状態：**ゲーム側は実装済み／描画側は提案（未対応）**。
ブランチ：`feature/game-natural-objects`。

## 1. 決まりごと（所有者）
- **自然物の正本はゲーム側**（`src/game/nature.js`）。ID・位置・向き・大きさ・当たり判定・採取可否・必要道具・残量・採取後の状態・再生はすべてゲームが決め、セーブする。
- **描画モジュールは表示するだけ**。素材の付与・採取成功の判定・セーブの更新はしない。受け取った状態をそのまま描く。
- 描画モジュールが独自の乱数で描く装飾のうち、ゲームが自然物として管理する仲間（木・岩・倒木・小石・丸い茂み）は**描かない**。同じ木や岩を二重に描くと、「見えているのに採れない／当たらない木」が生まれるため。

## 2. 生成の規則（共有）
- 地形関数は描画モジュールのもの（`terrainHeight`・`distanceToRiver`、`src/terrain-entry.ts` 経由）。乱数の種は `NATURE.SEED = 20261106`。
- 置かない場所：水の中（水位＋0.15未満）、川の帯（中心から5.6マス。川岸の小石は4.0）、急な斜面、まだ入れない地域、拠点の台地（木・岩は半径15マス以内に置かない）、地域の採取地点の近く。
- 木と岩のすき間は、主人公（半径0.35）が通れる幅を必ず空ける。
- **ID は「種類:x,z」（座標は0.1マス単位）**。規則を変えて位置が動いたものは別IDになり、古い状態は無視される（壊れない）。

## 3. 自然物の種類（ゲーム側の定義）
| 種類 `kind` | 名前 | 当たり判定（地面上の円の半径×大きさ） | 歩行を妨げる | 回数 | 必要な道具 | 1回で得る素材 | 採取後 | 再生 |
|---|---|---|---|---|---|---|---|---|
| `tree` | 木 | 0.34（幹だけ。樹冠は壁にしない） | はい | 2 | 石のおの／鉄のおの | 丸太 | `stump`（切り株） | 30分 |
| `rock` | 岩（`variant:"basalt"` は黒い岩） | 0.95（描画の footprintRadius 1.0 に合わせた。2026-11-06） | はい | 3 | ハンマー／つるはし | 丸い石（黒い岩は玄武岩＋丸い石） | `rubble`（残骸） | しない |
| `pebble` | 小石（`variant:"flint"` は火打ち石） | 0.22 | いいえ | 1 | なし | 丸い石（火打ち石） | `gone` | しない |
| `twig` | 落ち枝 | 0.25 | いいえ | 1 | なし | 木の枝×2 | `gone` | 8分 |
| `grass` | 草むら | 0.45 | いいえ | 1 | なし | 草×2 | `cut`（刈り跡） | 3分 |
| `bush` | やぶ | 0.55 | いいえ | 2 | なし | つる・落ち葉 | `cut` | 4分 |

切り株・残骸・刈り跡になると、**当たり判定も消える**（見えない壁を残さない）。
このほか、木の姿をしている地域の採取地点（枝の多い木など）は、幹（半径0.38）を固定の障害物にしている。

## 4. 描画モジュールへ渡す状態
今は既存の公開API `updateResourceVisual(id, state)` で渡している。`state` には既存の項目に加えて、次の `natural` を付けている（今のモジュールは無視する。将来の専用描画のための契約）。

```ts
interface NaturalObjectVisual {
  id: string;                       // 例 "tree:-412,388"
  kind: 'tree' | 'rock' | 'pebble' | 'twig' | 'grass' | 'bush';
  variant: string | null;           // 'flint' | 'basalt' | null
  state: 'intact' | 'stump' | 'rubble' | 'cut' | 'gone';
  collider: { shape: 'circle'; r: number; solid: boolean };   // 表示の参考。判定はゲーム側
  left: number; uses: number;       // 残り回数（ひび・減り具合の表現に使える）
}
// 例
gfx.updateResourceVisual('tree:-412,388', {
  position: { x: -41.2, z: 38.8 }, type: 'tree', rotationY: 1.2, scale: 1.1,
  depleted: true, visible: true, highlighted: false,
  natural: { id: 'tree:-412,388', kind: 'tree', variant: null, state: 'stump', collider: { shape: 'circle', r: 0.37, solid: false }, left: 0, uses: 2 },
});
```

見た目のタイプ（INTEGRATION.md §13 に対応、2026-11-06）：木→`tree`、岩→`rock`、小石→`pebble`（×0.75）、落ち枝→`branch`（×0.8）、草むら→`herb`、やぶ→大きな`herb`。`gone` は `visible:false`。
採取の作業中だけ `phase:'reacting'` を渡し、終わったら（中断を含む）`'idle'` に戻す。地域の採取地点も同じ。

寸法の照合（`gfx.getResourceVisualSpecs()` と nature.js の当たり判定。scale 1）：

| 種類 | 描画の寸法 | ゲームの当たり判定 | 備考 |
|---|---|---|---|
| 木 | trunkRadius 0.26 | 0.34（幹＋余裕） | 樹冠（footprint 1.15）は壁にしない |
| 岩 | footprintRadius 1.0 | 0.95 | |
| 落ち枝 | footprint 0.5×0.8＝0.40 | 0.25（歩行を妨げない・選択の目安） | |
| 小石 | footprint 0.32×0.75＝0.24 | 0.22（歩行を妨げない） | |

この照合は `tests/nature.test.mjs` が `RESOURCE_VISUAL_SPECS` を読み込んで毎回確認する（2026-11-06〜）。
表示するのは主人公の周り32マス以内（38マスを超えたら `null` で消す）。

## 5. 描画側にお願いしたいこと（Muse）
1. **`GraphicsOptions.decor`**（優先度：高。2026-11-06 時点で未対応。Muse の方針は「描画側の木・岩は景観専用」だが、見た目は採れる木・岩と同じなので、採れない・当たらない木が画面に残っている）：独自の装飾のうち、ゲームが管理する仲間を描かない指定。ゲームは初期化時に
   `decor: { trees:false, rocks:false, logs:false, pebbles:false, shrubs:false }` を渡している。
   - 実装の提案パッチ：`docs/handoff/patches/graphics-decor-option.patch`（`src/graphics` と原本の両方。型チェック済み）。Claude は適用していない。
   - パッチを当てたビルドで、森がゲーム側の木だけになり、木の選択・伐採・切り株・当たり判定・再読込が一致することを実WebGLで確認済み。
   - 草の葉・シダ・落ち葉などの細かい装飾は、今までどおり描画側だけでよい。
2. **専用タイプと採取後の見た目**（対応済み：`branch`・`pebble`・切り株・残骸・刈り跡。`phase:'reacting'` も導入済み）：`twig`（落ち枝）・`pebble`（小石、`flint` は黒っぽく）・`grass`（草むら）・`bush`（やぶ）の見た目と、`stump`・`rubble`・`cut` の表現。今の `rock` には結晶が付いていて、ふつうの岩としては目立ちすぎる。
3. **まとめて描く API（性能）**：数百の自然物を1つずつ `updateResourceVisual` で描くと、物体の数が多い。`setNaturalObjects(list)` ＋ `updateNaturalObject(id, state)` のように、種類ごとにインスタンス描画できる口があると、スマホでも軽くなる。遮蔽フェードもインスタンス単位で効かせてほしい。
4. 選んだ対象の強調（今の `highlighted` は大きな黄色のパルスで、木だと画面の一部を覆う）を、輪郭や足元の輪にしてほしい。

## 6. アイコン（Muse にお願い）
添付予定のアイコンは、まだリポジトリに届いていない。ゲーム側は受け口だけ用意した：
- 置き場所：`assets/icons/<名前>.webp`（`png`・`svg` も可）。名前は `lab`（研究室）・`craft`（工作）・`book`（図鑑）・`tech`（技術）・`log`（記録）・`map`（地図）・`home`（拠点）・`settings`（設定）。スマホのメニュー用に `menu` もあると統一できる。
- 推奨：透過、正方形 96×96px（表示は24〜28px）、余白を少し残して切り出す。ビルド時に自動で埋め込み、ない名前は絵文字で表示する。
- 仮の画像で、8つすべてのボタンが画像に切り替わり、文字ラベルが残ることを確認済み。

## 7. 地域の採取地点の姿と当たり判定（2026-11-06）
正本は `src/game/nature.js` の `DEPOSIT_SHAPE`。描画の種類（`RESOURCE_VISUAL_SPECS` に存在すること）と当たり判定の半径（0 は歩行を妨げない）を1か所で決める。

| 姿 | 採取地点 | 当たり判定 |
|---|---|---|
| `ore` | 石英・石炭・岩塩・赤鉄鉱・孔雀石・すず石・閃亜鉛鉱・ボーキサイト・硫黄・黒曜石 | 0.9（占有半径1.0） |
| `rock` | 玄武岩・石灰岩・花崗岩 | 0.9 |
| `tree` | 丸太・やに・ろう・樹皮・種 | 0.38（幹） |
| `branch`・`pebble`・`herb`・`grass`・`bush`・`flowers`・`clay`・`water`・`oil` | 枝・丸い石・火打ち石・貝殻・落ち葉・海藻・草・つる・ぶどう・粘土・黄土・砂・水・原油 | なし |

フィールドの自然物の見た目は、草むら→`grass`、やぶ→`bush`（2026-11-06〜）。
