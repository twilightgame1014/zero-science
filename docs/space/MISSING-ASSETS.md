# 宇宙計画：まだ完成していない素材の一覧（2026-11-14 統合時点）

ゲームは下の素材がなくても最後（宇宙到達）まで動く。今はどれも**仮表示**で、完成品としては扱わない。
担当：Claude＝コード・統合・検証／Muse＝3D モデルとアニメーション／GPT＝テクスチャ・アイコン・企画と制作指示。

## 1. 主人公の宇宙服（正式な 8 方向スプライト）— GPT 原画 → Muse 仕上げ
| 素材 ID（ファイル名案） | 用途 | 寸法 | 方向数 × 枚数 | 配置先 |
|---|---|---|---|---|
| `player-spritesheet-boy-suit-8dir` | 男の子が宇宙服を着た姿（歩行） | セル 256×256・可視高 200px・足元はセル下端から 29px・中心 x=127.5 | 8 方向（行）× 4 列（列0 は静止）＝ 32 コマ | `assets/hero/` → `scripts/make-hero-sprites.py` → `assets/build/hero/` |
| `player-spritesheet-girl-suit-8dir` | 女の子が宇宙服を着た姿 | 同上 | 同上 | 同上 |

- 仕様の詳細：`assets/rocket/GPT-SPRITE-REQUEST.md`（Muse 作成）。デザインの正は `assets/rocket/models/spacesuit-display-lod1.glb` と Muse ブランチの `assets/rocket/previews/suit-*.png`。
- 現状：`src/space-visual.ts` の `SpacesuitEquipmentPlaceholder`（白い胴・紺の背負い箱・透明な球のヘルメット）を、男女どちらの主人公の絵にも重ねている。**主人公の選択（`S.flags.hero`）は変わらない**（テスト済み）。
- ゲーム側の受け口（未実装・シートが届いたら作る）：`S.space.suit` があるとき `setPlayerSpriteSheet` を宇宙服のシートへ切り替える。8 方向の自己点検（`HD2D.diag8Check`）を同じく通すこと。

## 2. アイコン（追加 55 品目）— GPT
今は品目の絵文字（🔧／🛠️／🫓／⚫）と名前で出している（名前は必ず出るので操作は止まらない）。
共通：原画 256×256・透過あり・タイルなし。ゲームでは 32px と 48px で表示（既存の `assets/item-icons` → `scripts/make-item-atlas.py` の 64px アトラスへ入れる）。
キーは品目 ID（`docs/space-assets.json` の `assetId` は `icon_<品目ID>`）。

| 品目 ID | 名前 | 分野 | 種類 |
|---|---|---|---|
| `sp_machine` | 精密加工台 | 材料 | 設備 |
| `sp_materials` | 材料評価台 | 材料 | 設備 |
| `sp_plate` | 軽量外装板 | 材料 | 部品・材料 |
| `sp_frame` | 構造フレーム | 材料 | 部品・材料 |
| `sp_fastener` | 締結部品 | 材料 | 部品・材料 |
| `sp_insulator` | 絶縁部品 | 材料 | 部品・材料 |
| `sp_cable` | 被覆配線 | 電力 | 部品・材料 |
| `sp_fiber` | 機能繊維 | 材料 | 部品・材料 |
| `sp_seal` | 柔軟シール材 | 材料 | 部品・材料 |
| `sp_membrane` | 気密膜 | 材料 | 部品・材料 |
| `sp_thermal` | 積層断熱材 | 材料 | 部品・材料 |
| `sp_ceramic` | 耐熱セラミック | 材料 | 部品・材料 |
| `sp_window` | 透明保護材 | 材料 | 部品・材料 |
| `sp_powerbench` | 電源組立台 | 電力 | 設備 |
| `sp_storage` | 蓄電モジュール | 電力 | 部品・材料 |
| `sp_power` | 電源配電ユニット | 電力 | 部品・材料 |
| `sp_fab` | 電子部品製造設備 | 計算機 | 設備 |
| `sp_switch` | スイッチ回路 | 計算機 | 部品・材料 |
| `sp_transistor` | 切替素子 | 計算機 | 部品・材料 |
| `sp_pcb` | 配線基板 | 計算機 | 部品・材料 |
| `sp_passive` | 受動部品セット | 計算機 | 部品・材料 |
| `sp_gate` | 論理ゲートセット | 計算機 | 部品・材料 |
| `sp_adder` | 加算回路 | 計算機 | 部品・材料 |
| `sp_memory` | 記憶回路 | 計算機 | 部品・材料 |
| `sp_cpu` | 演算制御モジュール | 計算機 | 部品・材料 |
| `sp_io` | 表示入力モジュール | 計算機 | 部品・材料 |
| `sp_computerbench` | 計算機組立台 | 計算機 | 設備 |
| `sp_computer` | 学習用コンピューター | 計算機 | 部品・材料 |
| `sp_sensor` | 模擬環境センサー | 計算機 | 部品・材料 |
| `sp_flightcomputer` | 船内コンピューター | 計算機 | 部品・材料 |
| `sp_radio` | 通信ユニット | 計算機 | 部品・材料 |
| `sp_suitbench` | 宇宙服組立台 | 宇宙服 | 設備 |
| `sp_liner` | 内側の衣服 | 宇宙服 | 部品・材料 |
| `sp_pressurelayer` | 宇宙服の気密層 | 宇宙服 | 部品・材料 |
| `sp_protectlayer` | 宇宙服の保護層 | 宇宙服 | 部品・材料 |
| `sp_helmet` | ヘルメットとバイザー | 宇宙服 | 部品・材料 |
| `sp_gloves` | 手袋とブーツ | 宇宙服 | 部品・材料 |
| `sp_air` | 呼吸環境供給部 | 生命維持 | 部品・材料 |
| `sp_scrubber` | 空気再生部 | 生命維持 | 部品・材料 |
| `sp_waterunit` | 水衛生部 | 生命維持 | 部品・材料 |
| `sp_cooling` | 温度管理部 | 生命維持 | 部品・材料 |
| `sp_lifesupport` | 生命維持ユニット | 生命維持 | 部品・材料 |
| `sp_suit` | 組立済み宇宙服 | 宇宙服 | 部品・材料 |
| `sp_assembly` | 機体組立設備 | 機体 | 設備 |
| `sp_hull` | 機体構造 | 機体 | 部品・材料 |
| `sp_skin` | 機体外装 | 機体 | 部品・材料 |
| `sp_propulsion` | 架空推進モジュール | 機体 | 部品・材料 |
| `sp_charge` | 架空推進用カートリッジ | 機体 | 部品・材料 |
| `sp_capsule` | 搭乗カプセル | 機体 | 部品・材料 |
| `sp_pad` | 発射台 | 地上設備 | 設備 |
| `sp_tower` | 支持塔と搭乗通路 | 地上設備 | 設備 |
| `sp_control` | 地上管制端末 | 地上設備 | 設備 |
| `sp_testbench` | 総合試験端末 | 地上設備 | 設備 |
| `rawrubber` | 合成ゴムのもと | 材料（ゴム） | 部品・材料 |
| `rubber` | ゴム | 材料（ゴム） | 部品・材料 |
- `rawrubber`・`rubber` は今回の統合で Claude 側の実装から足した 2 品目（`docs/space-assets.json` にはまだない。次の更新で足す）。
- 架空の推進部（`sp_propulsion`・`sp_charge`）は、現実の機種・薬品のラベルに似せない抽象的な形と色にする。

## 3. テクスチャ原画 — GPT 原画 → Muse が UV に貼る
仕様の詳細：`assets/rocket/GPT-TEXTURE-REQUEST.md`（Muse 作成）。今は Muse の材質設定（色・金属度・粗さ）だけで描いている。
UV テンプレート（Muse ブランチ `feature/graphics-rocket-assets` の `assets/rocket/textures/uv-template-rocket-body.png` 2048×1024・`uv-template-capsule.png` 1024×512）は存在のみ確認。**画像の検品と、テクスチャの制作は未実施**。

| 素材 ID | 用途 | 寸法 | タイル | 透過 |
|---|---|---|---|---|
| `tex-rocket-skin` | 胴体とカプセルの外装（パネルの継ぎ目・リベット・点検口の跡） | 2048×1024 ＋ 1024×512 | なし（ラップ。u=0/1 で継ぎ目が合う） | なし |
| `tex-metal-dull` | 推進部・台座・タンク・配管（明 #8A8D90／暗 #55585C の 2 種） | 1024×1024 | あり | なし |
| `tex-insulation` ほか | 断熱材・耐熱・発射台の床など（依頼書の 3 以降） | 依頼書のとおり | 依頼書のとおり | 依頼書のとおり |

## 4. 3D モデル（Muse）
- 正式 13 モデル（LOD1）は導入済み（`assets/rocket/models/*-lod1.glb`。Muse の納品コミット 80d522e と blob が一致することをテストで検査）。**LOD0 は同梱していない**（1 ファイル 16MB の制約）。
- 確認の結果、直してほしい所・決めてほしい所は `docs/space/SPACE-INTEGRATION-2026-11-14.md` の「Muse への依頼」。
