# GPT/Codex への依頼：ロケット系アセットのゲーム導入（2026-11-14、Muse）

最終目標「自作ロケットで宇宙到達」の3D素材は制作完了済みです。
オーナー指示により、当面コードは GPT/Codex が担当するため、
統合はこちらへ依頼します。

正本はブランチ `feature/graphics-rocket-assets` の
`assets/rocket/README.md` と `assets/rocket/rocket-contract.json`
（v5）。この文面と食い違う場合は正本を優先してください。

## 取り込むもの

- `assets/rocket/models/`：GLB 13点＋全点の LOD1
  （`<ID>-lod1.glb`）。LOD0 合計 65,292 tris / 4.7 MB、
  LOD1 34,388 tris / 2.8 MB
- `assets/rocket/tools/`：再生成・検証スクリプト（統合には不要、
  参照のみ）
- 素材は完成品です。GLB の中身（寸法・ノード名・アンカー・
  クリップ）は変更しないでください。合わない点があれば
  GLB を直さず、Muse へ報告してください

## 配置（単位 m、原点＝設置面中心、正面 +Z、Y-up、建物と同規約）

- `launch-pad` を射点原点に置き、`rocket` はその上に重ねる
  （pad の `anchor_mount_top` (0,1.6,0) ＝ rocket の
  `anchor_mount`）
- `support-tower` は射点中心から **−X へ 4.6**
- `boarding-corridor` は原点（塔側接続点）を tower の
  `anchor_corridor_root`（塔配置後 (0.9,16.83,0) 相当）に置く。
  先端が rocket の `anchor_hatch` (−1.15,17.3,0) に一致する
  ことは数値検証済み
- `control-terminal` は射点脇に自由配置
- 射点のワールド座標は設定値として切り出すこと。初期値は既存
  エリアと干渉しない平地への仮置きでよい（最終位置はオーナー
  決定事項）

## 導入タスク

1. **組立段階の連動**：ゲーム進行に S0〜S4 を対応させ、ノード
   表示を切り替える（アニメーションではなく表示切替）。
   段階ごとの表示ノード一覧は README「B. 組立段階」が正。
   S3 では `hatch_open` / `bay_open` の終端フレームで開放状態を
   見せること。宙に浮く部品が出る段階遷移にしないこと
2. **発射シーケンス**：順序の目安は hatch_close →
   corridor_retract → tower_retract → mount_release → 上昇。
   上昇とカウントダウンはゲーム側トランスフォームで制御し、
   モデル側クリップと二重適用しないこと（機体の平行移動は
   クリップに焼き込まれていません）
3. **エフェクト接続点**：炎・噴射は `anchor_exhaust`
   (0,0.9,0) 方向 −Y、側方煙は pad の `anchor_smoke_l/r`
   (∓3.2,0.5,0)。モデル側に炎・煙は含まれていません。
   スマホ向けは粒子数と透明面の重なりを抑えた版を使うこと
4. **演出カメラ参照**：全景＝射点中心から (+16,6,+20) 方向、
   搭乗＝ rocket の `anchor_camera_capsule` (−4.2,17.6,3.2)
5. **科学設備6点**（electronics-fab / computer-bench /
   test-terminal / suit-stand / life-support /
   power-distribution）：研究・生産系の画面／施設に配置する。
   既存 `workbench`（整備作業台）と既存 `power-plant` 建物
   （電源）は流用済みの前提なので、重複する新規実装はしない
6. **宇宙服**：`spacesuit-display` は製作／点検画面用の展示
   モデル。主人公スプライトの宇宙服版は別途 GPT 担当
   （`assets/rocket/GPT-SPRITE-REQUEST.md`）なので、導入を
   それ待ちで止めないこと
7. **LOD と衝突**：近景 LOD0／遠景・スマホ LOD1。簡略衝突
   形状は rocket-contract.json の記載を使うこと

## クリップ一覧（全て GLB 内蔵、24fps）

| 対象 | クリップ | 内容 |
|---|---|---|
| support-tower | tower_retract | アーム格納＋塔が −X へ 3.0 後退（2.5s、逆再生で復帰） |
| boarding-corridor | corridor_retract | 塔側ヒンジで 70° 跳ね上げ（1.5s） |
| rocket | hatch_open / hatch_close | ハッチ開閉（0.8s） |
| rocket | bay_open / bay_close | 機器室パネル開閉（0.8s） |
| launch-pad | mount_release | 保持アーム×4 外倒し（0.6s） |
| support-tower | beacon_spin | 塔頂ビーコン回転（ループ） |

## 境界と禁止事項

- マテリアルは単色の仮マテリアルが現行の正です。テクスチャ
  原画は GPT 担当で別途進行中（`GPT-TEXTURE-REQUEST.md`）。
  統合側でテクスチャを捏造したり、文字を焼いたりしないこと
- アイテム ID は変更しない（CLAUDE.md の既存ルールどおり）
- 作業は TEAM_RULES どおり：自分の feature ブランチで作業し、
  main へ直接 push しない。ゲートは npm test / typecheck /
  build / e2e を全て通し、未実施のものは未実施と明記すること
- 作業開始前にリポジトリの最新の統合状態を確認し、
  `assets/rocket` は素材ブランチから取り込むこと

## 検証と報告

- 報告は「素材の制作完了」（済み）と「ゲームへの導入完了」を
  分けること
- 導入の証跡はデモではなく**実ゲーム画面**のスクリーン
  ショットで：各段階（S0〜S4）の射点、発射シーケンスの
  途中フレーム、低角度の3点を最低限
- 実機 FPS・スマホ表示は、実測した場合のみ「確認済み」と
  書き、未実施なら未確認と明記すること
- 寸法・接続点・段階仕様に変更が必要になったら、先に
  オーナーと Muse へ相談すること（素材側の契約変更になる
  ため）
