# Central street canyon

Hong Kong streets are canyons. The carriageway, a narrow curb, and a narrow sidewalk meet a podium. There is no spacious verge, no boulevard setback, and no open grass beside the asphalt. The earlier coast plate (olive `0x6a7264`, which reads as teal under the sky) was that verge: Des Voeux ran through empty land because many frontages have no LandsD footprint at the kerb. Recolouring that opening as a concrete plaza would still be an empty American avenue. This cut closes it with building mass.

There is no flag. Boot does not need a fetch. Central only.

## What changed

`js/hk-ground-fill.js` plans one podium per side of each Central centreline. `js/city-grid.js` instances it with the same curtain-wall podium shader as the LandsD extrudes, bottom at y = 0.16, height 18 m. The taxi collides with those boxes, so driving off the carriageway meets a wall.

- **Tagged width stays.** `carriagewayWidth` uses the LandsD/OSM tag when it is at least 3.2 m. A 3 m / 1 lane street is 3.6 m, a 5 m street stays 5 m, a 7 m street stays 7 m. Only a missing or hairline tag gets a class floor, and a highway tag still cannot collapse below 10.5 m. The wall still stands outside `HK_WALK_W` (2.05 m) plus `HK_CURB_W` (0.42 m). The drawn stone is 0.18 m; the section is in [HK_ROADS_CUT.md](HK_ROADS_CUT.md).
- **Footprint within about 18 m of the sidewalk.** The podium depth is that gap, plus a short bite into the footprint so the seam does not show the coast plate. A footprint already on the sidewalk is left alone.
- **No footprint on that side.** A 12 m street wall stands on the outer edge of the sidewalk. From the carriageway the next surface is the wall, not a plaza.
- **Harbour.** A wall is kept only when its centre and its outer face are inside the Hong Kong Island ring. The water side of the shore, and the north edge of the Central box that is already harbour, stay water.
- **Other carriageways.** A wall that would land in a parallel or crossing deck is dropped or shortened, so junctions stay open and two parts of Des Voeux do not grow a building in the asphalt.

The canyon plan still uses that 0.42 m margin. The drawn kerb, sidewalk joints, and OSM seating are in [HK_ROADS_CUT.md](HK_ROADS_CUT.md). The 2D atlas is unchanged. Outside Central there is no street wall.

## How to verify

`node --test tests/*.mjs tests/*.cjs`

On MSI, open the page (no query flag). Chase camera:

- Des Voeux asphalt, about **x = −1.4, z = 29.3**. The lane is still dark asphalt. It is the tagged width (7 m or 10 m on this street), with the white edge line. A narrow sidewalk, then a podium. The point is not inside a wall.
- Just off that carriageway, about **x = −1.4, z = 14** or **x = 8, z = 20**. That is podium, not teal ground and not an open concrete plaza.
- Harbour, about **x = 0, z = −860**. Water. No street wall.

## Residual gaps

- No 5 m DTM. Walls and roads are flat.
- The canyon ribbon is still the ground-fill wall outside the Des Voeux eye. Inside 80 m of x = −1.4, z = 29.3 the ribbon is removed when a LandsD individualised mesh is in that disc (`docs/HK_GLTF_CUT.md`). Where a gap wall remains, its sidewalk belt is an opaque shopfront, and Traditional Chinese neon hangs on that belt. The ground in that disc is the LandsD curb walk plus OSM pavement, crossings, and bus stops (`js/hk-pedestrian-data.js`), not an empty coast plate where those features are mapped.
- Not a parcel cadastre. Where LandsD has a footprint the wall meets it. Where it does not, the wall is a 12 m canyon edge, not a surveyed lot.
- Block interiors behind the street wall can still be the coast plate. They are not a place the carriageway looks into.
- Junction mouths stay open for a short distance so crossing decks are not buried.
