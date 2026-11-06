# GPT生成 自然素材セット（2026-11-06）

オーナーがGPTで生成した6シートを、Museが切り出し・整備してゲーム用アセット化したもの。
原画は `source/` に保管し、調整済み素材は別ファイルとして保存している（原画は上書きしない）。

- 加工スクリプト: `tools/process_assets.py`（切り出し・透過処理・継ぎ目処理）
- 同梱スクリプト: `tools/bundle_textures.py`（`src/graphics/gptTextures.ts` を生成。
  ゲームが単一HTMLファイルで配布されるため、素材はデータURIとしてモジュールに同梱する）
- 出典: 全てオーナーがGPTで生成した素材。外部素材（Poly Haven等）は未使用。
- **使わない素材**: `source/unused-*.jpg`（写実小物の旧シートと、緑背景の残る葉6種シート）は
  オーナー指示により不採用。`source/` には記録としてのみ残す。

## シート対応表

### A：地面（source/sheet-A-ground.png、2×2）
| 位置 | ファイル | 用途 |
|---|---|---|
| 左上 | textures/ground_grass.png | 草地（原画） |
| 左上派生 | textures/ground_grass_base.png | **地形の土台**。彩度0.68・コントラスト0.92・明度1.18に抑制した派生 |
| 右上 | textures/ground_dirt.png | 土。道の縁のデカールに使用 |
| 左下 | textures/ground_leaves.png | 落ち葉。林床のデカールに使用 |
| 右下 | textures/ground_gravel.png | 砂利。川岸のデカールに使用 |

### B：樹皮・木材（source/sheet-B-bark.jpg、2×2）
| 位置 | ファイル | 用途 |
|---|---|---|
| 左上 | textures/bark_deep.png | 広葉樹の幹（環境木・採取木） |
| 右上 | textures/bark_birch.png | 白樺の幹（環境木の亜種） |
| 左下 | textures/wood_grain.png | 木目。現状は予備（構造物用） |
| 右下 | textures/bark_moss.png | 苔付き樹皮。現状は予備 |

### C：岩・崖（source/sheet-C-rock.jpg、2×2）
| 位置 | ファイル | 用途 |
|---|---|---|
| 左上 | textures/rock_layered.png | 岩（環境岩・採取岩の主材） |
| 右上 | textures/rock_slate.png | 粘板岩。予備（高地岩は層状岩＋青灰色のインスタンス色で表現中） |
| 左下 | textures/rock_moss.png | 苔岩（川辺・林内の岩） |
| 右下 | textures/cliff_dirt.png | 土と石の崖。予備（段丘の断面用） |

### D：葉（source/sheet-D-leaves.jpg、2×2、白背景はフラッドフィルで除去）
| 位置 | ファイル | 用途 |
|---|---|---|
| 左上 | sprites/leaf_oak.png | 樫の葉付き枝。広葉樹の樹冠カード・採取木のカード |
| 右上 | sprites/leaf_birch.png | 白樺の葉付き枝。白樺の樹冠カード |
| 左下 | sprites/leaf_shrub.png | 低木。茂みのカード |
| 右下 | sprites/leaf_fern.png | シダ状の葉。予備（シダ本体はEのfern_frondを使用） |

### E：草花（source/sheet-E-grass-flowers.jpg、4×2、白背景はフラッドフィルで除去）
| 位置 | ファイル | 用途 |
|---|---|---|
| 上段1 | sprites/grass_short.png | 草むら（標準） |
| 上段2 | sprites/grass_wide.png | 草むら（草原の芯） |
| 上段3 | sprites/grass_dry.png | 枯れ草（道沿い・乾燥地） |
| 上段4 | sprites/fern_frond.png | シダ |
| 下段1 | sprites/flower_white.png | 白花（採取「花」ノードの色違い1） |
| 下段2 | sprites/flower_yellow.png | 黄花（同2） |
| 下段3 | sprites/flower_purple.png | 紫花（同3） |
| 下段4 | sprites/herb_patch.png | 野草（採取「草」ノード・装飾の群落） |

### F：小物（source/sheet-F-props.png、4×2、実アルファあり）
| 位置 | ファイル | 用途 |
|---|---|---|
| 上段1 | sprites/prop_branch.png | 落ち枝ノード |
| 上段2 | sprites/prop_bundle.png | 枝束。予備（アイテム表示用） |
| 上段3 | sprites/prop_pebbles.png | 小石ノード |
| 上段4 | sprites/prop_flint.png | 火打石。予備 |
| 下段1 | sprites/prop_stump.png | 切り株（木の採取済み表示） |
| 下段2 | sprites/prop_rubble.png | 瓦礫（岩の採取済み表示） |
| 下段3 | sprites/prop_cut_patch.png | 刈り跡（草・花の採取済み表示、地面に平置き） |
| 下段4 | sprites/prop_leaves_pile.png | 落ち葉の山（林床の平置き装飾） |

## 加工内容（素材品質の担保）

- シートを一枚のまま貼らない。全素材を個別に切り出した。
- 切り出しは等分ではなく、アルファ連結成分をセル単位でグループ化して実輪郭でトリミング
  （小石=石3個、落ち葉=葉3枚のような複数部品の小物も1素材として保持）。
- Fシートは実アルファを持つが生成器の靄（α≈1〜250）があったため、α≥128で二値化。
- D/Eシートの白背景は「画面端からのフラッドフィル」で除去。本体に囲まれた白（花弁など）は
  残る。縁の白ハローは、白さの強い縁画素を最大2px食い込む処理で除去した。
  黒や緑の一括消去はしていない（本体の色は欠落していない）。
- 地面・樹皮・岩肌テクスチャは「両端の平均へ収束させる対称クロスフェード」で
  継ぎ目なし化し、2×2タイリングで継ぎ目が見えないことを確認済み。
  ただし対称処理のためタイル端で模様が鏡像になる。地形の頂点色変化と
  草むら・デカールの重なりで目立たないようにしている。
- 作業解像度: 地面・樹皮・岩=256px、葉=256px、草花=160px、小物=192px。
  スプライトの縮小はNEAREST（ドットの鮮明さ優先）。
- ドットの細かさはシートごとに異なるが、ゲーム内表示サイズ（草≈40〜90px）では
  破綻しない範囲に収まっている。最終判断はゲーム内スクリーンショットで行った。
