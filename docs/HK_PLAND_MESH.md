# PlanD photo-realistic mesh — Central corridor

The Des Voeux chase loads a Planning Department 3D Photo-realistic Model as a street-corridor donor. The mesh is real PlanD capture. It is on without `?pland=donor`. `?pland=off` leaves the procedural corridor, including the non-pale shopfront. LandsD photographs stay mounted in the donor mode. While the clip is mounted, both the curtain and the retail shopfront yield inside the Digit1 corridor. That shopfront is `HkCentralStreetWalls` / `hkRetailPodium` / `hkShopfrontAlbedo`: orange tile, black mouth, red and green sign bands. Left in place it is the near orange/black toy canyon, in front of the photograph. A ribbon outside the corridor still keeps it. Neon on a yielded ribbon is not hung.

This is not a claim that the chase looks like Sleeping Dogs. A headless frame of the default eye is `artifacts/digit1-eye-east-sbs.png` (tip b0e2460 beside this cut). On that probe, NDC 0, −0.08 stays the shopfront RGB(91, 24, 22). NDC 0, 0.08 is Henderson photo RGB(44, 47, 61). NDC 0, 0 is PlanD photo RGB(49, 59, 53), not pale. The grid has no pale lit pixel. Those centre samples miss the left and right canyon. The shopfront there is the ribbon this cut omits while PlanD is mounted. Keith’s veto frame, not NDC 0, is the bar.

## What stays LandsD

`11-SW-9C` and `11-SW-8D` still load when their manifests are present. A triangle is still dropped only when all three corners sample LandsD atlas padding. Photographic charts on those sheets are not replaced.

The default page, and `?pland=donor`, draw the PlanD corridor behind those meshes (`polygonOffset`, render order behind the LandsD group) so a hole can show the aerial surface. A triangle on the street side of a loaded LandsD box, within 16 m, is omitted. That is the 2017 shell in front of The Henderson, which otherwise paints a pale face over the photograph. A triangle inside the box stays. That skirt is unchanged.

The Des Voeux eye sits on the carriageway, inside the 11-SW-8D street-wall box (`B344751569101063A0`, z from 29.2). Low triangles on the asphalt are not a street-side apron in front of a face, so the 16 m skirt does not drop them. The clip also keeps them: its ground test drops a triangle only when every corner is below the sidewalk plus 1.2 m. A kerb shell can clear that test with one corner and still spike several metres up. At mount, donor and compare drop a triangle when any corner or the centre meets the Des Voeux carriageway plus the sidewalk band (tagged half-width plus curb + walk − 0.4 m, 2.07 m). Height does not keep it. That is the ripped aerial shell on the south kerb, including the slivers whose high corner is above world y 4.5. A lot face clear of that band stays. The corridor shopfront is a separate list and is omitted with the curtain, not by this triangle test.

Canyon glass and the retail shopfront inside that same corridor are omitted while the clip is mounted, so neither `hkCanyonGlass` nor `hkShopfrontAlbedo` is a toy band in front of the photograph. `?pland=compare` does not mount the LandsD meshes, so the same cameras are an A-B of the aerial corridor against the usual page. `?pland=off` mounts neither the clip nor that omit, and the shopfront stays non-pale. Unknown values, including any street-view bake, leave PlanD off.

## Not a street-view atlas

Do not plan a Mapillary or KartaView bake for the Henderson / Des Voeux podiums. The useful sequences are shot from vehicles and the shopfront is occluded, and CC BY-SA share-alike is the wrong licence to bake into this page.

A Wikimedia Commons still of The Henderson facade exists and is CC0, for reference only. It is not a street atlas and it is not a texture in this cut. One file: [HK Central Charter Street n Murray Road The Henderson facade May 2025 R12S 04.jpg](https://commons.wikimedia.org/wiki/File:HK_Central_Charter_Street_n_Murray_Road_The_Henderson_facade_May_2025_R12S_04.jpg).

## Age, and The Henderson

Hong Kong Island in this dataset is aerial photography from March 2017. The files checked on 2026-10-24 are dated 21/02/2019. The Henderson at 2 Murray Road was completed in 2024. The Murray Road multi-storey car park on that site was demolished in 2018. The PlanD mesh shows the 2017 surface. Where a current LandsD chart of The Henderson is a hole, the donor shows that 2017 surface, not The Henderson’s shopfront. Nothing in this cut invents a later facade.

## Fetch

Dataset: [3D photo-realistic model](https://data.gov.hk/en-data/dataset/hk-pland-pland1-3d-photo-realistic-model).

```text
GET https://pdmap.pland.gov.hk/plandapi/Tiles?e=&n=&fileType=
```

`e` and `n` are HK1980 grid metres (EPSG:2326). `fileType` is `OBJ`, `OSGB`, or `CESIUM`. No key. A hit returns `gridList[]` with `grid_name`, `loc_tc`, `file_url`, and `modi_date`. The specification PDF’s example (`e=834251`, `n=815501`, `fileType=OSGB`) is `tile_20_26`, 灣仔、金鐘及中環. That host in the PDF (`ppgis.pland.gov.hk`) now answers on `pdmap.pland.gov.hk`. On 2026-10-24 the live call for that coordinate still returned `tile_20_26` (fid 88, modi 21/02/2019).

`tile_20_26` is not the Digit1 street. The Des Voeux eye, HK1980 about easting 834506.7, northing 815749.0, rounds to `e=834507&n=815749` and returns **`tile_21_26` only**. Northing 815750 is the seam with `tile_21_27` (the tile that contains the Statue Square origin, north of the eye). About 300 m along the look, Fairmont House and Lippo Centre fall in **`tile_22_26`**. The fetch asks the API every 125 m from the eye out to 500 m and keeps the unique tiles. It does not hard-code `tile_20_26`.

```bash
node tools/fetch-pland-central.mjs
node tools/fetch-pland-central.mjs --tiles tile_21_26,tile_22_26
node tools/fetch-pland-central.mjs --format CESIUM --keep-zip
```

OBJ is the page path. Each zip is one Altizure mesh (`config.json`, one `.obj`, one `.mtl`, four JPEGs), on the order of 80–250 MB compressed and one continuous surface, not a building. The tool clips that surface to the Digit1 corridor and writes `hk-3d/pland/manifest.json` plus `tile_…/corridor.gltf`. `hk-3d/` is gitignored. OSGB and CESIUM are the same capture; the tool can store those zips, and the page does not load them. A missing manifest leaves LandsD as it is.

The clip drops triangles whose highest corner is below the sidewalk plus 1.2 m, so the road carpet is not a second carriageway. A facade that still touches the pavement stays. A triangle on the asphalt with one corner above 1.2 m stays in the glTF. The page drops it later when it meets the Des Voeux carriageway or the sidewalk band, at any height. Triangles outside the chase corridor (500 m along heading 1.29, 72 m to either side) are dropped.

## CRS

OBJ is Z-up. `config.json` `model_transform` is row-major. On `tile_21_26` and `tile_21_27` (both read 2026-10-24) it is the same translation:

```text
easting  = x + 836974.635391304153
northing = y + 815456.572217391338
HKPD     = z
```

The first vertex of `tile_21_26/level_5_0_0.obj` lands on northing 815500, south of the corridor. The first vertex of `tile_21_27` lands about 8 m north of the Des Voeux eye (world x ≈ −2.33, z ≈ 20.84). Each zip still carries its own matrix. The tool does not assume the next tile matches.

Horizontal placement then uses the same path as the LandsD sheets: HK1980 grid → WGS84 (−5.5″ latitude, +8.8″ longitude) → Central ENU, origin Statue Square. That path is about a metre from the Geodetic Survey API. See [HK_GLTF_CUT.md](HK_GLTF_CUT.md).

Vertical placement does not snap the mesh minimum to the sidewalk. The config bounds include HKPD down to about −188 m, and that minimum would put the street in the sky. The pavement datum is the 10th percentile of HKPD within 18 m of the Des Voeux eye. World y is `(HKPD − that datum) + sidewalk` (sidewalk 0.22 m). Tiles that do not contain the eye reuse the eye tile’s datum. If no tile has pavement samples there, the tool stops rather than invent a height.

The glTF stores Altizure local positions. The page applies `model_transform` and the datum when it mounts the mesh, which is the same function the tests check. About 1.56 million triangles is a heavy page load. It is the Digit1 default because that is the street the chase looks at. `?pland=off` skips the request.

## Measured clip

`node tools/fetch-pland-central.mjs` on 2026-10-24 asked the API along the look and received two tiles: `tile_21_26` (eye, 125 m, 250 m) and `tile_22_26` (375 m, 500 m). Both zips use the translation above.

`tile_21_26` has 19,283 pavement samples within 18 m of the eye. The 10th percentile is HKPD 5.349 m. `tile_22_26` has none, so it uses that same datum.

| Tile | Triangles kept | Ground dropped | Outside dropped | World box |
| --- | --- | --- | --- | --- |
| tile_21_26 | 703,058 | 49,106 | 1,426,871 | x −8.1…241.9, z 28.2…174.7, y 0.14…285 |
| tile_22_26 | 857,179 | 110,877 | 448,278 | x 241.9…490.5, z 28.2…237.2 |

The Des Voeux eye (x −1.4, z 29.3) sits inside the `tile_21_26` box. The Henderson footprint (about x 218…264) straddles the tile edge at x ≈ 242, so the west of that site is `tile_21_26` and the east, with Fairmont House and Lippo Centre, is `tile_22_26`. The glTF buffers match their declared lengths and each tile keeps the four PlanD JPEGs. The clip is the capture’s own triangles, not a decimated stand-in. About 1.56 million triangles is a heavy page load. It is the Digit1 default. `?pland=off` does not request it.

## Page

Default: request `hk-3d/pland/manifest.json` and mount the clip as a donor when it is present. A missing manifest leaves LandsD as it is.

| Query | What mounts |
| --- | --- |
| (none), `?pland=donor`, `?pland=1` | LandsD photographs, PlanD corridor behind them, corridor curtain and shopfront omitted |
| `?pland=0`, `?pland=off` | LandsD only. Corridor curtain stays |
| `?pland=compare`, `?pland=ab` | PlanD corridor, LandsD individualised meshes left unmounted |

While a PlanD manifest is loaded, footprint extrudes whose boxes sit in the Digit1 corridor are hidden, so the corridor is not glass in front of the aerial mesh. Gap walls outside that corridor are unchanged. The continuous mesh is not given a solid collider. A box around it would close Des Voeux.

The loading line is 正在載入規劃署三維實景（中環街廊）…. The chart is drawn from the PlanD JPEG (already sunlit), with metalness 0. The zip files are 8192². The page file, and any larger image the loader still sees, is uploaded at 2048 on the long edge. Eight full 8192² images plus mipmaps exited the GPU process before a frame could be read. The triangles are still the corridor clip. No shopfront is generated.

## Digit1 cameras

Person chase only. A helicopter or a flyover is not the comparison.

| View | Query |
| --- | --- |
| Des Voeux eye, looking east | `index.html?at=-1.4,29.3,1.29` |
| 25 m along that look | `index.html?at=22.6,36.2,1.29` |
| South side of the same station | `index.html?at=-1.4,35.3,1.29` |

The same three with `?pland=compare` are the A-B. Heading 1.29, person mode. What you should expect:

- Donor: LandsD charts that already have a photograph stay in front. A triangle that was only LandsD atlas padding is a hole, and the 2017 aerial surface can show through it. If the PlanD shell sits proud of the LandsD shell, it will cover the photograph. That offset was not checked on a GPU. On the Des Voeux carriageway and sidewalk the shell is not drawn, at any height, out to 2.07 m past the tagged half-width. The south kerb at this eye is the deck and whatever LandsD or PlanD face is actually there. The corridor shopfront is not drawn in front of them. PlanD further along the corridor, off that band, stays.
- Compare: the corridor is the continuous 2017 mesh, including roofs and the old Murray Road site. It is a different year from the LandsD individualised model, not a repaired 2024 podium.
- Neither view is a present-day shopfront survey.

A headless frame of the default eye after this omit is `artifacts/digit1-eye-east-kerb.png` (swiftshader; LandsD manifests were absent). The same eye with `?pland=off` is `artifacts/digit1-eye-east-kerb-pland-off.png`. Read against `artifacts/digit1-eye-east-pland.png` (tip f054951, LandsD sheets loaded):

| NDC | f054951 | this frame |
| --- | --- | --- |
| 0, −0.08 | shopfront (91, 24, 22) | shopfront (90, 23, 21) |
| 0, 0 | PlanD (49, 59, 53) | PlanD (48, 58, 52) |
| 0, 0.08 | Henderson (44, 47, 61) | (205, 207, 211). LandsD was not mounted, so this sample is the aerial surface, not a skirt check |
| 0.45, −0.15 | pale kerb (164, 166, 168) | (34, 32, 28) |
| 0.70, −0.05 | (162, 156, 143) | (56, 56, 54) |
| 0.85, 0.05 | (148, 141, 128) | (51, 57, 62) |

The right half of that eye (NDC x 0.2 to 0.95, y −0.35 to 0.15) falls from mean luma about 147, about half of it pale, to mean luma about 53. A magenta PlanD material left 0.45, −0.15 and 0.70, −0.05 unchanged and turned 0, 0 magenta, so the dark right foreground in this frame is not the aerial mesh. With PlanD off, 0, −0.08 stays (91, 23, 21), 0, 0 becomes (56, 36, 21), and 0, 0.08 becomes (32, 32, 38). The mount log drops 7204 carriageway triangles from the 703058 in the `tile_21_26` clip. The 16 m skirt is still the Henderson unit test. This frame does not re-prove it.

The south station (`?at=-1.4,35.3,1.29`) is `artifacts/digit1-eye-east-kerb-south.png`. Its right half has mean luma about 51 and no pale pixels. NDC 0.45, −0.15 is (40, 39, 36). NDC 0, −0.08 is (240, 168, 92), the shelter plate from that station.

The corridor shopfront omit is `artifacts/digit1-eye-east-canyon.png` (swiftshader, LandsD manifests absent, PlanD `tile_21_26` mounted). The mount log keeps 2026 of 2145 retail ribbons and drops 9774 carriageway/sidewalk triangles. NDC 0, 0 is PlanD photo about RGB(50, 60, 53). The right street band (NDC x 0.72–1, y 0.30–0.78) falls from about 24% shopfront orange/red/green to under 1%. The same eye with `?pland=off` puts the ribbons back (retail 2145) and the right band returns to that 24%. Sleeping Dogs is not claimed. Keith’s full frame, not NDC 0, is the bar.

## Attribution

© 香港特別行政區政府規劃署 3D Photo-realistic Model / [DATA.GOV.HK](https://data.gov.hk/en-data/dataset/hk-pland-pland1-3d-photo-realistic-model).

PlanD publishes the model for reference. The department does not warrant fitness for a particular use and does not promise a later edition. This page names the department and the dataset. LandsD / Open3Dhk attribution on the individualised sheets is unchanged.

## Residual risks

- March 2017 aerial, files dated February 2019. The Henderson (completed 2024) is not in the mesh. The site is the car-park era.
- One continuous mesh per tile, not a building with its own chart. The corridor clip is a geometric cut, not a semantic one.
- About a metre of horizontal datum, shared with the LandsD path.
- The vertical datum is the eye-pavement percentile, not a DTM. A step along the street is only as good as that single offset.
- Donor depth offset is unverified on WebGPURenderer. Compare mode is the check that does not depend on it.
- Corridor extrudes are hidden whenever the manifest loads. A gap in the clip is empty rather than a glass wall.
- No collider on the PlanD mesh, so the person walks through it.
- Triangles that meet the Des Voeux carriageway or sidewalk band are omitted at mount, at any height. A PlanD face clear of that band still draws, including a south-lot shell past the sidewalk where LandsD has a hole.
- Full-tile OBJ is too heavy to mount. The page mounts the clip only: 703,058 triangles on `tile_21_26` and 857,179 on `tile_22_26`. That is the capture, not a decimated mesh, and it is a heavy browser load. GSD in these configs is about 0.06 m.
- OSGB and CESIUM are not on the runtime path.
- This environment captured the default eye and the south station, without LandsD sheets (`artifacts/digit1-eye-east-kerb.png`, the `?pland=off` frame, and `artifacts/digit1-eye-east-kerb-south.png`). The 25 m camera was not captured here. Henderson in front of PlanD is the 16 m skirt test.
