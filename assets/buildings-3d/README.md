# buildings-3d — 設置建物13種の3Dモデル（2026-11-07）

原画（`../buildings-icons/source/buildings-1.jpg` / `buildings-2.jpg`）を
設計図として、Blenderで実モデル化した設置建物13種。単色の箱・球の
組み合わせではなく、構造（骨組み・開口・付属設備）→輪郭→色面→質感
（手続きテクスチャ）の順に作り込んである。

## 構成

- `models/<id>.glb` — ゲーム導入用GLB（原点=接地中心、1単位=1m、前面=+Z）
- `textures/*.png` — 手続き生成テクスチャ14種（512px、モデルに埋め込み済み。
  単体でも環境テクスチャとして再利用可）
- `structures.json` — ID・寸法・占有形状（footprint）・入口・操作位置・
  可動部・素材メモの対応表（Claudeの組み込み用）
- `renders/<id>.png` — three.js（ゲームと同バージョン0.180）ビューアで
  ゲームの探索カメラ（pitch 32° / yaw 45°）から撮った確認画像。
  `renders/contact-sheet.png` に13種の一覧もある
- `tools/make_textures.py` / `tools/build_buildings.py` — 再生成パイプライン
  （`blender -b -noaudio --python tools/build_buildings.py -- models --render`）

## 対応表（構造物タイプ → モデル）

| 構造物ID | 名称 | 対応する設備ID | サイズ W×D×H (m) | 可動部・分離部 |
|---|---|---|---|---|
| workbench | 作業台 | bench | 2.2×1.05×1.23 | — |
| campfire | たき火 | campfire | 1.52×1.47×0.75 | Flame（炎、分離） |
| kiln | 窯 | kiln（かまど） | 2.46×2.28×1.6 | — |
| hut | 小屋 | —（stage連動） | 3.8×3.38×3.16 | — |
| smelter | 製錬炉 | furnace（簡易炉） | 3.65×2.75×2.29 | Bellows（ふいご一式） |
| laboratory | 研究施設 | —（stage連動） | 4.6×3.22×3.8 | — |
| steam-engine | 蒸気機関 | steamengine | 2.93×1.38×2.28 | Wheel（フライホイール）/ Piston |
| distillation-tower | 精留塔 | refinery | 1.71×1.44×3.97 | — |
| factory | 工場 | —（stage連動） | 5.2×4.25×5.04 | — |
| power-plant | 発電所 | —（段階建物） | 5.53×3.46×5.32 | — |
| research-institute | 研究所 | —（stage連動） | 5.65×4.2×4.68 | — |
| waterwheel | 水車 | waterwheel | 2.3×1.71×2.55 | Wheel（羽根板車輪） |
| drilling-rig | 掘削やぐら | rig | 2.9×2.55×3.56 | DrillPipe / Winch |

寸法は three.js 上での実測値。占有形状などの正式値は `structures.json`。

## 原画からの判断

- **水車**: 原画は水車小屋付きだが、既存仕様の水車は動力設備単体。
  付属建屋は参考扱いとし、小屋は追加していない（水車+脚台+導水板のみ）。
- **発電所**: 原画どおり火力型（タービン建屋+ボイラー棟+変圧器+煙突）で
  造形。**オーナー決定（2026-11-07）: 火力のまま、段階建物（新設
  コンテンツ）として扱う。** 現行設定の発電は水力発電機 generator の
  みのため、設定上の整合は Claude/GPT 側で確認・決定する。
- **蒸気機関**: 据え置き型（水平ボイラー+ピストン+フライホイール）。
  機関車にはしていない。**精留塔**は電波塔状の部品なし。**水車**は観覧車に
  していない（羽根板・軸・支持構造あり）。
- 炎・発光部はモデル本体と分離（Flameノード／発光マテリアル）。煙は
  モデルに含めず、従来どおりエフェクト側（playVisualEffect 'smoke'）。

## 組み込み方法（Claude向け）

現行の `StructureRenderer` はファクトリ差し替え式で、ヘッダーコメント
どおり GLB 読み込みのファクトリを `registerFactory` で登録すれば
呼び出し側は無変更で置き換わる。GLBの配信方法（単一ファイルビルドへの
同梱か、assets 配信か）はゲーム側の構成に合わせること。モバイル向けには
同一モデルの低ポリ版を別途出す代わりに、まず本モデルで実測し、重い
機種だけテクスチャ 256px 版への差し替えを検討（テクスチャは
`tools/make_textures.py` の S を変えて再生成可能）。

## 検証範囲

- three.js（ゲームと同バージョン 0.180）のビューアで、ゲームの探索
  カメラ（pitch 32° / yaw 45°）から全13種を確認（renders/）。
  可動部（Wheel / Piston / DrillPipe / Winch）の回転・移動の向きも
  同ビューアで確認済み（Wheel は rotation.z で盤面内回転を確認）。
  Blender の EEVEE レンダーはこの VM に libEGL がなく未実施 —
  代替として実エンジン（three.js）での確認を優先した。
- 実ゲーム内での配置確認は未実施（Claudeの組み込み後）。
