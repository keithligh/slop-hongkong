// Digit1 bars. Keith's eye at ?at=-1.4,29.3,1.29 is the live gate.
// Cut #26 fails a remount of the grey corridor slabs and a full-height punch
// of near PlanD. Cut #27 fails a centre ray that still first-hits PlanD.
// These checks do not claim a Sleeping Dogs street.
//
//   node tools/digit1-invader-gate.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKS, HK_RETAIL_BELT, HK_STREET_EYE } from '../js/city-config.js';
import { NULL_FILL_EDGE } from '../js/hk-gltf-frame.js';
import {
  PLAND_PODIUM_ABOVE_BELT,
  PLAND_STREET_SHELL_APRON,
  desVoeuxCarriageSegments,
  plandCarriageDistance,
  plandOmitsCarriageShell,
  plandOmitsDigit1LookGround,
  plandOmitsPodiumInsideLandsd,
  plandYieldsToLandsd,
  withPlandCorridorHidden
} from '../js/hk-pland-frame.js';

const ASHLAR_MOUNT = /hkCorridorPodiumFill|HkCorridorPodiumFill|createCorridorPodiumFillMaterial|corridorPodiumFillColor|0x8a847c/;
const HENDERSON = {
  minX: 217.54,
  maxX: 263.57,
  minZ: 53.74,
  maxZ: 104.96,
  minH: 5.75,
  maxH: 195.21
};
const SOUTH_WALL = { minX: -66.9, maxX: 13.4, minZ: 29.2, maxZ: 102.1 };

export function noAshlarInvaderSlabs(sources, plan) {
  const mounted = `${sources.buildings || ''}\n${sources.materials || ''}\n${sources.main || ''}`;
  if (ASHLAR_MOUNT.test(mounted)) return false;
  if (/hkShopfrontAlbedo/.test(sources.buildings || '')) return false;
  if (/podiumFillIds/.test(sources.buildings || '')) return false;
  if (!plan?.podiumFillIds || plan.podiumFillIds.size !== 0) return false;
  return true;
}

export function noZombieSkyHoles(sources) {
  const frame = sources?.frame || '';
  if (!/export const PLAND_PODIUM_ABOVE_BELT = 1/.test(frame)) return false;
  if (!/if \(!\(point\.y < belt \+ aboveBelt\)\) return false;/.test(frame)) return false;
  const inBelt = { x: 2, y: 4, z: 40 };
  const atCap = { x: 2, y: HK_RETAIL_BELT + PLAND_PODIUM_ABOVE_BELT, z: 40 };
  const above = { x: 2, y: HK_RETAIL_BELT + PLAND_PODIUM_ABOVE_BELT + 12, z: 40 };
  if (plandOmitsPodiumInsideLandsd(inBelt, [SOUTH_WALL]) !== true) return false;
  if (plandOmitsPodiumInsideLandsd(atCap, [SOUTH_WALL]) !== false) return false;
  if (plandOmitsPodiumInsideLandsd(above, [SOUTH_WALL]) !== false) return false;
  if (plandOmitsPodiumInsideLandsd({ x: 230, y: HK_RETAIL_BELT + 40, z: 80 }, [HENDERSON]) !== false) return false;
  if (plandYieldsToLandsd({ x: 212.8, y: 31.7, z: 91.1 }, [HENDERSON]) !== true) return false;
  return true;
}

function lookPoint(along, side, y) {
  const fx = Math.sin(HK_STREET_EYE.heading);
  const fz = Math.cos(HK_STREET_EYE.heading);
  return {
    x: HK_STREET_EYE.x + fx * along - fz * side,
    y,
    z: HK_STREET_EYE.z + fz * along + fx * side
  };
}

// Centre and centre_low on the Digit1 chase. The measured melt is tile_21_26
// mat_tex_1 near (80.35, 10.37, 53.23). The same rays then meet a mat_tex_2
// sheet around along 151 m, centroid y ~16, and a centre_low sheet around
// along 209 m, centroid y ~12. The apron does not contain the melt. The
// Henderson shell at along ~223 m stays for the skirt.
export function ndcCentreNotPland() {
  const slime = { x: 80.35, y: 10.37, z: 53.23 };
  const low = { x: 80.35, y: 6.4, z: 53.23 };
  const segments = desVoeuxCarriageSegments();
  const road = plandCarriageDistance(slime.x, slime.z, segments);
  if (!road || !(road.dist > road.half + PLAND_STREET_SHELL_APRON)) return false;
  if (plandOmitsCarriageShell(slime, { x: slime.x + 0.2, y: slime.y, z: slime.z }, { x: slime.x, y: slime.y, z: slime.z + 0.2 }, segments)) {
    return false;
  }
  if (plandOmitsDigit1LookGround(slime) !== true) return false;
  if (plandOmitsDigit1LookGround(low) !== true) return false;
  if (plandOmitsDigit1LookGround(lookPoint(151.43, -0.02, 16.04)) !== true) return false;
  if (plandOmitsDigit1LookGround(lookPoint(209.39, 0.52, 12.23)) !== true) return false;
  if (plandOmitsDigit1LookGround(lookPoint(90, 22, 8)) !== false) return false;
  if (plandOmitsDigit1LookGround(lookPoint(120, 0, 24)) !== false) return false;
  if (plandOmitsDigit1LookGround(lookPoint(120, 0, 18)) !== false) return false;
  if (plandOmitsDigit1LookGround(lookPoint(223.15, 0.06, 22.36)) !== false) return false;
  if (plandOmitsDigit1LookGround({ x: 212.8, y: 31.7, z: 91.1 }) !== false) return false;
  return true;
}

export function midRoadSlimeGone(sources) {
  const page = sources?.pland || '';
  return /plandOmitsDigit1LookGround/.test(page)
    && /omitted \$\{look\} triangles on the Digit1 mid-road look/.test(page);
}

export function orangeCanyonGone(sources) {
  return /omitPlandCorridorGlass\(walls/.test(sources.grid || '')
    && !/hkShopfrontAlbedo/.test(sources.pland || '');
}

export function readDigit1Sources(root) {
  const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
  return {
    buildings: read('js/buildings.js'),
    materials: read('js/tsl-materials.js'),
    main: read('js/main.js'),
    frame: read('js/hk-pland-frame.js'),
    pland: read('js/hk-pland.js'),
    grid: read('js/city-grid.js'),
    gltf: read('js/hk-gltf-frame.js')
  };
}

export function digit1InvaderGate(root) {
  const sources = readDigit1Sources(root);
  const plan = withPlandCorridorHidden({ hiddenIds: new Set() }, BLOCKS);
  const bars = {
    eye: '?at=-1.4,29.3,1.29',
    noAshlarInvaderSlabs: noAshlarInvaderSlabs(sources, plan),
    noZombieSkyHoles: noZombieSkyHoles(sources),
    nullFillEdge: NULL_FILL_EDGE,
    orangeCanyonGone: orangeCanyonGone(sources),
    hendersonInFront: plandYieldsToLandsd({ x: 212.8, y: 31.7, z: 91.1 }, [HENDERSON]),
    ndcCentreNotPland: ndcCentreNotPland(),
    midRoadSlimeGone: midRoadSlimeGone(sources)
  };
  bars.pass = bars.noAshlarInvaderSlabs
    && bars.noZombieSkyHoles
    && bars.nullFillEdge >= 1024
    && bars.orangeCanyonGone
    && bars.hendersonInFront === true
    && bars.ndcCentreNotPland === true
    && bars.midRoadSlimeGone === true
    && !/NULL_FILL_EDGE = 256/.test(sources.gltf);
  return bars;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const report = digit1InvaderGate(root);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}
