// Digit1 bars. Keith's eye at ?at=-1.4,29.3,1.29 is the live gate.
// Cut #26 fails a remount of the grey corridor slabs and a full-height punch
// of near PlanD. Cut #27 fails a centre ray that still first-hits PlanD.
// Cut #28 fails when the forward 皇后像廣場 shelter is outside that chase, or
// when the sidewalk shader is still a sky-mirror slab.
// These checks do not claim a Sleeping Dogs street.
//
//   node tools/digit1-invader-gate.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLOCKS,
  HK_RETAIL_BELT,
  HK_STREET_EYE,
  ISLAND_BOUNDS,
  ROADS,
  hkPlanCorners,
  hkResolveLandmarks
} from '../js/city-config.js';
import { digit1ChasePose, projectChaseNdc } from '../js/digit1-probe-frame.js';
import { NULL_FILL_EDGE, boxClosestDistance, gltfAlbedoSampler } from '../js/hk-gltf-frame.js';
import { HK_PEDESTRIAN } from '../js/hk-pedestrian-data.js';
import { HK_BUS_SHELTER, hkShelterRoofPose, planHkStreetGround } from '../js/hk-pedestrian.js';
import {
  PLAND_BOC_PLATE_PEAK,
  PLAND_PODIUM_ABOVE_BELT,
  PLAND_STREET_SHELL_APRON,
  desVoeuxCarriageSegments,
  digit1BocTowerPlate,
  plandCarriageDistance,
  plandOmitsCarriageShell,
  plandOmitsDigit1BocPlate,
  plandOmitsDigit1FlankChart,
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
  // Flank yield must not reopen the near-box interior above the belt.
  if (plandOmitsDigit1FlankChart(above, [SOUTH_WALL]) !== false) return false;
  if (plandOmitsDigit1FlankChart({ x: 230, y: 40, z: 80 }, [HENDERSON]) !== false) return false;
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

function queenShelterInFront(plan = planHkStreetGround(HK_PEDESTRIAN, ROADS)) {
  const eye = HK_STREET_EYE;
  const fx = Math.sin(eye.heading);
  const fz = Math.cos(eye.heading);
  const rx = -fz;
  const rz = fx;
  let best = null;
  for (const stop of plan.stops) {
    if (stop.name !== '皇后像廣場' || !stop.shelter || stop.inRoad) continue;
    const dx = stop.x - eye.x;
    const dz = stop.z - eye.z;
    const along = dx * fx + dz * fz;
    const lat = dx * rx + dz * rz;
    if (!(along > 2 && along < 40 && Math.abs(lat) < 20)) continue;
    if (!best || along < best.along) best = { ...stop, along, lat };
  }
  return best;
}

// The forward 皇后像廣場 shelter is on the north kerb walk and inside the
// Digit1 chase, not only in the build count.
export function digit1GroundLifeVisible(plan) {
  const stop = queenShelterInFront(plan);
  if (!stop) return false;
  if (!(stop.lat < -3.2 && stop.lat > -6.2)) return false;
  const pose = digit1ChasePose(HK_STREET_EYE);
  const roofPose = hkShelterRoofPose(stop);
  const sign = projectChaseNdc(pose, { x: stop.x, y: HK_BUS_SHELTER.signY, z: stop.z });
  const roof = projectChaseNdc(pose, { x: roofPose.x, y: HK_BUS_SHELTER.roofY, z: roofPose.z });
  const inFrame = (hit) => hit.depth > 4 && hit.depth < 40
    && Math.abs(hit.ndcX) < 0.82
    && Math.abs(hit.ndcY) < 0.9;
  return inFrame(sign) && inFrame(roof);
}

export function digit1SidewalkAuthentic(sources) {
  const mat = sources?.materials || '';
  const start = mat.indexOf('function createSidewalkMaterial');
  const end = mat.indexOf('function createCurbMaterial');
  const body = start >= 0 && end > start ? mat.slice(start, end) : '';
  if (!/const jointHalf = 0\.022;/.test(body)) return false;
  if (!/specularF90\.assign\(0\.24\)/.test(body)) return false;
  if (!/mat\.setupSpecular = function/.test(body)) return false;
  if (!/metalnessNode = clamp\(swFresnel\.mul\(0\.4\), 0\.0, 0\.4\)\.mul\(swPuddle\)/.test(body)) return false;
  if (/swWet\.z\.mul\(0\.3\)/.test(body)) return false;
  const grid = sources?.grid || '';
  if (!/createSidewalkMaterial\(\)/.test(grid)) return false;
  if (!/HkSidewalks/.test(grid) || !/HkOsmPavement/.test(grid)) return false;
  if (/mapillary/i.test(body) || /mapillary/i.test(grid)) return false;
  if (/hkCoastLand/.test(body)) return false;
  return true;
}

const BOC_CHART = {
  minX: 13.9,
  maxX: 56.1,
  minZ: 51.7,
  maxZ: 95.5,
  minH: 4,
  maxH: 73.7
};
// Cheung Kong Center. Closest point is past the 80 m disc, on the right flank.
const CKC_CHART = {
  minX: 44.3,
  maxX: 109.8,
  minZ: 115.4,
  maxZ: 180.9,
  minH: 5,
  maxH: 281.5
};

// right_mid second hit: PlanD just east of the Bank of China chart, above the
// belt, outside the mid-road corridor. The eye-facing skirt misses that cap.
export function digit1FlankMeltGone() {
  const proud = { x: 58.07, y: 10.59, z: 71.81 };
  if (plandYieldsToLandsd(proud, [BOC_CHART]) !== false) return false;
  if (plandOmitsPodiumInsideLandsd(proud, [BOC_CHART]) !== false) return false;
  if (plandOmitsDigit1LookGround(proud) !== false) return false;
  if (plandOmitsDigit1FlankChart(proud, [BOC_CHART]) !== true) return false;
  // Same chart, upper face band. Deep interior above the belt stays.
  if (plandOmitsDigit1FlankChart({ x: 54.1, y: 12, z: 72 }, [BOC_CHART]) !== true) return false;
  if (plandOmitsDigit1FlankChart({ x: 35, y: HK_RETAIL_BELT + 12, z: 73 }, [BOC_CHART]) !== false) return false;
  if (boxClosestDistance(CKC_CHART, HK_STREET_EYE) <= 80) return false;
  if (plandOmitsDigit1FlankChart({ x: 70, y: 14, z: 140 }, [CKC_CHART]) !== true) return false;
  if (plandOmitsPodiumInsideLandsd({ x: 70, y: 14, z: 140 }, [CKC_CHART]) !== false) return false;
  if (plandOmitsDigit1FlankChart({ x: 70, y: 90, z: 140 }, [CKC_CHART]) !== false) return false;
  if (plandOmitsDigit1FlankChart({ x: 230, y: 40, z: 80 }, [HENDERSON]) !== false) return false;
  if (plandOmitsDigit1FlankChart({ x: 2, y: HK_RETAIL_BELT + 12, z: 40 }, [SOUTH_WALL]) !== false) return false;
  if (plandYieldsToLandsd({ x: 212.8, y: 31.7, z: 91.1 }, [HENDERSON]) !== true) return false;
  // Mid-road slime stays on the look omit, not this flank test.
  const slime = { x: 80.35, y: 10.37, z: 53.23 };
  if (plandOmitsDigit1LookGround(slime) !== true) return false;
  if (plandOmitsDigit1FlankChart(slime, [BOC_CHART, CKC_CHART, HENDERSON, SOUTH_WALL]) !== false) return false;
  return true;
}

function chaseTwoLevel(entry) {
  const sampler = gltfAlbedoSampler(entry);
  return sampler.maxEdge === 0
    && sampler.mipmaps === true
    && sampler.mipLevels === 2
    && sampler.anisotropy === 16
    && sampler.minFilter === 'mipmap';
}

function lookPointBox(dist) {
  const fx = Math.sin(HK_STREET_EYE.heading);
  const fz = Math.cos(HK_STREET_EYE.heading);
  const x = HK_STREET_EYE.x + dist * fx;
  const z = HK_STREET_EYE.z + dist * fz;
  return { minX: x, maxX: x, minZ: z, maxZ: z };
}

// Mid-far canyon charts on the Digit1 look. The photograph past 80 m is the
// same two-level anisotropic sample as the near disc, not a full mip chain
// and not the one-tap smear. The chartless Bank of China Tower plate is owned
// by the LandsD shaft yield, not by widening this flank-chart punch. A low
// centre sample past Henderson (tile_22_26) is not this bar.
export function digit1FarFlankFidelity() {
  if (!chaseTwoLevel(lookPointBox(96))) return false;
  if (!chaseTwoLevel(lookPointBox(220))) return false;
  if (!chaseTwoLevel(HENDERSON)) return false;
  if (!chaseTwoLevel({ minX: 278, maxX: 316, minZ: 86, maxZ: 121 })) return false;
  if (!chaseTwoLevel({ minX: 341, maxX: 384, minZ: 135, maxZ: 178 })) return false;
  if (!(boxClosestDistance(CKC_CHART, HK_STREET_EYE) > 80)) return false;
  if (!chaseTwoLevel(CKC_CHART)) return false;
  const at80 = gltfAlbedoSampler(lookPointBox(80));
  if (at80.mipLevels !== 2 || at80.anisotropy !== 16) return false;
  const offLook = gltfAlbedoSampler({ minX: 400, maxX: 430, minZ: 20, maxZ: 40 });
  if (offLook.maxEdge !== 2048 || offLook.mipLevels === 2) return false;
  const behind = gltfAlbedoSampler({ minX: -220, maxX: -160, minZ: 0, maxZ: 50 });
  if (behind.maxEdge !== 2048 || behind.mipLevels === 2) return false;
  const tower = BLOCKS.find((block) => block.name === 'Bank of China Tower' && block.height === 303.3);
  if (!tower) return false;
  const charts = [BOC_CHART, CKC_CHART, HENDERSON, SOUTH_WALL];
  if (plandOmitsDigit1BocPlate({ x: tower.cx, y: 25, z: tower.cz }, tower) !== true) return false;
  if (plandOmitsDigit1FlankChart({ x: tower.cx, y: 25, z: tower.cz }, charts) !== false) return false;
  if (plandOmitsDigit1LookGround({ x: 278.49, y: 15.44, z: 110.37 }) !== false) return false;
  return true;
}

// Chartless BoC Tower plate. The right_mid second hit at tip 17419de sits
// inside the LandsD ring. That centroid yields. The mast above the prism peak
// stays. The flank-chart punch does not grow to cover this plate, and a
// neighbour in the bounding-box wedge is not the plate. Face readability is
// digit1BocPrismFidelity, not this ownership bar.
export function digit1BocPlateOwned(sources) {
  const tower = digit1BocTowerPlate();
  if (!tower) return false;
  const inside = { x: 164.3, y: 25, z: 146.7 };
  if (plandOmitsDigit1BocPlate(inside, tower) !== true) return false;
  if (plandOmitsDigit1BocPlate({ x: tower.cx, y: 25, z: tower.cz }, tower) !== true) return false;
  const roof = ISLAND_BOUNDS.sidewalkHeight + tower.height;
  if (plandOmitsDigit1BocPlate({ x: tower.cx, y: roof + 4, z: tower.cz }, tower) !== true) return false;
  if (plandOmitsDigit1BocPlate({ x: tower.cx, y: roof + PLAND_BOC_PLATE_PEAK, z: tower.cz }, tower) !== false) return false;
  if (plandOmitsDigit1BocPlate({ x: tower.cx, y: roof + 40, z: tower.cz }, tower) !== false) return false;
  if (plandOmitsDigit1BocPlate({ x: 149.2, y: 25, z: 144.4 }, tower) !== false) return false;
  if (plandOmitsDigit1BocPlate({ x: 278.49, y: 15.44, z: 110.37 }, tower) !== false) return false;
  if (plandOmitsDigit1BocPlate({ x: 230, y: 40, z: 80 }, tower) !== false) return false;
  if (plandOmitsDigit1BocPlate({ x: 80.35, y: 10.37, z: 53.23 }, tower) !== false) return false;
  if (plandOmitsDigit1BocPlate({ x: 2, y: HK_RETAIL_BELT + 12, z: 40 }, tower) !== false) return false;
  if (plandOmitsDigit1BocPlate(inside, { ...tower, name: 'The Henderson' }) !== false) return false;
  if (plandOmitsDigit1LookGround({ x: 278.49, y: 15.44, z: 110.37 }) !== false) return false;
  const charts = [BOC_CHART, CKC_CHART, HENDERSON, SOUTH_WALL];
  if (plandOmitsDigit1FlankChart({ x: tower.cx, y: 25, z: tower.cz }, charts) !== false) return false;
  if (plandOmitsDigit1FlankChart({ x: 58.07, y: 10.59, z: 71.81 }, [BOC_CHART]) !== true) return false;
  const page = sources?.pland || '';
  if (!/omitted \$\{boc\} triangles on the Digit1 BoC Tower LandsD plate/.test(page)) return false;
  if (!/boxes\?\.length \? digit1BocTowerPlate\(\) : null/.test(page)) return false;
  const landmarks = sources?.landmarks || '';
  const bocSrc = landmarks.slice(landmarks.indexOf('function addBankOfChina'), landmarks.indexOf('function addJardine'));
  if (!/Math\.max\(2, Math\.round\(rise \/ 52\)\)/.test(bocSrc)) return false;
  if (!/glassMetalness: 0/.test(bocSrc)) return false;
  if (!/glassRoughness: 0\.48/.test(bocSrc)) return false;
  if (!/reflectionFloor: 0\.04/.test(bocSrc)) return false;
  if (!/createRetailPodiumMaterial\(\)/.test(bocSrc)) return false;
  if (/reflectivity: 0\.96/.test(bocSrc)) return false;
  if (/mapillary/i.test(bocSrc)) return false;
  if (/hkShopfrontAlbedo/.test(bocSrc)) return false;
  return true;
}

// The Digit1 eye looks straight at the short west shaft (fraction 0.33). The
// tall glass is the radial faces of the other shafts. Those faces carry the
// white X. The glass is dielectric panes, not the fine mullion hash.
function digit1BocEyeFace() {
  const { placed } = hkResolveLandmarks();
  const site = placed.find((item) => item.id === 'boc');
  if (!site?.block) return null;
  const block = site.block;
  const corners = hkPlanCorners(block.poly, block.cx, block.cz);
  if (corners.length !== 4) return null;
  let north = 0;
  let northZ = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const mz = (corners[i].z + corners[(i + 1) % corners.length].z) / 2;
    if (mz < northZ) {
      northZ = mz;
      north = i;
    }
  }
  const fractions = [1, 0.76, 0.51, 0.33];
  const fx = Math.sin(HK_STREET_EYE.heading);
  const fz = Math.cos(HK_STREET_EYE.heading);
  const center = { x: block.cx, z: block.cz };
  let best = null;
  for (let step = 0; step < 4; step++) {
    const a = corners[(north + step) % 4];
    const b = corners[(north + step + 1) % 4];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    let nx = -dz / len;
    let nz = dx / len;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    if ((mx + nx - center.x) * nx + (mz + nz - center.z) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const facing = nx * fx + nz * fz;
    if (!best || facing < best.facing) best = { facing, fraction: fractions[step], edge: len };
  }
  return best;
}

export function digit1BocPrismFidelity(sources) {
  const landmarks = sources?.landmarks || '';
  const bocSrc = landmarks.slice(landmarks.indexOf('function addBankOfChina'), landmarks.indexOf('function addJardine'));
  if (!/const fractions = \[1, 0\.76, 0\.51, 0\.33\]/.test(bocSrc)) return false;
  if (!/hkPlanCorners\(block\.poly, block\.cx, block\.cz\)/.test(bocSrc)) return false;
  if (!/glassMetalness: 0/.test(bocSrc)) return false;
  if (!/glassRoughness: 0\.48/.test(bocSrc)) return false;
  if (!/reflectionFloor: 0\.04/.test(bocSrc)) return false;
  if (!/reflectivity: 0\.22/.test(bocSrc)) return false;
  if (!/glassTint: 0x7aa3c2/.test(bocSrc)) return false;
  if (/reflectivity: 0\.96/.test(bocSrc)) return false;
  if (/glassMetalness: 0\.72/.test(bocSrc)) return false;
  if (/mapillary/i.test(bocSrc)) return false;
  if (/hkShopfrontAlbedo/.test(bocSrc)) return false;
  if (!/createRetailPodiumMaterial\(\)/.test(bocSrc)) return false;
  if (!/quietGlass: true/.test(bocSrc)) return false;
  if (!/quietGlass = false/.test(sources?.materials || '')) return false;
  if (!/Math\.max\(2, Math\.round\(rise \/ 52\)\)/.test(bocSrc)) return false;
  if (!/emissiveIntensity: 0\.7/.test(bocSrc)) return false;
  if (!/metalness: 0\.04/.test(bocSrc)) return false;
  if (!/const member = 4\.6/.test(bocSrc)) return false;
  if (!/braceShaftFace\(a, b,/.test(bocSrc)) return false;
  if (!/braceShaftFace\(a, center,/.test(bocSrc)) return false;
  if (!/braceShaftFace\(b, center,/.test(bocSrc)) return false;
  const eyeFace = digit1BocEyeFace();
  if (!eyeFace) return false;
  if (Math.abs(eyeFace.facing + 1) > 0.05) return false;
  if (eyeFace.fraction !== 0.33) return false;
  if (!(eyeFace.edge > 40 && eyeFace.edge < 70)) return false;
  return true;
}

// Canyon pack is the chart the flank yield uncovers. No ashlar slab, no orange ribbon.
export function digit1CanyonDensity(sources, plan) {
  if (!noAshlarInvaderSlabs(sources, plan)) return false;
  if (!orangeCanyonGone(sources)) return false;
  if (!/proud of Digit1 LandsD flank charts/.test(sources?.pland || '')) return false;
  if (!/plandOmitsDigit1FlankChart/.test(sources?.frame || '')) return false;
  const podium = { x: 70, y: 6, z: 140 };
  if (plandOmitsDigit1FlankChart(podium, [CKC_CHART]) !== true) return false;
  if (plandOmitsPodiumInsideLandsd(podium, [CKC_CHART]) !== false) return false;
  if (plan?.podiumFillIds?.size) return false;
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
    gltf: read('js/hk-gltf-frame.js'),
    landmarks: read('js/landmarks.js')
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
    midRoadSlimeGone: midRoadSlimeGone(sources),
    digit1GroundLifeVisible: digit1GroundLifeVisible(),
    digit1SidewalkAuthentic: digit1SidewalkAuthentic(sources),
    digit1FlankMeltGone: digit1FlankMeltGone(),
    digit1CanyonDensity: digit1CanyonDensity(sources, plan),
    digit1FarFlankFidelity: digit1FarFlankFidelity(),
    digit1BocPlateOwned: digit1BocPlateOwned(sources),
    digit1BocPrismFidelity: digit1BocPrismFidelity(sources)
  };
  bars.pass = bars.noAshlarInvaderSlabs
    && bars.noZombieSkyHoles
    && bars.nullFillEdge >= 1024
    && bars.orangeCanyonGone
    && bars.hendersonInFront === true
    && bars.ndcCentreNotPland === true
    && bars.midRoadSlimeGone === true
    && bars.digit1GroundLifeVisible === true
    && bars.digit1SidewalkAuthentic === true
    && bars.digit1FlankMeltGone === true
    && bars.digit1CanyonDensity === true
    && bars.digit1FarFlankFidelity === true
    && bars.digit1BocPlateOwned === true
    && bars.digit1BocPrismFidelity === true
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
