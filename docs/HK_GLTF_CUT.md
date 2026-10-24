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
4. Landmarks the extrude batch does not own. The Bank of China Tower stays on its LandsD corners (four triangles, real plate, real height steps). Its skirt is `HkRetailPodium` and its faces are the same curtain material as the other extrudes. There is no separate chrome prism skin. When an individualised mesh covers that footprint, the prism is not drawn: the photograph is the facade. Jardine portholes start at or above the belt.

Photo materials on the glTF keep the file’s roughness and metalness. A mesh whose box is within 120 m of the Des Voeux eye keeps the JPEG’s native edge (the LandsD atlases are 4096²). Farther maps still drop to 2048 px. Every photo map is sampled at anisotropy 16. Street-near maps use a LOD bias of −1.25 so an eye-height view stays on a sharp mip instead of the muddy one. The cached JPEGs are untouched.

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

Person mode, x = −1.4, z = 29.3, heading 1.29 rad. The 8D mesh around that point is textured LandsD geometry at the file resolution. Procedural glass, canyon ribbons, and footprint extrudes inside 80 m of that eye are not drawn when a LandsD mesh is inside the disc. Further east, 9C towers continue the street in the same photo material. The Bank of China Tower, about 230 m east-south of this eye, uses its individualised mesh when that file is in 11-SW-9C or 11-SW-8D, and otherwise the footprint prism with the extrude materials.

## Placement

glTF node matrices are column-major, Y-up after the node: X = HK1980 easting, Y = HKPD, Z = −northing. Horizontal placement is `hkCoreProject` after the HK1980 inverse and the small-area WGS84 shift (latitude −5.5″, longitude +8.8″). Each mesh’s lowest HKPD snaps to the sidewalk at 0.22 m, same as the extrudes.

## Residual risks

- 11-SW-8D on disk is the Des Voeux subset (24), not all 781. `--street` is how to cache the rest of the sheet. Buildings further into Sheung Wan stay on the opaque extrude until that cache grows.
- About a metre of horizontal datum difference versus the LandsD grid API.
- Snapping each mesh to the sidewalk flattens real steps in HKPD.
- A mesh that does not share a footprint’s box can leave an extrude beside it outside the 80 m street disc, or hide a neighbour when the boxes overlap. Inside that disc the extrude is hidden once any LandsD mesh is present, so a gap with no individualised model is empty rather than a glass slab.
- Full-resolution atlases within 120 m cost more GPU memory than the old 2048 px cap. Farther sheets still downscale.
- The pinned `GLTFLoader` commit (`5e6eee6ce875`) is three.js `dev` as of 2026-10-24.
