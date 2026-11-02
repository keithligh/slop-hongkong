# Digit1 ground — LandsD tile-based mesh

Cut #41. The carriageway under `?at=-1.4,29.3,1.29` was procedural asphalt (`createRoadSurfaceMaterial`) with cast-iron manhole lids left over from the New York shader. That is not a photograph of Des Voeux. This cut mounts the Lands Department 3D Visualisation Map (tile-based models) under that eye and yields the procedural deck where the tiles land.

The plan is [plans/cut41-sd-ground.md](../plans/cut41-sd-ground.md).

© Government of the Hong Kong SAR (Lands Department) / CSDI 3D Visualisation Map (tile-based) / [Open3Dhk](https://3d.map.gov.hk/).

## What mounted

The tileset is the public Cesium 3D Tiles endpoint:

```text
https://data.map.gov.hk/api/3d-data/3dtiles/f2/tileset.json
```

The page uses the example key published on the CSDI 3D Visualisation Map API page. `?groundTiles=off` leaves the procedural deck in place. The walk keeps leaf b3dm tiles whose box centre is within 42 m of the Digit1 eye and whose half-extent is at most 24 m, capped at 72 tiles. Vertices are Y-up in the tile frame, converted to ECEF, then into the Statue Square world (x east, z south). The low tail of heights within 8 m of the eye is shifted onto the asphalt at y = 0.07 so the photograph sits on the same ground the chase walks.

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

## Residual

- The mesh is an oblique aerial. Kerb paint and aggregate are coarser than a phone photograph at this eye. LOD changes between tiles are visible.
- The vertical snap is one offset for the disc. A real step in the mesh is kept; the whole plate moves so the low tail meets the sidewalk.
- Charts win only inside mounted BUILDING boxes, and only above the ground band. An aerial facade with no individualised chart stays.
- The example API key and the tileset can change. `?groundTiles=off` is the escape.
- Cut #40 far-frame Soft live A-B is a different change and is not in this mount.
- Cut #45: the carriageway tile is about 2 cm per texel and ETC1S-compressed. The reconstruction sharpens the kerb line and paving joints it has, and it can also raise block edges in the asphalt. It cannot add detail the aerial did not capture; a phone photograph at this eye still resolves more.
