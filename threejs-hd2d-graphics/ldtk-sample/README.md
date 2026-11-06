# LDtk sample plot （見本区画）

LDtk（無料のレベルエディタ）で配置したデータを、HD-2D グラフィックモジュールが
読める JSON に変換して取り込むための試作一式。狙いは、自然物や地域の配置を
コード内の定数ではなく「描いて決めるデータ」として扱えるようにすること
（バイオーム設計の入力づくりが第一の用途）。

## 中身

| ファイル | 内容 |
|---|---|
| `sample-plot.ldtk` | LDtk 1.5.3 プロジェクト。第9ラウンドの見本区画と同一配置 |
| `tools/build_sample_plot.py` | 上記 .ldtk の生成スクリプト（再実行可能） |
| `tools/ldtk_to_graphics.py` | .ldtk → 描画側 JSON 変換。`--check` でデモ区画と 1:1 照合 |
| `tools/build_preview.py` | .ldtk の上面プレビュー PNG 生成（エディタ無しで確認用） |
| `out/sample-plot.graphics.json` | 変換結果（clearings / naturalObjects / ground） |
| `out/preview.png` | 上面プレビュー |

## プロジェクトの設計

- レベル `Sample_Plot`：24 m × 24 m、中心はワールド座標 (-38, 30)。
  レベル左上が (-50, 18)、32 px = 1 m、グリッド 16 px = 0.5 m。
  対応関係はレベルフィールド `originX / originZ / pxPerMeter` として
  ファイル自身に記録してある（変換側はそれを読むので自己完結）。
- レイヤー2つ：
  - `NaturalObjects`（Entities）: Tree / Rock / Ore / Bush / Grass / Herb /
    Flowers / Branch / Pebble / Water / Oil の採取ノード＋ Clearing
    （景観を生やさない範囲）＋ Spawn（確認用テレポート先）。
    全エンティティ pivot は (0.5, 0.5) で、`px` が中心位置。
  - `Ground`（IntGrid）: grass / dirt / path / gravel の地面塗り。
    1セル = 0.5 m。
- ノードのカスタムフィールド：`scale`（Float）、`variant`（String、
  例 flint）、`state`（String: available / depleted）、
  `highlighted`（Bool）。Clearing は `radius`（Float、m）。

## 変換の対応

| LDtk | 描画側 |
|---|---|
| Clearing エンティティ | `decor.clearings` の `{x, z, r}` |
| ノードエンティティ | `setNaturalObjects` の要素。id は nature.js 形式 `kind:x,z`（0.1 単位座標）で自動生成 |
| `state = depleted` | `depleted: true` |
| `variant` 非空 | `natural: {kind, variant}` |
| Ground の IntGrid | `ground` ブロックとして書き出すのみ（現行レンダラは未使用。将来の地面マスク用） |

## 使い方

```sh
# .ldtk を作り直す（LDtk 付属サンプル Entities.ldtk を骨格として使う）
python3 tools/build_sample_plot.py
# 変換＋照合
python3 tools/ldtk_to_graphics.py --check
# プレビュー生成
python3 tools/build_preview.py
```

LDtk 本体は Muse の VM に設置済み（`~/workspace/tools/ldtk/`、v1.5.3、
公式 ubuntu-distribution の AppImage を展開したもの）。エディタで開いて
編集 → 保存 → 変換、という往復も可能。

## 検証（2026-11-07、Muse）

- `ldtk_to_graphics.py --check`：デモ区画の14ノード＋クリアリングが
  位置・scale・depleted・highlighted・variant まで完全一致（PASS）。
- LDtk 1.5.3 実機（VM 上）で `sample-plot.ldtk` を開き、レイヤー・
  エンティティ・地形がエラーなく表示されることを確認。
- モジュールのデモで往復確認：区画のノードを全消去した状態から、
  変換 JSON だけを `setNaturalObjects` に渡して同一区画が復元される
  ことをスクリーンショットで確認（ゲーム本体での確認ではない）。

## 注意

- これは試作（提案）であり、ゲーム本体・Claude 側の nature.js は変更しない。
  実データの正は引き続きゲーム側（nature.js）にある。この仕組みは
  「設計・配置の入力」を作るためのもので、描画側は受け取った配置を
  表示するだけ、という役割分担は従来どおり。
- 地面の IntGrid 塗りを実際の地形へ反映させるには描画側の対応が別途必要
  （現行は頂点カラー＋デカール方式）。今回は書き出しまで。
