# Individualised glTF — Central street faces

Des Voeux and Statue Square use Lands Department / Open3Dhk individualised building meshes. The models are the photogrammetry export (textured glTF), not a procedural podium. Invented canyon walls are removed where one of those meshes covers the street edge. Every invented street face keeps an opaque shopfront for the first two storeys. Curtain glass starts above that belt, and it cannot paint a window below it. Dense Traditional Chinese neon hangs on the shopfront belt.

© Government of the Hong Kong SAR (Lands Department) / [Open3Dhk](https://3d.map.gov.hk/).

## Sheets

Origin is Statue Square (22.28088 N, 114.15979 E), HK1980 about easting 834507, northing 815779. The Des Voeux camera used below sits on that easting, about 29 m south. The 1:1000 sheet edge between 11-SW-8D and 11-SW-9C is the north-south line at easting 834500.6, world x ≈ −7.6. The camera (x = −1.4) is on the 9C side of that line. The street runs east-west, so the west frontage is 8D and the eastward view is 9C.

| Sheet | Zip | BUILDING glTF in the sheet | Intersect Central | Kept on disk |
| --- | --- | --- | --- | --- |
| 11-SW-9C | 534,406,988 bytes | 73 | 73 | 59 (span ≥ 8 m) |
| 11-SW-8D | 2,636,460,399 bytes | 781 | 781 | 24 street faces (see below) |

Central is 22.276–22.288 N, 114.150–114.170 E. 11-SW-9A remains the pier sheet north of this pair (15 BUILDING glTF, none on Des Voeux). 11-SW-9B has no BUILDING models.

11-SW-8D’s 781 models all fall inside the Central box. 747 have a horizontal span of at least 8 m. The page does not need the whole 2.6 GB zip. The street cache is every kept model whose centre is within 180 m of the Des Voeux camera, plus towers of at least 80 m within 280 m: **24 buildings**. One of them, `B344751569101063A0`, is an 80 m × 185 m mesh whose footprint contains the camera (x from −66.9 to 13.4, z from 29.2 to 102.1). That is the photogrammetry street wall, not a glass slab.

11-SW-9C’s 59 models are the east side of the same corner, including towers whose photo atlases show a stone base and real facade. The largest JPEGs are LandsD facade photographs (4096²), not a generated window grid.

```bash
node tools/fetch-central-gltf-sheet.mjs --street
```

That command downloads both zips and keeps every Central BUILDING glTF with span ≥ 8 m. `hk-3d/` is gitignored. A missing manifest leaves the extrude fallback in place.

## What the page does

`HK_GLTF_SHEETS` is `11-SW-9C` and `11-SW-8D`. Boot loads both manifests, keeps masses with span ≥ 8 m inside the core, and mounts the nearest 200. Distance is the closest point on the mesh box to the Des Voeux eye (x = −1.4, z = 29.3), not the distance to the Statue Square origin. A mesh that overlaps the Bank of China Tower footprint is pinned into that set so a nearer harbour block cannot drop it. `?gltf=11-SW-9A` still loads a single sheet. `?gltfCap=` overrides the handful, up to 800.

A footprint whose box overlaps a loaded mesh (intersection at least 15% of the smaller box, 2 m margin) is left out of the extrude batch. When any loaded mesh itself sits inside 80 m of the Des Voeux eye, every extrude whose box is inside that same 80 m disc is left out too, overlap or not. A canyon wall is cut out wherever its centreline runs through a loaded mesh (3 m margin), and the same 80 m disc drops the canyon ribbon when a LandsD mesh is inside it. The pieces that remain are gap fill outside that street disc.

Street-level glass is forced off in four places. None of them repaint a LandsD photograph.

1. Geometry. Canyon ribbons and LandsD extrudes are split at `HK_RETAIL_BELT` (sidewalk + two 3.9 m storeys, world y = 8.02). The lower mesh is `HkRetailPodium`: granite plinth to about 1.2 m, a dark shop mouth above the plinth, a tile fascia. No punched window sits in that belt.
2. Massing podium. A wide plate’s lower block (`style: 'podium'`) uses `hkPodiumMasonry`, ashlar with punched openings only above the belt. `HkCurtainWall` is only the setback tower (`tower0`–`tower2`). Tower glass therefore starts above the podium, not at the sidewalk.
3. Shader backstop. `createCurtainWallMaterial` with `boxLocal: false` replaces colour, roughness, metalness, mullion normal, and pane emission wherever `positionWorld.y < HK_RETAIL_BELT`. A missed split still cannot draw a curtain grid to the pavement. Box-local facade tests are unchanged.
4. Landmarks the extrude batch does not own. The Bank of China Tower stays on its LandsD corners (four triangles, real plate, real height steps). Its skirt is `HkRetailPodium`. Its faces are the curtain grid with metalness 0, glass roughness 0.48, reflectivity 0.22 and a reflection floor of 0.04. The previous face used metalness 0.72 and reflectivity 0.96, which is a chrome skin. There is no individualised BUILDING mesh on that plate in 11-SW-9C, 11-SW-8D, 11-SW-9D, 11-SW-10C or 11-SW-8C, so the prism is what the chase draws. When a mesh does cover the footprint, the prism is not drawn. Jardine portholes start at or above the belt.

Photo materials keep the file’s roughness and the JPEG as base color. FME writes a constant `metallicFactor` (0.5 on these sheets) and no metalness map. That factor is not a measured metal: at eye height it replaces half the photograph with a rough-metal response, so the facade reads as brown dirt. Where a material has no metalness map, metalness is 0.

The Digit1 centre look is The Henderson’s LandsD mesh (`11-SW-9C`, `B347491569901063A0`, material `B347491569901063A0_001`), and the presented pixel is that chart’s photograph, not atlas padding. `node tools/digit1-pixel-probe.mjs` opens `index.html?probe=digit1&at=-1.4,29.3,1.29` and reads the swapchain. NDC 0, 0.22 is RGB(30, 34, 49). NDC 0, 0.36 is RGB(46, 49, 62). Neither is pale (luma ≥ 165 and chroma ≤ 42). The ray hits `HkGltfBuilding` with a map. The GPU-row texel (`flipY false`, v = 0 = first file row) is RGB(33, 43, 61) and RGB(50, 58, 71). The flipped row of the same UV is padding RGB(136, 138, 137), and that is not the pixel. An unlit magenta material on that building turns both centre samples to RGB(255, 59, 232). Hiding the building, and hiding the LandsD group, shows `HkCurtainWall` / `hkTowerGlass1` at about RGB(47, 65, 83), which is still not pale. Premise rejected: Henderson padding is not the white mid-look slab, because those samples are not white and the row the GPU samples is the photograph. Another null-fill omit would not move them.

The pale sample on that grid is NDC 0, −0.08, RGB(176, 168, 170). The ray hits `HkCentralStreetWalls` / `hkRetailPodium`, which has no albedo map. Hiding Henderson, painting Henderson magenta, and hiding LandsD all leave that pixel pale. It is the procedural podium under the street, not a LandsD triangle. This cut does not repaint it.

The full chase set decodes to about 4.5 GB of albedo. A memory-capped headless GPU process is killed before that set can present, so the probe mounts the three buildings the full-set rays hit: `B347491569901063A0`, `B345831577701063A0`, `B345471572201063A0`. On the full set the centre ray already named the same Henderson material and the same photo texel. The eye-height shell that contains the camera is not one of those three, and with it unmounted the player stays on the requested eye.

A triangle is still omitted when every corner, or the face centre, samples LandsD null fill on the GPU row. The previous omit sampled `(1 − v)`, which can delete a photograph and keep the padding on the other side of the chart. The sample uses the GPU row. The photographic shell stays. `?pland=donor` (and `?pland=1`) can show the Planning Department aerial mesh. `?pland=compare` leaves the LandsD meshes unmounted. That mesh is the March 2017 capture, not a current shopfront. See [HK_PLAND_MESH.md](HK_PLAND_MESH.md). Nothing is filled from Mapillary or KartaView. Those vehicle sequences are occluded, and CC BY-SA share-alike is the wrong licence to bake into this page.

A mesh in the Des Voeux chase keeps the JPEG’s native edge (the LandsD atlases are 4096²) and uploads that image as a single mip, sampled with a linear filter and no anisotropy. The chase is the 120 m disc around the eye, plus any mesh whose box crosses the look corridor: 500 m along heading 1.29 and 72 m to either side. That corridor is where The Henderson (~220 m), Fairmont House (~290 m) and Lippo Centre (~380 m) sit. The single-mip sampler stays so a generated mip chain cannot smear those charts. It is not a white-slab fix. The Digit1 centre samples above are the photograph. Masses off that corridor, including blocks behind the camera, still drop to 2048 px, keep mipmaps, and keep anisotropy 16. Street faces also sort ahead of those off-look masses when the 200 cap binds. The cached JPEGs are untouched. Muddy brown charts that are real LandsD texels (variance in the photograph, not the constant fill) stay.

A canyon ribbon is removed when the slab reaches a loaded mesh, not only when the centreline or the lot-facing edge does. The ribbon is a sidewalk volume in front of the lot. Its centreline can miss the photograph while half the depth still covers the shopfront, which is the flat podium under the tower. A gap with no mesh behind it keeps the wall. The 80 m disc is unchanged.

Neon boards and a second fascia row hang on canyon faces that are still gaps, on that shopfront belt (sign tops stay under y = 8.02). Des Voeux is the densest. Copy is Traditional Chinese. Highways get none. Signs are not parented to the tower glass.

## Camera

Street proof is the person chase at eye height. A helicopter or flyover frame is not acceptance.

| View | x | z | heading (rad) |
| --- | --- | --- | --- |
| Des Voeux eye, looking east | −1.4 | 29.3 | 1.29 |
| 25 m along that look | 22.6 | 36.2 | 1.29 |
| South side of the same station | −1.4 | 35.3 | 1.29 |

```text
index.html?at=-1.4,29.3,1.29
```

Person mode, x = −1.4, z = 29.3, heading 1.29 rad. The 8D mesh around that point is textured LandsD geometry at the file resolution. Procedural glass, canyon ribbons, and footprint extrudes inside 80 m of that eye are not drawn when a LandsD mesh is inside the disc. Further along the look, 9C towers (The Henderson, Fairmont House, Lippo Centre) use the same single-mip photograph. Triangles whose corners or face centre sample LandsD null fill are omitted, so The Henderson’s street height is a chart from that mesh, or a hole where the file had no chart. A sidewalk ribbon whose body reaches one of those meshes is not drawn. 皇后像廣場, the OSM `highway=bus_stop` with `shelter=yes` on the north pavement, is about 14 m from this eye. Its roof and the Chinese plate are sized for that distance. The Bank of China Tower, about 230 m east-south of this eye, has no BUILDING glTF on the loaded sheets. The chase draws the footprint prism with a matte glass face and the opaque shopfront skirt.

## Placement

glTF node matrices are column-major, Y-up after the node: X = HK1980 easting, Y = HKPD, Z = −northing. Horizontal placement is `hkCoreProject` after the HK1980 inverse and the small-area WGS84 shift (latitude −5.5″, longitude +8.8″). Each mesh’s lowest HKPD snaps to the sidewalk at 0.22 m, same as the extrudes.

## Residual risks

- 11-SW-8D on disk is the Des Voeux subset (24), not all 781. `--street` is how to cache the rest of the sheet. Buildings further into Sheung Wan stay on the opaque extrude until that cache grows.
- About a metre of horizontal datum difference versus the LandsD grid API.
- Snapping each mesh to the sidewalk flattens real steps in HKPD.
- A mesh that does not share a footprint’s box can leave an extrude beside it outside the 80 m street disc, or hide a neighbour when the boxes overlap. Inside that disc the extrude is hidden once any LandsD mesh is present, so a gap with no individualised model is empty rather than a glass slab.
- Full-resolution atlases on the chase corridor cost more GPU memory than the 120 m disc. Off-look sheets still downscale.
- The Bank of China Tower prism is the LandsD footprint, not a photogrammetry mesh. The skin is matte glass, not a photograph of the diagrid.
- The pinned `GLTFLoader` commit (`5e6eee6ce875`) is three.js `dev` as of 2026-10-24.
- Null-fill faces with no photograph behind them are holes. That is the file, not a replacement building.
- Some street-height charts are real muddy photographs (browns and olives with texel variance). Dropping the constant fill does not repaint those.
- This cut does not claim the chase is Sleeping Dogs. The Digit1 probe rejects the padding-slab premise; MSI is a separate gate.
