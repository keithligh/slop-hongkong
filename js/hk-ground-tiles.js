import * as THREE from 'three/webgpu';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { HK_STREET_EYE } from './city-config.js';
import { createGroundPhotoMaterial } from './hk-ground-photo.js';
import {
  HK_GROUND_ATTRIBUTION,
  HK_GROUND_BASIS_PATH,
  HK_GROUND_CHART_CLEARANCE,
  HK_GROUND_DECK_NAMES,
  HK_GROUND_SAMPLE_RADIUS,
  HK_GROUND_TINT_BANDS,
  HK_GROUND_TILE_DISC,
  deckInstancesToYield,
  ecefToWorld,
  gltfVertexToEcef,
  groundSnapOffset,
  groundTintBand,
  groundTileGsdCm,
  groundTileLift,
  parseB3dm,
  readGlbMesh,
  resolveGroundPhotoMode,
  resolveGroundPhotoTuning,
  resolveGroundPriority,
  resolveGroundTint,
  resolveGroundTilesRequest,
  selectDigit1GroundTiles,
  tileTriangleYieldsToBuilding
} from './hk-ground-tiles-frame.js';

// Open3DHK tile-based mesh under the Digit1 disc. Individualised BUILDING
// charts stay in front above the sidewalk. The procedural deck yields inside
// the same disc once a photographed tile is actually on the eye.

const DECK_NAMES = new Set(HK_GROUND_DECK_NAMES);

function parseKtx2(loader, bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => {
    loader.parse(buffer, resolve, reject);
  });
}

function bakeMesh(mesh, matrix, rtc, map, mode, tuning) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const ecef = gltfVertexToEcef(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2], matrix, rtc);
    const world = ecefToWorld(ecef[0], ecef[1], ecef[2]);
    positions[i] = world.x;
    positions[i + 1] = world.y;
    positions[i + 2] = world.z;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.needsUpdate = true;
  const material = mode === 'plain'
    ? new THREE.MeshBasicMaterial({
      map,
      color: 0xffffff,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
      depthWrite: true
    })
    : createGroundPhotoMaterial(map, map.image?.width || 1, map.image?.height || 1, tuning);
  if (mode === 'plain') material.name = 'hkGroundTilePhoto';
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 1;
  return { geometry, material, width: map.image?.width || 1, height: map.image?.height || 1 };
}

// Diagnostic paint for finding seams on a live frame (?groundTint=gsd|tile).
function tintMaterial(mode, gsdCm, index) {
  let colour = 0x444444;
  if (mode === 'tile') colour = new THREE.Color().setHSL((index * 0.381966) % 1, 0.7, 0.5).getHex();
  else if (gsdCm > 0) colour = HK_GROUND_TINT_BANDS[groundTintBand(gsdCm)].rgb;
  return new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide });
}

function dropBuildingTriangles(geometry, boxes) {
  const position = geometry.attributes.position;
  const source = geometry.index ? geometry.index.array : null;
  const count = source ? source.length : position.count;
  const keep = [];
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    const a = source ? source[triangle] : triangle;
    const b = source ? source[triangle + 1] : triangle + 1;
    const c = source ? source[triangle + 2] : triangle + 2;
    const point = {
      x: (position.getX(a) + position.getX(b) + position.getX(c)) / 3,
      y: (position.getY(a) + position.getY(b) + position.getY(c)) / 3,
      z: (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3
    };
    if (tileTriangleYieldsToBuilding(point, boxes)) continue;
    keep.push(a, b, c);
  }
  geometry.setIndex(keep);
}

function sampleHeights(meshes, eye, radius) {
  const heights = [];
  const limit = radius * radius;
  for (const item of meshes) {
    const position = item.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const dx = position.getX(i) - eye.x;
      const dz = position.getZ(i) - eye.z;
      if (dx * dx + dz * dz <= limit) heights.push(position.getY(i));
    }
  }
  return heights;
}

function punchDeck(group, eye, radius) {
  if (!group) return 0;
  const hidden = new THREE.Matrix4();
  let count = 0;
  group.traverse((obj) => {
    if (!obj.isInstancedMesh || !DECK_NAMES.has(obj.name)) return;
    const centres = obj.userData.hkCentres || [];
    const indexes = deckInstancesToYield(centres, eye, radius);
    for (const index of indexes) {
      hidden.makeScale(0, 0, 0);
      hidden.setPosition(centres[index].x, 0, centres[index].z);
      obj.setMatrixAt(index, hidden);
    }
    if (indexes.length) {
      obj.instanceMatrix.needsUpdate = true;
      obj.computeBoundingSphere();
      count += indexes.length;
    }
  });
  return count;
}

async function downloadTiles(tiles) {
  const out = new Array(tiles.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tiles.length) {
      const index = cursor;
      cursor += 1;
      const tile = tiles[index];
      try {
        const res = await fetch(tile.url);
        if (!res.ok) throw new Error(String(res.status));
        out[index] = { tile, bytes: new Uint8Array(await res.arrayBuffer()) };
      } catch (err) {
        out[index] = { tile, error: err };
      }
    }
  }
  const workers = Math.min(6, tiles.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

function emptyMount(extra = {}) {
  return {
    loaded: 0,
    failed: 0,
    yielded: 0,
    triangles: 0,
    snap: null,
    group: null,
    attribution: HK_GROUND_ATTRIBUTION,
    ownership: 'procedural',
    ...extra
  };
}

export async function mountHkGroundTiles(scene, renderer, {
  href = '',
  eye = HK_STREET_EYE,
  cityGroup = null,
  buildings = []
} = {}) {
  if (!resolveGroundTilesRequest(href || 'http://localhost/')) {
    return emptyMount({ disabled: true });
  }
  let tiles = [];
  try {
    tiles = await selectDigit1GroundTiles({ eye });
  } catch (err) {
    console.warn(`[ground-tiles] tileset ${err.message || err}`);
    return emptyMount();
  }
  if (!tiles.length) {
    console.warn('[ground-tiles] no tile covers the Digit1 disc');
    return emptyMount();
  }
  const photoMode = resolveGroundPhotoMode(href || 'http://localhost/');
  const tuning = resolveGroundPhotoTuning(href || 'http://localhost/');
  const tint = resolveGroundTint(href || 'http://localhost/');
  const priority = resolveGroundPriority(href || 'http://localhost/');
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(HK_GROUND_BASIS_PATH);
  try {
    ktx2.detectSupport(renderer);
  } catch (err) {
    console.warn(`[ground-tiles] ktx2 ${err.message || err}`);
    return emptyMount();
  }
  const downloads = await downloadTiles(tiles);
  const pending = [];
  let failed = 0;
  for (const item of downloads) {
    if (!item || item.error || !item.bytes) {
      failed += 1;
      const name = item?.tile?.url?.split('?')[0].split('/').pop() || 'tile';
      console.warn(`[ground-tiles] skip ${name}: ${item?.error?.message || item?.error || 'empty'}`);
      continue;
    }
    try {
      const name = item.tile.url.split('?')[0].split('/').pop() || '';
      const packed = name.endsWith('.b3dm') ? parseB3dm(item.bytes) : { feature: {}, glb: item.bytes };
      const decoded = readGlbMesh(packed.glb);
      if (!decoded) {
        failed += 1;
        console.warn(`[ground-tiles] skip ${name}: no photograph`);
        continue;
      }
      const map = await parseKtx2(ktx2, decoded.ktx2);
      pending.push({
        ...bakeMesh(decoded, item.tile.matrix, packed.feature.RTC_CENTER || null, map, photoMode, tuning),
        file: name
      });
    } catch (err) {
      failed += 1;
      const name = item.tile.url.split('?')[0].split('/').pop() || 'tile';
      console.warn(`[ground-tiles] skip ${name}: ${err.message || err}`);
    }
  }
  const offset = groundSnapOffset(sampleHeights(pending, eye, HK_GROUND_SAMPLE_RADIUS));
  if (offset == null) {
    for (const item of pending) item.geometry.dispose();
    ktx2.dispose();
    console.warn('[ground-tiles] no ground sample under the Digit1 eye');
    return emptyMount({ failed: failed + pending.length });
  }
  const group = new THREE.Group();
  group.name = 'HkGroundTiles';
  let loaded = 0;
  let triangles = 0;
  let eyeGsd = 0;
  for (const item of pending) {
    const position = item.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) position.setY(i, position.getY(i) - offset);
    position.needsUpdate = true;
    dropBuildingTriangles(item.geometry, buildings);
    const index = item.geometry.index;
    if (!index || index.count < 3) {
      item.geometry.dispose();
      continue;
    }
    const gsdCm = groundTileGsdCm(
      position.array,
      item.geometry.attributes.uv.array,
      index.array,
      item.width,
      item.height,
      HK_GROUND_CHART_CLEARANCE
    );
    if (priority === 'finer') {
      // The tile nearest the eye is first and does not move; see groundTileLift.
      if (!(eyeGsd > 0)) eyeGsd = gsdCm;
      const lift = groundTileLift(gsdCm, eyeGsd);
      if (lift) {
        for (let i = 0; i < position.count; i++) position.setY(i, position.getY(i) + lift);
        position.needsUpdate = true;
      }
    }
    item.geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(item.geometry, tint ? tintMaterial(tint, gsdCm, group.children.length) : item.material);
    mesh.name = 'HkGroundTile';
    mesh.userData.hkSource = 'landsd-3dtiles';
    mesh.userData.hkFile = item.file;
    mesh.userData.hkGsdCm = gsdCm;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    group.add(mesh);
    loaded += 1;
    triangles += index.count / 3;
  }
  ktx2.dispose();
  if (!loaded) return emptyMount({ failed });
  scene.add(group);
  const yielded = punchDeck(cityGroup, eye, HK_GROUND_TILE_DISC);
  console.info(`[ground-tiles] mounted ${loaded} tiles triangles ${Math.round(triangles)} snap ${offset.toFixed(2)} yielded ${yielded}`);
  return {
    loaded,
    failed,
    yielded,
    triangles,
    snap: offset,
    group,
    attribution: HK_GROUND_ATTRIBUTION,
    ownership: 'tiles'
  };
}
