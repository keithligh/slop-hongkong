# Central asphalt roads

The centreline was already LandsD plus OSM. What read as a brown thread was the mesh: a few metres of carriageway, no paint, and a sidewalk slab too low to separate the road from the coast fill. This cut keeps that centreline and gives Central a driveable cross-section.

## What changed

`js/hk-road-deck.js` turns each at-grade centreline segment into a deck. `js/city-grid.js` instances it. There is no flag. Boot does not need a fetch.

- **Asphalt** uses the existing WebGPU road shader (`createRoadSurfaceMaterial`): dark aggregate, grit, and the rain wetness already driven by `uRoadWetness`. The coast fill is pushed back in depth so the deck wins.
- **Kerb** is a granite stone 0.18 m wide (`HK_KERB_STONE`). It rises from the asphalt top at y = 0.07 to the sidewalk top at y = 0.22, so the upstand is the face between them. `HK_CURB_W` stays 0.42 m and is still the margin the canyon wall uses. The 0.24 m between the stone and that margin is sidewalk, so the outer edge of the walk does not move. Stones are scored about every 0.9 m along the ribbon. Central only. Edge lines are 0.22 m wide and lane dashes 0.18 m, drawn as a thin ribbon just above the asphalt.
- **Sidewalk** is the concrete-flag shader. The paved width outside the stone is the old 2.05 m walk plus the 0.24 m that used to be curb, top at the same 0.22 m the pedestrians use. Joints follow the ribbon (about 0.45 m across, 0.9 m along) via the instance `hkSpan` attribute, so a diagonal street is not a world-axis diamond grid. Island-wide, so a street outside the core is still pavement rather than a stroke. Where two parts of the same Central street run a few metres apart, a sidewalk that would fall inside either carriageway is dropped, so the gap does not fill with concrete. The next surface in Central is a podium, not a setback.
- **Mapped pavement** is separate from that kerb strip. `js/hk-pedestrian-data.js` is the Central OSM extract (footway, sidewalk, pedestrian area, crossing, bus stop, bench, street lamp). `planHkStreetGround` lays those ways in the same concrete shader, at the same 0.22 m top. A way whose centre sits in the carriageway is not paved over the asphalt. A way that overlaps the kerb keeps its outer edge and is pulled back to the stone. iB1000 kerb lines are not in this repo; the margin is the LandsD centreline width. A zebra is painted where the crossing tag is a marked crossing, and a stop is only a `highway=bus_stop` node.
- **Paint**, Central only: white edge lines, a dashed white lane line on one-way streets, a double yellow centre on two-way streets (`dir === 'TW'` or untagged), a white stop bar where another street meets the end, and a short yellow keep-clear (four bars) on the approach of a carriageway at least 9 m wide. Stripes use `createLaneStripeMaterial`, which shares the asphalt wetness field, so rain darkens them and drops roughness.

`GEO.roadGraph` is unchanged. Traffic still follows the centreline. The deck is not a second graph, and it is not a Manhattan grid.

## Width

LandsD has no measured carriageway. The stored width is the street-graph heuristic (OSM `width`, else `lanes × 3.3`, else class), and `Math.round` had collapsed a one-lane tag to 3 m. The deck does not trust that as a hairline:

| Input | Carriageway |
|---|---|
| A tag of 3.2 m or more, not a highway | the tag. A 5 m hill street stays 5 m. A 7 m street stays 7 m. |
| Tag missing or under 3.2 m, 1 lane | 3.6 m |
| Tag missing or under 3.2 m, 2 lanes | 5.8 m |
| Tag missing or under 3.2 m, 3 lanes | 7.8 m |
| Tag missing or under 3.2 m, 4 lanes | 9.6 m |
| Highway flag | at least 10.5 m, or the tag when that is wider |
| Cap | 22 m |

A tagged 17 m road stays 17 m. A tagged 3 m / 1 lane road becomes 3.6 m, not an avenue. Des Voeux near the spawn keeps its 7 m and 10 m tags. Connaught keeps its wider tag. Parallel parts of one name both lay asphalt; paint and the outer kerb stay on the wider part when the centrelines are close enough to be one carriageway. The visual stone is 0.18 m. The walk outside it is 2.29 m, which is the old 2.05 m plus the 0.24 m the stone gave back, so the outer edge is still 0.42 m plus 2.05 m from the carriageway. The building face is the next surface, documented in [HK_GROUND_FILL_CUT.md](HK_GROUND_FILL_CUT.md).

## How to verify

`node --test tests/*.mjs tests/*.cjs`

On MSI, open the page (no query flag). The taxi starts about 18 m from Des Voeux, not on the carriageway. That side of the street is a podium, not an open fill. The location pill still says 中環 · Des Voeux Road Central from the carriageway.

Drive southeast onto the asphalt. A point on that centreline is about **x = −1.4, z = 29.3** (east / south of the origin). From the chase camera on that point:

- the lane under the taxi is dark asphalt at the tagged width, not a widened avenue
- a white edge line and a dashed white lane line are visible
- a narrow concrete sidewalk and a darker curb sit outside the asphalt, then a podium

Chater, two-way, is the double yellow. A point on it is about **x = 24, z = −62**. Connaught's wider deck is north of that, about **x = 46, z = −134**. The map (M) still draws the centreline; the 3D deck is what you drive.

## Residual gaps

- No denser pedestrians and no DTM. Central frontage uses LandsD individualised meshes where the sheets are fetched, and a street wall in the gaps: [HK_GLTF_CUT.md](HK_GLTF_CUT.md), [HK_GROUND_FILL_CUT.md](HK_GROUND_FILL_CUT.md). Relief is still flat.
- Paint is class paint, not the Hong Kong transport manual: no tram fairway, no full yellow-box inventory, no worded keep-clear, no arrow legends. Junctions get a stop bar and a short run of yellow bars.
- Parallel centrelines more than about half the combined width apart stay separate streets. A real median narrower than that becomes one asphalt surface.
- Wetness is the shader's existing rain film and puddle mask. There are no mesh puddles, reflections unique to Central, or per-street drainage.
- Outside Central there is asphalt and sidewalk, but no curb mesh and no lane paint.
