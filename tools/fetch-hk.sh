#!/bin/bash
# Populate tools/data/hk from LandsD (CSDI FeatureServer) and OpenStreetMap.
# Full extracts are gitignored. --sample only refreshes the committed Statue Square fixture.
# usage: tools/fetch-hk.sh [--sample | --landsd-only | --osm-only] [extra args for fetch-landsd.mjs]
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'EOF'
usage: tools/fetch-hk.sh [--sample | --landsd-only | --osm-only] [extra args for fetch-landsd.mjs]

--sample       refresh tools/data/hk/samples (Statue Square–Chater) and skip Overpass
--landsd-only  FeatureServer extract into tools/data/hk/ (gitignored)
--osm-only     run tools/data/q_hk_*.overpassql into tools/data/hk/osm_*.json
               (coast, parks, landmarks, piers, highways, and the Central pedestrian extract)
EOF
  exit 0
fi

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${HK_DATA:-"$ROOT/tools/data/hk"}
mkdir -p "$OUT"

SAMPLE=0
LANDSD=1
OSM=1
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --sample) SAMPLE=1 ;;
    --landsd-only) OSM=0 ;;
    --osm-only) LANDSD=0 ;;
    *) ARGS+=("$arg") ;;
  esac
done

if [ "$LANDSD" = 1 ]; then
  if [ "$SAMPLE" = 1 ]; then
    node "$ROOT/tools/fetch-landsd.mjs" --sample --out "$ROOT/tools/data/hk/samples" "${ARGS[@]}"
  else
    node "$ROOT/tools/fetch-landsd.mjs" --out "$OUT" "${ARGS[@]}"
  fi
fi

if [ "$OSM" = 1 ] && [ "$SAMPLE" = 0 ]; then
  export OVERPASS_UA="${OVERPASS_UA:-slop-hongkong-geodata/1.0 (three.js city sim)}"
  bash "$ROOT/tools/overpass.sh" "$OUT/osm_coast.json" "$ROOT/tools/data/q_hk_coast.overpassql"
  bash "$ROOT/tools/overpass.sh" "$OUT/osm_parks.json" "$ROOT/tools/data/q_hk_parks.overpassql"
  bash "$ROOT/tools/overpass.sh" "$OUT/osm_landmarks.json" "$ROOT/tools/data/q_hk_landmarks.overpassql"
  bash "$ROOT/tools/overpass.sh" "$OUT/osm_piers.json" "$ROOT/tools/data/q_hk_piers.overpassql"
  # Highways join the LandsD centreline in the street graph. The queries above stay the OSM fill roles.
  bash "$ROOT/tools/overpass.sh" "$OUT/osm_highways.json" "$ROOT/tools/data/q_hk_highways.overpassql"
  # Central footways, crossings, and bus stops. The page module is rebuilt with
  # node tools/build-hk-pedestrian.mjs "$OUT/osm_pedestrian.json"
  bash "$ROOT/tools/overpass.sh" "$OUT/osm_pedestrian.json" "$ROOT/tools/data/q_hk_pedestrian.overpassql"
fi
