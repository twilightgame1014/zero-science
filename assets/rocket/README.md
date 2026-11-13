# ロケット系アセット契約（最終目標「自作ロケットで宇宙到達」）

グラフィックス担当（Muse）からゲーム統合（Claude）への共有文書。
モデルID・寸法・接続点・組立段階・アニメーションをここで正とする。
寸法の単位はメートル、原点と向きは建物13種（assets/buildings-3d）と
同じ規約：**原点＝設置面の中心、正面＝+Z、Y-up（three.js）**。

## スケール基準

- 主人公スプライト：平面 1.7×1.7、見た目の身長 ≒ 1.33 m
  （256px セル中 200px が可視部）。建物は小屋 3.16 m、工場 5.04 m。
- ロケットは世界の人工物で最大：射点上の全高 **20.8 m**
  （火山 40 m の約半分）。カプセルは主人公が座って収まる寸法。

## 配色（基調）

生成り #E8DFC8（機体主塗装）／落ち着いた金属 #8A8D90・#55585C／
濃紺 #22364F（帯・塔）／青緑 #1D7F7B（通路・端末、UI ティールと一致）／
断熱材 #C9A86A（下段ラップ）／耐熱 #3A3733（ノズル・基部）／
注意色は琥珀 #C38A2E を最小限（ハッチ縁など）。
実在ロケット・機関ロゴ・他作品の意匠は再現しない。文字は焼き込まない。

## A. 主要モデル（assets/rocket/models/）

| ID | 内容 | 寸法 (W×D×H m) | 備考 |
|---|---|---|---|
| rocket | 機体一式（部位ノード分離） | Ø3.4 × 19.2（台上） | 下記部位参照 |
| launch-pad | 発射台 | 16×16×2.4 | 台座・保持アーム・偏流板 |
| support-tower | 支持塔 | 1.8×1.8×21.5 | 射点中心から −X へ 4.6 |
| boarding-corridor | 搭乗通路 | 長さ 2.55 × 1.1×1.58 | 塔⇔ハッチ間 |
| control-terminal | 地上管制端末 | 1.8×0.8×1.5 | 単独配置可 |

### rocket の部位ノード（分離可能）

- `Propulsion` 推進モジュール：y 1.6–4.8、Ø3.4。ノズルベルは
  台座空洞内 y 0.9–1.6。フィン等の突起なし（架空設計）。
- `BodyLower` 下段胴体：y 4.8–11.3、Ø3.4。下部 2.2 m は断熱ラップ帯。
- `BodyUpper` 上段胴体／機器室：y 11.3–15.8、Ø3.4→2.9 テーパー。
  機器室は側面パネル `BayPanel` が開閉（機器搭載の見せ場）。
- `Capsule` 搭乗カプセル：y 15.8–19.2、基部 Ø2.9→上部 Ø1.5 の
  フラスタム＋ドーム。ハッチは −X 面、中心 y 17.3、Ø0.95
  （その高さの胴径は Ø2.15、ハッチ面は中心軸から 1.08）。
  窓は +Z 面に 1 枚（バイザー越しの内景は作らない）。
- `NoseTip` 脱出塔を兼ねる先端：y 19.2–20.8。

## 接続点（アンカー、three.js ローカル座標・Y-up）

rocket（原点＝射点中心の地表面）:
- `anchor_mount` (0, 1.6, 0)：機体基部。launch-pad の台座上面と一致
- `anchor_exhaust` (0, 0.9, 0)：噴射エフェクト発生点、方向 −Y
- `anchor_hatch` (−1.15, 17.3, 0)：ハッチ中心の少し外、外向き −X
- `anchor_camera_capsule` (−4.2, 17.6, 3.2)：搭乗演出カメラ参照点

launch-pad（原点＝台中心の地表面）:
- `anchor_mount_top` (0, 1.6, 0)：台座上面＝rocket の anchor_mount
- `anchor_smoke_l` (−3.2, 0.5, 0) / `anchor_smoke_r` (3.2, 0.5, 0)：
  側方煙エフェクト発生点

support-tower（原点＝塔基部の地表面、配置は射点中心から −X へ 4.6）:
- `anchor_corridor_root` (+0.9, 16.83, 0)：通路の塔側接続（塔の +X 面、
  床高 16.83 ＝ ハッチ敷居と面一。通路内法高 1.5、主人公 1.33 が通れる）
- `anchor_arm_1/2/3`：整備アーム先端（y 6.5 / 12.5 / 17.0、機体側へ +X。
  アーム長は 1・2 が 1.95、3 が 2.55 で先端が機体表面に達する）

boarding-corridor（原点＝塔側接続点、+X 方向へ伸びる）:
- 全長 2.55。塔の +X 面（射点中心から −3.7）に原点を置くと、先端が
  −1.15 ＝ rocket の `anchor_hatch` に一致する。先端のドックリング
  （Ø1.1）がハッチ面との隙間を橋渡しする。

演出カメラ参照点（ゲーム側が使う目安、モデルには含めない）:
- 全景：射点中心から (+16, 6, +20) 方向
- ハッチ：anchor_camera_capsule

## B. 組立段階（表示切り替え仕様、アニメーションではない）

ゲーム側は段階ごとにノード表示を切り替える。宙に浮く部品は置かない
（各段階で支持物＝台・塔・作業台・クレーンアームのいずれかに接する）。

- S0 射点のみ：launch-pad + support-tower + control-terminal
- S1 骨格：rocket は Frame_*（リブ＋縦通材）と Frame_Tank* のみ表示。
  Capsule・外装・通路・部品棚なし
- S2 外装途中：Propulsion 外装一式（Propulsion / PropSkirt / Nozzle /
  NozzleInner）、BodyLowerInsul、Skin_Lower_P1〜P3（塔側 P4 が欠け、
  そこは Frame_BodyLower が見える）、SeamRing_70、BodyUpper は
  Frame_BodyUpper + Frame_TankUpper + Skin_Upper_P2 のみ（正面 P1・
  背面 P3・塔側 P4 は骨格のまま）。Capsule・通路なし、parts-rack 配置
- S3 機器搭載途中：外装完成（全 Skin_*、UpperBand、SeamRing_*、
  BayPanel、Capsule 一式、Nose*）、骨格は非表示。ハッチと BayPanel は
  クリップ hatch_open / bay_open の終端フレームで開放状態にする。
  parts-rack と既存 workbench を脇に配置、通路は未接続
- S4 完成：S3 から parts-rack を撤去し、全閉（閉クリップの始端）、
  通路を接続、塔アーム接続

外装パネルは4分割（P1 正面 +Z / P2 +X / P3 背面 / P4 塔側 −X）。
段階表示の検証レンダーは previews/stage-s1〜s4-34.png。

流用：整備用の作業台は既存 `workbench`（buildings-3d）をそのまま使う。
部品置き場だけ新規（`parts-rack`：棚＋部品箱、2.4×0.9×1.8）。

## C. 科学設備（assets/rocket/models/、設備単体スケール）

| ID | 内容 | 寸法 (W×D×H m) | 流用・重複回避 |
|---|---|---|---|
| electronics-fab | 電子部品の製造設備 | 2.6×1.2×2.0 | 新規 |
| computer-bench | コンピューター組立台 | 2.2×1.0×1.6 | 新規（作業台とは別） |
| test-terminal | 試験端末 | 1.4×0.9×1.7 | 新規 |
| suit-stand | 宇宙服の組立／点検設備 | 1.6×1.2×2.2 | 新規。宇宙服展示を兼ねる |
| life-support | 生命維持ユニット | 2.0×1.0×1.9 | 新規（タンク＋管路） |
| power-distribution | 蓄電／配電設備 | 2.2×0.8×1.9 | 新規（電池棚＋配電盤）。発電所建物は流用し重複させない |

## 宇宙服

- `spacesuit-display`：展示／製作画面用 3D（suit-stand に装着した姿）。
  全高 ≒1.5 m（主人公の頭身に合わせ、スプライト可視高 1.33 m 基準）。
  部位ノード分離：Helmet / Visor / Torso / GloveL/R / BootL/R /
  Backpack（生命維持）。男女共通規格、色は生成り＋濃紺＋青緑。
- デザイン資料：正面・左・右・背面・斜め2方向のレンダーを
  previews/ に出す（GPT がスプライト化する際の原画）。
- スプライト化は GPT 担当。引き継ぎ仕様は GPT-REQUEST に分離：
  既存8方向シート契約（セル 256×256、可視高 200px、足元基準
  セル下から 29px、中心 x=127.5）と同一にすること。

## アニメーション（モデル側クリップ）

| 対象 | クリップ | 内容 |
|---|---|---|
| support-tower | tower_retract | 整備アーム収納＋塔がレールで −X へ 3.0 m 後退（2.5s、逆再生で復帰） |
| boarding-corridor | corridor_retract | 塔側ヒンジで 70° 振り上げ退避（1.5s） |
| rocket/Capsule | hatch_open / hatch_close | ハッチ回転開放・閉鎖（0.8s） |
| rocket/BodyUpper | bay_open / bay_close | 機器室パネル開放・閉鎖（0.8s） |
| launch-pad | mount_release | 保持アーム 4 本が外側へ倒れる（0.6s） |
| support-tower | beacon_spin | 塔頂ビーコンの回転（ループ） |

**二重適用の禁止**：ロケットの上昇・カウントダウンは Claude が
ゲーム側トランスフォームで制御する。モデル側クリップに機体の
平行移動は焼き込まない（tower_retract の塔自身の移動は除く）。
炎・煙・噴射はモデルに含めず、anchor_exhaust / anchor_smoke_* に
ゲーム側エフェクトを付ける前提。エフェクト素材は GPT 依頼に分離し、
スマホ向けに粒子数・透明面を抑えた版を別途用意する（統合時仕様）。

## 納品物と検証

- 再生成スクリプト tools/build_rocket.py（Blender 4.0.2）
- GLB（LOD0/LOD1）＋簡略衝突（rocket-contract.json に形状で記載）
- rocket-contract.json：ID・実寸・原点・向き・接続点・アニメ・
  材質と発光部の対応表・段階表示・容量/三角形数/材質数
- 検証：360°＋低角度レンダー、主人公フィギュアとの並置、発射台と
  機体の接続数値確認、通路とハッチの干渉確認
- 「素材の制作完了」と「ゲームへの導入完了」は分けて報告する。
  本書の段階では素材側の契約であり、導入は Claude の統合後。
