# Cut #48 — Digit1 asphalt and kerb read

**Repo:** keithligh/slop-hongkong
**Base tip:** `e032ce9` (main after Cut #47, game deck by default)
**Source:** Keith via Holiday, 2026-11-03. The road is a total disaster: alien ground, not a street you can walk. Soft Soft-grain far stays STOPPED. Do not claim a Soft pass.

## Diagnosis

The default Digit1 eye (`?at=-1.4,29.3,1.29`) is the LandsD centreline deck and the OSM pavement. Aerial `f2` tiles are opt-in (`?groundTiles=on`) and are the melted photograph from Cuts #41–#46. They are not what the default page draws.

What the default page drew was still unusable. Headless crops, navy = `B > R + 12` and luma < 50:

| Crop | Luma | Navy |
| --- | --- | --- |
| underfoot | 29.6 | 99% |
| right-kerb | 42.0 | 87% |

Crevice AO treated the kerb and the sidewalk as a wall base. Neutral charcoal times the blue sky light, 5 m pour noise, and a wet-film Fresnel made the carriageway a wavy navy void. The ribbons themselves were already under the eye (`HkRoadCentrelines`, `HkCurbs`, `HkSidewalks`).

## Fix

Matte warm asphalt, AO opened on the road, kerb and sidewalk, pale granite, lane paint that mirrors only in a puddle. No new images. No tile mount. No invented grit. No Soft-grain far.

After the same crops: underfoot navy 0% (luma 61.5), right-kerb navy 0% (luma 85), stone brighter than the asphalt on the kerb midline. Soft is not SD. SD NOT YET.
