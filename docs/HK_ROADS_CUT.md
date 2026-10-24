# Central asphalt roads

The centreline was already LandsD plus OSM. What read as a brown thread was the mesh: a few metres of carriageway, no paint, and a sidewalk slab too low to separate the road from the coast fill. This cut keeps that centreline and gives Central a driveable cross-section.

## What changed

`js/hk-road-deck.js` turns each at-grade centreline segment into a deck. `js/city-grid.js` instances it. There is no flag. Boot does not need a fetch.

- **Asphalt** uses the existing WebGPU road shader (`createRoadSurfaceMaterial`): dark aggregate, grit, and the rain wetness already driven by `uRoadWetness`. The coast fill is pushed back in depth so the deck wins.
- **Curb** is the granite curb shader, about 0.42 m wide. The face runs from y = 0.02 to y = 0.22, flush with the sidewalk, so the step reads at eye height. Central only. Edge lines are 0.22 m wide and lane dashes 0.18 m, drawn as a 3 cm ribbon on the asphalt so they stay sharp under the chase camera.
- **Sidewalk** is the concrete-flag shader, 2.05 m outside the curb, top at the same 0.22 m the pedestrians use. Island-wide, so a street outside the core is still pavement rather than a stroke. Where two parts of the same Central street run a few metres apart, a sidewalk that would fall inside either carriageway is dropped, so the gap does not fill with concrete. The next surface in Central is a podium, not a setback.
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

A tagged 17 m road stays 17 m. A tagged 3 m / 1 lane road becomes 3.6 m, not an avenue. Des Voeux near the spawn keeps its 7 m and 10 m tags. Connaught keeps its wider tag. Parallel parts of one name both lay asphalt; paint and the outer curb stay on the wider part when the centrelines are close enough to be one carriageway. The sidewalk is 2.05 m. The building face is the next surface, documented in [HK_GROUND_FILL_CUT.md](HK_GROUND_FILL_CUT.md).

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
