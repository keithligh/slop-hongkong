# Slop Hong Kong

A Hong Kong city simulation built with [three.js](https://threejs.org/), WebGPURenderer, and TSL. Explore on foot, by car, by bicycle, or by helicopter.

Opening `index.html` loads Hong Kong. No query parameter is required. The scene is `js/hk-geodata.js`: the full Hong Kong Island and Kowloon extract (LandsD buildings and the road centreline, OSM highways, parks, and Victoria Harbour), origin at Central (中環／皇后像廣場), LAT0 = 22.28088, LON0 = 114.15979, true north. The interface is Traditional Chinese (繁體中文). The origin decision is in [docs/HK_ORIGIN.md](docs/HK_ORIGIN.md). Cut 5 of the pipeline, including how to re-fetch, is in [docs/HK_GEO_PIPELINE.md](docs/HK_GEO_PIPELINE.md).

This fork started from [mrdoob/slop-newyork](https://github.com/mrdoob/slop-newyork). The live New York demo remains at [mrdoob.github.io/slop-newyork](https://mrdoob.github.io/slop-newyork/).

## Make it your own

Fork it, remix it, improve it, break it. Make games, animations, films, experiments, or something completely different. Use it as a starting point and take it wherever you want. Have fun!

## License and data

The project code is available under the [MIT License](LICENSE).

The playable page uses Lands Department data via the [CSDI Portal](https://portal.csdi.gov.hk/) / [DATA.GOV.HK](https://data.gov.hk/) for buildings and the road centreline, and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL) for Victoria Harbour, the coast, and piers. Individualised building models are © the Government of the Hong Kong SAR (Lands Department) via [Open3Dhk](https://3d.map.gov.hk/); commercial and non-commercial use is allowed when the Government and that website are named as the source. Fetch is in [docs/HK_GLTF_CUT.md](docs/HK_GLTF_CUT.md). The page loads `js/hk-geodata.js` and, when `hk-3d/` manifests are present, the Central sheets 11-SW-9C and 11-SW-8D, plus the Bank of China Tower photograph on 11-SW-14A. The Digit1 mid-band has no further sheet: those hits are inside 9C and outside every BUILDING mesh hunted on 9C, 8D, 14A and 13B. The Des Voeux corridor also loads a clipped Planning Department 3D Photo-realistic Model (March 2017 aerial, © 香港特別行政區政府規劃署) when `hk-3d/pland/` is present. `?pland=off` leaves it unmounted. `?pland=compare` is the A-B without the LandsD sheets. Fetch and the Digit1 cameras are in [docs/HK_PLAND_MESH.md](docs/HK_PLAND_MESH.md). Third-party data and dependencies retain their respective licenses.
