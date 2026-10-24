# Slop Hong Kong

A Hong Kong city simulation built with [three.js](https://threejs.org/), WebGPURenderer, and TSL. Explore on foot, by car, by bicycle, or by helicopter.

This build still renders the upstream Manhattan map. The Hong Kong geodata pipeline is in progress. v1 covers Hong Kong Island, Kowloon, and Victoria Harbour. The world origin for that port is Central (Statue Square / Chater): LAT0 = 22.28088, LON0 = 114.15979, with true north as the v1 bearing. Details are in [docs/HK_ORIGIN.md](docs/HK_ORIGIN.md).

This fork started from [mrdoob/slop-newyork](https://github.com/mrdoob/slop-newyork). The live New York demo remains at [mrdoob.github.io/slop-newyork](https://mrdoob.github.io/slop-newyork/).

## Make it your own

Fork it, remix it, improve it, break it. Make games, animations, films, experiments, or something completely different. Use it as a starting point and take it wherever you want. Have fun!

## License and data

The project code is available under the [MIT License](LICENSE).

The running build still ships the upstream geographic set: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). Long-term sources for the Hong Kong port are OpenStreetMap (ODbL) and open data from [DATA.GOV.HK](https://data.gov.hk/). Third-party data and dependencies retain their respective licenses.
