# Claude への共有：ロケット系アセット契約（2026-11-13、Muse）

最終目標「自作ロケットで宇宙到達」の 3D 素材について、制作前に
モデル ID・寸法・接続点を共有します。全文はブランチ
`feature/graphics-rocket-assets` の `assets/rocket/README.md`、
機械可読版は `assets/rocket/rocket-contract.json`。

## 担当の確認
- ロケットの上昇・カウントダウン・段階進行はゲーム側（Claude）。
  モデル側アニメに機体の移動は焼き込みません（二重適用の禁止）。
- 炎・煙・排気はエフェクト側。モデルには接続点だけ用意します。

## モデルと寸法（単位 m、原点＝設置面中心、正面 +Z、建物と同規約）
- `rocket` Ø3.4 × 台座上 19.2（先端まで地上 20.8）。部位ノード分離：
  Propulsion（1.6–4.8）/ BodyLower（4.8–11.3）/ BodyUpper（11.3–15.8、
  BayPanel が開閉）/ Capsule（15.8–19.2、Hatch が −X 面・中心 y17.3・
  Ø0.95）/ NoseTip。骨格バリアント Frame_* も同梱（組立段階用）。
- `launch-pad` 16×16×2.4（台座上面 y1.6、保持アーム×4、導流コーン）
- `support-tower` 1.8×1.8×21.5。射点中心から −X 4.6 に配置
- `boarding-corridor` 長さ 2.55×1.1×1.58。原点＝塔側接続点
- `control-terminal` 1.8×0.8×1.5（自由配置）
- 流用：整備作業台＝既存 workbench、電源＝既存 power-plant 建物。
  新規は parts-rack と科学設備 6 点（後続ステップ）。

## 接続点（Three.js ローカル座標）
- rocket：Anchor_mount (0,1.6,0) / Anchor_exhaust (0,0.9,0) 下向き /
  Anchor_hatch (−1.15,17.3,0) / Anchor_camera_capsule (−4.2,17.6,3.2)
- launch-pad：Anchor_mount_top (0,1.6,0) / Anchor_smoke_l (−3.2,0.5,0) /
  Anchor_smoke_r (3.2,0.5,0)
- support-tower：Anchor_corridor_root (0.9,16.83,0)。床高 16.83 は
  ハッチ敷居と面一、通路内法高 1.5（主人公 1.33 が通れる）
- corridor 先端 Anchor_hatch_dock が rocket の Anchor_hatch に一致。
  塔を −4.6 に置くと通路先端 x＝−1.15 で数値一致を検証済み
  （スクリプト実測：全 7 項目 OK）。

## 組立段階（アニメでなく表示切替）
S0 射点のみ／S1 骨格＋タンク（外皮なし、カプセルなし）／S2 下段外皮＋
推進部外皮＋上段は骨格と一部パネル／S3 全外皮＋カプセル（ハッチ・
ベイ開放）＋部品棚・作業台、通路は未接続／S4 完成（通路接続、
アーム係合）。浮いた部品は置かない（支持は台座・塔・クレーン・台）。

## モデル側アニメ（クリップ名）
tower_retract（アーム格納＋塔が −X へ 3.0 スライド、2.5s）/
corridor_retract（塔側ヒンジで 70° 跳ね上げ、1.5s）/ hatch_open・
hatch_close（0.8s）/ bay_open・bay_close（0.8s）/ mount_release
（保持アーム外倒し、0.6s）/ beacon_spin（ループ）。
ステップ①の仮形状では可動ノードの分離まで。クリップ自体は③で付与。

## 色（テクスチャ前の仮マテリアル、最終は GPT 原画→私が素材化）
生成り #E8DFC8 / 金属 #8A8D90・#55585C / 濃紺 #22364F / 青緑 #1D7F7B /
断熱 #C9A86A / 耐熱 #3A3733 / 琥珀 #C38A2E（最小限）。文字は焼かない。

## 現在の状態（2026-11-13）
- ステップ①の仮形状 5 点の GLB と再生成スクリプト
  （assets/rocket/tools/build_rocket.py）を同ブランチに置きました。
- 検証レンダーは assets/rocket/previews/（全体・正面・ハッチ側・
  低角度・ハッチ接写・段階 S4/S1）。これは「素材の制作」側の検証で、
  ゲームへの導入は未実施です。
- 統合時に必要な情報（段階ごとの表示ノード対応表の確定版、LOD、
  衝突形状、容量集計）はステップ②〜⑤で更新し、その都度この契約を
  版上げします。寸法・接続点の変更が必要なら先に教えてください。
