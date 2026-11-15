# 道路の差し替え用原画（GPT、2026-11-15）

土・砂利・石敷きを別画像で生成しました。`originals/` は生成原本、直下は512×512の不透明RGB PNGです。用途は1セル2×2mに1回繰り返すベースカラー原画です。

**原画制作済み／継ぎ目処理・材質組合せの検品待ち。ゲームの正式道路はMuseの既存画像を継続使用しています。**

`road-dirt.png`、`road-gravel.png`、`road-stone.png` の候補です。生成だけで厳密なタイル性は保証しません。特に砂利の端と石敷きの目地の周期をMuse側で確認・処理してください。端の色差の測定は `docs/integration/generated-art-qc-20261115.json` にありますが、数値だけでは模様の接続を保証できません。

現行の `assets/construction/textures/*_n.png` は元の手続き模様に対応する法線です。この新原画へ無条件で組み合わせないでください。対応する法線を材質構造から仕上げるか、適用時に法線を無効化して検品してください。今回は法線を生成していません。

採用後の経路は `assets/construction/textures/road-*.png` → `scripts/make-construction-glb.py` → `assets/build/construction/road-*.webp` → buildのASSETS.construction.textures → construction-visual.tsです。採用前に正式原本を上書きしないでください。
