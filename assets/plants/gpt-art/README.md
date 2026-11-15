# 植物原画納品（GPT、2026-11-15）

`../GPT-TEXTURE-REQUEST.md` の8素材を個別画像として生成。`originals/` は生成原本、直下のPNGは指定寸法への縮小版です。竹は256×512、ほかは512×512。樹皮と竹はRGB、葉・針葉は実アルファ付きRGBAです。松樹皮と竹の生成時の外側余白を切り出しています。色画像を法線マップとして扱わないでください。

状態は **原画制作済み／モデルへの正式適用待ち** です。GLB・材質契約は変更していません。新しい採集ID・収量も追加していません。

## Museへの接続指示

|画像|材質スロット|適用|
|---|---|---|
|tex-bark-broadleaf.png|bark / barkDark|縦筋の円柱ラップ、ベースカラー|
|tex-bark-pine.png|trunkPine|鱗状の樹皮、ベースカラー|
|tex-bark-kouzo.png|barkLight|繊維ストリップの色、ベースカラー|
|tex-leaf-broadleaf.png|leafA / leafB / leafDark|4枚配置。各象限から1枚ずつ切り出して葉カードに割当てる。全4枚を1枚の葉へ貼らない|
|tex-leaf-kouzo.png|kouzoLeaf|切れ込み葉1枚、アルファを保持|
|tex-needle-pine.png|needleA / needleB|針葉の束1組、アルファを保持|
|tex-bamboo-culm.png|bambooCulm / bambooNode|節を含まない表面色。節は既存ジオメトリ|
|tex-reed-leaf.png|reedLeaf|縦向きの細長い葉1枚、アルファを保持|

32 GLBを検査すると62プリミティブにTEXCOORD_0がありません。対象材質にはleafA/leafB/leafDark、kouzoLeaf、needleB、reedLeafが含まれます。詳細は `docs/integration/plant-uv-audit-20261115.json`。依頼表にはUVの説明はありますが、実UVテンプレート画像はありません。

UVを持たない葉にそのまま貼らず、Muse側でUVとカードの表裏・向き・切り出し範囲を確定してください。READMEの「不透明ジオメトリ」と依頼表の「透過葉カード」の運用差もここで整理してください。綿の白い実、亜麻・菜種の花は変更対象外です。

画像寸法とアルファ範囲は検査済み。透明縁の最終的な見え方、実モデルとLODでの見え方、タイルの継ぎ目は未検証です。生成だけでシームレス性を保証しません。元モデルの寸法・原点・スロットは維持してください。
