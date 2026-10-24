# Hong Kong geodata pipeline

Cut 5 boots Hong Kong only. The committed `js/hk-geodata.js` is the full Island + Kowloon extract (fetched 2026-10-24), not the Statue Square sample. Opening `index.html` loads that module with no `?city=` parameter: the LandsD centreline plus OSM highways, LandsD Building blocks (`TopHeight - BaseHeight`), Victoria Harbour from OSM coast and water, and OSM parks. The module is a static import, preloaded ahead of `js/geo-source.js` and `js/city-config.js`. The second-city geodata module was removed in step 6 and is not loaded. The visible interface is Traditional Chinese (繁體中文). `buildLandmarks` calls `buildHkLandmarks`.

A checkout without the gitignored extracts still builds. `GEO_CITY=hk node tools/build-geodata.mjs` then falls back to the Statue Square centreline and buildings plus the harbour samples, and it would overwrite `js/hk-geodata.js` with that small module. Regenerate the committed file only after `bash tools/fetch-hk.sh`.

## Frame

`tools/geo-frame.mjs` is the source of the numbers in [HK_ORIGIN.md](HK_ORIGIN.md).

| | Hong Kong (`GEO_CITY=hk`, the page) | New York (tool rebuild only) |
|---|---|---|
| Origin | Central / Statue Square–Chater | 5th Ave & 42nd St centreline |
| LAT0, LON0 | 22.28088, 114.15979 | 40.75318, -73.98185 |
| Bearing | True north (`THETA = 0`) | 29.017°, then refined from the avenues |
| World axes | 1 m, x = east, z = south | 1 m, x = grid east, z = grid south |

`tools/geo-base.mjs` reads `GEO_CITY`. Unset or `nyc` runs the existing Manhattan shoreline build and still requires the NYC inputs below. `hk` (aliases `hongkong`, `hong-kong`) sets the Hong Kong frame and does not open CSCL or DCP.

`GEO_CITY=hk node tools/build-geodata.mjs` builds the street graph, the blocks, and the harbour, writes `js/hk-geodata.js`, and exits 0. It does not write a second city module. An optional second argument is the output path. `tools/geo-blocks.mjs` dispatches: unset `GEO_CITY` (or `nyc`) still rasterises Manhattan curb islands; `hk` calls `tools/geo-hk-blocks.mjs`. The Manhattan extra stage stays in `tools/geo-extra.mjs`. Hong Kong harbour is `tools/geo-hk-extra.mjs`.

## v1 bbox

Hong Kong Island, Kowloon up to the Lion Rock / Kowloon Peak ridgeline, and Victoria Harbour. WGS84 degrees, south / west / north / east:

```
22.185, 114.100, 22.360, 114.260
```

The box includes Green Island, Cape D'Aguilar, Stanley, and Stonecutters. Most of Lamma, Lantau, and the New Territories fall outside it. A sliver of northern Lamma or Tseung Kwan O can still meet the edge.

Probe on 2026-10-24, `returnCountOnly` against this bbox: **70,247** Active buildings and **15,227** road centreline parts. The tiled fetch the same day wrote **70,183** buildings and **15,222** centreline parts. The 64 buildings and 5 centreline parts in the count and not in the files have WGS84 geometry that lies entirely outside the box (a few metres past the east edge into Tseung Kwan O, or past the north or west edge). The envelope count includes them; the tile query does not. A full building extract is about 81 MB. Those files are gitignored.

## LandsD via CSDI

Prefer the open FeatureServer paths. Attribution on every extract: **Lands Department via CSDI Portal / DATA.GOV.HK**. hkgeotiles is not a dependency.

| Layer | Service id | Where | Output |
|---|---|---|---|
| Building | `landsd_rcd_1637211194312_35158` | `Status='Active'` | `tools/data/hk/landsd-buildings.geojson` |
| Road Centreline | `landsd_rcd_1637310758814_80061` | `1=1` | `tools/data/hk/landsd-roads.geojson` |

```
https://portal.csdi.gov.hk/server/rest/services/common/<id>/FeatureServer/0/query?f=geojson&returnGeometry=true&outFields=*&outSR=4326
```

Building heights are metres on Hong Kong Principal Datum. Cut 3 extrudes `TopHeight - BaseHeight`. Some Active footprints leave those fields null; the footprint stays a lot and extrusion skips it. The road layer is an annotation-grade centreline, the LandsD stand-in for CSCL geometry and names. The layer probed on 2026-10-24 advertises `maxRecordCount` 3000 and supports `resultOffset`. The fetcher uses that page size, never asks for more than 10,000 rows, tiles the bbox into cells of at most 0.04°, and splits a cell that would need a deep offset. Features that cross a tile edge are deduped by `featureKey` in `tools/fetch-landsd.mjs`: GeoJSON `feature.id` when CSDI sets it (that id is the OBJECTID), otherwise `properties.OBJECTID` (`objectid` / `ObjectId`). Features with neither key are kept.

### How to fetch

```bash
# Committed fixture: a few buildings and centreline parts around Statue Square
node tools/fetch-landsd.mjs --sample

# Full Island + Kowloon extract, plus OSM fill. Writes tools/data/hk/ (gitignored).
bash tools/fetch-hk.sh

# Either source on its own
bash tools/fetch-hk.sh --landsd-only
bash tools/fetch-hk.sh --osm-only
```

`--layer buildings|roads`, `--bbox south,west,north,east`, `--page-size`, and `--out` are passed through `fetch-landsd.mjs` (`--help`).

The committed samples live in `tools/data/hk/samples/` (`statue-square-buildings.geojson`, `statue-square-roads.geojson`, and `statue-square-highways.json` for the street-graph smoke test). Refresh the LandsD files with `--sample`. Do not commit `landsd-*.geojson` or `osm_*.json` from a full run.

## Street graph (Cut 2)

`GEO_CITY=hk` makes `tools/geo-streets.mjs` call `tools/geo-hk-streets.mjs`. The Manhattan numbered-street and avenue lists stay on the NYC path. Hong Kong `STREETS` and `AVENUES` are empty.

Same roles as the NYC pipeline. Only the government centreline changes:

| Role | New York | Hong Kong |
|---|---|---|
| Street centreline geometry and names | CSCL | LandsD Road Centreline |
| Class, lanes, width, oneway, and roads the centreline misses | (CSCL carries width and lanes) | OSM highways (`q_hk_highways.overpassql`) |
| Coast, water, parks, landmarks, piers | OSM `q_*` | OSM `q_hk_*` (unchanged roles) |
| Blocks and building heights | Centreline curb islands | LandsD Building, `TopHeight - BaseHeight`. OSM buildings are gap fill only. |

LandsD `STREETTYPE` values on the layer are Main Road, Secondary Road, Highway, Tunnel, Restricted Road, and Track. Track is not a carriageway and is left out. The other five become world-frame pieces (`x` east, `z` south, metres). At-grade pieces also become graph links. A link is `[node a, node b, name index, width m, lanes, direction, inner x/z…]`, the same tuple as `buildRoadGraph()` in `tools/geo-roadgraph.mjs`. Direction is `1` along the digitised line, `-1` against it, `0` both ways. LandsD has no travel direction, so oneway comes from a matched OSM way; otherwise the link is both ways.

There is no measured width on the centreline. A matched OSM `width` wins, then OSM `lanes` × 3.3 m, then a class width (motorway 14, trunk 12, primary / Main Road 11, secondary 8.5, residential 6.5, service / Restricted Road 4.5). Highway and motorway/trunk links use roadway code `2`. Tunnels use level `tunnel` and code `3`. OSM `bridge` lifts the level to `elevated`. `*_link` is a ramp.

The road graph keeps the same 7-tuple as `buildRoadGraph()` in `tools/geo-roadgraph.mjs`: `[node a, node b, name index, width m, lanes, direction, inner x/z…]`. It does not grow a `level` or `rw` field. Non-at-grade parts are omitted from the graph the way NYC omits a centreline whose `from_level_code` / `to_level_code` is not `13`. A LandsD or OSM part whose level is `tunnel`, `elevated`, or `ramp` stays on `pieces` (so a later cut can still see it) and is counted as `omittedNonAtGrade`. At-grade `Highway` / motorway parts stay in the graph: in this layer that class is a surface road, not the NYC `rw_type` 2 viaduct filter. Level `13` is the shared at-grade code (`isAtGradeLevel` in `tools/geo-hk-streets.mjs`).

Matching is 12 m and about 25° of bearing. When a service road and a main road both lie on the same centreline, the higher OSM class is the one copied onto it. An OSM way that is not already on the centreline is appended as gap links (runs of at least 18 m). Its ends snap to an existing node within 12 m. LandsD ends snap within 1.5 m. Footways, paths, and service driveways are not part of the graph. The Manhattan module is not imported, so Broadway, numbered avenues, and the 14th Street cutoff are not applied.

Without `tools/data/hk/landsd-roads.geojson`, the stage uses the committed Statue Square centreline and `statue-square-highways.json`. A full centreline does not fall back to that small highway fixture. Missing OSM keeps the LandsD geometry and uses `STREETTYPE` for class.

```bash
# Statue Square sample: LandsD centreline + OSM highway fixture
# (only when tools/data/hk/landsd-roads.geojson is absent)
GEO_CITY=hk node tools/geo-streets.mjs

# Streets, blocks, and harbour. Writes js/hk-geodata.js. Does not write a second city module.
GEO_CITY=hk node --max-old-space-size=8192 tools/build-geodata.mjs
```

## OSM fill

OpenStreetMap keeps the roles it has on the NYC path: coast, water, parks, landmarks, and piers. Highways are additional, and they feed the street graph above. They do not replace the centreline. Queries, same bbox:

- `tools/data/q_hk_coast.overpassql` — coastline, water, riverbank, harbour
- `tools/data/q_hk_parks.overpassql` — parks, gardens, nature reserves, protected areas
- `tools/data/q_hk_landmarks.overpassql` — named landmark footprints
- `tools/data/q_hk_piers.overpassql` — piers and ferry terminals
- `tools/data/q_hk_highways.overpassql` — drivable highways for class, lanes, width, oneway, and gaps

`tools/fetch-hk.sh` runs these through `tools/overpass.sh` into `tools/data/hk/osm_*.json` (`osm_highways.json` for the highway query). The NYC queries `q_coast`, `q_cp`, `q_landmarks`, and `q_piers` are unchanged.

## What the NYC boot path still needs

Leave `GEO_CITY` unset (or set `nyc`) and keep these files in `tools/data/`:

- `cscl_manhattan.json` — NYC street centreline (CSCL), `inkn-q76z`
- `dcp_boroughs.json` — DCP borough boundaries, `gthc-hcne`
- `nycparks_manhattan.json` — NYC Parks properties, `enfh-gkve`
- `osm_centralpark.json`, `osm_piers.json`, `osm_coastline.json`, `osm_landmarks.json` — from the NYC Overpass queries

Rebuild, without touching the Hong Kong fetch:

```bash
node --max-old-space-size=8192 tools/build-geodata.mjs
```

That rewrites `js/nyc-geodata.js`. Leave `GEO_CITY` unset. The Hong Kong street and block stages do not write that file.

## Blocks (Cut 3)

`GEO_CITY=hk` makes `tools/geo-blocks.mjs` call `tools/geo-hk-blocks.mjs`. The Manhattan raster (Broadway plazas, Central Park drives, FDR / Route 9A, the sidewalk erosion, `CUT_Z = -7090`) runs only for New York.

Hong Kong blocks are building footprints, not street-bounded curb islands. Each Active LandsD polygon is one block and one lot:

- `poly` is the outer ring in the world frame (x east, z south, metres). Holes are kept on `holes`.
- `height` is `TopHeight - BaseHeight` in metres, rounded to 0.1. `base` is `BaseHeight` on Hong Kong Principal Datum. A null or non-positive pair sets `height` to null: the lot remains, and nothing is extruded.
- A footprint already aligned with the axes and close to rectangular gets one axis-aligned `rects` entry. A rotated rectangle gets one frontage `frames` entry, the same `[θ, px, pz, rects]` shape as an irregular Manhattan block (`world = p + R_y(θ)·(local − p)`). A footprint the rectangle would badly overfill (an L, a court) keeps `poly` and no lot rect.
- Area under 40 m² is a speck and is dropped, same floor as the Manhattan islands. `park` stays 0. There is no park-name or highway-name pass.

OSM buildings are gap fill only. If `tools/data/hk/osm_buildings.json` or `GEO_HK_OSM_BUILDINGS` is present (Overpass JSON or GeoJSON), a building whose interior point misses every LandsD ring is appended. `height` or `building:levels` × 3.2 m supplies the extrusion when the tag exists; otherwise the gap lot is not extruded. The default fetch does not download this file. LandsD is the building layer. A full extract is `landsd-buildings.geojson` (gitignored); without it the stage uses `samples/statue-square-buildings.geojson`.

`CUT_Z` is not Manhattan's −7090 (129th Street). That line would push the north of Kowloon out of the detailed set. Hong Kong `CUT_Z` is 200 m north of the v1 northern edge, so Hong Kong Island and Kowloon up to the Lion Rock / Kowloon Peak line stay detailed (`z > CUT_Z`). Footprints north of that line, still inside the east-west span, are `lowDetail`: outlines with no lots and no extrusion. The committed sample sits on the origin and produces no carpet. Victoria Harbour, piers, and the Kowloon shore are Cut 4 (`tools/geo-hk-extra.mjs`), not this block stage. Blocks do not need a land mask because they come from footprints.

```bash
# Statue Square sample: streets, then seven extruded footprints. Exit 0.
GEO_CITY=hk node tools/build-geodata.mjs

# Block list alone (Prince's Building 80.4 m, HSBC Main Building 177.2 m).
GEO_CITY=hk node tools/geo-blocks.mjs

# Full extracts (gitignored) once landsd-buildings.geojson is present.
# Optional: tools/data/hk/osm_buildings.json for gap fill.
GEO_CITY=hk node tools/build-geodata.mjs
```

## Harbour and the module (Cut 4)

OSM keeps the water and coast role. LandsD stays Building and Road Centreline. iB1000 hydro is later; harbour v1 is OSM.

`tools/data/q_hk_coast.overpassql` fetches coastline and water ways, plus relations (`natural=water`, `natural=coastline`, `harbour=yes`, `waterway=riverbank`) so the Victoria Harbour multipolygon is included. Piers stay on `q_hk_piers.overpassql`. A full fetch writes gitignored `tools/data/hk/osm_coast.json` and `osm_piers.json`. Without those files the build uses the committed samples `tools/data/hk/samples/harbour-coast.json` and `harbour-piers.json`. `GEO_HK_COAST` and `GEO_HK_PIERS` override both. Those samples are already a full-bbox coast and pier fixture: the full OSM coast reproduces the same Island, Kowloon, harbour, and pier rings. Parks stay empty unless `osm_parks.json` is present. The committed module is the full extract in the next section, not the seven-block sample. A fresh clone does not contain the gitignored extracts, so rebuilding without fetching shrinks the module back to the sample.

`tools/geo-hk-extra.mjs` rasterises the v1 bbox (about 16 m). Coastline is a barrier. The bbox border is sealed. Flooding starts at the harbour seed (114.1735, 22.2915). Land is the unflooded empty cells, not the barrier cells, so the border does not stitch Hong Kong Island to Kowloon. The component that contains Central is `GEO.hongKongIsland`. The component that contains Tsim Sha Tsui is `GEO.kowloon`. Those rings are not stored as `manhattan` or `boroughs.newJersey`. Harbour water is the flooded component of the seed that lies within 1700 m of both shores. Named OSM water rings are appended when they do not contain Central or Tsim Sha Tsui. Piers are oriented boxes, 80–250000 m², within 90 m of either shore.

Empty `streets`, `avenues`, `broadway`, `bridges`, and `landmarks`. `centralPark.bounds` is null. `frame.city` is `'hk'` (the NYC file leaves `city` unset). Hong Kong Island is `hongKongIsland`. Kowloon is `kowloon`. Block tuples keep the NYC shape and then append `[height, base, name]`.

```bash
# Writes js/hk-geodata.js. Without the gitignored extracts this is the seven-block sample.
# With landsd-*.geojson and osm_*.json present it rewrites the full module. Do not commit the sample over it.
# tests/hk-geo.test.mjs rejects that file: blocks.length > 10000, size > 5 MB, roads and graph nodes above the sample.
GEO_CITY=hk node tools/build-geodata.mjs

# Harbour stage alone (same coast resolution as the build).
node tools/geo-hk-extra.mjs

node --test tests/hk-harbour.test.mjs tests/hk-geo.test.mjs tests/hk-blocks.test.mjs tests/hk-streets.test.mjs
```

The full extract and the sample coast report the same shores: Victoria Harbour 13.33 km² between Island 71.51 km² and Kowloon 78.30 km², with 49 piers. Central is the origin. Tsim Sha Tsui is about (988, −1447). Admiralty is about (499, 169), on the island.

### Boot

`js/geo-source.js` always exports the Hong Kong module. `resolveRuntimeCity` returns `'hk'`. A `?city=` query and `GEO_CITY` do not switch the page. Node tool runs still accept `hk`, `hongkong`, and `hong-kong` for `GEO_CITY` when rebuilding data. The map paints `GEO.harbour.rings` in the pond colour before the land fill, so the shores cover overlap. The existing water plane stays. `buildLandmarks` calls `buildHkLandmarks`. Named Central places sit on their LandsD footprints or the Central Star Ferry pier. Victoria Peak and the Tsim Sha Tsui clock stay unbuilt. `buildCityBlocks` extrudes the Central core only (below), except the Bank of China Tower shaft. That shaft stays the triangular mesh on the LandsD footprint, skinned with the same shopfront and curtain materials as the other extrudes. An individualised glTF that covers the plate replaces the prism; the square extrude is not drawn either way.

### Central core buildings

The visible massing is the Central CBD, not the full Island + Kowloon extract. `HK_CORE_BBOX` in `js/city-config.js` is WGS84 south / west / north / east:

```
22.276, 114.150, 22.288, 114.170
```

A block is inside when its centroid lies in that box in the world frame (the same local ENU as `tools/geo-frame.mjs`). On the committed module that is 2,021 footprints. 1,943 have a positive `TopHeight - BaseHeight` and are extruded from `poly` with `ExtrudeGeometry` (the same outline path as `createExtrudedPolygonMesh`). 78 have a null height and are skipped (`HK_NULL_HEIGHT = 'skip'`): no stand-in slab and no invented storeys. The other 51,092 footprints are not built. The axis-aligned box stored on an empty `rects` list is not the mesh. Committed tuples do not carry courtyard holes, so a court extrudes as its outer ring.

`index.html` preloads `js/hk-geodata.js`, then `js/geo-source.js`, then `js/city-config.js`, and the rest of the module graph (33 preloads, including `js/hk-gltf-frame.js` and `js/hk-gltf.js`). The atlas module is `js/hk-map.js`. `js/traffic.js` statically imports `js/pedestrian-routes.js`, so that file is preloaded too. The previous 29-count check stopped on the missing `geo-source.js` link and never reached it.

### Shore helper

`getIslandBoundsAtZ(z)` is Hong Kong Island’s outermost west/east crossing, clamped at the island’s ends. `getIslandBoundsAtZ(z, x)` returns Kowloon’s crossing when `x` lies in that span and not the island’s, or when `z` is north of the island and still on Kowloon. Tsim Sha Tsui (about z = −1447) is north of the island’s northernmost point (z = −1392), so the one-argument helper would clamp it onto the island.

`ISLAND_BOUNDS` and `PLAY_BOUNDS` are the same box: Hong Kong Island, Kowloon, and the Victoria Harbour rings. The island ring alone is not the water or player box. The water material does not paint an extra skyline on top of the harbour.

## Full extract (committed module)

Fetched 2026-10-24 with `bash tools/fetch-hk.sh` on the v1 bbox. Raw GeoJSON stays gitignored. `js/hk-geodata.js` is the playable module, committed as plain JavaScript. It is about 14.4 MiB. That is under GitHub's 50 MB warning, so this file does not use Git LFS. Do not commit the raw extracts: buildings are 81 MB and highways are 30 MB.

| Source | File | What came back | Size |
|---|---|---|---|
| LandsD Building | `landsd-buildings.geojson` | 70,183 features | 81 MB |
| LandsD Road Centreline | `landsd-roads.geojson` | 15,222 features | 11 MB |
| OSM coast | `osm_coast.json` | 634 ways, 28 relations | 2.3 MB |
| OSM parks | `osm_parks.json` | 1,035 ways, 60 relations | 1.8 MB |
| OSM landmarks | `osm_landmarks.json` | 1 way (name whitelist) | 3.6 KB |
| OSM piers | `osm_piers.json` | 241 ways, 7 relations | 231 KB |
| OSM highways | `osm_highways.json` | 33,903 ways | 30 MB |

The module, compared with the Statue Square sample (7 blocks, 5 road polylines, 5 graph links, no parks):

- Blocks: **53,113** footprints, **49,030** extruded (`TopHeight - BaseHeight`), **4,083** kept with no height, **17,087** specks dropped, **0** OSM building gaps, carpet **0**. `osm_buildings.json` is not part of `fetch-hk.sh`.
- Roads: **11,692** polylines. Graph **16,084** nodes / **16,383** links / **2,298** names. **148,839** centreline pieces, **1,923** non-at-grade omitted, **392** non-carriageway skipped. OSM: **32,214** drivable ways after the graph filter, **13,308** centreline parts tagged, **3,652** gap links.
- Shores: identical to the sample module. Harbour **13.33 km²**, Island **71.51 km²**, Kowloon **78.30 km²**, **49** piers, **4** harbour rings. Parks: **680** (the sample had none).
- `landmarks` is `{}`. The landmark query is a name whitelist and returned one way; it is not copied onto the module. Named places are placed in `js/landmarks.js` from LandsD block names and `GEO.piers`, not from this empty object.
- Central is inside Hong Kong Island. Admiralty is inside the island. Tsim Sha Tsui is inside Kowloon and not the island, north of the island's northernmost point (z = −1392). The harbour seed (114.1735, 22.2915) is inside the harbour ring and outside both shores, so the water stays between them. `ISLAND_BOUNDS` and `PLAY_BOUNDS` include both shores and the harbour rings.

```bash
# Refresh the gitignored extracts, then rewrite the committed module.
bash tools/fetch-hk.sh
GEO_CITY=hk node --max-old-space-size=8192 tools/build-geodata.mjs
```

`fetch-hk.sh` runs LandsD (buildings and roads, default bbox) and then the five `q_hk_*.overpassql` queries through `tools/overpass.sh`. `--landsd-only` and `--osm-only` split that. `--sample` only refreshes the Statue Square LandsD fixture and skips Overpass.

## Where you stand

Walk, car, bike, and helicopter spawn at Central (the `central` teleport). The menu is 中環、尖沙咀、金鐘:

| Button | Place | Lon, lat | Heading |
|---|---|---|---|
| 中環 | 皇后像廣場 | 114.15979, 22.28088 | π, face north toward the harbour |
| 尖沙咀 | 鐘樓 | 114.16938, 22.29395 | 0, face south toward the island |
| 金鐘 | 金鐘站 | 114.16463, 22.27935 | π, face north |
