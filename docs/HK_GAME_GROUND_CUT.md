# Digit1 ground — game deck

Cut #47. Plan: [plans/cut47-sd-digit1-game-ground.md](../plans/cut47-sd-digit1-game-ground.md).

At `?at=-1.4,29.3,1.29` the carriageway is the game deck again: the LandsD / OSM road ribbons, the granite kerb, the sidewalk flags, the lane paint, and the mapped OSM pavement, crossings and bus stops. The Open3DHK aerial tiles of Cuts #41 to #46 are not mounted by default. Keith rejected that look ("alien world") on 2026-11-03, and the method is abandoned for the Digit1 eye. See [HK_GROUND_TILES_CUT.md](HK_GROUND_TILES_CUT.md) for what was tried and why it stops.

Soft is not SD. SD NOT YET. This cut does not claim Sleeping Dogs and does not claim photo ownership of the street.

## What changed

### Tiles are opt-in

`mountHkGroundTiles` ran on every page load and punched the deck inside a 42 m disc once a photographed tile sampled the eye (69 instances yielded at the eye in the #46 frame). The gate was `?groundTiles=off`. It is inverted:

| URL | Ground |
| --- | --- |
| no `groundTiles` (default) | game deck. No tileset request, no `HkGroundTiles` group, nothing punched |
| `?groundTiles=on` (also `1`, `true`) | the #41 to #46 mount, unchanged, for far or debug views |
| `?groundTiles=off`, `0`, anything else | game deck |

`resolveGroundTilesRequest` in `js/hk-ground-tiles-frame.js` is the one place that decides. `punchDeck` is only reached after it, so with the default URL `HkRoadCentrelines`, `HkSidewalks`, `HkCurbs`, `HkLaneMarkingsWhite`, `HkLaneMarkingsYellow` and `HkOsmPavement` keep every instance. The #45 / #46 URL switches (`groundPhoto`, `groundSharpen`, `groundRadius`, `groundPriority`, `groundTint`) only matter under `?groundTiles=on`. Nothing in them was changed or tuned in this cut.

`tools/digit1-ground-mount.html` and `tools/digit1-ground-seams.html` add `groundTiles=on` themselves. `tools/digit1-eye-shot.mjs` no longer demands a tile mount unless the query asks for one, and it refuses a frame where tiles mounted without the opt-in.

### Material read

All three are TSL, with no texture bytes added. Fab, Megascans and Mapillary assets are not in the repo, so nothing here is a photo of Des Voeux.

- `createRoadSurfaceMaterial`: a binder-and-chip aggregate (`stoneChips`, 24 mm and 10.5 mm grids) in the colour and in the bump, faded by pixel footprint so it settles to the mean tone at range. Albedo is lifted from `0x2b2e33 / 0x464a51` (read as black in the canyon) to `0x4a4a4b / 0x747271`, and the canyon AO is relaxed 40% toward open on the carriageway only. The puddle field, damp stains, wet film, Fresnel metalness and the neon / sky emissive are untouched, so wetness still follows `uRoadWetness`.
- `createCurbMaterial`: paler granite with per-stone tone, quartz and mica speckle and pitting, a lit arris along the top edge, a darker road face with gutter dirt at its foot, and a 11 mm joint every 0.9 m. The 0.2 m upstand, the 0.9 m stone length and the wet darkening are as before.
- `createSidewalkMaterial`: faint stone chips in the flags. Joints, flag tone, drainage and puddle handling are as before.

The #41 deletion of the ConEd / NYC lids stays.

### Mapped street life

`city-grid.js` already built, from `hk-pedestrian-data.js` and the LandsD centreline, the pavement, zebra crossings (`HkCrossings`), bus stop poles, shelters and name plates (`HkBusStopSign`), benches and lamps. At the eye they were hidden whenever the tiles mounted. Un-punching the disc is the change. Counts inside the 42 m disc at the eye, from the plan (`digit1StreetLife`):

| Layer | Count |
| --- | --- |
| deck sidewalks / curbs / paint | 4 / 3 / 18 |
| OSM walks / crossings / bus stops | 42 / 17 / 4 |
| benches / lamps | 0 / 0 |

OSM maps no bench or lamp in that disc, so none is drawn. No prop was invented.

## Bar: `digit1GameGround`

`js/hk-game-ground-frame.js`. It is a Keith-eye direction bar, not a ground-ownership floor. PASS needs all of:

1. the capture is live and not synthetic, and the AFTER frame is not blank
2. the first mesh a down-ray meets at the eye (`ahead-0`) is deck or osm, and no probe ray (4, 8 and 16 m ahead, 3, 5 and 7 m to the right) meets a tile
3. no `HkGroundTile` mesh is in the AFTER scene (`tilesMounted === false`)
4. the mapped street life is readable in the disc: asphalt, sidewalks, kerb, paint, OSM walks, and crossings or bus stops
5. `road-ahead`, `right-kerb` and `underfoot` crops each differ from BEFORE by MAD >= 6

BEFORE is the #46 tip `03d4ab0` (tiles by default). AFTER is this page. `js/hk-game-ground.js` casts the rays on the page and publishes `window.__digit1GameGround`; `tools/digit1-eye-shot.mjs --owner-json` saves it and `tools/digit1-game-ground.mjs before.png after.png owner.json` scores the pair.

```text
node tools/digit1-eye-shot.mjs /tmp/before.png --root /path/to/03d4ab0 --hide-hud
node tools/digit1-eye-shot.mjs /tmp/after.png --hide-hud --owner-json /tmp/owner.json
node tools/digit1-game-ground.mjs /tmp/before.png /tmp/after.png /tmp/owner.json
```

Headless Chrome / SwiftShader, 1280 x 633 crop fractions of `DIGIT1_GROUND_CROPS`, `?at=-1.4,29.3,1.29`. The repo has no `hk-3d/` manifests, so the individualised charts and the PlanD corridor are absent on both sides; the A-B is the ground only. This is not Keith's MSI. The pair is [artifacts/digit1-game-ground-ab.png](../artifacts/digit1-game-ground-ab.png) and the first-hit rays are [artifacts/digit1-game-ground-owner.json](../artifacts/digit1-game-ground-owner.json).

| Crop | MAD vs #46 tiles |
| --- | --- |
| road-ahead | 58.04 |
| right-kerb | 41.45 |
| underfoot | 12.44 |

First-hit rays at the eye: `HkLaneMarkingsWhite` (eye), `HkRoadCentrelines` (4 and 16 m ahead), `HkLaneMarkingsWhite` (8 m ahead, 3 m right), `HkSidewalks` (5 m right). No tile. Result: `digit1GameGround PASS live-game-ground`. The BEFORE frame mounted 51 tiles and yielded 69 deck instances; the AFTER frame mounted none. The MSI call stays with the live pair on that machine, and a Soft PASS is not the Keith eye.

## Not done, on purpose

- No polish of the aerial tiles (ownership, grain, seams, sharpen, LOD).
- Soft-grain far (#43 / #44) is not reopened. Far NDC is not touched.
- No Soft paint, no Mapillary bake, no Megascans or Fab bridge.
- No phone grit presented as a photo of the street.
- No Sleeping Dogs claim, no UE5.

## Residual

- The lighting at the eye is the existing golden-hour canyon: the road and kerb are in sky-lit shade and read blue-grey. Aggregate chips are visible underfoot and a few metres ahead; further out the asphalt is a mean tone with the existing mottling and wet film.
- A procedural deck is a game street. The aerial tiles were a photograph of the wrong thing; this is not a photograph of the right one. Real Des Voeux asphalt, kerb paint and tram paint need a capture this cut did not wait for.
- `?groundTiles=on` still depends on the CSDI example key and the `f2` tileset staying up.
