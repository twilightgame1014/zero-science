# gpt-env — GPT environment sheets, round 21 (2026-11-07)

Originals in `source/` (as generated, 1206 px wide). Processing:
`tools/process_env.py` (report: `process-report.json`).
Runtime bundle: `tools/bundle_env.py` → `src/graphics/envTextures.ts`.

| source | processed | use |
|---|---|---|
| sheet-01-cliff.jpg | cliff-face.png (1024²) + cliff-face_n.png | cliff-* GLBs, tile 2 m |
| sheet-02-scree.jpg | ground-scree.png (1024², 3×3 mosaic) | terrain splat3.z, tile 6 m / cell 2 m |
| sheet-03-moss.jpg | moss/moss-1..6.png | GLB decals on L rocks + shore rocks; WaterfallKit WF_Moss |
| sheet-04-streaks.jpg | waterfall-streaks.png (RGBA) | WaterfallKit fall layers, tile 2.2 m |
| sheet-05-foam.jpg | foam/foam-cluster-1..4.png, foam/foam-ring-1..2.png | WF_Foam (ring), WF_FoamCluster; water-surface sprites |
| sheet-06-shore-foam.jpg | shore-foam.png (1024×256, bottom crop to 4:1) | shoreline ribbons, tile 3 m |

QA previews: cliff-face-preview4x4.png, ground-scree-preview4x4.png,
qa-moss-dark.png, qa-moss-magenta.png, qa-foam-blue.png,
waterfall-streaks-stack3.png, shore-foam-preview4x.png.
Placement metadata: assets/environment-set/metadata.json (gpt-env entries).
Spec for Claude: threejs-hd2d-graphics/INTEGRATION.md §27.
