import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ISLAND_BOUNDS,
  PLAY_BOUNDS,
  HONG_KONG_ISLAND_COASTLINE,
  KOWLOON_COASTLINE,
  BLOCKS,
  ROADS,
  HK_CORE_WORLD,
  HK_RETAIL_BELT,
  HK_STREET_EYE,
  HK_STREET_NEAR
} from './city-config.js';
import {
  createCurbMaterial,
  createCurtainWallMaterial,
  createLaneStripeMaterial,
  createRetailPodiumMaterial,
  createRoadSurfaceMaterial,
  createSidewalkMaterial,
  createWaterMaterial
} from './tsl-materials.js';
import { GEO } from './geo-source.js';
import { HK_CANYON_HEIGHT, canyonGlassWalls, clipCanyonWalls, hkCanyonBuildings, planHkStreetCanyon } from './hk-ground-fill.js';
import { HK_PEDESTRIAN } from './hk-pedestrian-data.js';
import { HK_BUS_SHELTER, planHkStreetGround } from './hk-pedestrian.js';
import { planHkRoadDeck } from './hk-road-deck.js';

// Hong Kong coast, Victoria Harbour, and the centreline asphalt deck. Lots stay in buildings.js.

/**
 * Merges static non-instanced THREE.Mesh objects sharing the same material into a single
 * batched BufferGeometry per material to minimize WebGPU render & shadow pass draw calls.
 */
function batchStaticGroupMeshes(rootGroup, excludeMaterials = null) {
  if (!mergeGeometries) return;
  rootGroup.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(rootGroup.matrixWorld).invert();
  const buckets = new Map();

  rootGroup.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || !obj.geometry || !obj.material) return;
    if (excludeMaterials && excludeMaterials.has(obj.material)) return;
    const attrs = obj.geometry.attributes;
    if (!attrs.position || !attrs.normal || !attrs.uv) return;
    if (!buckets.has(obj.material)) {
      buckets.set(obj.material, []);
    }
    buckets.get(obj.material).push(obj);
  });

  for (const [mat, meshes] of buckets.entries()) {
    if (meshes.length < 2) continue;
    const geos = [];
    let anyCast = false;
    let anyReceive = false;

    for (const m of meshes) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const key of Object.keys(g.attributes)) {
        if (key !== 'position' && key !== 'normal' && key !== 'uv') {
          g.deleteAttribute(key);
        }
      }
      const relMat = new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld);
      g.applyMatrix4(relMat);
      geos.push(g);
      if (m.castShadow) anyCast = true;
      if (m.receiveShadow) anyReceive = true;
      if (m.parent) m.parent.remove(m);
    }

    const merged = mergeGeometries(geos, false);
    if (merged) {
      const batchedMesh = new THREE.Mesh(merged, mat);
      batchedMesh.castShadow = anyCast;
      batchedMesh.receiveShadow = anyReceive;
      rootGroup.add(batchedMesh);
    }
  }
}

/**
 * Helper to convert an array of world {x, z} polygon vertices into a horizontal THREE.Shape
 * in (x, -z) space so that rotating by rotateX(-Math.PI / 2) maps (x, -z, 0) -> (x, 0, z)
 * with an upward (+Y) surface normal.
 */
function createWorldXZShape(pts) {
  const shape = new THREE.Shape();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  }
  shape.closePath();
  return shape;
}

function createExtrudedPolygonMesh(pts, bottomY, height, material, receiveShadow = true, castShadow = false) {
  const shape = createWorldXZShape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bottomY, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  mesh.castShadow = castShadow;
  return mesh;
}

function addHkRibbonMesh(group, mat, segs, y, height, name, renderOrder = 0) {
  if (!segs.length) return null;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, mat, segs.length);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = renderOrder;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    dummy.position.set(s.x, y, s.z);
    dummy.rotation.set(0, s.yaw, 0);
    dummy.scale.set(s.w, height, s.len);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  const span = new Float32Array(segs.length * 2);
  for (let i = 0; i < segs.length; i++) {
    span[i * 2] = segs[i].w;
    span[i * 2 + 1] = segs[i].len;
  }
  geo.setAttribute('hkSpan', new THREE.InstancedBufferAttribute(span, 2));
  mesh.computeBoundingSphere();
  group.add(mesh);
  return mesh;
}

// Asphalt deck on the LandsD / OSM centreline. Central gets curbs and paint.
// GEO.roadGraph stays the traffic graph; drawing it again would stack a second deck.
function buildHkRoadRibbons(group, roadMat, sidewalkMat) {
  const asphaltMat = roadMat || new THREE.MeshStandardNodeMaterial({ color: 0x2c3136, roughness: 0.55, metalness: 0.08 });
  asphaltMat.name = 'hkRoadCentreline';
  asphaltMat.polygonOffset = true;
  asphaltMat.polygonOffsetFactor = -1;
  asphaltMat.polygonOffsetUnits = -1;
  const curbMat = createCurbMaterial();
  curbMat.name = 'hkRoadCurb';
  const whiteMat = createLaneStripeMaterial(0xf3f0e6);
  whiteMat.name = 'hkLaneWhite';
  const yellowMat = createLaneStripeMaterial(0xe6b01e);
  yellowMat.name = 'hkLaneYellow';
  const deck = planHkRoadDeck(ROADS, HK_CORE_WORLD);
  const white = [];
  const yellow = [];
  for (const mark of deck.markings) {
    if (mark.color === 'yellow') yellow.push(mark);
    else white.push(mark);
  }
  // Road top 0.07. Kerb rises from the asphalt to the sidewalk top at 0.22.
  // The walk starts above the road so the stone face is the upstand between them.
  addHkRibbonMesh(group, asphaltMat, deck.asphalt, 0.02, 0.05, 'HkRoadCentrelines', 1);
  if (sidewalkMat) addHkRibbonMesh(group, sidewalkMat, deck.sidewalks, 0.08, 0.14, 'HkSidewalks', 1);
  addHkRibbonMesh(group, curbMat, deck.curbs, 0.02, 0.2, 'HkCurbs', 2);
  addHkRibbonMesh(group, whiteMat, white, 0.072, 0.012, 'HkLaneMarkingsWhite', 3);
  addHkRibbonMesh(group, yellowMat, yellow, 0.074, 0.012, 'HkLaneMarkingsYellow', 3);
  const graphLinks = GEO.roadGraph && GEO.roadGraph.links ? GEO.roadGraph.links.length : 0;
  console.info(
    `[roads] HK asphalt ${deck.asphalt.length} sidewalks ${deck.sidewalks.length} ` +
    `curbs ${deck.curbs.length} markings ${deck.markings.length} roadGraph links ${graphLinks}`
  );
}

function buildHkPierDecks(group) {
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x8d8880, roughness: 0.82, metalness: 0.04 });
  mat.name = 'hkPierDeck';
  const geos = [];
  for (const p of GEO.piers || []) {
    const ring = p.ring;
    if (!ring || ring.length < 6) continue;
    const pts = [];
    for (let i = 0; i < ring.length; i += 2) pts.push({ x: ring[i], z: ring[i + 1] });
    if (pts.length < 3) continue;
    try {
      geos.push(createExtrudedPolygonMesh(pts, 0.02, 0.32, mat, true, false).geometry);
    } catch {
      // A bad ring must not drop the rest of the harbour decks.
    }
  }
  if (!geos.length) return;
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
  mesh.name = 'HkPierDecks';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);
}

function createFlatPolygonMesh(pts, y, material, receiveShadow = true) {
  const shape = createWorldXZShape(pts);
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

function buildCityGrid(scene, gltfPlan = null) {
  return buildHkCityGrid(scene, gltfPlan);
}

// Podiums hard against the sidewalk. A LandsD footprint within reach is met;
// a side with none still gets a street wall. The harbour ring is not walled.
function buildHkStreetCanyon(group, gltfPlan = null) {
  const plan = planHkStreetCanyon({
    roads: ROADS,
    buildings: hkCanyonBuildings(BLOCKS, HK_CORE_WORLD),
    core: HK_CORE_WORLD,
    island: HONG_KONG_ISLAND_COASTLINE
  });
  const gltfMeshes = gltfPlan?.selected || [];
  const walls = clipCanyonWalls(plan.walls, gltfMeshes, gltfMeshes.length ? {
    eye: HK_STREET_EYE,
    near: HK_STREET_NEAR
  } : {});
  const retailMat = createRetailPodiumMaterial();
  const wallMat = createCurtainWallMaterial({
    glassTint: 0x1c3a45,
    frameTint: 0x9aa6b0,
    windowWidth: 3.15,
    floorHeight: 3.9,
    spandrelRatio: 0.3,
    litProbability: 0.84,
    warmth: 0.74,
    reflectivity: 0.82,
    seed: 2.4,
    boxLocal: false
  });
  wallMat.name = 'hkCanyonGlass';
  const ribbons = walls.map((wall) => ({ x: wall.x, z: wall.z, yaw: wall.yaw, w: wall.depth, len: wall.len }));
  const lookSolids = gltfPlan?.lookSolids || [];
  const glass = gltfMeshes.length || lookSolids.length ? canyonGlassWalls(walls, gltfMeshes, {
    eye: HK_STREET_EYE,
    belt: HK_RETAIL_BELT,
    sidewalk: ISLAND_BOUNDS.sidewalkHeight,
    solids: lookSolids
  }) : walls;
  const glassRibbons = glass.map((wall) => ({ x: wall.x, z: wall.z, yaw: wall.yaw, w: wall.depth, len: wall.len }));
  const baseY = 0.16;
  const baseH = Math.max(0.4, HK_RETAIL_BELT - baseY);
  const glassH = Math.max(0.4, HK_CANYON_HEIGHT - baseH);
  addHkRibbonMesh(group, retailMat, ribbons, baseY, baseH, 'HkCentralStreetWalls', 1);
  addHkRibbonMesh(group, wallMat, glassRibbons, HK_RETAIL_BELT, glassH, 'HkCentralStreetWallsGlass', 1);
  console.info(`[ground] Central street walls ${plan.walls.length} kept ${walls.length} after LandsD overlap; glass ${glass.length} where the look ray misses and no tall mesh is on the lot side`);
  return walls.map((wall) => ({
    minX: wall.minX,
    maxX: wall.maxX,
    minZ: wall.minZ,
    maxZ: wall.maxZ,
    maxY: baseY + HK_CANYON_HEIGHT,
    obb: wall.obb
  }));
}

function paintStopLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.MeshBasicNodeMaterial({ color: 0xf0c31a, name: 'hkBusStop', side: THREE.DoubleSide });
  const draw = () => {
    ctx.fillStyle = '#f0c31a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1408';
    let size = 72;
    ctx.font = `700 ${size}px "Noto Sans TC", sans-serif`;
    while (size > 28 && ctx.measureText(text).width > canvas.width - 36) {
      size -= 2;
      ctx.font = `700 ${size}px "Noto Sans TC", sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  };
  draw();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicNodeMaterial({ map, side: THREE.DoubleSide });
  mat.name = 'hkBusStop';
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      draw();
      map.needsUpdate = true;
    });
  }
  return mat;
}

function furniturePose(kind) {
  switch (kind) {
    case 'bench':
      return { w: 0.48, len: 1.35, y: 0.22, h: 0.42 };
    case 'lamp':
      return { w: 0.12, len: 0.12, y: 0.22, h: 3.6 };
    default: {
      const unknown = kind;
      throw new Error(`Unhandled street furniture ${unknown}`);
    }
  }
}

// OSM sidewalks, pedestrian areas, zebra crossings, and bus stops.
// The 2.05 m curb walk stays. This is the mapped pavement outside that strip.
function buildHkPedestrianGround(group) {
  const plan = planHkStreetGround(HK_PEDESTRIAN, ROADS);
  const walkMat = createSidewalkMaterial();
  walkMat.name = 'hkOsmPavement';
  walkMat.polygonOffset = true;
  walkMat.polygonOffsetFactor = -2;
  walkMat.polygonOffsetUnits = -2;
  const areaMat = createSidewalkMaterial({ ribbon: false });
  areaMat.name = 'hkOsmPedestrianArea';
  areaMat.polygonOffset = true;
  areaMat.polygonOffsetFactor = -2;
  areaMat.polygonOffsetUnits = -2;
  addHkRibbonMesh(group, walkMat, plan.walks, 0.08, 0.14, 'HkOsmPavement', 1);
  for (const ring of plan.areas) {
    const mesh = createExtrudedPolygonMesh(ring, 0.08, 0.14, areaMat, true, false);
    mesh.name = 'HkOsmPedestrianArea';
    group.add(mesh);
  }
  const zebra = createLaneStripeMaterial(0xf4f1e8);
  zebra.name = 'hkCrossing';
  addHkRibbonMesh(group, zebra, plan.crossings, 0.078, 0.016, 'HkCrossings', 4);

  const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x3a4046, roughness: 0.62, metalness: 0.18 });
  poleMat.name = 'hkBusPole';
  const roofMat = new THREE.MeshStandardNodeMaterial({ color: 0x2c3338, roughness: 0.7, metalness: 0.08 });
  roofMat.name = 'hkBusShelter';
  const benchMat = new THREE.MeshStandardNodeMaterial({ color: 0x6d6256, roughness: 0.78, metalness: 0.04 });
  benchMat.name = 'hkBench';
  const lampMat = new THREE.MeshStandardNodeMaterial({ color: 0x4e555c, roughness: 0.55, metalness: 0.22 });
  lampMat.name = 'hkStreetLamp';
  const poles = [];
  const roofs = [];
  const benches = [];
  const lamps = [];
  const colliders = [];
  const labels = new Map();
  for (const stop of plan.stops) {
    const shelter = HK_BUS_SHELTER;
    poles.push({ x: stop.x, z: stop.z, yaw: 0, w: shelter.poleW, len: shelter.poleW });
    if (stop.shelter && !stop.inRoad) {
      const away = stop.yaw + Math.PI;
      roofs.push({
        x: stop.x + Math.sin(away) * shelter.roofSetback,
        z: stop.z + Math.cos(away) * shelter.roofSetback,
        yaw: stop.roadYaw,
        w: shelter.roofW,
        len: shelter.roofLen
      });
    }
    if (stop.name && typeof document !== 'undefined') {
      let mat = labels.get(stop.name);
      if (!mat) {
        mat = paintStopLabel(stop.name);
        labels.set(stop.name, mat);
      }
      const sign = new THREE.Mesh(new THREE.BoxGeometry(shelter.signW, shelter.signH, shelter.signD), mat);
      sign.name = 'HkBusStopSign';
      sign.position.set(stop.x, shelter.signY, stop.z);
      sign.rotation.y = stop.yaw;
      sign.castShadow = true;
      group.add(sign);
    }
    if (!stop.inRoad) {
      colliders.push({
        minX: stop.x - 0.35,
        maxX: stop.x + 0.35,
        minZ: stop.z - 0.35,
        maxZ: stop.z + 0.35,
        maxY: stop.shelter ? 2.7 : 2.4
      });
    }
  }
  for (const item of plan.furniture) {
    const pose = furniturePose(item.kind);
    const slab = { x: item.x, z: item.z, yaw: item.yaw, w: pose.w, len: pose.len };
    if (item.kind === 'bench') benches.push(slab);
    else lamps.push(slab);
  }
  const poleMesh = addHkRibbonMesh(group, poleMat, poles, HK_BUS_SHELTER.poleY, HK_BUS_SHELTER.poleH, 'HkBusPoles', 2);
  const roofMesh = addHkRibbonMesh(group, roofMat, roofs, HK_BUS_SHELTER.roofY, HK_BUS_SHELTER.roofH, 'HkBusShelters', 2);
  if (poleMesh) poleMesh.castShadow = true;
  if (roofMesh) roofMesh.castShadow = true;
  const bench = furniturePose('bench');
  const lamp = furniturePose('lamp');
  addHkRibbonMesh(group, benchMat, benches, bench.y, bench.h, 'HkBenches', 2);
  addHkRibbonMesh(group, lampMat, lamps, lamp.y, lamp.h, 'HkStreetLamps', 2);
  console.info(
    `[ground] OSM pavement ${plan.walks.length} areas ${plan.areas.length} ` +
    `crossings ${plan.crossingSites} stops ${plan.stops.length} ` +
    `(shelter ${roofs.length}) benches ${benches.length} lamps ${lamps.length}`
  );
  return colliders;
}

// Coast rings become land. Carriageways are an asphalt deck on GEO.roads.
// Victoria Harbour water uses PLAY_BOUNDS (Island + Kowloon + harbour).
function buildHkCityGrid(scene, gltfPlan = null) {
  const group = new THREE.Group();
  group.name = 'HongKongCityGrid';

  const play = PLAY_BOUNDS || ISLAND_BOUNDS;
  const waterMat = createWaterMaterial();
  const pad = 3200;
  const waterGeo = new THREE.PlaneGeometry(
    (play.maxX - play.minX) + pad * 2,
    (play.maxZ - play.minZ) + pad * 2,
    1,
    1
  );
  waterGeo.rotateX(-Math.PI / 2);
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.name = 'VictoriaHarbourWater';
  waterMesh.position.set((play.minX + play.maxX) * 0.5, play.waterLevel, (play.minZ + play.maxZ) * 0.5);
  group.add(waterMesh);

  const landMat = new THREE.MeshStandardNodeMaterial({
    color: 0x6a7264,
    roughness: 0.94,
    metalness: 0,
    side: THREE.DoubleSide
  });
  landMat.name = 'hkCoastLand';
  landMat.polygonOffset = true;
  landMat.polygonOffsetFactor = 1;
  landMat.polygonOffsetUnits = 1;
  const seawallMat = new THREE.MeshStandardNodeMaterial({
    color: 0x5c5a55,
    roughness: 0.82,
    metalness: 0.1,
    side: THREE.DoubleSide
  });
  for (const ring of [HONG_KONG_ISLAND_COASTLINE, KOWLOON_COASTLINE]) {
    if (!ring || ring.length < 3) continue;
    const land = createFlatPolygonMesh(ring, 0.0, landMat, true);
    land.name = 'HongKongCoastGround';
    group.add(land);
    const wall = createExtrudedPolygonMesh(ring, -2.35, 2.31, seawallMat, true, false);
    wall.name = 'HongKongCoastSeawall';
    group.add(wall);
  }

  const roadMat = createRoadSurfaceMaterial();
  const sidewalkMat = createSidewalkMaterial();
  const canyonColliders = buildHkStreetCanyon(group, gltfPlan);
  buildHkRoadRibbons(group, roadMat, sidewalkMat);
  const stopColliders = buildHkPedestrianGround(group);
  buildHkPierDecks(group);

  const roadSidewalks = [];
  for (const b of BLOCKS) {
    if (b.park > 0.6 || b.median) continue;
    if (b.maxX - b.minX < 0.5 || b.maxZ - b.minZ < 0.5) continue;
    roadSidewalks.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
  }


  batchStaticGroupMeshes(group, new Set([waterMat, roadMat, sidewalkMat, landMat]));
  scene.add(group);
  console.info(`[ground] HK coast rings ${HONG_KONG_ISLAND_COASTLINE.length}+${KOWLOON_COASTLINE.length} water ${play.minX.toFixed(0)}..${play.maxX.toFixed(0)} x ${play.minZ.toFixed(0)}..${play.maxZ.toFixed(0)}`);
  return { group, sidewalks: roadSidewalks, footprints: [], highwayLanes: [], colliders: [...canyonColliders, ...stopColliders] };
}

export { buildCityGrid, batchStaticGroupMeshes };
