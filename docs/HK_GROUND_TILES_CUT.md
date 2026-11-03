# Digit1 ground — LandsD tile-based mesh

> **Cut #47: this method is abandoned for the Digit1 eye.** Keith rejected the aerial-tile ground (Cuts #41, #45, #46) as an "alien world" on 2026-11-03. The tiles are no longer mounted by default and the deck is no longer punched: the default Digit1 ground is the game deck, see [HK_GAME_GROUND_CUT.md](HK_GAME_GROUND_CUT.md). The mount below is kept only behind `?groundTiles=on`, for far or debug views. Everything on this page that says "`?groundTiles=off` is the escape" is inverted: `off` is now the default. Do not spend further cuts on ownership, grain, seams, sharpening or LOD of these tiles. Soft is not SD, and SD is not yet.

Cut #41. The carriageway under `?at=-1.4,29.3,1.29` was procedural asphalt (`createRoadSurfaceMaterial`) with cast-iron manhole lids left over from the New York shader. That is not a photograph of Des Voeux. This cut mounts the Lands Department 3D Visualisation Map (tile-based models) under that eye and yields the procedural deck where the tiles land.

The plan is [plans/cut41-sd-ground.md](../plans/cut41-sd-ground.md).

© Government of the Hong Kong SAR (Lands Department) / CSDI 3D Visualisation Map (tile-based) / [Open3Dhk](https://3d.map.gov.hk/).

## What mounted

The tileset is the public Cesium 3D Tiles endpoint:

```text
https://data.map.gov.hk/api/3d-data/3dtiles/f2/tileset.json
```

The page uses the example key published on the CSDI 3D Visualisation Map API page. From Cut #47 the mount runs only with `?groundTiles=on`; without it the procedural deck stays in place (before #47 the escape was `?groundTiles=off`). The walk keeps leaf b3dm tiles whose box centre is within 42 m of the Digit1 eye and whose half-extent is at most 24 m, capped at 72 tiles. Vertices are Y-up in the tile frame, converted to ECEF, then into the Statue Square world (x east, z south). The low tail of heights within 8 m of the eye is shifted onto the asphalt at y = 0.07 so the photograph sits on the same ground the chase walks.

Textures are KTX2 embedded as `image/ktx2`, not `KHR_texture_basisu`. The page decodes that buffer with the three.js KTX2 transcoder and draws the photograph unlit (`hkGroundTilePhoto`), the same way the PlanD aerial is shown as captured. A triangle whose centroid is above y = 1.8 and inside a mounted Individualised BUILDING box is dropped, so those charts stay in front. The ground band inside the box stays.

Where at least one photographed tile samples the eye, these ribbons lose the instances whose centres fall in the 42 m disc: `HkRoadCentrelines`, `HkSidewalks`, `HkCurbs`, `HkLaneMarkingsWhite`, `HkLaneMarkingsYellow`, `HkOsmPavement`. The road graph and the collision height are unchanged. Ribbons outside the disc stay. Bus shelters, benches, and lamps stay. If the tileset fails, or no vertex lands within 8 m of the eye, the deck is not punched.

`createRoadSurfaceMaterial` no longer draws the ConEd / NYC sewer lids. That deletion is the whole island, not only the disc. It is not an ownership pass by itself.

Individualised INFRASTRUCTURE and TERRAIN sheets are not the plate. The tile walk reached the eye, so this cut did not fall through to a glTF sheet or to a Megascans bridge. No Megascans bytes are in the repo.

## Soft bar

`digit1GroundOwnership` is the bar for this cut. It scores mean absolute RGB difference and `hp_std_3x3` grain on a ground crop, after versus tip `c2eeeb0`. It returns pass only when all of these hold:

- the capture is marked live, and not synthetic
- ownership is `tiles`, `infrastructure`, or `terrain`
- MAD is at least 6 and the absolute grain delta is at least 0.35

A missing capture, a painted buffer, a Megascans bind, or a manhole-only change returns fail. This page does not paint that crop. Sleeping Dogs is not claimed.

A headless Chrome / SwiftShader pair at `?at=-1.4,29.3,1.29`, tip `c2eeeb0` before and this mount after, was scored with that function. The road-ahead crop was MAD 19.79 and grain 5.86 to 8.37. The right kerb crop was MAD 13.15 and grain 0.93 to 2.76. Both clear the floors with ownership `tiles`. That machine is not Keith's MSI, so the MSI call stays with the live pair from that machine. `tools/digit1-ground-mount.html` mounts only the disc and reports loaded tiles, the snap, and the nearest vertex.

## Cut #45 — right-kerb and underfoot grain

Plan: [plans/cut45-sd-digit1-right-kerb.md](../plans/cut45-sd-digit1-right-kerb.md). Cut #41 left right-kerb (`|grainΔ|` 0.022) and underfoot (0.156) under the 0.35 floor, with tiles owning the rays. This cut does not touch the mount, the tile walk, the yield radius, or the far-frame work from #43 and #44.

What the inventory found at `22d91a4`, from the published tileset and a headless frame:

- The eye tile `Tile_+230_+104_L21_00102210` is a leaf (no children), so the walk already takes the finest LOD there. It is 1024 x 2048 at about 2.0 cm per texel. The neighbours on the walk are 2 to 5 cm per texel. The 0.5 cm tiles are building bases, not the carriageway. `f2` is the only tileset the CSDI host serves; `f0`, `f1`, `f3` and `f4` are 404.
- Nothing else competes for the rays. A triangle scan at points 0 to 20 m ahead of the eye finds one tile photograph per point, apart from a second layer 0.2 m up on the west side from the coarser `L20_0000000` tile. The procedural deck is punched (69 instances yielded).
- Each tile is a single-level KTX2 (ETC1S/BasisLZ, transcoded to a compressed format), loaded `LinearFilter`, anisotropy 1. At the avatar's feet the photograph is magnified about 2 to 3 times in screen space and the carriageway reads as 4 x 4 blocks with almost no texel-scale detail. Bilinear smears the one real edge there, the kerb line.

So the tile owns the ground and the grain was missing from the read, not from the ownership. The change is in how the photograph is sampled, not in what is drawn:

- `js/hk-ground-photo.js` replaces `MeshBasicMaterial` for the tiles with a `MeshBasicNodeMaterial` (`hkGroundTilePhoto`). Where the tile is magnified (texels per pixel from `dFdx`/`dFdy`, full at 0.5 and gone by 1) it reads the photograph with a Catmull-Rom filter and adds a luma unsharp of the tile's own texels in gamma space (gain 2.5, radius 1.5 texels). Minified ground keeps the plain filter. Nothing is synthesised and no second texture is bound; a flat patch stays flat. The CPU twin and the weights are in `js/hk-ground-tiles-frame.js`.
- `?groundPhoto=plain` restores the bilinear `MeshBasicMaterial` read (the #41 look) for a live A-B on the MSI. `?groundSharpen=` and `?groundRadius=` override the gain and radius for tuning.
- `digit1GroundResiduals` is the #45 bar: live right-kerb and underfoot crops must both clear `digit1GroundOwnership`. `digit1GroundOwnership` now also refuses a flat AFTER frame that differs from BEFORE (`blank-frame`): during this work a failed tile fetch produced a blank screenshot that scored PASS.
- `tools/digit1-eye-shot.mjs` gained `--root` (serve the BEFORE checkout) and `--hide-hud`; `tools/digit1-ground-ab.mjs` scores two frames on `DIGIT1_GROUND_CROPS` (fractions of the frame).

Headless Chrome / SwiftShader, 1280 x 633, `?at=-1.4,29.3,1.29`, BEFORE is tip `c2eeeb0` (the #41 lineage), crops are the fractions in `DIGIT1_GROUND_CROPS`. These are not Keith's MSI crops and not the #41 pixel rectangles:

| Crop | MAD | grain before -> after | grainΔ | #41 read (`?groundPhoto=plain`) |
| --- | --- | --- | --- | --- |
| right-kerb | 59.55 | 2.657 -> 3.697 | +1.040 | -0.231 |
| underfoot | 16.30 | 0.425 -> 1.022 | +0.597 | 0.000 |
| road-ahead | 60.17 | 23.527 -> 10.404 | -13.123 | -13.104 |
| south-kerb | 31.61 | 2.020 -> 1.896 | -0.124 | -0.518 |

Right-kerb and underfoot clear MAD 6 and `|grainΔ|` 0.35 on this pair, with ownership `tiles`. Two things the MSI pair needs to read with care:

- `|grainΔ|` is not monotone in sharpness. The procedural BEFORE has its own grit, so a crop whose tile grain climbs toward the BEFORE value crosses zero and fails. South-kerb does that here (1.50 plain, 1.90 reconstructed, BEFORE 2.02). On the #41 crop it was -3.31. Judge it by the signed delta and both grains, not by the pass flag alone.
- Against the #41 tip as BEFORE (the plain read) the same change is MAD 1 to 2, under the floor of 6. The honest A-B for these two crops is against `c2eeeb0`, where the ownership change already supplies the MAD. The gain over `007d61f` is the grain delta in the last column.

The MSI call stays with the live pair on that machine. Soft is not SD, and SD is not claimed.

## Cut #46 — LOD seams between tiles

Plan: [plans/cut46-sd-digit1-ground-gsd.md](../plans/cut46-sd-digit1-ground-gsd.md). Cut #45 left the eye tile sharper and the seams between tiles readable. This cut does not touch the mount path, the tile walk, the yield radius, the #45 reconstruction, Soft paint, the far NDC, or the far-frame work from #43 and #44.

What the inventory found at `0a71f80` (51 tiles, headless frame, `?groundTint=gsd`):

- At `?at=-1.4,29.3,1.29` the right half of the frame is the 2.1 cm eye tile (`L21_00102210`, `L21_00102211`) and the left half, with the north kerb and the north half of the carriageway, is 4.0 to 6.0 cm (`+230_+105_L20_0000000`, `L20_0000100`, `L20_0000200`, and `+229_+105_L20_002102`). The seam is at z = 28.6, a 1.9x GSD step, running ahead along the avatar's left. `f2` is the only tileset the host serves and those L20 tiles are leaves, so there is no finer tile to prefer. A second, transverse seam sits about 10 m ahead where the 2.1 cm tiles end at x = 11.6.
- Ground-only GSD differs from whole-tile GSD. Over all triangles the neighbour reads 4.3 cm; the facades in the same tile pull that figure. The tint and the lift use the ground band (triangles under 1.8 m).
- Neighbouring tiles overlap in strips 0.2 to 0.3 m wide (the 2.1 cm and 4.0 cm tiles share about 2 m2 at z = 28.5 to 28.7). The two surfaces agree to 2 mm. Which photograph wins was decided triangle by triangle by depth noise, and the `polygonOffset` 1/1 of the tile material is nothing on the 32-bit reversed depth buffer. On screen that is a tooth edge, not a line: boundary spread 5.6 px rms, 0.46 extra transitions per row.
- Across the seam the photographs match: mean luma 26.9 against 27.0 and grain 1.47 against 1.42 in the 14 px bands either side (the #45 read, rows where the boundary is clean). Exposure is not what separates them; the GSD step and the teeth are.

The change: each tile moves vertically by 4 mm per centimetre of ground GSD relative to the tile on the eye (clamped to 3 cm), so the finer photograph always owns an overlap. The eye tile does not move (the snap and the avatar's feet are unchanged), a 4 cm neighbour sits 8 mm below it, a 0.5 cm building base sits 6 mm above. A tile with no ground triangles has no GSD to rank and stays where it is. `?groundPriority=off` is the #45 mount for a live A-B; a frame of it matches a `0a71f80` checkout (whole-frame MAD 0.04, the avatar idling). `?groundTint=gsd` paints each tile by ground GSD (magenta under 1 cm, green 1 to 2.2, yellow 2.2 to 3.5, orange 3.5 to 5, red over 5) and `?groundTint=tile` by file; both are diagnostics.

`digit1GroundSeams` is the Cut #46 bar. A live BEFORE and AFTER pair is read as a `?groundTint=gsd` frame and a photograph frame each. A pixel is tile paint where the tint frame differs from the photograph frame (a facade stripe is orange in both). Runs of a band shorter than three pixels are anti-aliasing blends and are dropped. Transitions between two bands are tracked down the rows and fitted to a line (a ground line is a straight line on screen); the spread about it is the seam's ragged edge. It returns pass only when all of these hold:

- the capture is live, not synthetic, and the ownership is `tiles`, `infrastructure`, or `terrain`
- both frames have a seam in the lane crop (`HK_GROUND_SEAM_ROI`, the carriageway ahead of the avatar and the left kerb), and the AFTER frame is not blank
- the ragged spread falls by at least 1 px and is at most 1.2 px after
- the photograph inside a 14 px band about the seam changes by at least MAD 0.5, which is above what two frames of one tip differ by (0.00 in that band when measured, about 0.1 over the whole lower half)

`tools/digit1-ground-seam.mjs` takes the four screenshots (see its header for the commands) and `tools/digit1-ground-seams.html` is a plan view of the mounted band for looking at the mosaic. `tools/digit1-eye-shot.mjs` now refuses a frame when the tiles did not mount: it also waits for the loading overlay to exist before reading it, and passes `--disable-web-security` because the host's cache sometimes answers with another origin's `Access-Control-Allow-Origin`, which the harness's random localhost port cannot satisfy.

Headless Chrome / SwiftShader, 1280 x 633, `?at=-1.4,29.3,1.29`, BEFORE is `?groundPriority=off`. These are not Keith's MSI frames. The pair is in [artifacts/digit1-seam-gsd-tint-ab.png](../artifacts/digit1-seam-gsd-tint-ab.png) and [artifacts/digit1-seam-gsd-photo-ab.png](../artifacts/digit1-seam-gsd-photo-ab.png); the scores are in [artifacts/digit1-seam-gate.json](../artifacts/digit1-seam-gate.json).

| Seam (2.1 cm / 4.0 cm, green / orange) | BEFORE | AFTER |
| --- | --- | --- |
| rows tracked | 156 | 159 |
| boundary spread, px rms | 5.59 | 0.48 |
| extra transitions per row | 0.46 | 0.00 |
| 14 px band MAD, before to after | | 1.07 |
| 14 px band grain | 1.397 | 1.442 |

Against `c2eeeb0` the #45 residuals are unchanged: right-kerb MAD 59.55, grain delta +1.040 (identical to #45); underfoot MAD 16.33, grain delta +0.611 (was +0.597). Both still clear MAD 6 and `|grainΔ|` 0.35 with ownership `tiles`. South-kerb is `below-floor` as it was at #45 (-0.130 against -0.124); the held bar names right-kerb and underfoot only. The band grain barely moves: the fix chooses which photograph shows, it does not add or remove detail, and nothing is synthesised.

Measured and not shipped. A reconstruction whose gate and radius are in ground distance rather than texels (so a 4 cm tile is not sharpened over twice the ground) cut the coarse region's grain from 3.91 to 3.30 and calmed the block edges on the left kerb, but it also took the underfoot crop from +0.65 to +0.49 and no seam number improved: the #45 read already puts the two sides of the seam at the same grain (1.47 against 1.42, against 1.37 against 0.76 for the plain read). The MSI underfoot delta at #45 was +0.40 against a 0.35 floor, so it was left alone. It is the first thing to try if the left kerb reads blocky on the MSI.

The MSI call stays with the live pair on that machine. Soft is not SD, SD is not claimed, and a Soft pass is not the Keith eye.

## Residual

- The mesh is an oblique aerial. Kerb paint and aggregate are coarser than a phone photograph at this eye. LOD changes between tiles are visible: after Cut #46 the seam is a straight line and not a tooth edge, but the 2.1 cm to 4.0 cm step across it is the source's, and the host serves no finer tile for the north half of the carriageway. The seam is not feathered: the tiles overlap by 0.2 to 0.3 m at most and a cross-fade there would be a few pixels wide.
- The vertical snap is one offset for the disc. A real step in the mesh is kept; the whole plate moves so the low tail meets the sidewalk.
- Charts win only inside mounted BUILDING boxes, and only above the ground band. An aerial facade with no individualised chart stays.
- The example API key and the tileset can change. From Cut #47 the tiles are opt-in (`?groundTiles=on`), so the default page does not depend on them.
- Cut #40 far-frame Soft live A-B is a different change and is not in this mount.
- Cut #45: the carriageway tile is about 2 cm per texel and ETC1S-compressed. The reconstruction sharpens the kerb line and paving joints it has, and it can also raise block edges in the asphalt. It cannot add detail the aerial did not capture; a phone photograph at this eye still resolves more.

## Cut #47 — abandoned for the Digit1 eye

Plan: [plans/cut47-sd-digit1-game-ground.md](../plans/cut47-sd-digit1-game-ground.md). The Soft bars on this page (`digit1GroundOwnership`, `digit1GroundResiduals`, `digit1GroundSeams`) passed on frames that Keith's eye called an alien world: an oblique aerial carpet at 2 to 5 cm per texel, with no phone asphalt, granite kerb, tram paint or sidewalk life, and it hid the LandsD / OSM street that was already map-true. A Soft PASS is not the Keith eye.

- Default: no tileset fetch, no `HkGroundTiles`, no yielded deck. `resolveGroundTilesRequest` returns null unless `?groundTiles=on` (or `1`, `true`).
- Opt-in: `?groundTiles=on` is the #46 mount, byte for byte, with the #45 / #46 switches. It is a debug and far-view escape, not a direction.
- The bars and their tests stay so the opt-in mount stays checkable. They are not extended.
- The tools that mount tiles (`digit1-ground-mount.html`, `digit1-ground-seams.html`) add `groundTiles=on` themselves.
