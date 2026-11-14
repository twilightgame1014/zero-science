# 宇宙計画：テクスチャ原画・アイコンの依頼（Claude → GPT、2026-11-13）

ゲームは今、**絵文字と仮モデル**で最後まで遊べます。下の素材が届いたら差し替えます（アイテム ID は変えません）。
トーンは既存の「フィールドノートと実験器具」（濃紺・生成り・青緑・控えめな琥珀、線 1px、影なし）に合わせてください。

## 1. アイコン（透過 PNG）
| 用途 | 点数 | 寸法 | 透過 | タイル | キー（ファイル名） |
|---|---|---|---|---|---|
| 道具 | 3 | 原画 256px（ゲームは 64px に縮小） | あり | なし | `tools/solderiron`・`tools/compressor`・`tools/powerdrill` |
| 設備 | 9 | 同上 | あり | なし | `facilities/press`・`lathe`・`loom`・`semifab`・`substation`・`assembly`・`launchpad`・`tower`・`control` |
| 操作 | 4 | 同上 | あり | なし | `ops/roll`（圧延）・`ops/cut`（切削）・`ops/spin`（紡糸）・`ops/fabricate`（微細加工） |
| 物質・部品 | 64 | 同上 | あり | なし | 下の一覧（アイテム ID がファイル名） |
| UI（線のアイコン） | 1 | 48px と 32px（生成り／青緑の2色） | あり | なし | `space`（「宇宙へ」のタブ。ロケットの線画） |
| 状態の印 | 2 | 32px | あり | なし | `state-know`（実習待ち＝本）、`state-simplified`（ゲーム内で簡略化） |

物質・部品（64）：
- 金属と構造材：`steelplate` `steelbeam` `bolt` `pipe` `alalloy` `alplate` `foil`
- ガラスとセラミックス：`temperedglass` `glassfiber` `ceramic` `heattile` `visor`
- 化学素材と繊維：`rawrubber` `rubber` `seal` `synfiber` `synfabric` `airtight` `composite` `mli` `insulwire`
- 電力：`motor` `accumulator` `powerunit`
- 電子部品：`wafer` `transistor` `chip` `switch` `relay` `resistor` `capacitor` `board` `oscillator` `gateboard` `adderboard` `memboard` `cpuboard` `iounit` `computer` `sensorunit` `shipcomputer` `radio` `antenna`
- 宇宙服と生命維持：`innerwear` `pressurelayer` `outerlayer` `helmet` `gloves` `lifesupport` `spacesuit` `valve` `tankshell` `airtank` `co2scrubber` `coolingunit` `monitor` `cabinlife`
- 機体：`propcell` `nozzle` `r_frame` `r_skin` `r_engine` `r_capsule` `shipradio`

注意：`propcell`・`nozzle`・`r_engine` は**架空の部品**です。現実の機種・薬品のラベルに似せず、抽象的な形と色（だいだい＋暗い灰）で。

## 2. テクスチャ原画（Muse のモデル用。材質スロット名は MUSE-SPACE-MODEL-CONTRACT.md）
| 名前 | 用途 | 寸法 | 透過 | タイル |
|---|---|---|---|---|
| `tex-concrete-pad` | 発射台・床（打ちっぱなし＋うすい汚れ） | 1024 | なし | あり |
| `tex-steel-lattice` | 支持塔・鉄骨（赤さび色の塗装） | 512 | なし | あり |
| `tex-alloy-panel` | 機体の外装（白い板のつなぎ目・びょう） | 1024 | なし | あり（縦方向） |
| `tex-heat-tile` | 耐熱タイル（暗い灰の四角の並び） | 512 | なし | あり |
| `tex-assembly-wall` | 組立棟の壁（波板） | 512 | なし | あり |
| `tex-console` | 管制端末の表示面（ランプと目盛り。文字は読めない記号で） | 512 | なし | なし |
| `tex-warning-stripe` | 注意のしま模様（琥珀と濃紺） | 256 | なし | あり |

## 3. 絵（演出・エンディング）
| 名前 | 用途 | 寸法 | 透過 | タイル |
|---|---|---|---|---|
| `cine-rocket` | 上昇の絵の機体（横から。今は図形で描いている） | 512×1024 | あり | なし |
| `cine-earth` | 宇宙から見た地球のふち（下からせり上がる） | 2048×1024 | あり | なし |
| `cine-clouds` | 流れる雲（3枚） | 1024×256 | あり | 横にあり |
| `ending-card` | エンディングの背景（星空と小さな機体） | 1920×1080 | なし | なし |
| 主人公の宇宙服シート | 8方向・4列×8行（男の子・女の子）※原画。仕上げは Muse | 既存のシートと同じ | あり | なし |

## 4. 品質の確認をお願いしたい点（ディレクターとして）
- 終盤の量：軌道に乗るまでの原料の目安（`docs/space/SPACE-PROGRAM.md` §5）。多すぎる・少なすぎるの判断。
- 実習①〜⑧の文と難しさ（小学生に通じるか）。
- 「ゲーム内で簡略化」の印を付けた工程の一覧と、説明文の言い回し。
