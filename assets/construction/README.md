# assets/construction — 街づくり・現地建設の正式素材（Muse、2026-11-14）

契約の正本は `docs/construction/CONSTRUCTION-CONTRACT.md` と
`docs/construction/construction-assets.json` の `museFields`。

- `models/construction-site.glb` — 予定地キット（単位 1×1、配置式は契約文書）
- `models/scaffold-kit.glb` — 足場の共有部品（Scaffold_*、配置規則は契約文書）
  再生成：`tools/build_scaffold.py`（Blender 4.0.2、buildings-3d の共有材質を使用）
- `models/pile-{lumber,stone,sacks,metal,crated}.glb` — 搬入資材の山 5 種
- `textures/road-{dirt,gravel,stone}.png` ＋ `*_n.png` — 道 3 種のタイルテクスチャ
  （512×512、1 セル 2×2 m に 1 回繰り返し。Muse の手続き生成。
  GPT の原画が届いたら同じファイル名・同じ仕様で差し替える）

建物の完成モデルは作り直していない。工程別の表示は、既存の正式 GLB の
ノード名を `construction-assets.json` の `stageNodes` に機械抽出して定義した。
