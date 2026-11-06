# Claude側への統合手順・連携API仕様

このモジュールは **描画専用** です。ゲームシステム（状態管理・採集・反応・研究・建築判定・セーブ等）はすべて Claude 側が担当し、本モジュールは受け取った状態を表示するだけです。

## 1. 取り込み方法

1. `src/graphics/` フォルダをプロジェクトの `src/graphics/` にコピーする。
2. 依存は `three` のみ：`npm install three`（型は `@types/three`）。
3. アセットは任意。`assets/characters/player-spritesheet.png` を使う場合は、そのURLを `playerSpriteUrl` で渡す。未指定なら内蔵プレースホルダーで動作する。

## 2. 初期化

```ts
import { initializeGraphics } from './graphics';

const gfx = await initializeGraphics(canvasContainerElement, {
  playerSpriteUrl: playerSpriteUrl,   // 任意
  quality: 'auto',                    // 'high' | 'low' | 'auto'
  onContextLost: () => { /* 任意の通知 */ },
});
```

React の場合は `useEffect` 内で初期化し、クリーンアップで `gfx.disposeGraphics()` を呼ぶこと。

## 3. 毎フレーム（または状態変化時）の連携

```ts
// プレイヤー表示状態（座標の正本は Claude 側）
gfx.setPlayerVisualState({
  position: { x: player.x, z: player.z },
  direction: player.direction,  // 'down' | 'left' | 'right' | 'up'
  moving: player.isMoving,
});

// カメラを任意地点へ（null でプレイヤー追従に復帰）
gfx.setCameraTarget({ x: 10, z: -5 });
gfx.setCameraTarget(null);

// 世界の見た目（時刻・天気は演出専用。ゲーム内時刻の正本は Claude 側）
gfx.setWorldVisualState({ timeOfDay: 0.22, weather: 'clear' });
```

## 4. 資源・建築・エフェクト

```ts
// 資源ノードの表示（存在・残量・採取済みの正本は Claude 側）
gfx.updateResourceVisual('tree-001', {
  position: { x: 12, z: -8 },
  type: 'tree',          // 'tree'|'rock'|'herb'|'flowers'|'clay'|'mushroom'|任意
  depleted: false,       // true で切り株・瓦礫などの採取済み表示
  highlighted: false,    // 注目対象のパルス表示
});
gfx.updateResourceVisual('tree-001', null);  // 表示を消す

// 建築物の表示（設置可否・素材・時間の判定は Claude 側）
gfx.addStructureVisual('bldg-001', 'campfire', { x: 3, z: 4 }, 0);
gfx.removeStructureVisual('bldg-001');
// 対応タイプ: workbench / campfire / kiln / smelter / hut / stone-house /
// laboratory / factory / power-plant / research-institute
// 未対応タイプは仮マーカー表示。GLB等への差し替えは
// StructureRenderer.registerFactory(type, factory) で可能。

// 演出（状態には一切影響しない）
gfx.playVisualEffect('discovery', { x: 12, z: -8 });
// 'sparkle'|'discovery'|'levelup'|'splash'|'leaves'|'smoke'
```

## 5. リサイズ・破棄

```ts
gfx.resizeGraphics(width, height);  // 通常は ResizeObserver が自動処理
gfx.disposeGraphics();              // 画面離脱時
```

## 6. 座標系の契約（連携時に要すり合わせ）

- 右手系、Y軸が上。地面は XZ 平面。
- 既定では「ゲーム座標 1単位 = シーン 1単位、原点一致」。
- Claude 側の座標系と異なる場合は、コードを書き換えず `GraphicsOptions.config.coordinates` の `scale` / `origin` で吸収する：

```ts
await initializeGraphics(el, {
  config: { coordinates: { scale: 1, origin: { x: 0, y: 0, z: 0 } } },
});
```

- 地面の高さはモジュール側の地形関数で決まる。建築・資源の `position.y` を省略すると自動で地表に接地する。Claude 側が独自の地形を持つ場合は、この地形関数（`src/graphics/utils.ts` の `terrainHeight`）を連携時にすり合わせること。

## 7. データ所有権（厳守事項）

| データ | 正本（所有者） | 本モジュールの扱い |
|---|---|---|
| プレイヤー座標 | Claude側 | 受け取って描画のみ。書き戻しなし |
| 所持アイテム | Claude側 | 扱わない |
| 資源の採取状態 | Claude側 | `depleted` 等を受けて見た目を変えるだけ |
| 建築物の設置情報 | Claude側 | id/type/座標を受けて表示するだけ |
| ゲーム進行 | Claude側 | 扱わない |

描画補間された座標・アニメーション位相など、表示専用の一時状態のみモジュール内部に保持します。

## 8. キャラクター（主人公）

正式な主人公シートが2名分同梱されています。

- `assets/characters/player-spritesheet-boy.png`（男の子）
- `assets/characters/player-spritesheet-girl.png`（女の子）

どちらを使うか（主人公選択の状態）は Claude 側で管理してください。グラフィック側は表示を切り替えるだけです。

```ts
// 初期化時
const gfx = await initializeGraphics(el, { playerSpriteUrl: boySheetUrl });

// 実行中の切替（主人公選択・着せ替え等）
await gfx.setPlayerSpriteSheet(girlSheetUrl);
```

シート規格：4列×4行（行 = 下・左・右・上、列 = 歩行フレーム）、1セル正方形、足元はセル下端から約11%の位置に統一。自作シートも同規格で差し替え可能です。

## 9. HD-2Dルック（ポストエフェクト）

`GraphicsOptions.postEffects` で有効化します（未指定時は quality が `high` のとき ON、`low` では OFF）。

- ブルーム: ランプ・窓明かり・水面のきらめき等、輝度しきい値（0.82）を超えた部分だけが光ります
- チルトシフト: 画面中央の帯だけシャープに保ち、上下をぼかす HD-2D 特有の「ジオラマ感」
- カラーグレーディング: 温かみのある色調＋彩度補正＋ビネット

モバイル等では `postEffects: false` で従来どおりの軽量描画になります。差は見た目のみで、API や座標系に影響はありません。

また `AssetManager` には石畳・瓦屋根・茅葺き・漆喰壁・木板の手続きテクスチャ生成（`createCobblestoneTexture` 等）が追加されました。デモにはこれらを使った村のセット（`demo/village.ts`、統合対象外）が同梱されています。

## 10. ワールドの見た目（タイルセット系デザイン）

開始フィールドはタイルセット系リファレンスの設計言語で構築されています。

- 地形は段丘状（平らな段＋急な崖際）で、岩肌には地層の縞が入ります。高さ関数は従来どおり `terrainHeight` が唯一の正です
- 土の道（高原→川辺→岩場）が地形色に焼き込まれています。道は見た目のみで、歩行可否・経路はロジック側の管理です
- 岩場の高地には滝（岩組み＋落水シート＋水しぶき＋水煙）と、下部の池があります
- 地平線には雪冠の山並み（遠景レイヤー）が霧越しに見えます
- 道沿いに石段と石垣が配置されています。これらは地形の装飾で、建築物（addStructureVisual）とは別系統です

## 11. 探索カメラと遮蔽フェード（2026-11-06）

探索ホーム仕様（docs/handoff/EXPLORATION-HOME-2026-11-06.md）に合わせ、既定カメラと前景の扱いを変更しました。公開APIの追加・変更はありません。

- 既定カメラ：`viewSize` 26 → 16、`pitchDegrees` 50 → 32（`config.camera`）。主人公の画面占有率は横画面で約10%、縦画面でも約8%以上を維持します（縦画面の視野拡大は最大約1.32倍に抑制）。
- `config.camera.anchorOffset`（任意、既定 0.09）：視点中心を画面上方へずらし、主人公の足元が画面高の約59%に来ます。タップ判定は実際のカメラ変換経由なので表示と一致します。
- 遮蔽フェード：カメラと主人公の視線を遮る樹冠（インスタンシング単位のディザー抜き）と建築物（インスタンス単位の透明度）を自動で薄くします。共有マテリアルは変更しません。ゲーム状態・通行判定には一切影響しません。
- 遠景の山並みを近く・高くし、低視点でも地平線が空白になりにくくしました。チルトシフトのボケ量も弱めています（資源や道の視認性優先）。

## 12. 水面修正・pickGround・安全領域・ワールド作り込み（2026-11-06）

- **川の水面が表示されない不具合を修正**：`TerrainRenderer.buildWater()` の三角形の向きが裏表逆で法線が下向きになっていました。インデックス順を修正し、水面が正しく描画されます（従来「水位より低い土地が水中色に見える」症状の原因もこれでした）。
- **新API `pickGround(canvasX, canvasY)`**：キャンバス内のピクセル座標から、実際に描画されている地表の点を返します。水面に当たれば `surface: 'water'`、地形なら `'terrain'`、どちらにも当たらなければ `null`。表示形状だけの情報で、通行可否は含みません。未対応版との互換のため、呼び出し側は `typeof gfx.pickGround === 'function'` で確認してください。
- **新API `setViewportInsets({ top, bottom, left, right })`**（単位：CSS px）：HUDに隠れる領域を伝えると、カメラが主人公を安全領域内に保ちます。初期値として `GraphicsOptions.viewportInsets` でも渡せます。ズームや追従対象は変わりません。
- カメラ既定値：viewSize 13（主人公の見える高さは横画面で画面高の約10%）、pitch 32°は維持。霧は晴天時 88–195 に遠ざけ、チルトシフトもさらに弱めました。
- ワールド表現：森は群生＋空き地の構成にし、細身の樹形を追加。岩は角ばった形状＋沈み込み＋岩場への集積に変更し、樹冠と同じ仕組みで遮蔽フェードの対象にしました。地面には土のムラを追加し、道の上には草・低木・倒木を置かないようにしました。地形の外周には遠景の地面（スカート）を敷き、低視点でも空白が見えません。
