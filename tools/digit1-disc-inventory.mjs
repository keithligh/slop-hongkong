#!/usr/bin/env node
// What the 50 m / 80 m disc around the Digit1 eye is made of, from the real hk-3d manifests and
// the same planners the page runs. LandsD meshes, procedural extrudes that survive, canyon
// ribbons that survive, and the ground the eye sees between them.
//   node tools/digit1-disc-inventory.mjs [--json]
// Needs hk-3d/<sheet>/manifest.json (node tools/fetch-central-gltf-sheet.mjs --street).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLOCKS,
  HK_CORE_WORLD,
  HK_GLTF_SHEETS,
  HONG_KONG_ISLAND_COASTLINE,
  ROADS,
  HK_STREET_EYE,
  HK_STREET_NEAR,
  HK_WALK_RADIUS
} from '../js/city-config.js';
import { boxClosestDistance, hiddenExtrudeIds, planGltfManifest } from '../js/hk-gltf-frame.js';
import { clipCanyonWalls, hkCanyonBuildings, planHkStreetCanyon } from '../js/hk-ground-fill.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const eye = HK_STREET_EYE;
const dist = (x, z) => Math.hypot(x - eye.x, z - eye.z);

const buildings = [];
for (const sheet of HK_GLTF_SHEETS) {
  const file = path.join(root, 'hk-3d', sheet, 'manifest.json');
  if (!existsSync(file)) continue;
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  for (const entry of manifest.buildings || []) buildings.push({ ...entry, sheet });
}
if (!buildings.length) {
  console.error('no hk-3d manifests: run node tools/fetch-central-gltf-sheet.mjs --street');
  process.exit(1);
}

const plan = planGltfManifest({ sheet: 'all', buildings });
const selected = plan.selected;
const landsd = selected
  .map((entry) => ({
    id: String(entry.file || '').split('/')[1] || entry.name,
    sheet: entry.sheet,
    d: boxClosestDistance(entry, eye),
    height: entry.maxH - entry.minH
  }))
  .filter((row) => row.d <= HK_STREET_NEAR)
  .sort((a, b) => a.d - b.d);

const hidden = new Set(hiddenExtrudeIds(BLOCKS, selected));
const extrudesInDisc = BLOCKS.filter((b) => !b.park && !b.median && boxClosestDistance(b, eye) <= HK_STREET_NEAR);
const extrudeSurvivors = extrudesInDisc.filter((b) => !hidden.has(b.id));

const canyon = planHkStreetCanyon({
  roads: ROADS,
  buildings: hkCanyonBuildings(BLOCKS, HK_CORE_WORLD),
  core: HK_CORE_WORLD,
  island: HONG_KONG_ISLAND_COASTLINE
});
const kept = clipCanyonWalls(canyon.walls, selected, { eye, near: HK_STREET_NEAR });
const ribbonsIn = (limit) => kept.filter((wall) => dist(wall.x, wall.z) <= limit);

const report = {
  eye,
  walkRadius: HK_WALK_RADIUS,
  overlayDisc: HK_STREET_NEAR,
  landsdMeshesWithin80: landsd,
  landsdMeshesWithin50: landsd.filter((row) => row.d <= HK_WALK_RADIUS).length,
  extrudesWithin80: extrudesInDisc.length,
  extrudesHiddenWithin80: extrudesInDisc.length - extrudeSurvivors.length,
  extrudeSurvivorsWithin80: extrudeSurvivors.map((b) => ({ id: b.id, d: +boxClosestDistance(b, eye).toFixed(1) })),
  canyonRibbonsPlanned: canyon.walls.length,
  canyonRibbonsKeptWithin50: ribbonsIn(HK_WALK_RADIUS).length,
  canyonRibbonsKeptWithin80: ribbonsIn(HK_STREET_NEAR).length,
  canyonRibbonsKeptWithin110: ribbonsIn(110).length
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`eye ${eye.x}, ${eye.z}  walk ${HK_WALK_RADIUS} m  overlay disc ${HK_STREET_NEAR} m`);
  console.log(`LandsD meshes (cap-${selected.length} set) within ${HK_STREET_NEAR} m: ${landsd.length}, within ${HK_WALK_RADIUS} m: ${report.landsdMeshesWithin50}`);
  console.table(landsd.map((row) => ({ id: row.id, sheet: row.sheet, 'd m': +row.d.toFixed(1), 'h m': +row.height.toFixed(1) })));
  console.log(`extrudes within ${HK_STREET_NEAR} m: ${report.extrudesWithin80}, hidden ${report.extrudesHiddenWithin80}, surviving ${report.extrudeSurvivorsWithin80.length}`);
  console.log(`canyon ribbons kept: <=50 m ${report.canyonRibbonsKeptWithin50}, <=80 m ${report.canyonRibbonsKeptWithin80}, <=110 m ${report.canyonRibbonsKeptWithin110}`);
}
