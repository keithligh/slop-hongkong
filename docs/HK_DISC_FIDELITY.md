# Digit1 disc fidelity (inside the 50 m walk fence)

Scope is the walk disc: `HK_STREET_EYE` = (-1.4, 29.3), `HK_WALK_RADIUS` = 50 m. Nothing here moves the fence, the 80 m overlay gate (`HK_STREET_NEAR`), PlanD (default off), the aerial ground tiles (opt-in) or Soft-grain. Soft is not SD. SD NOT YET.

## What the disc is made of

`node tools/digit1-disc-inventory.mjs` reads the real `hk-3d/` manifests and runs the same planners as the page (`planGltfManifest` at cap 200, `hiddenExtrudeIds`, `clipCanyonWalls`).

| Layer | Within 50 m | Within 80 m |
| --- | --- | --- |
| LandsD BUILDING meshes | 4: HSBC `B344751569101063A0` (8D, contains the eye), Bank of China Building `B345471572201063A0` (9C, 25 m), Legislative Council `B345831577701063A0` (9C, 31 m), `B344201582001063A0` (8D, 38 m, 95 m tall) | 7 (adds `B344861581201063A0` 5 m kiosk, `B344281572002063A0`, `B344201571001063A0` 172 m) |
| Procedural extrudes | 0 survive | 7 planned, 7 hidden, 0 survive |
| Canyon ribbons (street walls) | 0 | 0 (12 within 110 m) |
| Deck (asphalt, kerb, lane paint) | 4 asphalt, 7 kerb, 23 markings | 7 / 13 / 39 |
| OSM life | 62 pavement ribbons, 18 crossings, 4 bus stops, 0 benches, 0 lamps | 120 / 24 / 6 / 0 / 0 |

With the sheets present the procedural walls are already gone from the disc. The white-orange banded boxes in the before shots are not LandsD charts and not an overlap: they are the extrude and canyon fallback (`hkRetailPodium`, `hkPodiumMasonry`) that draws when `hk-3d/` is absent or its manifests do not load. The before pair is pixel-for-pixel that fallback ([artifacts/disc-fidelity/nolandsd-before.png](../artifacts/disc-fidelity/nolandsd-before.png)). `hk-3d/` is gitignored, so a checkout, a CI render and a deploy without it shows that fallback.

## What was wrong

1. **The ground between the walls was the coast plate, olive `0x6a7264`, which reads teal under the sky.** With LandsD present and the canyon ribbons cut from the disc, the plate is the only surface between the OSM pavement, the kerb ribbons and the LandsD walls: Statue Square, the bank plaza under HSBC, the lots behind the kerb. Hiding it left a dark void, hiding the roads left a teal field under the lane paint. Before and after: [before-east](../artifacts/disc-fidelity/before-east.png) / [after-east](../artifacts/disc-fidelity/after-east.png), [before-south](../artifacts/disc-fidelity/before-south.png) / [after-south](../artifacts/disc-fidelity/after-south.png), [before-north](../artifacts/disc-fidelity/before-north.png) / [after-north](../artifacts/disc-fidelity/after-north.png).
2. **Fallback podium windows were 0.35 m soft smoothstep ramps**, so every punched opening read as a grey smear at kerb distance. Fallback bands were saturated orange (tile fascia and coping) with bright red and green signs.
3. **`?confine=on` threw on every frame.** The debug ring was a `THREE.LineLoop`, which WebGPURenderer rejects ("Objects of type THREE.LineLoop are not supported"). The MSI URL is `?confine=on`.

## What changed

- `createCoastLandMaterial` (`js/tsl-materials.js`) makes the coast plate itself the sidewalk granite on world metres (paving, joints, grit, AO, wet field) inside `digit1PlazaDisc()` (full strength to 80 m, fading to olive by 110 m), so there is no rim. It is the plate and not a second mesh. A first attempt put a plaza mesh 4 mm above the plate; it lost the depth test to the plate's own polygon offset inside about 20 m of the camera, so the near field stayed teal and only the far field paved. Swapping the material avoids the fight.
- `podiumStreetColor` openings use `filteredPulse` edges, a mullion and transom, a sill band, per-bay ashlar tone, and a sky gradient in the glass.
- `hk-shopfront.js` tile fascia and coping are muted stone; sign bands are darker red and green. Still under the pale gate and the mouth stays darker than the pier.
- `js/main.js`: the confine debug ring is a closed `THREE.Line`. `?debug=scene` exposes `window.__hkScene` for the review tools.
- `tools/digit1-disc-shots.mjs`: one boot, several camera orbits, optional mesh hides, `--eval`. `tools/digit1-disc-inventory.mjs`: the table above.

## Texture fidelity inside the fence

The mounted sheets are real facade photographs. Two faults were in how those photographs were addressed.

- **The banded towers were invented boxes on open ground, not missing buildings.** From the stop at (46.673, 41.099), heading 1.29, the right bands are `digit1-midband-right` (about 54 m, NDC x ≈ 0.46) and the left-centre bands are `digit1-midband-left` (about 102 m, NDC x ≈ −0.25). Their world positions are the Chater Garden bus stop on Des Voeux (22.28018 N, 114.16062 E, HK1980 about 834594 E, 815701 N) and Queensway (22.28048 N, 114.16120 E). LandsD building polygons return nothing on either envelope. All 73 BUILDING glTF on 11-SW-9C miss them by more than 8 m, and all 781 on 11-SW-8D miss them by more than 40 m. The sheet edge with 8D is easting 834500.6; both plates are east of it, inside 9C. glTF placement of the real neighbours matches the LandsD footprints within about 5 m, so this is not a shifted coordinate. Those neighbours stay in the cap of 200: Bank of China Building `B345471572201063A0` (about 30 m from the right plate), Cheung Kong Center `B345831563001063A0`, the Court of Final Appeal `B345831577701063A0`, The Henderson `B347491569901063A0`, Lippo Centre `B348641561601063A0`, and HSBC `B344751569101063A0`. The enamel boxes are not mounted. Nothing is painted into the road or the garden.
- **Scrambled pavement.** The same HSBC mesh has about 21 000 up-facing triangles within a few metres of the sidewalk. Each one addresses a different scrap (UV span about 0.007). They sit on the walks and the plaza; the Des Voeux carriageway beside the eye is not one of them. Inside the 80 m disc those triangles leave the photograph and use `hkStreetDeck`, the same world-metre flags as the sidewalk. The carriageway stays the game deck. Roofs and walls stay photographs. The Bank of China Tower is outside that disc, so its base is unchanged.
- **The low red/green/brown block beside the yellow 中銀大廈 sign is an unbacked canyon ribbon, not a building.** `frontage` used to emit `HkCentralStreetWalls` with `hkRetailPodium` (sign red and green, tile brown) even when the lot side had no LandsD footprint. That ribbon sits just east of the Bank of China Tower box, about (236, 176), depth 12 m, beside the yellow `HkBusStopSign`. It is omitted. A side that meets a real footprint still closes onto that footprint. The tower photograph on 11-SW-14A is untouched.
- **The former Legislative Council is a hollow colonnade in the source, and the ceiling was then deleted.** `B345831577701063A0` keeps its columns, arches, dome and roof photographs. About 2 900 downward soffit triangles sit on the null-grey chart; null-fill was dropping them, which opens the portico ceiling. Those faces are pointed at a masonry texel from the same mesh and kept. The loose-strip drop (about 1 100 triangles, mostly the thin wall edge) is not applied to this mesh. Behind the arcade the file has no core: a horizontal ray leaves the colonnade and travels 30 m or more before the far screen. A wall is built on that inner edge, so an arch stays open and the sightline meets the core. The arch plane itself is not filled.
- **HSBC loose strips are dropped. Columns stay on their own photograph.** On `B344751569101063A0`, a triangle whose UV is a sliver (long side at least 0.08, short side under 0.012) and whose world cross-section is under 0.55 m is a broken ribbon, including the bars that sat between the columns after a neighbouring chart was stretched onto the sliver. Those triangles are removed. A face with a real cross-section keeps the UVs in the file, so a white column that is actually white stays white. Nothing is stamped from an unrelated atlas rectangle.

## Deferred

- **LandsD photographs near the eye.** A substantial face keeps the UV in the file. A sliver on a thin ribbon is omitted rather than aimed at a neighbouring chart.
- **The mid-field procedural boxes** past 80 m (white and light-blue banded towers, black glass with an enamel belt) are outside the fence and out of scope.
- **Shaded ground still reads cool.** The golden-hour ambient is blue; paving in shadow is blue-grey. That is the lighting rig, not a material.
- **Street life.** 0 benches and 0 lamps are mapped inside 80 m. OSM has none there; none were invented.
- **Fallback facade is still not geo-accurate.** It is a stand-in for the `hk-3d/` absence, not a release facade. Release needs the LandsD sheets served with the build.
- Bank of China Tower chart (11-SW-14A, scenery outside the fence), the cap-200 fill, Soft MSI, Soft-grain, aerial tiles and PlanD stay as they were.

## How to MSI

1. `node tools/fetch-central-gltf-sheet.mjs --street` (11-SW-9C and 11-SW-8D are enough for the disc).
2. Serve the repo and open `index.html?at=-1.4,29.3,1.29&confine=on`.
3. Walk to the fence; the ring is a thin red line. Nearby walls should be facade photographs, not horizontal colour bands. The walks and the plaza should be continuous flags, not a patchwork of atlas scraps. The carriageway stays the asphalt deck. The Bank of China Tower, past the fence, stays its own mesh.
4. Without `hk-3d/` (or `?gltf=11-SW-9A`) the fallback walls should show crisp openings and a stone band, not a smear and orange.
5. Headless review on a CPU-only box: `node tools/digit1-disc-shots.mjs artifacts/disc --query 'at=-1.4,29.3,1.29&confine=on&gltfCap=10&debug=scene' --hide-hud --shots 'east:0:0,south:-720:0'`. `gltfCap=10` keeps the 7 gate meshes and stays inside what SwiftShader can hold; the default cap of 200 loses the device there. That run is not Keith's MSI and does not claim a Soft pass.
