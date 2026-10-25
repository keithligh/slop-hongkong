import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ISLAND_BOUNDS,
  BLOCKS,
  HK_CORE_BBOX,
  HK_NULL_HEIGHT,
  blockInHkCore,
  hkFootprintHeight,
  hkLandmarkOwnsShaft,
  hkMassingPlan,
  hkRetailSlices,
  hkScaleRing
} from './city-config.js';
import { DIGIT1_MIDBAND_PLATES, digit1MidbandWallSpec } from './hk-pland-frame.js';
import {
  createCurtainWallMaterial,
  createMidbandCanyonMaterial,
  createPodiumMasonryMaterial,
  createRetailPodiumMaterial
} from './tsl-materials.js';

// LandsD footprint ring extruded to TopHeight − BaseHeight. Same shape path as
// createExtrudedPolygonMesh in city-grid.js: outline in (x, −z), depth along Y.
// Only the Central core is built. A null height is skipped (HK_NULL_HEIGHT).
// Where the plate is wide enough, a full-footprint podium and a set-back tower
// share that recorded height. The street base is an opaque shopfront. Glass starts above that belt.
const HK_EXTRUDE_BATCH = 400;

function ringForExtrude(poly) {
  const pts = [];
  for (const p of poly || []) {
    const prev = pts[pts.length - 1];
    if (prev && Math.hypot(prev.x - p.x, prev.z - p.z) < 0.05) continue;
    pts.push({ x: p.x, z: p.z });
  }
  if (pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 0.05) pts.pop();
  }
  if (pts.length < 3) return null;
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j].x * (-pts[i].z) - pts[i].x * (-pts[j].z);
  }
  if (area < 0) pts.reverse();
  return pts;
}

function scaleHkRing(pts, scale) {
  if (!(scale < 1)) return pts;
  return ringForExtrude(hkScaleRing(pts, scale));
}

function extrudeHkFootprint(pts, height, lift = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, -pts[0].z);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, -pts[i].z);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, ISLAND_BOUNDS.sidewalkHeight + lift, 0);
  return geo;
}

function hkCurtainMaterials() {
  const make = (name, opts) => {
    const mat = createCurtainWallMaterial({ ...opts, boxLocal: false });
    mat.name = name;
    return mat;
  };
  return {
    tower0: make('hkTowerGlass0', {
      glassTint: 0x1a4d68,
      frameTint: 0xd5dee6,
      windowWidth: 2.35,
      floorHeight: 3.9,
      litProbability: 0.7,
      warmth: 0.4,
      reflectivity: 0.96,
      seed: 7.1
    }),
    tower1: make('hkTowerGlass1', {
      glassTint: 0x2a516c,
      frameTint: 0xe7eef3,
      windowWidth: 2.5,
      floorHeight: 3.9,
      litProbability: 0.64,
      warmth: 0.42,
      reflectivity: 0.95,
      seed: 8.6
    }),
    tower2: make('hkTowerGlass2', {
      glassTint: 0x1e3530,
      frameTint: 0x6e7872,
      windowWidth: 2.2,
      floorHeight: 3.8,
      litProbability: 0.66,
      warmth: 0.55,
      reflectivity: 0.9,
      seed: 9.4
    })
  };
}

function withRetailBelt(parts) {
  const sliced = [];
  for (const part of parts) {
    for (const slice of hkRetailSlices(part.y0, part.h, part.style)) {
      sliced.push({ ...part, ...slice });
    }
  }
  return sliced;
}

function tryExtrudeHk(pts, height, lift) {
  let geo = null;
  try {
    geo = extrudeHkFootprint(pts, height, lift);
  } catch {
    geo = null;
  }
  if (!geo || !geo.getAttribute('position') || geo.getAttribute('position').count < 3) {
    if (geo) geo.dispose();
    return null;
  }
  return geo;
}

function buildHkFootprintBlocks(scene, gltfPlan = null) {
  const group = new THREE.Group();
  group.name = 'HongKongCityBlocks';
  const colliders = [];
  const allBlocks = [];
  const glass = {
    ...hkCurtainMaterials(),
    podium: createPodiumMasonryMaterial(),
    retail: createRetailPodiumMaterial()
  };
  const batches = {
    podium: [],
    tower0: [],
    tower1: [],
    tower2: [],
    retail: []
  };
  let extruded = 0;
  let podiumTowers = 0;
  let skippedOutside = 0;
  let skippedNull = 0;
  let skippedDegenerate = 0;
  let skippedOwned = 0;
  let skippedGltf = 0;
  const hiddenIds = gltfPlan?.hiddenIds instanceof Set ? gltfPlan.hiddenIds : null;
  const flush = (key) => {
    const batch = batches[key];
    if (!batch.length) return;
    const merged = mergeGeometries(batch, false);
    for (const geo of batch) geo.dispose();
    batch.length = 0;
    if (!merged) return;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, glass[key]);
    mesh.name = key === 'retail' ? 'HkRetailPodium' : key === 'podium' ? 'HkPodiumMasonry' : 'HkCurtainWall';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const queue = (style, geo) => {
    const key = Object.hasOwn(batches, style) ? style : 'tower0';
    batches[key].push(geo);
    if (batches[key].length >= HK_EXTRUDE_BATCH) flush(key);
  };
  for (const b of BLOCKS) {
    if (b.park > 0.6 || b.median) continue;
    if (!blockInHkCore(b)) {
      skippedOutside++;
      continue;
    }
    const h = hkFootprintHeight(b);
    if (!(h > 0)) {
      skippedNull++;
      continue;
    }
    if (hkLandmarkOwnsShaft(b)) {
      // Bank of China Tower is the triangular mesh on its LandsD corners (landmarks.js),
      // or the individualised glTF when that mesh covers the plate. A square extrude
      // would hide either one.
      skippedOwned++;
      continue;
    }
    // PlanD donor: a corridor plate stays hidden. No belt slab is extruded
    // in its place, and the shopfront atlas is not hung on that hole.
    if (hiddenIds && hiddenIds.has(b.id)) {
      skippedGltf++;
      continue;
    }
    const plan = hkMassingPlan(b);
    if (!plan) {
      skippedNull++;
      continue;
    }
    const pts = ringForExtrude(b.poly);
    if (!pts) {
      skippedDegenerate++;
      continue;
    }
    let pieces = withRetailBelt(plan.parts.map((part) => ({
      ...part,
      ring: part.scale < 1 ? scaleHkRing(pts, part.scale) : pts
    })));
    if (pieces.some((part) => !part.ring)) {
      const shaftStyle = h < 32 ? 'podium' : plan.parts[plan.parts.length - 1].style;
      pieces = withRetailBelt([{ role: 'shaft', scale: 1, y0: 0, h: plan.height, style: shaftStyle, ring: pts }]);
    }
    const geos = [];
    let failed = false;
    for (const part of pieces) {
      const geo = tryExtrudeHk(part.ring, part.h, part.y0);
      if (!geo) {
        failed = true;
        break;
      }
      geos.push({ style: part.style, geo });
    }
    if (failed) {
      for (const item of geos) item.geo.dispose();
      const shaftStyle = h < 32 ? 'podium' : 'tower0';
      geos.length = 0;
      pieces = [];
      let shaftFailed = false;
      for (const slice of hkRetailSlices(0, h, shaftStyle)) {
        const shaft = tryExtrudeHk(pts, slice.h, slice.y0);
        if (!shaft) {
          shaftFailed = true;
          break;
        }
        geos.push({ style: slice.style, geo: shaft });
        pieces.push({ role: 'shaft', h: slice.h, y0: slice.y0 });
      }
      if (shaftFailed || !geos.length) {
        for (const item of geos) item.geo.dispose();
        skippedDegenerate++;
        continue;
      }
    }
    for (const item of geos) queue(item.style, item.geo);
    if (plan.parts.length > 1) podiumTowers++;
    extruded++;
    const ground = ISLAND_BOUNDS.sidewalkHeight;
    colliders.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, maxY: ground + h });
    allBlocks.push({
      id: b.name || `hk_${b.id}`,
      cx: b.cx,
      cz: b.cz,
      minX: b.minX,
      maxX: b.maxX,
      minZ: b.minZ,
      maxZ: b.maxZ,
      district: b.district || 'hk_cbd',
      maxH: h,
      footprints: pieces.map((part) => ({ x0: b.minX, x1: b.maxX, z0: b.minZ, z1: b.maxZ, h: part.y0 + part.h, pts: b.poly }))
    });
  }
  for (const key of Object.keys(batches)) flush(key);
  const midbandWalls = addDigit1MidbandWalls(group, gltfPlan);
  scene.add(group);
  const named = allBlocks.filter((block) => /HSBC Main Building|Prince's Building|Bank of China Building|Standard Chartered Bank Building/i.test(block.id));
  const curtainMeshes = group.children.filter((mesh) => mesh.name !== 'HkMidbandCanyon').length;
  console.info(
    `[buildings] Central core ${HK_CORE_BBOX.south},${HK_CORE_BBOX.west},${HK_CORE_BBOX.north},${HK_CORE_BBOX.east} ` +
    `extruded ${extruded} LandsD footprints; podium+tower ${podiumTowers}; curtain wall ${curtainMeshes} meshes; ` +
    `midband canyon ${midbandWalls}; ` +
    `null height ${HK_NULL_HEIGHT} ${skippedNull}; ` +
    `landmark shaft ${skippedOwned}; ` +
    `gltf hidden ${skippedGltf}; ` +
    `outside core skipped ${skippedOutside}; degenerate ${skippedDegenerate}` +
    (named.length ? `; ${named.map((block) => `${block.id} ${block.maxH}m`).join('; ')}` : '')
  );
  return {
    group,
    colliders,
    quadtree: null,
    allBlocks,
    update() {},
    updateLights() {}
  };
}

function buildCityBlocks(scene, gltfPlan = null) {
  return buildHkFootprintBlocks(scene, gltfPlan);
}

// Honest face for the Digit1 mid-band plates. No LandsD ring and no BUILDING
// glTF cover those eye hits, so a blank PlanD omit would open onto distant
// curtain. The wall is the look-frame plate: shopfront belt, glass above.
// Compare keeps the 2017 mesh and does not draw this stand-in.
// Kept off the footprint-extrude path: that path must not grow a box stand-in.
function addDigit1MidbandWalls(group, gltfPlan) {
  if (gltfPlan?.plandMode === 'compare') return 0;
  const material = createMidbandCanyonMaterial();
  for (const plate of DIGIT1_MIDBAND_PLATES) {
    const spec = digit1MidbandWallSpec(plate);
    const geo = new THREE.BoxGeometry(spec.size.along, spec.size.height, spec.size.side);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'HkMidbandCanyon';
    mesh.userData.hkSource = 'footprint';
    mesh.userData.hkPlate = spec.id;
    mesh.position.set(spec.position.x, spec.position.y, spec.position.z);
    mesh.rotation.y = spec.rotationY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return DIGIT1_MIDBAND_PLATES.length;
}

export { buildCityBlocks };
