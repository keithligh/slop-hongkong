// Digit1 cut #26 bars. Keith's eye at ?at=-1.4,29.3,1.29 is the live gate.
// These checks fail a remount of the grey corridor slabs and a full-height
// punch of near PlanD. They do not claim a Sleeping Dogs street.
//
//   node tools/digit1-invader-gate.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKS, HK_RETAIL_BELT } from '../js/city-config.js';
import { NULL_FILL_EDGE } from '../js/hk-gltf-frame.js';
import {
  PLAND_PODIUM_ABOVE_BELT,
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
    hendersonInFront: plandYieldsToLandsd({ x: 212.8, y: 31.7, z: 91.1 }, [HENDERSON])
  };
  bars.pass = bars.noAshlarInvaderSlabs
    && bars.noZombieSkyHoles
    && bars.nullFillEdge >= 1024
    && bars.orangeCanyonGone
    && bars.hendersonInFront === true
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
