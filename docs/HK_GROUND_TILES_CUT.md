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

## Residual

- The mesh is an oblique aerial. Kerb paint and aggregate are coarser than a phone photograph at this eye. LOD changes between tiles are visible.
- The vertical snap is one offset for the disc. A real step in the mesh is kept; the whole plate moves so the low tail meets the sidewalk.
- Charts win only inside mounted BUILDING boxes, and only above the ground band. An aerial facade with no individualised chart stays.
- The example API key and the tileset can change. `?groundTiles=off` is the escape.
- Cut #40 far-frame Soft live A-B is a different change and is not in this mount.
