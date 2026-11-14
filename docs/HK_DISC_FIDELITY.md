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

## Deferred

- **LandsD photographs near the eye.** The photogrammetry is the data: the HSBC podium and glass are low-poly planes and blank panels. No chart reassignment fixes that. Better meshes need a better source.
- **The mid-field procedural boxes** past 80 m (white and light-blue banded towers, black glass with an enamel belt) are outside the fence and out of scope.
- **Shaded ground still reads cool.** The golden-hour ambient is blue; paving in shadow is blue-grey. That is the lighting rig, not a material.
- **Street life.** 0 benches and 0 lamps are mapped inside 80 m. OSM has none there; none were invented.
- **Fallback facade is still not geo-accurate.** It is a stand-in for the `hk-3d/` absence, not a release facade. Release needs the LandsD sheets served with the build.
- Bank of China Tower chart (11-SW-14A, scenery outside the fence), the cap-200 fill, Soft MSI, Soft-grain, aerial tiles and PlanD stay as they were.

## How to MSI

1. `node tools/fetch-central-gltf-sheet.mjs --street` (11-SW-9C and 11-SW-8D are enough for the disc).
2. Serve the repo and open `index.html?at=-1.4,29.3,1.29&confine=on`.
3. Walk to the fence; the ring is a thin red line. Look at the ground between the OSM pavement and the walls (it is paved, not teal) and at the plaza under HSBC.
4. Without `hk-3d/` (or `?gltf=11-SW-9A`) the fallback walls should show crisp openings and a stone band, not a smear and orange.
5. Headless review on a CPU-only box: `node tools/digit1-disc-shots.mjs artifacts/disc --query 'at=-1.4,29.3,1.29&confine=on&gltfCap=10&debug=scene' --hide-hud --shots 'east:0:0,south:-720:0'`. `gltfCap=10` keeps the 7 gate meshes and stays inside what SwiftShader can hold; the default cap of 200 loses the device there. That run is not Keith's MSI and does not claim a Soft pass.
