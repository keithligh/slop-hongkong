import * as THREE from 'three/webgpu';
import { HK_STREET_EYE } from './city-config.js';
import {
  HK_GAME_GROUND_DECK,
  HK_GAME_GROUND_OSM,
  HK_GAME_GROUND_TILES,
  digit1GameGroundOwner,
  digit1GroundProbePoints
} from './hk-game-ground-frame.js';

// Cut #47. Which mesh does a down-ray meet first at and about the Digit1 eye?
// The default answer is the game deck (or OSM pavement). The LandsD aerial tiles
// answer only under ?groundTiles=on. This reads the scene the page drew; it does
// not paint anything.

const TARGET_NAMES = new Set([...HK_GAME_GROUND_DECK, ...HK_GAME_GROUND_OSM, ...HK_GAME_GROUND_TILES]);
// Above every ribbon top (kerb 0.22, crossing 0.094) and below shelter roofs.
const RAY_START_Y = 0.6;

function collectTargets(roots) {
  const targets = [];
  for (const root of roots) {
    if (!root) continue;
    root.traverse((obj) => {
      if (obj.isMesh && TARGET_NAMES.has(obj.name)) targets.push(obj);
    });
  }
  return targets;
}

export function probeDigit1GameGround(roots, eye = HK_STREET_EYE) {
  const targets = collectTargets(roots);
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  const hits = [];
  for (const point of digit1GroundProbePoints(eye)) {
    origin.set(point.x, RAY_START_Y, point.z);
    raycaster.set(origin, down);
    let name = '';
    try {
      const found = raycaster.intersectObjects(targets, false);
      name = found.length ? found[0].object.name : '';
    } catch (err) {
      console.warn(`[game-ground] ray ${point.label}: ${err.message || err}`);
    }
    hits.push({ label: point.label, name });
  }
  const owner = digit1GameGroundOwner(hits);
  const tilesMounted = targets.some((obj) => HK_GAME_GROUND_TILES.includes(obj.name));
  return { ...owner, tilesMounted, targets: targets.length };
}
