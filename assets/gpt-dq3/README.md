# GPT DQ3-density asset set (round 19, 2026-11-07)

Owner-supplied GPT sheets generated from
`threejs-hd2d-graphics/GPT-ASSET-PROMPTS-DQ3-2026-11-07.md`
(target: Dragon Quest III HD-2D density — individually readable
stones, foliage richness, prop count, per-material drawn detail).
Originals live in `source/`, untouched; everything else is derived.

Sheet map: 01 town ground / 02 walls+roof / 03 broadleaf / 04
flowers+vines / 05 scatter (**square 1254×1254 version adopted**;
the wide 1536×1024 duplicate is kept as
`sheet-05-scatter-wide-SUPERSEDED.jpg` for reference only) / 06
town props / 07 volcano / 08 waterside.

## Pipelines

- `tools/process_dq3.py` — cutouts (flood fill + rembg
  isnet-general-use gate; seg-union for the white-on-white smoke;
  enclosed-white-pocket removal that spares shaded petals/cloth)
  and ground tiles (light flatten → half-roll crossfade; roof
  period-cropped; dirt ruts diffusion-inpainted for the plain
  variant). Metrics in `process-report.json`; QA composites
  `qa-sprays-magenta.png` / `qa-props-magenta.png`.
- `tools/prep_dq3.py` — end-grain rings + structure-derived
  normals (mortar / plank gaps / tile overlap only, never from
  broad colour variation — round-14 rule).
- `tools/build_dq3.py` — all 21 GLBs (Blender 4.0.2, reuses the
  buildings builder's world-scale UV system). Sizes in
  `models-measured.json`.
- `tools/make_blend.py` — regenerates `models/dq3-assets.blend`
  (all GLBs in one editable grid). The .blend is a workspace
  convenience; the parametric source of truth is `build_dq3.py`,
  so the .blend is not versioned.
- `tools/bundle_dq3.py` — WebP bundle → module
  `src/graphics/dq3Textures.ts` (21 textures, ~0.95 MB).

## Correspondence table

| Asset | Source | Processed | Model | Applied to |
|---|---|---|---|---|
| town-cobble | sheet-01 TL | ground/town-cobble.png (+_n) | plaza.glb centre/rims | module terrain splat3 (town centre) |
| town-grass | sheet-01 TR | ground/town-grass.png | — | viewer district ground (module uses its own grass splat) |
| town-dirt / town-dirt-plain | sheet-01 BL | ground/town-dirt.png, town-dirt-plain.png (ruts inpainted out) | — | module terrain splat3 (town outskirts, plain) |
| town-plaza-strip | sheet-01 TR quadrant band | ground/town-plaza-strip.png | plaza.glb rings (u = angle × reps) | — (model) |
| roof-orange | sheet-02 TL | ground/roof-orange.png (+_n, period-cropped) | hut-town.glb roof slabs + eave tile row | — (model) |
| wall-plaster | sheet-02 TR (beam-free cell) | ground/wall-plaster.png | hut-town.glb walls under real 3D timber | — (model) |
| wall-plaster-timber | sheet-02 TR | ground/wall-plaster-timber.png | fallback / distant use | — |
| stone-wall | sheet-02 BL | ground/stone-wall.png (+_n) | hut-town.glb foundation | — (model) |
| plank / window-unit | sheet-02 BR | ground/plank.png (windowless), sprays/window-unit.png (dressing ref) | hut-town.glb door/gable; window is geometry + glass | — (model) |
| broadleaf-bright/droop/deep/light | sheet-03 quadrants | sprays/broadleaf-*.png | tree-broadleaf-{round,tall,young}.glb canopies | module node trees (ResourceRenderer spraySet, preferred over round-11 branch cards) |
| flower-branch / berry-branch / vine / roundleaf-bush | sheet-04 quadrants | sprays/*.png | planter dressing (cards) | module bundle (sprays) |
| grass-tall / grass-wide / grass-pampas | sheet-05 row 1 | sprays/*.png | — | module bundle |
| flower-white/yellow/pink | sheet-05 row 2 | sprays/*.png | — | module bundle |
| pebbles / leaf-pile | sheet-05 row 3 | sprays/*.png | — | module bundle (ground decals) |
| stump / log-fallen / moss-rock | sheet-05 row 4 | sprays/*.png (reference) | stump.glb / log-fallen.glb / moss-rock.glb (rings end-grain, moss cards) | — (models) |
| banner-red / banner-green | sheet-06 | props/*.png (reference) | banner-*.glb (cloth grid, sine drape, swallowtail notch, no text) | — (models) |
| planter-large / planter-small | sheet-06 | props/*.png | planter-*.glb (lathe pot + soil + leaf cards) | — (models) |
| fruit-basket | sheet-06 | props/*.png | fruit-basket.glb | — (models) |
| crates | sheet-06 | props/*.png | crates.glb (plank boxes + battens) | — (models) |
| canopy-cloth | sheet-06 | props/*.png | stall.glb canopy | — (models) |
| stone-lantern | sheet-06 | props/*.png | stone-lantern.glb (unlit by default) | — (models) |
| barrel | sheet-06 | props/*.png | barrel.glb (lathe bulge + iron bands + rings top) | — (models) |
| bucket-rope | sheet-06 | props/*.png (handle interior pocket removed) | bucket-rope.glb (open profile, handle, rope coil) | — (models) |
| ash | sheet-07 TL | ground/ash.png | — (terrain vertex colour + volcanic tile carry it) | — |
| lava-flow | sheet-07 TR | ground/lava-flow.png (1024 albedo, crust darkened) + lava-flow-emissive.png (stream only) | volcano district disc | module crater lava lake + lava NODE (preferred over round-17 pair) |
| smoke-1/2/3 | sheet-07 BL | sprays/smoke-*.png (soft alpha, NOT binarised) | — | module bundle (area particles / vent dressing) |
| basalt-1/2/3 | sheet-07 BR | sprays/basalt-*.png (reference) | basalt-{1,2,3}.glb (3 shape originals, sides/backs completed) | — (models) |
| lily-flower / reed-cattail / floating-plants / waterside-bush | sheet-08 quadrants | sprays/*.png | — | module bundle (floating-plants; others staged for Claude-side placement) |

## Civilisation-stage classification (owner §9)

- **Developed town only** (NOT for the primitive starting
  settlement): town-cobble, town-plaza-strip, roof-orange,
  wall-plaster(-timber), stone-wall, plank, hut-town, plaza,
  banner-*, planter-*, crates, barrel, bucket-rope, stall,
  fruit-basket, stone-lantern.
- **All stages / nature**: broadleaf set, flowers/vines, grass,
  pebbles, leaf-pile, stump, log-fallen, moss-rock, waterside set.
- **Volcano area**: ash, lava-flow pair, smoke, basalt-*.

Display timing / unlock changes are Claude's (game logic); these
files change no progression rules.

## Model notes

- Origin at ground centre, front +Z (same convention as
  assets/buildings-3d/). Sizes in `models-measured.json`
  ({w,h,d} metres). Trees: round w3.57 h4.31 / tall w2.82 h5.08 /
  young w1.87 h3.02. Hut w4.2 d4.15 h3.52 (entrance front +Z,
  centred). Plaza Ø12.6, walk-over slab (no collision intended).
- GLBs embed their textures (~41 MB total for the folder). For
  the game build, make a lightweight set the way Claude did for
  round 14 (albedo 512 JPEG, normal/roughness 256) — see
  HANDOFF-TO-CLAUDE.md 追補16.
- Grey-mode caveat: alpha cards render as solid quads under a
  grey override, so the grey check validates solid geometry
  only; canopies are verified in the final-material shots.
