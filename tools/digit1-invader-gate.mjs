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
  HK_GLTF_SHEETS,
  HK_RETAIL_BELT,
  HK_STREET_EYE,
  ISLAND_BOUNDS,
  ROADS,
  hkPlanCorners,
  hkResolveLandmarks
} from '../js/city-config.js';
import { digit1ChasePose, projectChaseNdc } from '../js/digit1-probe-frame.js';
import {
  HK_BOC_PHOTO_CHART,
  HK_DIGIT1_MIDBAND_GRID_ELIMINATED,
  HK_DIGIT1_MIDBAND_HITS,
  HK_DIGIT1_MIDBAND_HUNT,
  HK_DIGIT1_MIDBAND_NOT_BUILDING,
  HK_MIDBAND_PHOTO_CHARTS,
  NULL_FILL_EDGE,
  boxClosestDistance,
  digit1MidbandChartsCover,
  filterPinSheetBuildings,
  footprintOverlapRatio,
  gltfAlbedoSampler,
  gltfCoversFootprint,
  hkGltfBoxContains,
  isLandsdAtlasGutter,
  isLandsdNullTexel,
  landsdChartPixels,
  landsdChartRect,
  landsdChartWrap,
  landsdDilateGutter,
  landsdGutterMip,
  remapLandsdChartUv
} from '../js/hk-gltf-frame.js';
import { HK_PEDESTRIAN } from '../js/hk-pedestrian-data.js';
import { HK_BUS_SHELTER, hkShelterRoofPose, planHkStreetGround } from '../js/hk-pedestrian.js';
import {
  PLAND_BOC_PLATE_PEAK,
  PLAND_FLANK_TOP,
  PLAND_PODIUM_ABOVE_BELT,
  PLAND_STREET_SHELL_APRON,
  desVoeuxCarriageSegments,
  DIGIT1_MIDBAND_PLATES,
  digit1BocTowerPlate,
  digit1LookAxes,
  digit1LookFrame,
  digit1MidbandWallSpec,
  plandCarriageDistance,
  plandOmitsCarriageShell,
  plandOmitsDigit1BocPlate,
  plandOmitsDigit1FlankChart,
  plandOmitsDigit1LookGround,
  plandOmitsDigit1MidbandPlate,
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

function chaseChart(entry) {
  const sampler = gltfAlbedoSampler(entry);
  return sampler.maxEdge === 0
    && sampler.mipmaps === true
    && sampler.chartMips === true
    && sampler.anisotropy === 16
    && sampler.minFilter === 'mipmap'
    && sampler.wrap === 'clamp'
    && sampler.mipLevels !== 2;
}

function lookPointBox(dist) {
  const fx = Math.sin(HK_STREET_EYE.heading);
  const fz = Math.cos(HK_STREET_EYE.heading);
  const x = HK_STREET_EYE.x + dist * fx;
  const z = HK_STREET_EYE.z + dist * fz;
  return { minX: x, maxX: x, minZ: z, maxZ: z };
}

// Mid-far canyon charts on the Digit1 look. The photograph past 80 m is the
// same chart-packed anisotropic sample as the near disc. Off-look sheets stay
// downscaled and do not take that path. The chartless Bank of China Tower
// plate is owned by the LandsD shaft yield, not by widening this flank-chart
// punch. A low centre sample past Henderson (tile_22_26) is not this bar.
export function digit1FarFlankFidelity() {
  if (!chaseChart(lookPointBox(96))) return false;
  if (!chaseChart(lookPointBox(220))) return false;
  if (!chaseChart(HENDERSON)) return false;
  if (!chaseChart({ minX: 278, maxX: 316, minZ: 86, maxZ: 121 })) return false;
  if (!chaseChart({ minX: 341, maxX: 384, minZ: 135, maxZ: 178 })) return false;
  if (!(boxClosestDistance(CKC_CHART, HK_STREET_EYE) > 80)) return false;
  if (!chaseChart(CKC_CHART)) return false;
  const at80 = gltfAlbedoSampler(lookPointBox(80));
  if (at80.chartMips !== true || at80.anisotropy !== 16 || at80.wrap !== 'clamp') return false;
  const offLook = gltfAlbedoSampler({ minX: 400, maxX: 430, minZ: 20, maxZ: 40 });
  if (offLook.maxEdge !== 2048 || offLook.chartMips === true || offLook.mipLevels === 2) return false;
  const behind = gltfAlbedoSampler({ minX: -220, maxX: -160, minZ: 0, maxZ: 50 });
  if (behind.maxEdge !== 2048 || behind.chartMips === true || behind.mipLevels === 2) return false;
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

function rayOutsideMidband(target) {
  for (let step = 1; step <= 8; step++) {
    const t = step / 8;
    const point = {
      x: HK_STREET_EYE.x + (target.x - HK_STREET_EYE.x) * t,
      y: 2 + (target.y - 2) * t,
      z: HK_STREET_EYE.z + (target.z - HK_STREET_EYE.z) * t
    };
    if (plandOmitsDigit1MidbandPlate(point)) return false;
  }
  return true;
}

// Chartless mid-band canyon. The measured PlanD centroids yield. The replacement
// is the footprint plate wall, not a blank omit onto curtain at ~650 m.
// The face of that wall is digit1MidbandFacadeFidelity. Soft centre_low and the
// right apron stay. BoC and Henderson rays stay clear.
export function digit1MidbandCanyonFidelity(sources) {
  const right = { x: 84.93, y: 14.7, z: 77.32 };
  const up = { x: 80.89, y: 18.31, z: 71.08 };
  const left = { x: 141.18, y: 21.64, z: 44.13 };
  if (plandOmitsDigit1MidbandPlate(right) !== true) return false;
  if (plandOmitsDigit1MidbandPlate(up) !== true) return false;
  if (plandOmitsDigit1MidbandPlate(left) !== true) return false;
  if (plandOmitsDigit1MidbandPlate({ x: 88.57, y: 15.18, z: 79.25 }) !== true) return false;
  if (plandOmitsDigit1MidbandPlate({ x: 89.23, y: 19.8, z: 75.12 }) !== true) return false;
  if (plandOmitsDigit1MidbandPlate({ x: 146.84, y: 22.37, z: 44.76 }) !== true) return false;
  if (plandOmitsDigit1MidbandPlate({ x: right.x, y: PLAND_FLANK_TOP, z: right.z }) !== false) return false;
  if (plandOmitsDigit1MidbandPlate({ x: 278.49, y: 15.44, z: 110.37 }) !== false) return false;
  if (plandOmitsDigit1MidbandPlate({ x: 139.11, y: 12.52, z: 129.12 }) !== false) return false;
  if (plandOmitsDigit1MidbandPlate({ x: 80.35, y: 10.37, z: 53.23 }) !== false) return false;
  if (plandOmitsDigit1LookGround({ x: 80.35, y: 10.37, z: 53.23 }) !== true) return false;
  if (plandOmitsDigit1MidbandPlate({ x: 58.07, y: 10.59, z: 71.81 }) !== false) return false;
  if (plandOmitsDigit1FlankChart({ x: 58.07, y: 10.59, z: 71.81 }, [BOC_CHART]) !== true) return false;
  const tower = digit1BocTowerPlate();
  if (!tower) return false;
  if (plandOmitsDigit1BocPlate({ x: tower.cx, y: 25, z: tower.cz }, tower) !== true) return false;
  if (plandOmitsDigit1MidbandPlate({ x: 161.94, y: 24.67, z: 145.11 }) !== false) return false;
  if (plandOmitsDigit1MidbandPlate({ x: 217.99, y: 22.78, z: 92.93 }) !== false) return false;
  if (plandOmitsDigit1MidbandPlate({ x: 212.8, y: 31.7, z: 91.1 }) !== false) return false;
  if (plandOmitsDigit1MidbandPlate({ x: 2, y: HK_RETAIL_BELT + 12, z: 40 }) !== false) return false;
  if (plandOmitsDigit1LookGround({ x: 278.49, y: 15.44, z: 110.37 }) !== false) return false;
  if (!rayOutsideMidband({ x: 161.94, y: 24.67, z: 145.11 })) return false;
  if (!rayOutsideMidband({ x: 217.99, y: 22.78, z: 92.93 })) return false;
  if (DIGIT1_MIDBAND_PLATES.length !== 2) return false;
  const rightPlate = DIGIT1_MIDBAND_PLATES[0];
  const leftPlate = DIGIT1_MIDBAND_PLATES[1];
  if (rightPlate.sideMin <= 16 || leftPlate.sideMax >= -16) return false;
  const axes = digit1LookAxes();
  const rightWall = digit1MidbandWallSpec(rightPlate);
  const rightFrame = digit1LookFrame(rightWall.position);
  const rightMidAlong = (rightPlate.alongMin + rightPlate.alongMax) * 0.5;
  const rightMidSide = (rightPlate.sideMin + rightPlate.sideMax) * 0.5;
  if (Math.abs(rightFrame.along - rightMidAlong) > 1e-6) return false;
  if (Math.abs(rightFrame.side - rightMidSide) > 1e-6) return false;
  if (Math.abs(Math.cos(rightWall.rotationY) - axes.fx) > 1e-9) return false;
  if (Math.abs(-Math.sin(rightWall.rotationY) - axes.fz) > 1e-9) return false;
  const leftWall = digit1MidbandWallSpec(leftPlate);
  if (!(leftWall.size.height > 40 && leftWall.size.height < 70)) return false;
  const page = sources?.pland || '';
  if (!/omitted \$\{midband\} triangles on the Digit1 mid-band chartless plate/.test(page)) return false;
  if (!/boxes\?\.length && plandOmitsDigit1MidbandPlate/.test(page)) return false;
  const buildings = sources?.buildings || '';
  if (!/HkMidbandCanyon/.test(buildings)) return false;
  if (!/createMidbandCanyonMaterial/.test(buildings)) return false;
  if (!/plandMode === 'compare'/.test(buildings)) return false;
  if (/hkShopfrontAlbedo/.test(buildings)) return false;
  if (/hkCorridorPodiumFill/.test(buildings)) return false;
  const materials = sources?.materials || '';
  const start = materials.indexOf('function createMidbandCanyonMaterial');
  const end = materials.indexOf('export {', start);
  const body = start >= 0 && end > start ? materials.slice(start, end) : '';
  if (!/mat\.name = 'hkMidbandCanyon'/.test(body)) return false;
  if (/hkShopfrontAlbedo|0x8a847c|createCurtainWallMaterial|hkTowerGlass/.test(body)) return false;
  return true;
}

// Chartless mid-band face. No Active ring covers the plates, so this is not a
// BUILDING photograph. The stand-in is a two-storey opaque shopfront and a
// window grid above it. Flat stone courses, the orange atlas, corridor ashlar,
// and curtain glass to the pavement fail. Sleeping Dogs is not this bar.
export function digit1MidbandFacadeFidelity(sources) {
  const materials = sources?.materials || '';
  const start = materials.indexOf('function createMidbandCanyonMaterial');
  const end = materials.indexOf('export {', start);
  const body = start >= 0 && end > start ? materials.slice(start, end) : '';
  if (!/mat\.name = 'hkMidbandCanyon'/.test(body)) return false;
  if (!/HK_RETAIL_BELT/.test(body)) return false;
  if (!/HK_STREET_EYE/.test(body)) return false;
  if (!/const podium/.test(body)) return false;
  if (!/shopMouth/.test(body)) return false;
  if (!/signBand/.test(body)) return false;
  if (!/mullion/.test(body)) return false;
  if (!/const pane/.test(body)) return false;
  if (!/storey/.test(body)) return false;
  if (!/emissiveNode/.test(body)) return false;
  if (!/roughnessNode/.test(body)) return false;
  if (!/mix\(upper, podiumCol, frame\.podium\)/.test(body)) return false;
  if (/vec3\(0\.76,\s*0\.69,\s*0\.58\)/.test(body)) return false;
  if (/y\.mul\(0\.46\)/.test(body)) return false;
  if (/hkShopfrontAlbedo|0x8a847c|createCurtainWallMaterial|hkTowerGlass|podiumStreetColor/.test(body)) return false;
  const buildings = sources?.buildings || '';
  if (!/mesh\.userData\.hkSource = 'footprint'/.test(buildings)) return false;
  if (!/new THREE\.BoxGeometry/.test(buildings)) return false;
  if (!/plandMode === 'compare'/.test(buildings)) return false;
  if (/hkShopfrontAlbedo|hkCorridorPodiumFill/.test(buildings)) return false;
  if (DIGIT1_MIDBAND_PLATES.length !== 2) return false;
  return true;
}

// Still-chartless Digit1 photo. Mid-band hits stay outside every BUILDING box
// on 11-SW-9C and 11-SW-14A, so the canyon wall remains. The Bank of China
// plate is the LandsD photograph B346831557701063A0. The white-X prism stays
// the fallback when that manifest is absent. This is not a Sleeping Dogs claim.
export function digit1PhotoFidelity(sources) {
  if (!HK_GLTF_SHEETS.includes(HK_BOC_PHOTO_CHART.sheet)) return false;
  if (HK_BOC_PHOTO_CHART.sheet !== '11-SW-14A') return false;
  if (HK_BOC_PHOTO_CHART.id !== 'B346831557701063A0') return false;
  const tower = digit1BocTowerPlate();
  if (!tower) return false;
  if (gltfCoversFootprint(tower, [HK_BOC_PHOTO_CHART]) !== true) return false;
  if (!(footprintOverlapRatio(tower, HK_BOC_PHOTO_CHART, 2) >= 0.9)) return false;
  const hits = [
    { x: 84.93, z: 77.32 },
    { x: 80.89, z: 71.08 },
    { x: 141.18, z: 44.13 }
  ];
  for (const hit of hits) {
    const inside = hit.x >= HK_BOC_PHOTO_CHART.minX && hit.x <= HK_BOC_PHOTO_CHART.maxX
      && hit.z >= HK_BOC_PHOTO_CHART.minZ && hit.z <= HK_BOC_PHOTO_CHART.maxZ;
    if (inside) return false;
  }
  const sampler = gltfAlbedoSampler(HK_BOC_PHOTO_CHART);
  if (sampler.chartMips !== true || sampler.anisotropy !== 16 || sampler.maxEdge !== 0) return false;
  if (sampler.wrap !== 'clamp' || sampler.mipLevels === 2) return false;
  const stray = { id: 'stray', minX: 10, maxX: 30, minZ: 10, maxZ: 30, span: 20 };
  const kept = filterPinSheetBuildings([stray, HK_BOC_PHOTO_CHART]);
  if (kept.length !== 1 || kept[0].id !== HK_BOC_PHOTO_CHART.id) return false;
  const frame = sources?.gltf || '';
  if (!frame.includes(HK_BOC_PHOTO_CHART.id)) return false;
  if (!frame.includes('11-SW-14A')) return false;
  if (!/export function filterPinSheetBuildings/.test(frame)) return false;
  const page = sources?.gltfPage || '';
  if (!/isGltfPinSheet\(manifest\.sheet\)/.test(page)) return false;
  if (!/filterPinSheetBuildings\(/.test(page)) return false;
  const fetchSrc = sources?.fetch || '';
  if (!/11-SW-14A/.test(fetchSrc)) return false;
  if (!/filterPinSheetBuildings\(/.test(fetchSrc)) return false;
  if (!/isGltfPinSheet\(sheet\)/.test(fetchSrc)) return false;
  const landmarks = sources?.landmarks || '';
  if (!/gltfCoversFootprint\(site\.block, gltfMeshes\)/.test(landmarks)) return false;
  if (!digit1BocPrismFidelity(sources)) return false;
  if (!digit1MidbandCanyonFidelity(sources)) return false;
  if (!digit1MidbandFacadeFidelity(sources)) return false;
  return true;
}

// Cut #36 residual. True only when a LandsD BUILDING chart contains every
// Digit1 mid-band hit. The procedural canyon is not that chart. An empty
// HK_MIDBAND_PHOTO_CHARTS list is the exhaustive miss: 9C holds the hits, and
// 9C / 8D / 14A / 13B leave them outside every BUILDING mesh. A false result
// is an open residual. It does not fail the #22–#35 hold suite. Sleeping Dogs
// is not claimed either way.
export function digit1MidbandPhotoFidelity(sources) {
  const frame = sources?.gltf || '';
  if (!frame.includes('HK_DIGIT1_MIDBAND_HUNT')) return false;
  if (!frame.includes('HK_MIDBAND_PHOTO_CHARTS')) return false;
  if (!frame.includes('HK_DIGIT1_MIDBAND_NOT_BUILDING')) return false;
  for (const row of HK_DIGIT1_MIDBAND_HUNT) {
    if (!(row.closestM > 0)) return false;
    if (!frame.includes(row.sheet) || !frame.includes(row.closestId)) return false;
    for (const hit of HK_DIGIT1_MIDBAND_HITS) {
      if (hkGltfBoxContains(row, hit.x, hit.z)) return false;
    }
  }
  for (const row of HK_DIGIT1_MIDBAND_GRID_ELIMINATED) {
    if (!(row.minM >= 400)) return false;
  }
  for (const hit of HK_DIGIT1_MIDBAND_HITS) {
    if (hkGltfBoxContains(HK_DIGIT1_MIDBAND_NOT_BUILDING, hit.x, hit.z)) return false;
    if (hkGltfBoxContains(HK_BOC_PHOTO_CHART, hit.x, hit.z)) return false;
  }
  if (!digit1MidbandCanyonFidelity(sources)) return false;
  if (!digit1MidbandFacadeFidelity(sources)) return false;
  if (digit1MidbandChartsCover()) {
    const fetchSrc = sources?.fetch || '';
    const buildings = sources?.buildings || '';
    for (const chart of HK_MIDBAND_PHOTO_CHARTS) {
      if (!HK_GLTF_SHEETS.includes(chart.sheet)) return false;
      if (!fetchSrc.includes(chart.sheet)) return false;
      if (!frame.includes(chart.id)) return false;
    }
    if (!/HkMidbandCanyon/.test(buildings)) return false;
    return true;
  }
  return false;
}

// Measured 2026-10-25 from the Open3Dhk zips. Bank of China Tower material
// _001 on 11-SW-14A uses the left strip of a 4096² atlas. Bank of China
// Building material _002 on 11-SW-9C uses the left half. The repeating crown
// primitive on the tower is outside the image and must not be cropped.
const BOC_TOWER_CHART_UV = Object.freeze({
  minU: 0.0005000000237487257,
  minV: 0,
  maxU: 0.12449999898672104,
  maxV: 0.4932631254196167
});
const BOC_FLANK_CHART_UV = Object.freeze({
  minU: 0,
  minV: 0,
  maxU: 0.5,
  maxV: 0.9488099813461304
});
const BOC_REPEAT_UV = Object.freeze({
  minU: -4.069892406463623,
  minV: 0,
  maxU: 5.799892425537109,
  maxV: 1.000030517578125
});

// Primary bar. Chase photographs are cropped to the UV chart they use, clamped,
// and mip-filtered without averaging LandsD gutter into the facade. The
// mid-band BUILDING hunt stays an open residual and is not this bar.
export function digit1PhotoAtlasFidelity(sources) {
  const sampler = gltfAlbedoSampler(HK_BOC_PHOTO_CHART);
  if (sampler.chartMips !== true || sampler.wrap !== 'clamp' || sampler.anisotropy !== 16) return false;
  if (sampler.maxEdge !== 0 || sampler.mipLevels === 2 || sampler.minFilter !== 'mipmap') return false;
  const tower = landsdChartRect(
    BOC_TOWER_CHART_UV.minU,
    BOC_TOWER_CHART_UV.minV,
    BOC_TOWER_CHART_UV.maxU,
    BOC_TOWER_CHART_UV.maxV
  );
  if (!tower || !(tower.u1 - tower.u0 < 0.2) || !(tower.v1 - tower.v0 < 0.6)) return false;
  const flank = landsdChartRect(
    BOC_FLANK_CHART_UV.minU,
    BOC_FLANK_CHART_UV.minV,
    BOC_FLANK_CHART_UV.maxU,
    BOC_FLANK_CHART_UV.maxV
  );
  if (!flank || !(flank.u1 - flank.u0 <= 0.5)) return false;
  if (landsdChartRect(0, 0, 1, 1) !== null) return false;
  if (landsdChartWrap(BOC_REPEAT_UV.minU, BOC_REPEAT_UV.minV, BOC_REPEAT_UV.maxU, BOC_REPEAT_UV.maxV) !== 'repeat') return false;
  if (landsdChartRect(BOC_REPEAT_UV.minU, BOC_REPEAT_UV.minV, BOC_REPEAT_UV.maxU, BOC_REPEAT_UV.maxV) !== null) return false;
  const [u0, v0] = remapLandsdChartUv(BOC_TOWER_CHART_UV.minU, BOC_TOWER_CHART_UV.minV, tower);
  const [u1, v1] = remapLandsdChartUv(BOC_TOWER_CHART_UV.maxU, BOC_TOWER_CHART_UV.maxV, tower);
  if (u0 !== 0 || v0 !== 0 || u1 !== 1 || v1 !== 1) return false;
  const px = landsdChartPixels(tower, 4096, 4096);
  if (!px || px.width > 600 || px.width < 400 || px.height > 2200 || px.height < 1800) return false;
  if (isLandsdAtlasGutter(60, 60, 60) !== true) return false;
  if (isLandsdNullTexel(60, 60, 60) !== false) return false;
  if (isLandsdAtlasGutter(0, 0, 0) !== false) return false;
  const src = new Uint8Array([
    200, 30, 20, 255, 60, 60, 60, 255,
    180, 40, 25, 255, 136, 138, 137, 255
  ]);
  const mip = landsdGutterMip(src, 2, 2);
  if (mip.width !== 1 || mip.height !== 1) return false;
  if (mip.data[0] !== 190 || mip.data[1] !== 35 || mip.data[2] !== 23) return false;
  const shore = new Uint8Array([
    10, 20, 30, 255, 60, 60, 60, 255
  ]);
  const dilated = landsdDilateGutter(shore, 2, 1, 1);
  if (dilated[0] !== 10 || dilated[4] !== 10 || dilated[5] !== 20 || dilated[6] !== 30) return false;
  const page = sources?.gltfPage || '';
  if (!/export function packLandsdChart/.test(page)) return false;
  if (!/landsdGutterMip/.test(page) || !/ClampToEdgeWrapping/.test(page)) return false;
  if (!/chartMips/.test(page) || !/packLandsdChart\(geo, obj\.material, sampler\)/.test(page)) return false;
  const frame = sources?.gltf || '';
  if (!/export function landsdChartRect/.test(frame)) return false;
  if (!/export function isLandsdAtlasGutter/.test(frame)) return false;
  if (!/chartMips: true/.test(frame)) return false;
  const fetchSrc = sources?.fetch || '';
  if (!/11-SW-14A/.test(fetchSrc)) return false;
  if (/mapillary/i.test(page)) return false;
  if (HK_MIDBAND_PHOTO_CHARTS.length !== 0) return false;
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
    gltfPage: read('js/hk-gltf.js'),
    fetch: read('tools/fetch-central-gltf-sheet.mjs'),
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
    digit1BocPrismFidelity: digit1BocPrismFidelity(sources),
    digit1MidbandCanyonFidelity: digit1MidbandCanyonFidelity(sources),
    digit1MidbandFacadeFidelity: digit1MidbandFacadeFidelity(sources),
    digit1PhotoFidelity: digit1PhotoFidelity(sources),
    digit1PhotoAtlasFidelity: digit1PhotoAtlasFidelity(sources),
    digit1MidbandPhotoFidelity: digit1MidbandPhotoFidelity(sources)
  };
  // #22–#35 holds. The mid-band photograph is an open residual until a BUILDING
  // chart covers the hits. A documented miss does not fail this suite.
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
    && bars.digit1MidbandCanyonFidelity === true
    && bars.digit1MidbandFacadeFidelity === true
    && bars.digit1PhotoFidelity === true
    && bars.digit1PhotoAtlasFidelity === true
    && !/NULL_FILL_EDGE = 256/.test(sources.gltf);
  const openResiduals = [];
  if (bars.digit1MidbandPhotoFidelity !== true) openResiduals.push('digit1MidbandPhotoFidelity');
  bars.openResiduals = openResiduals;
  bars.sleepingDogsBar = 'NOT YET';
  return bars;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const report = digit1InvaderGate(root);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}
