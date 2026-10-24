#!/usr/bin/env node
// Digit1 white-slab pick. Rerunnable observation for the chase cameras:
//   index.html?at=-1.4,29.3,1.29
//   index.html?at=22.6,36.2,1.29
//   index.html?at=-1.4,35.3,1.29
//
// Casts the person-chase rays (FOV 56, default orbit pitch 0.09) through the
// mid-look and reports the first front face: LandsD glTF, footprint extrude,
// canyon ribbon, or Bank of China landmark prism. `--gltf` also tests baked
// triangles when hk-3d/<sheet>/BUILDING exists (gitignored). Texel `gpu=` uses
// glTF v = 0 as the first image row (flipY false). `flipped=` is the opposite
// row the old omit sampled.
//
// On the eye centre rays the first face is HkGltfBuilding
// B347491569901063A0 (The Henderson), material _001. Hiding that id misses.
// The GPU texel there is a photograph. The flipped row is padding
// RGB(136, 138, 137), which is why a corner test on that row left the slab.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  BLOCKS,
  HK_CORE_WORLD,
  HK_RETAIL_BELT,
  HONG_KONG_ISLAND_COASTLINE,
  ISLAND_BOUNDS,
  ROADS,
  blockInHkCore,
  hkFootprintHeight,
  hkLandmarkOwnsShaft,
  hkMassingPlan,
  hkResolveLandmarks
} from '../js/city-config.js';
import { HK_CANYON_HEIGHT, planHkStreetCanyon, pointInRing } from '../js/hk-ground-fill.js';
import {
  hiddenExtrudeIds,
  hk80ToWorld,
  isLandsdNullTexel,
  planGltfManifest
} from '../js/hk-gltf-frame.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const SIDEWALK = ISLAND_BOUNDS.sidewalkHeight;
const HENDERSON_ID = 'B347491569901063A0';
const HENDERSON_BOX = { minX: 218, maxX: 264, minZ: 54, maxZ: 105, minY: SIDEWALK, maxY: SIDEWALK + 190 };

const CAMERAS = [
  { id: 'eye', x: -1.4, z: 29.3, heading: 1.29 },
  { id: 'east25', x: 22.6, z: 36.2, heading: 1.29 },
  { id: 'south', x: -1.4, z: 35.3, heading: 1.29 }
];

// Mid-look band in the chase frame. The blank slab sits above the horizon,
// around the centre of the carriageway, not in the sky and not on the asphalt.
const GRID_X = [-0.28, -0.14, 0, 0.14, 0.28];
const GRID_Y = [0.08, 0.22, 0.36, 0.5];
const ASPECT = 16 / 9;

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}
function len(a) {
  return Math.hypot(a.x, a.y, a.z);
}
function norm(a) {
  const l = len(a) || 1;
  return scale(a, 1 / l);
}

export function chaseCamera(at, groundY = 0) {
  const pitch = 0.09;
  const dist = 4.3;
  const height = 1.95 + Math.sin(pitch) * dist * 0.85;
  const horiz = Math.cos(pitch) * dist;
  const heading = at.heading;
  const cam = {
    x: at.x - Math.sin(heading) * horiz,
    y: Math.max(0.65, groundY + height),
    z: at.z - Math.cos(heading) * horiz
  };
  const look = {
    x: at.x + Math.sin(heading) * 5.2,
    y: groundY + 3.1,
    z: at.z + Math.cos(heading) * 5.2
  };
  const forward = norm(sub(look, cam));
  const right = norm(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  return { cam, look, forward, right, up, fovY: (56 * Math.PI) / 180 };
}

export function rayFromNdc(camera, ndcX, ndcY, aspect = ASPECT) {
  const halfH = Math.tan(camera.fovY / 2);
  const halfW = halfH * aspect;
  const dir = norm(add(camera.forward, add(scale(camera.right, ndcX * halfW), scale(camera.up, ndcY * halfH))));
  return { origin: camera.cam, dir };
}

function slabT(o, d, box) {
  let t0 = 0;
  let t1 = Infinity;
  const axes = ['x', 'y', 'z'];
  const min = { x: box.minX, y: box.minY, z: box.minZ };
  const max = { x: box.maxX, y: box.maxY, z: box.maxZ };
  for (const axis of axes) {
    const inv = 1 / d[axis];
    let a = (min[axis] - o[axis]) * inv;
    let b = (max[axis] - o[axis]) * inv;
    if (a > b) {
      const s = a;
      a = b;
      b = s;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t1 < t0) return null;
  }
  if (t1 < 0.2) return null;
  return t0 > 0.2 ? t0 : t1 > 0.2 ? 0.2 : null;
}

function pointInFootprint(x, z, poly) {
  return pointInRing(x, z, poly);
}

function closest(hits) {
  let best = null;
  for (const hit of hits) {
    if (!hit || !(hit.t > 0.2)) continue;
    if (!best || hit.t < best.t) best = hit;
  }
  return best;
}

function hitAt(origin, dir, t, extra) {
  return {
    t,
    x: origin.x + dir.x * t,
    y: origin.y + dir.y * t,
    z: origin.z + dir.z * t,
    ...extra
  };
}

function rayPolygonPrism(origin, dir, poly, y0, y1) {
  let best = null;
  const consider = (t) => {
    if (!(t > 0.2) || t > 800) return;
    if (!best || t < best.t) best = t;
  };
  if (Math.abs(dir.y) > 1e-8) {
    for (const y of [y0, y1]) {
      const t = (y - origin.y) / dir.y;
      if (!(t > 0.2)) continue;
      const x = origin.x + dir.x * t;
      const z = origin.z + dir.z * t;
      if (pointInFootprint(x, z, poly)) consider(t);
    }
  }
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const nx = -ez;
    const nz = ex;
    const denom = nx * dir.x + nz * dir.z;
    if (Math.abs(denom) < 1e-8) continue;
    const t = (nx * (a.x - origin.x) + nz * (a.z - origin.z)) / denom;
    if (!(t > 0.2)) continue;
    const y = origin.y + dir.y * t;
    if (y < y0 - 0.02 || y > y1 + 0.02) continue;
    const x = origin.x + dir.x * t;
    const z = origin.z + dir.z * t;
    const edge2 = ex * ex + ez * ez;
    if (edge2 < 1e-6) continue;
    const u = ((x - a.x) * ex + (z - a.z) * ez) / edge2;
    if (u < -0.002 || u > 1.002) continue;
    consider(t);
  }
  return best;
}

function extrudeStyle(block, y) {
  const plan = hkMassingPlan(block);
  if (!plan) return 'none';
  const local = y - SIDEWALK;
  if (local < HK_RETAIL_BELT - SIDEWALK) return 'retail';
  const part = plan.parts.find((item) => local >= item.y0 - 0.05 && local <= item.y0 + item.h + 0.05);
  if (!part) return plan.parts[plan.parts.length - 1].style;
  if (part.style === 'podium') return 'podium';
  return part.style;
}

function layerName(style) {
  if (style === 'retail') return 'footprint-extrude';
  if (style === 'podium') return 'footprint-extrude';
  if (style.startsWith('tower')) return 'footprint-extrude';
  return 'footprint-extrude';
}

function meshNameForStyle(style) {
  if (style === 'retail') return 'HkRetailPodium';
  if (style === 'podium') return 'HkPodiumMasonry';
  return 'HkCurtainWall';
}

export function pickProcedural(origin, dir, world) {
  const hits = [];
  for (const block of world.extrudes) {
    const y0 = SIDEWALK;
    const y1 = SIDEWALK + block.height;
    if (!slabT(origin, dir, { minX: block.minX, maxX: block.maxX, minY: y0, maxY: y1, minZ: block.minZ, maxZ: block.maxZ })) continue;
    const t = rayPolygonPrism(origin, dir, block.poly, y0, y1);
    if (t == null) continue;
    const y = origin.y + dir.y * t;
    const style = extrudeStyle(block, y);
    hits.push(hitAt(origin, dir, t, {
      layer: layerName(style),
      mesh: meshNameForStyle(style),
      id: block.id,
      name: block.name || '',
      material: style === 'retail' ? 'hkRetailPodium' : style === 'podium' ? 'hkPodiumMasonry' : 'hkCanyonGlass-or-curtain',
      map: false,
      parent: 'HongKongCityBlocks',
      hiddenByGltf: world.hiddenIds.has(block.id),
      ownsLandmark: false
    }));
  }
  for (const block of world.landmarks) {
    const y0 = SIDEWALK;
    const y1 = SIDEWALK + block.height;
    if (!slabT(origin, dir, { minX: block.minX, maxX: block.maxX, minY: y0, maxY: y1, minZ: block.minZ, maxZ: block.maxZ })) continue;
    const t = rayPolygonPrism(origin, dir, block.poly, y0, y1);
    if (t == null) continue;
    hits.push(hitAt(origin, dir, t, {
      layer: 'landmark',
      mesh: 'HkBankOfChina',
      id: block.id,
      name: block.name || 'Bank of China Tower',
      material: 'curtain-glass+retail-skirt',
      map: false,
      parent: 'HkLandmarks',
      hiddenByGltf: world.hiddenIds.has(block.id),
      ownsLandmark: true
    }));
  }
  for (const wall of world.walls) {
    const y0 = 0.16;
    const y1 = 0.16 + HK_CANYON_HEIGHT;
    const t = rayWall(origin, dir, wall, y0, y1);
    if (t == null) continue;
    const y = origin.y + dir.y * t;
    const glass = y >= HK_RETAIL_BELT;
    hits.push(hitAt(origin, dir, t, {
      layer: 'canyon-ribbon',
      mesh: glass ? 'HkCentralStreetWallsGlass' : 'HkCentralStreetWalls',
      id: wall.raw || '',
      name: wall.raw || '',
      material: glass ? 'hkCanyonGlass' : 'hkRetailPodium',
      map: false,
      parent: 'HkCityGrid',
      hiddenByGltf: false,
      ownsLandmark: false
    }));
  }
  const hendersonT = slabT(origin, dir, HENDERSON_BOX);
  return { hit: closest(hits.filter((item) => !item.hiddenByGltf)), raw: closest(hits), hendersonAabbT: hendersonT };
}

function rayWall(origin, dir, wall, y0, y1) {
  const dx = origin.x - wall.x;
  const dz = origin.z - wall.z;
  const cs = wall.obb.cs;
  const sn = wall.obb.sn;
  const lx = dx * cs - dz * sn;
  const lz = dx * sn + dz * cs;
  const dlx = dir.x * cs - dir.z * sn;
  const dlz = dir.x * sn + dir.z * cs;
  return slabT(
    { x: lx, y: origin.y, z: lz },
    { x: dlx, y: dir.y, z: dlz },
    { minX: -wall.obb.hx, maxX: wall.obb.hx, minY: y0, maxY: y1, minZ: -wall.obb.hz, maxZ: wall.obb.hz }
  );
}

function buildWorld(gltfBoxes) {
  const hidden = new Set(gltfBoxes.length ? hiddenExtrudeIds(BLOCKS, gltfBoxes) : []);
  const extrudes = [];
  const landmarks = [];
  for (const block of BLOCKS) {
    if (block.park > 0.6 || block.median) continue;
    if (!blockInHkCore(block)) continue;
    const height = hkFootprintHeight(block);
    if (!(height > 0)) continue;
    const entry = { ...block, height };
    if (hkLandmarkOwnsShaft(block)) landmarks.push(entry);
    else extrudes.push(entry);
  }
  const canyon = planHkStreetCanyon({
    roads: ROADS,
    buildings: extrudes,
    core: HK_CORE_WORLD,
    island: HONG_KONG_ISLAND_COASTLINE
  });
  let walls = canyon.walls;
  if (gltfBoxes.length) {
    walls = clipWallsInline(walls, gltfBoxes);
  }
  return { extrudes, landmarks, walls, hiddenIds: hidden, gltfBoxes };
}

function clipWallsInline(walls, meshes) {
  const { clipCanyonWalls } = waitClip();
  return clipCanyonWalls(walls, meshes, { eye: { x: -1.4, z: 29.3 }, near: 80 });
}

function waitClip() {
  return clipRef;
}
const clipRef = {};

function mulMat4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
function applyMat4(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}
function localMatrix(node) {
  if (node.matrix && node.matrix.length === 16) return node.matrix;
  const t = node.translation || [0, 0, 0];
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
}

function loadGltfBoxes(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const plan = planGltfManifest(manifest, { cap: 800 });
  return plan.selected.map((entry) => ({ ...entry, sheet: manifest.sheet }));
}

const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(doc, index, buffers) {
  const acc = doc.accessors[index];
  const view = doc.bufferViews[acc.bufferView];
  const buf = buffers[view.buffer];
  const comps = COMP[acc.type];
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = view.byteStride || comps * componentBytes(acc.componentType);
  const out = new Float64Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) {
    const base = start + i * stride;
    for (let c = 0; c < comps; c++) out[i * comps + c] = readComponent(buf, base + c * componentBytes(acc.componentType), acc.componentType);
  }
  return { data: out, count: acc.count, comps };
}

function componentBytes(type) {
  switch (type) {
    case 5120:
    case 5121:
      return 1;
    case 5122:
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
    default:
      throw new Error(`gltf component ${type}`);
  }
}

function readComponent(buf, offset, type) {
  switch (type) {
    case 5120:
      return buf.readInt8(offset);
    case 5121:
      return buf.readUInt8(offset);
    case 5122:
      return buf.readInt16LE(offset);
    case 5123:
      return buf.readUInt16LE(offset);
    case 5125:
      return buf.readUInt32LE(offset);
    case 5126:
      return buf.readFloatLE(offset);
    default:
      throw new Error(`gltf component ${type}`);
  }
}

function loadBuffers(doc, file) {
  return (doc.buffers || []).map((buffer) => {
    if (!buffer.uri || buffer.uri.startsWith('data:')) throw new Error(`embedded buffer in ${file}`);
    return readFileSync(path.join(path.dirname(file), buffer.uri));
  });
}

function bakePrimitive(positions, matrix) {
  const count = positions.length / 3;
  const out = new Float32Array(positions.length);
  let minH = Infinity;
  for (let i = 0; i < count; i++) {
    const placed = applyMat4(matrix, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    const hkpd = placed[1];
    const [x, , z] = hk80ToWorld(placed[0], -placed[2], hkpd);
    out[i * 3] = x;
    out[i * 3 + 1] = hkpd;
    out[i * 3 + 2] = z;
    if (hkpd < minH) minH = hkpd;
  }
  const shift = SIDEWALK - minH;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    out[i * 3 + 1] += shift;
    const x = out[i * 3];
    const y = out[i * 3 + 1];
    const z = out[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { positions: out, box: { minX, maxX, minY, maxY, minZ, maxZ }, minH, shift };
}

function nodeWorlds(doc) {
  const nodes = doc.nodes || [];
  const worlds = new Array(nodes.length);
  function worldOf(index, parent) {
    if (worlds[index]) return worlds[index];
    const node = nodes[index] || {};
    const m = parent ? mulMat4(parent, localMatrix(node)) : localMatrix(node).slice();
    worlds[index] = m;
    for (const child of node.children || []) worldOf(child, m);
    return m;
  }
  const scene = (doc.scenes || [])[doc.scene || 0] || { nodes: [] };
  for (const index of scene.nodes || []) worldOf(index, null);
  return worlds;
}

function materialInfo(doc, materialIndex) {
  const mat = doc.materials?.[materialIndex] || {};
  const pbr = mat.pbrMetallicRoughness || {};
  const texInfo = pbr.baseColorTexture;
  const factor = pbr.baseColorFactor || [1, 1, 1, 1];
  let image = null;
  if (texInfo && doc.textures?.[texInfo.index]) {
    const source = doc.textures[texInfo.index].source;
    const img = doc.images?.[source];
    image = img?.uri || null;
  }
  return {
    name: mat.name || '',
    factor,
    image,
    alphaMode: mat.alphaMode || 'OPAQUE',
    doubleSided: !!mat.doubleSided,
    metallic: pbr.metallicFactor,
    roughness: pbr.roughnessFactor
  };
}

function triIntersect(origin, dir, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  const px = dir.y * e2z - dir.z * e2y;
  const py = dir.z * e2x - dir.x * e2z;
  const pz = dir.x * e2y - dir.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const sx = origin.x - ax;
  const sy = origin.y - ay;
  const sz = origin.z - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < -1e-4 || u > 1 + 1e-4) return null;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = (dir.x * qx + dir.y * qy + dir.z * qz) * inv;
  if (v < -1e-4 || u + v > 1 + 1e-4) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (!(t > 0.2)) return null;
  return { t, u, v, w: 1 - u - v, front: det > 0 };
}

const imageCache = new Map();

function sampleImage(file, u, v, flipV = true) {
  if (!file || !existsSync(file)) return null;
  let img = imageCache.get(file);
  if (img === undefined) {
    const probe = spawnSync('python3', ['-c', [
      'import sys',
      'from PIL import Image',
      'im = Image.open(sys.argv[1]).convert("RGB")',
      'im.thumbnail((256, 256))',
      'w, h = im.size',
      'sys.stderr.write(f"{w} {h}\\n")',
      'sys.stderr.flush()',
      'sys.stdout.buffer.write(im.tobytes())'
    ].join('\n'), file], { maxBuffer: 8 * 1024 * 1024 });
    if (probe.status !== 0) {
      imageCache.set(file, null);
      return null;
    }
    const [w, h] = String(probe.stderr).trim().split(/\s+/).map(Number);
    const data = probe.stdout;
    if (!w || !h || data.length < w * h * 3) {
      imageCache.set(file, null);
      return null;
    }
    img = { w, h, data };
    imageCache.set(file, img);
  }
  if (!img) return null;
  let uu = u % 1;
  let vv = v % 1;
  if (uu < 0) uu += 1;
  if (vv < 0) vv += 1;
  const x = Math.min(img.w - 1, (uu * img.w) | 0);
  const y = Math.min(img.h - 1, ((flipV ? 1 - vv : vv) * img.h) | 0);
  const i = (y * img.w + x) * 3;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function loadSheetMeshes(sheetDir, boxes) {
  const meshes = [];
  for (const box of boxes) {
    const file = path.join(sheetDir, box.file);
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    let buffers;
    try {
      buffers = loadBuffers(doc, file);
    } catch (err) {
      console.error(`[pick] buffer ${box.name || box.file}: ${err.message}`);
      continue;
    }
    const worlds = nodeWorlds(doc);
    const nodes = doc.nodes || [];
    nodes.forEach((node, index) => {
      if (node.mesh == null) return;
      const mesh = doc.meshes[node.mesh];
      const matrix = worlds[index] || localMatrix(node);
      for (const prim of mesh.primitives || []) {
        if (prim.attributes?.POSITION == null) continue;
        const posAcc = readAccessor(doc, prim.attributes.POSITION, buffers);
        const baked = bakePrimitive(posAcc.data, matrix);
        let index = null;
        if (prim.indices != null) {
          const ind = readAccessor(doc, prim.indices, buffers);
          index = ind.data;
        } else {
          index = new Float64Array(posAcc.count);
          for (let i = 0; i < posAcc.count; i++) index[i] = i;
        }
        let uv = null;
        if (prim.attributes.TEXCOORD_0 != null) uv = readAccessor(doc, prim.attributes.TEXCOORD_0, buffers).data;
        const mat = materialInfo(doc, prim.material);
        meshes.push({
          building: box.name || path.basename(box.file, '.gltf'),
          file: box.file,
          sheet: box.sheet,
          node: node.name || '',
          box: baked.box,
          positions: baked.positions,
          index,
          uv,
          material: mat,
          imagePath: mat.image ? path.join(path.dirname(file), mat.image) : null
        });
      }
    });
  }
  return meshes;
}

function triangleSample(mesh, ia, ib, ic, hit) {
  let texel = null;
  let texelUnflipped = null;
  let cornerNull = null;
  let centroidNull = null;
  let corners = null;
  let uv = null;
  if (mesh.uv && mesh.imagePath) {
    const uva = [mesh.uv[ia * 2], mesh.uv[ia * 2 + 1]];
    const uvb = [mesh.uv[ib * 2], mesh.uv[ib * 2 + 1]];
    const uvc = [mesh.uv[ic * 2], mesh.uv[ic * 2 + 1]];
    const u = hit.w * uva[0] + hit.u * uvb[0] + hit.v * uvc[0];
    const v = hit.w * uva[1] + hit.u * uvb[1] + hit.v * uvc[1];
    uv = [u, v];
    texel = sampleImage(mesh.imagePath, u, v, false);
    texelUnflipped = sampleImage(mesh.imagePath, u, v, true);
    const ca = sampleImage(mesh.imagePath, uva[0], uva[1], false);
    const cb = sampleImage(mesh.imagePath, uvb[0], uvb[1], false);
    const cc = sampleImage(mesh.imagePath, uvc[0], uvc[1], false);
    corners = [ca, cb, cc];
    if (ca && cb && cc) {
      cornerNull = [ca, cb, cc].every((rgb) => isLandsdNullTexel(rgb[0], rgb[1], rgb[2]));
    }
    if (texel) centroidNull = isLandsdNullTexel(texel[0], texel[1], texel[2]);
  }
  return { texel, texelUnflipped, cornerNull, centroidNull, corners, uv };
}

function pickGltf(origin, dir, meshes, { hideNames = null, omitNull = false, frontOnly = true } = {}) {
  let best = null;
  for (const mesh of meshes) {
    if (hideNames && hideNames.has(mesh.building)) continue;
    if (!slabT(origin, dir, mesh.box)) continue;
    const p = mesh.positions;
    const idx = mesh.index;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const ia = idx[t];
      const ib = idx[t + 1];
      const ic = idx[t + 2];
      const hit = triIntersect(
        origin, dir,
        p[ia * 3], p[ia * 3 + 1], p[ia * 3 + 2],
        p[ib * 3], p[ib * 3 + 1], p[ib * 3 + 2],
        p[ic * 3], p[ic * 3 + 1], p[ic * 3 + 2]
      );
      if (!hit || (best && hit.t >= best.t)) continue;
      // FrontSide is the glTF default. A closer back face is culled and does not paint.
      if (frontOnly && !hit.front && !mesh.material.doubleSided) continue;
      const sample = triangleSample(mesh, ia, ib, ic, hit);
      // Same rule as omitLandsdNullFill: three null corners leave the triangle undrawn.
      if (omitNull && sample.cornerNull) continue;
      const { texel, texelUnflipped, cornerNull, centroidNull, corners, uv } = sample;
      best = hitAt(origin, dir, hit.t, {
        layer: 'gltf',
        mesh: 'HkGltfBuilding',
        id: mesh.building,
        name: mesh.node || mesh.building,
        file: mesh.file,
        sheet: mesh.sheet,
        material: mesh.material.name || 'gltf-pbr',
        materialType: 'pbrMetallicRoughness',
        map: !!mesh.material.image,
        image: mesh.material.image,
        baseColorFactor: mesh.material.factor,
        doubleSided: mesh.material.doubleSided,
        parent: 'HkIndividualModels',
        front: hit.front,
        facing: hit.front ? 'front' : 'back',
        texel,
        texelUnflipped,
        uv,
        corners,
        cornerNull,
        centroidNull,
        henderson: mesh.building === HENDERSON_ID
      });
    }
  }
  return best;
}

function summarise(hit) {
  if (!hit) return 'MISS';
  const texel = hit.texel ? ` gpu=${hit.texel.join(',')}` : '';
  const unflipped = hit.texelUnflipped ? ` flipped=${hit.texelUnflipped.join(',')}` : '';
  const uv = hit.uv ? ` uv=${hit.uv.map((n) => n.toFixed(3)).join(',')}` : '';
  const corners = hit.corners
    ? ` corners=${hit.corners.map((rgb) => (rgb ? rgb.join(',') : '?')).join('|')}`
    : '';
  const eyeD = Math.hypot((hit.x ?? 0) + 1.4, (hit.z ?? 0) - 29.3);
  const flags = [
    hit.hiddenByGltf ? 'HIDDEN' : '',
    hit.henderson ? 'HENDERSON' : '',
    hit.map === false ? 'no-map' : hit.map ? 'map' : '',
    hit.facing || '',
    hit.cornerNull === true ? 'corner-null' : hit.cornerNull === false ? 'corner-photo' : '',
    hit.centroidNull === true ? 'centroid-null' : hit.centroidNull === false ? 'centroid-photo' : ''
  ].filter(Boolean).join(' ');
  const slot = hit.image ? ` ${hit.material || ''} ${hit.image}` : '';
  return `${hit.layer} ${hit.mesh} ${hit.id || hit.name} t=${hit.t.toFixed(1)} y=${hit.y.toFixed(1)} at ${hit.x?.toFixed?.(1)},${hit.z?.toFixed?.(1)} eye ${eyeD.toFixed(1)} ${flags}${slot}${texel}${unflipped}${uv}${corners}`;
}

function sheetDirs() {
  const root3d = path.join(root, 'hk-3d');
  return ['11-SW-9C', '11-SW-8D']
    .map((sheet) => path.join(root3d, sheet))
    .filter((dir) => existsSync(path.join(dir, 'manifest.json')));
}

function corridorBoxes(boxes) {
  const eye = { x: -1.4, z: 29.3, heading: 1.29 };
  const fx = Math.sin(eye.heading);
  const fz = Math.cos(eye.heading);
  const sx = -fz;
  const sz = fx;
  return boxes.filter((box) => {
    let minAlong = Infinity;
    let maxAlong = -Infinity;
    let minSide = Infinity;
    let maxSide = -Infinity;
    for (const x of [box.minX, box.maxX]) {
      for (const z of [box.minZ, box.maxZ]) {
        const along = (x - eye.x) * fx + (z - eye.z) * fz;
        const side = (x - eye.x) * sx + (z - eye.z) * sz;
        minAlong = Math.min(minAlong, along);
        maxAlong = Math.max(maxAlong, along);
        minSide = Math.min(minSide, side);
        maxSide = Math.max(maxSide, side);
      }
    }
    return maxAlong >= -20 && minAlong <= 420 && maxSide >= -90 && minSide <= 90;
  });
}

async function main() {
  const dirs = sheetDirs();
  const boxes = dirs.flatMap((dir) => loadGltfBoxes(dir).map((box) => ({ ...box, _dir: dir })));
  const world = buildWorld(boxes);
  console.log(`[pick] procedural extrudes ${world.extrudes.length} landmarks ${world.landmarks.length} canyon ${world.walls.length} gltf boxes ${boxes.length} hidden extrudes ${world.hiddenIds.size}`);
  const chaseBoxes = corridorBoxes(boxes);
  console.log(`[pick] chase-corridor glTF ${chaseBoxes.length}`);
  let meshes = [];
  if (process.argv.includes('--gltf') && chaseBoxes.length) {
    const byDir = new Map();
    for (const box of chaseBoxes) {
      const list = byDir.get(box._dir) || [];
      list.push(box);
      byDir.set(box._dir, list);
    }
    for (const [dir, list] of byDir) {
      console.log(`[pick] triangles ${path.basename(dir)} ${list.length}`);
      meshes = meshes.concat(loadSheetMeshes(dir, list));
    }
    console.log(`[pick] glTF meshes ${meshes.length}`);
  }

  const report = [];
  for (const at of CAMERAS) {
    const camera = chaseCamera(at, 0);
    console.log(`\n[cam ${at.id}] pos ${camera.cam.x.toFixed(2)},${camera.cam.y.toFixed(2)},${camera.cam.z.toFixed(2)} look ${camera.look.x.toFixed(2)},${camera.look.y.toFixed(2)},${camera.look.z.toFixed(2)}`);
    for (const ndcY of GRID_Y) {
      for (const ndcX of GRID_X) {
        const ray = rayFromNdc(camera, ndcX, ndcY);
        const procedural = pickProcedural(ray.origin, ray.dir, world);
        const gltf = meshes.length ? pickGltf(ray.origin, ray.dir, meshes) : null;
        const gltfEither = meshes.length ? pickGltf(ray.origin, ray.dir, meshes, { frontOnly: false }) : null;
        const gltfKept = meshes.length ? pickGltf(ray.origin, ray.dir, meshes, { omitNull: true }) : null;
        const gltfNoHenderson = meshes.length ? pickGltf(ray.origin, ray.dir, meshes, { hideNames: new Set([HENDERSON_ID]) }) : null;
        const winner = closest([gltf, procedural.hit].filter(Boolean));
        const winnerKept = closest([gltfKept, procedural.hit].filter(Boolean));
        const row = {
          camera: at.id,
          ndc: [ndcX, ndcY],
          winner: summarise(winner),
          afterOmit: summarise(winnerKept),
          gltf: summarise(gltf),
          gltfEitherFace: summarise(gltfEither),
          gltfAfterOmit: summarise(gltfKept),
          procedural: summarise(procedural.hit),
          proceduralIfNoGltfHide: summarise(procedural.raw),
          hendersonAabb: procedural.hendersonAabbT ? procedural.hendersonAabbT.toFixed(1) : '',
          withoutHenderson: summarise(gltfNoHenderson)
        };
        report.push(row);
        if (ndcX === 0 && (ndcY === 0.22 || ndcY === 0.36)) {
          console.log(`  ndc ${ndcX},${ndcY} WIN ${row.winner}`);
          console.log(`    after-omit ${row.afterOmit}`);
          console.log(`    front ${row.gltf}`);
          console.log(`    either ${row.gltfEitherFace}`);
          console.log(`    gltf-kept ${row.gltfAfterOmit}`);
          console.log(`    proc ${row.procedural}`);
          console.log(`    henderson aabb t=${row.hendersonAabb || 'miss'} hide-henderson ${row.withoutHenderson}`);
        }
      }
    }
  }
  if (process.argv.includes('--dense') && meshes.length) {
    const camera = chaseCamera(CAMERAS[0], 0);
    const tally = { N: 0, C: 0, p: 0, o: 0, miss: 0 };
    console.log('\n[dense eye] slot:texel for the mass column');
    for (let yi = -1; yi <= 12; yi++) {
      const ndcY = yi * 0.05;
      const parts = [`${ndcY.toFixed(2)}`];
      for (let xi = -4; xi <= 1; xi++) {
        const ndcX = xi * 0.05;
        const ray = rayFromNdc(camera, ndcX, ndcY);
        const hit = pickGltf(ray.origin, ray.dir, meshes);
        if (!hit || hit.layer !== 'gltf') {
          parts.push('----');
          continue;
        }
        const slot = (hit.image || '').match(/_(\d+)\./)?.[1] || '?';
        const rgb = hit.texel ? hit.texel.join(',') : '?';
        const flag = hit.cornerNull ? 'N' : hit.centroidNull ? 'C' : 'k';
        parts.push(`${slot}${flag}:${rgb}`);
      }
      console.log(parts.join(' '));
    }
  }

  const out = path.join(root, 'tools', 'digit1-white-pick.json');
  const payload = { cameras: CAMERAS, aspect: ASPECT, gltf: meshes.length > 0, rows: report };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\n[pick] wrote ${out}`);
}

const clipCanyon = await import('../js/hk-ground-fill.js');
clipRef.clipCanyonWalls = clipCanyon.clipCanyonWalls;

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
