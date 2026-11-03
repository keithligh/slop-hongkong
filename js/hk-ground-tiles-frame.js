import { HK_STREET_EYE, hkCoreProject, hkCoreUnproject } from './city-config.js';
import { keithEyeGrain, keithEyeLuma, keithEyeMad } from './digit1-far-frame.js';

// LandsD 3D Visualisation Map (tile-based), Cesium 3D Tiles, WGS84 ECEF.
// The key is the example published on the CSDI API page, not a private credential.
// https://tools.csdi.gov.hk/csdi-webpage/apidoc/3d-visualisation-map-api

export const HK_GROUND_TILESET = 'https://data.map.gov.hk/api/3d-data/3dtiles/f2/tileset.json';
export const HK_GROUND_TILES_KEY = '3967f8f365694e0798af3e7678509421';
export const HK_GROUND_BASIS_PATH = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@f17eb5d689094a3fbd4cd0d64d54729a48036ce0/examples/jsm/libs/basis/';
export const HK_GROUND_TILE_DISC = 42;
export const HK_GROUND_TILE_MAX_HALF = 24;
export const HK_GROUND_TILE_CAP = 72;
export const HK_GROUND_JSON_CAP = 48;
export const HK_GROUND_ASPHALT_Y = 0.07;
export const HK_GROUND_CHART_CLEARANCE = 1.8;
export const HK_GROUND_SAMPLE_RADIUS = 8;
export const HK_GROUND_MAD_FLOOR = 6;
export const HK_GROUND_GRAIN_FLOOR = 0.35;
export const HK_GROUND_BLANK_GRAIN = 0.05;
export const HK_GROUND_ATTRIBUTION = '© Government of the Hong Kong SAR (Lands Department) / CSDI 3D Visualisation Map (tile-based) / Open3Dhk (https://3d.map.gov.hk/)';

export const HK_GROUND_DECK_NAMES = Object.freeze([
  'HkRoadCentrelines',
  'HkSidewalks',
  'HkCurbs',
  'HkLaneMarkingsWhite',
  'HkLaneMarkingsYellow',
  'HkOsmPavement'
]);

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const A_WGS = 6378137;
const E2_WGS = 6.69437999014e-3;

// Cut #47: the LandsD aerial ground tiles are opt-in. Default Digit1 eye is the
// game deck (HkRoadCentrelines, HkSidewalks, HkCurbs, lane paint, HkOsmPavement).
// ?groundTiles=on (or 1/true) mounts the tiles and punches the deck as #41 did.
export function resolveGroundTilesRequest(href) {
  let flag = '';
  try {
    flag = new URL(href, 'http://localhost').searchParams.get('groundTiles') || '';
  } catch {
    flag = '';
  }
  if (flag === 'on' || flag === '1' || flag === 'true') return { enabled: true };
  return null;
}

// ?groundPhoto=plain keeps the bilinear MeshBasicMaterial read for a live A-B
// against the reconstructed read. Default is the reconstruction.
export function resolveGroundPhotoMode(href) {
  let flag = '';
  try {
    flag = new URL(href, 'http://localhost').searchParams.get('groundPhoto') || '';
  } catch {
    flag = '';
  }
  return flag === 'plain' ? 'plain' : 'reconstruct';
}

export function resolveGroundPhotoTuning(href) {
  let params;
  try {
    params = new URL(href, 'http://localhost').searchParams;
  } catch {
    params = new URLSearchParams();
  }
  const read = (key, fallback, lo, hi) => {
    const raw = params.get(key);
    const value = raw == null || raw === '' ? NaN : Number(raw);
    return Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
  };
  return {
    sharpen: read('groundSharpen', HK_GROUND_PHOTO_SHARPEN, 0, 4),
    radius: read('groundRadius', HK_GROUND_PHOTO_RADIUS, 0.5, 4)
  };
}

// ?groundTint=gsd paints each tile by its ground sample distance, ?groundTint=tile
// by file. A diagnostic for finding the seams on a live frame, not a look.
export function resolveGroundTint(href) {
  let flag = '';
  try {
    flag = new URL(href, 'http://localhost').searchParams.get('groundTint') || '';
  } catch {
    flag = '';
  }
  return flag === 'gsd' || flag === 'tile' ? flag : '';
}

// ?groundPriority=off restores the equal-height mount of #41/#45 (no neighbour
// precedence) for a live A-B.
export function resolveGroundPriority(href) {
  let flag = '';
  try {
    flag = new URL(href, 'http://localhost').searchParams.get('groundPriority') || '';
  } catch {
    flag = '';
  }
  return flag === 'off' || flag === '0' ? 'off' : 'finer';
}

// Where two LandsD tiles overlap on the carriageway the photographs are coplanar
// to within a millimetre or two, so which one wins is decided triangle by
// triangle by depth noise, and the seam between a 2 cm and a 4 cm photograph is
// a ragged tooth edge. Each tile is moved vertically by a few millimetres per
// centimetre of ground sample distance relative to the tile on the eye: the finer
// photograph always owns the overlap and the eye tile does not move.
// ?groundTint=gsd bands: tiles below each limit (cm per texel on the ground band)
// take that colour. The hue sectors read the colour back from a tone-mapped
// screenshot.
export const HK_GROUND_TINT_BANDS = Object.freeze([
  Object.freeze({ max: 1, rgb: 0xff00ff, hue: [270, 340] }),
  Object.freeze({ max: 2.2, rgb: 0x22cc44, hue: [75, 170] }),
  Object.freeze({ max: 3.5, rgb: 0xeedd22, hue: [46, 75] }),
  Object.freeze({ max: 5, rgb: 0xff8800, hue: [15, 46] }),
  Object.freeze({ max: Infinity, rgb: 0xdd2222, hue: [-20, 15] })
]);

export function groundTintBand(gsdCm) {
  return HK_GROUND_TINT_BANDS.findIndex((band) => gsdCm < band.max);
}

export const HK_GROUND_LIFT_PER_CM = 0.004;
export const HK_GROUND_LIFT_MAX = 0.03;
export function groundTileLift(gsdCm, refCm) {
  if (!(gsdCm > 0) || !(refCm > 0)) return 0;
  const lift = (refCm - gsdCm) * HK_GROUND_LIFT_PER_CM;
  return Math.max(-HK_GROUND_LIFT_MAX, Math.min(HK_GROUND_LIFT_MAX, lift));
}

// World size of one texel, in centimetres: sqrt(world area / (uv area x texels)).
// Positions are the baked world vertices (metres), uvs and indices as read from the glb.
// maxY keeps the carriageway and drops facade triangles, whose density is not the ground's.
export function groundTileGsdCm(positions, uvs, indices, width, height, maxY = Infinity) {
  let world = 0;
  let uv = 0;
  for (let k = 0; k + 2 < indices.length; k += 3) {
    const a = indices[k] * 3;
    const b = indices[k + 1] * 3;
    const c = indices[k + 2] * 3;
    if (Math.max(positions[a + 1], positions[b + 1], positions[c + 1]) > maxY) continue;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    world += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const ia = indices[k] * 2;
    const ib = indices[k + 1] * 2;
    const ic = indices[k + 2] * 2;
    uv += 0.5 * Math.abs((uvs[ib] - uvs[ia]) * (uvs[ic + 1] - uvs[ia + 1]) - (uvs[ic] - uvs[ia]) * (uvs[ib + 1] - uvs[ia + 1]));
  }
  const texels = uv * width * height;
  return world > 0 && texels > 0 ? Math.sqrt(world / texels) * 100 : 0;
}

export function wgs84ToEcef(latDeg, lonDeg, height = 0) {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const nrad = A_WGS / Math.sqrt(1 - E2_WGS * sinLat * sinLat);
  return [
    (nrad + height) * cosLat * Math.cos(lon),
    (nrad + height) * cosLat * Math.sin(lon),
    (nrad * (1 - E2_WGS) + height) * sinLat
  ];
}

export function ecefToWgs84(x, y, z) {
  const b = A_WGS * Math.sqrt(1 - E2_WGS);
  const ep2 = (A_WGS * A_WGS - b * b) / (b * b);
  const p = Math.hypot(x, y);
  const th = Math.atan2(A_WGS * z, b * p);
  const lon = Math.atan2(y, x);
  const lat = Math.atan2(
    z + ep2 * b * Math.sin(th) ** 3,
    p - E2_WGS * A_WGS * Math.cos(th) ** 3
  );
  const nrad = A_WGS / Math.sqrt(1 - E2_WGS * Math.sin(lat) * Math.sin(lat));
  const height = p / Math.cos(lat) - nrad;
  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI, h: height };
}

export function worldToGroundEcef(x, z, height = 5) {
  const { lat, lon } = hkCoreUnproject(x, z);
  return wgs84ToEcef(lat, lon, height);
}

export function ecefToWorld(x, y, z) {
  const wgs = ecefToWgs84(x, y, z);
  const [east, south] = hkCoreProject(wgs.lon, wgs.lat);
  return { x: east, y: wgs.h, z: south };
}

function mulMat(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] = a[row] * b[col * 4]
        + a[4 + row] * b[col * 4 + 1]
        + a[8 + row] * b[col * 4 + 2]
        + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function applyMat(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

// glTF is Y-up in the tile's local frame. The tileset matrix expects Z-up ECEF.
export function gltfVertexToEcef(x, y, z, matrix, rtc = null) {
  let gx = x;
  let gy = y;
  let gz = z;
  if (rtc && rtc.length >= 3) {
    gx += rtc[0];
    gy += rtc[1];
    gz += rtc[2];
  }
  return applyMat(matrix, gx, -gz, gy);
}

export function worldOfGltfVertex(x, y, z, matrix, rtc = null) {
  const ecef = gltfVertexToEcef(x, y, z, matrix, rtc);
  return ecefToWorld(ecef[0], ecef[1], ecef[2]);
}

export function tilesetBoxMetrics(point, box, matrix) {
  const centre = applyMat(matrix, box[0], box[1], box[2]);
  const delta = [point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]];
  let dist2 = 0;
  let half = 0;
  for (const axisIndex of [3, 6, 9]) {
    const end = applyMat(matrix, box[0] + box[axisIndex], box[1] + box[axisIndex + 1], box[2] + box[axisIndex + 2]);
    const axis = [end[0] - centre[0], end[1] - centre[1], end[2] - centre[2]];
    const length = Math.hypot(axis[0], axis[1], axis[2]) || 1e-9;
    if (length > half) half = length;
    const proj = (delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2]) / length;
    const clamped = Math.max(-length, Math.min(length, proj));
    dist2 += (proj - clamped) ** 2;
  }
  return {
    dist: Math.sqrt(dist2),
    centre: Math.hypot(delta[0], delta[1], delta[2]),
    half
  };
}

function withKey(href, key) {
  const url = new URL(href);
  if (key && !url.searchParams.has('key')) url.searchParams.set('key', key);
  return url.href;
}

function isMeshUri(pathname) {
  const name = pathname.toLowerCase();
  return name.endsWith('.b3dm') || name.endsWith('.glb') || name.endsWith('.gltf');
}

export async function selectDigit1GroundTiles({
  eye = HK_STREET_EYE,
  disc = HK_GROUND_TILE_DISC,
  maxHalf = HK_GROUND_TILE_MAX_HALF,
  cap = HK_GROUND_TILE_CAP,
  key = HK_GROUND_TILES_KEY,
  root = HK_GROUND_TILESET,
  fetchImpl = globalThis.fetch,
  jsonCap = HK_GROUND_JSON_CAP
} = {}) {
  const eyeEcef = worldToGroundEcef(eye.x, eye.z, 5);
  const kept = [];
  const seen = new Set();
  let jsonCount = 0;

  async function load(rel, parentMatrix) {
    if (jsonCount >= jsonCap) return;
    const href = withKey(new URL(rel, root).href, key);
    if (seen.has(href)) return;
    seen.add(href);
    jsonCount += 1;
    const res = await fetchImpl(href);
    if (!res.ok) throw new Error(`tileset ${res.status}`);
    const doc = await res.json();
    await visit(doc.root, parentMatrix, href, doc.root?.refine || 'REPLACE');
  }

  async function visit(node, parentMatrix, base, inherited) {
    if (!node) return;
    const refine = node.refine || inherited;
    const local = node.transform ? mulMat(parentMatrix, node.transform) : parentMatrix;
    const box = node.boundingVolume?.box;
    let metrics = null;
    if (box) {
      metrics = tilesetBoxMetrics(eyeEcef, box, local);
      if (metrics.dist > disc + maxHalf) return;
    }
    const kids = node.children || [];
    const uri = node.content?.uri || '';
    if (uri) {
      const next = new URL(uri, base);
      if (next.pathname.toLowerCase().endsWith('.json')) {
        await load(next.href, local);
        return;
      }
      if (isMeshUri(next.pathname) && kids.length) {
        await visitChildren(kids, local, base, refine, eyeEcef);
        return;
      }
      if (isMeshUri(next.pathname) && metrics && metrics.centre <= disc && metrics.half <= maxHalf) {
        kept.push({
          url: withKey(next.href, key),
          centre: metrics.centre,
          half: metrics.half,
          dist: metrics.dist,
          matrix: local.slice(),
          geometricError: Number(node.geometricError) || 0
        });
      }
      return;
    }
    await visitChildren(kids, local, base, refine, eyeEcef);
  }

  async function visitChildren(kids, local, base, refine, point) {
    const ranked = kids.map((child) => {
      const childMatrix = child.transform ? mulMat(local, child.transform) : local;
      const childBox = child.boundingVolume?.box;
      const rank = childBox ? tilesetBoxMetrics(point, childBox, childMatrix).dist : 0;
      return { child, rank };
    });
    ranked.sort((a, b) => a.rank - b.rank);
    for (const item of ranked) await visit(item.child, local, base, refine);
  }

  await load(root, IDENTITY);
  kept.sort((a, b) => a.centre - b.centre || a.half - b.half);
  return kept.slice(0, cap);
}

export function parseB3dm(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'b3dm') throw new Error(`not b3dm ${magic}`);
  const ftJson = view.getUint32(12, true);
  const ftBin = view.getUint32(16, true);
  const btJson = view.getUint32(20, true);
  const btBin = view.getUint32(24, true);
  let feature = {};
  if (ftJson > 0) {
    const text = new TextDecoder().decode(bytes.subarray(28, 28 + ftJson)).replace(/\0/g, '').trim();
    if (text) feature = JSON.parse(text);
  }
  const glbStart = 28 + ftJson + ftBin + btJson + btBin;
  return { feature, glb: bytes.subarray(glbStart) };
}

function glbParts(glb) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  return { view, json, binStart: 20 + jsonLength + 8 };
}

function readAccessorFloats(parts, accessorIndex, components) {
  const accessor = parts.json.accessors[accessorIndex];
  const bufferView = parts.json.bufferViews[accessor.bufferView];
  const stride = bufferView.byteStride || components * 4;
  const start = parts.binStart + (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = new Float32Array(accessor.count * components);
  for (let i = 0; i < accessor.count; i++) {
    const base = start + i * stride;
    for (let component = 0; component < components; component++) {
      out[i * components + component] = parts.view.getFloat32(base + component * 4, true);
    }
  }
  return out;
}

function readAccessorIndices(parts, accessorIndex) {
  const accessor = parts.json.accessors[accessorIndex];
  const bufferView = parts.json.bufferViews[accessor.bufferView];
  const width = accessor.componentType === 5125 ? 4 : 2;
  const stride = bufferView.byteStride || width;
  const start = parts.binStart + (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const ArrayType = width === 4 ? Uint32Array : Uint16Array;
  const out = new ArrayType(accessor.count);
  for (let i = 0; i < accessor.count; i++) {
    const offset = start + i * stride;
    out[i] = width === 4 ? parts.view.getUint32(offset, true) : parts.view.getUint16(offset, true);
  }
  return out;
}

// One LandsD b3dm primitive: positions, UVs, indices, and the embedded KTX2 photograph.
// These tiles address the image as image/ktx2 without KHR_texture_basisu, so the
// glTF texture loader does not own the decode.
export function readGlbMesh(glb) {
  const parts = glbParts(glb);
  const prim = parts.json.meshes?.[0]?.primitives?.[0];
  if (!prim || prim.attributes?.POSITION == null || prim.attributes?.TEXCOORD_0 == null || prim.indices == null) {
    return null;
  }
  for (const node of parts.json.nodes || []) {
    if (node.matrix || node.translation || node.rotation || node.scale) return null;
  }
  const image = (parts.json.images || []).find((entry) => entry.mimeType === 'image/ktx2' && entry.bufferView != null);
  if (!image) return null;
  const bufferView = parts.json.bufferViews[image.bufferView];
  const ktxStart = parts.binStart + (bufferView.byteOffset || 0);
  const ktx2 = new Uint8Array(bufferView.byteLength);
  ktx2.set(glb.subarray(ktxStart, ktxStart + bufferView.byteLength));
  return {
    positions: readAccessorFloats(parts, prim.attributes.POSITION, 3),
    uvs: readAccessorFloats(parts, prim.attributes.TEXCOORD_0, 2),
    indices: readAccessorIndices(parts, prim.indices),
    ktx2
  };
}

export function glbPositions(glb) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (view.byteLength < 20) return new Float32Array();
  const jsonLength = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  const attr = gltf.meshes?.[0]?.primitives?.[0]?.attributes?.POSITION;
  if (attr == null) return new Float32Array();
  const accessor = gltf.accessors[attr];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const stride = bufferView.byteStride || 12;
  const binChunk = 20 + jsonLength;
  const binStart = binChunk + 8 + (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const positions = new Float32Array(accessor.count * 3);
  for (let i = 0; i < accessor.count; i++) {
    const offset = binStart + i * stride;
    positions[i * 3] = view.getFloat32(offset, true);
    positions[i * 3 + 1] = view.getFloat32(offset + 4, true);
    positions[i * 3 + 2] = view.getFloat32(offset + 8, true);
  }
  return positions;
}

export function groundSnapOffset(heights, target = HK_GROUND_ASPHALT_Y) {
  const values = [];
  for (const value of heights || []) {
    if (Number.isFinite(value)) values.push(value);
  }
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const index = Math.min(values.length - 1, Math.floor(values.length * 0.15));
  return values[index] - target;
}

export function tileTriangleYieldsToBuilding(point, boxes, clearance = HK_GROUND_CHART_CLEARANCE) {
  if (!point || !(point.y > clearance)) return false;
  for (const box of boxes || []) {
    if (!box || !Number.isFinite(box.minX)) continue;
    if (point.x >= box.minX && point.x <= box.maxX && point.z >= box.minZ && point.z <= box.maxZ) return true;
  }
  return false;
}

export function ribbonYieldsToGroundTiles(x, z, eye = HK_STREET_EYE, radius = HK_GROUND_TILE_DISC) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  return Math.hypot(x - eye.x, z - eye.z) <= radius;
}

export function deckInstancesToYield(centres, eye = HK_STREET_EYE, radius = HK_GROUND_TILE_DISC) {
  const indexes = [];
  for (let i = 0; i < (centres || []).length; i++) {
    const centre = centres[i];
    if (ribbonYieldsToGroundTiles(centre?.x, centre?.z, eye, radius)) indexes.push(i);
  }
  return indexes;
}

// Live MSI crops only. A source-string check, a painted buffer, or a manhole-only
// delta does not pass. Megascans is a bridge and stays ownership-open.
export function digit1GroundOwnership(capture) {
  const empty = {
    pass: false,
    reason: 'live-msi-required',
    mad: 0,
    grainBefore: 0,
    grainAfter: 0,
    grainDelta: 0,
    ownership: capture?.ownership || ''
  };
  if (!capture || capture.live !== true || capture.synthetic === true) return empty;
  const width = capture.width;
  const height = capture.height;
  const mad = keithEyeMad(capture.before, capture.after, width, height);
  const grainBefore = keithEyeGrain(capture.before, width, height);
  const grainAfter = keithEyeGrain(capture.after, width, height);
  const grainDelta = grainAfter - grainBefore;
  const ownership = capture.ownership || '';
  // A flat AFTER that still differs from BEFORE (the page drew nothing, or a
  // screenshot raced the swapchain) is not a ground crop.
  if (grainAfter < HK_GROUND_BLANK_GRAIN && mad >= HK_GROUND_MAD_FLOOR) {
    return { pass: false, reason: 'blank-frame', mad, grainBefore, grainAfter, grainDelta, ownership };
  }
  const photo = ownership === 'tiles' || ownership === 'infrastructure' || ownership === 'terrain';
  const base = { mad, grainBefore, grainAfter, grainDelta, ownership };
  if (!photo) return { pass: false, reason: 'ownership-open', ...base };
  const pass = mad >= HK_GROUND_MAD_FLOOR && Math.abs(grainDelta) >= HK_GROUND_GRAIN_FLOOR;
  return { pass, reason: pass ? 'live-ground' : 'below-floor', ...base };
}

// Digit1-eye ground crops as fractions of the presented frame. Right-kerb is the
// north sidewalk and kerb line right of the avatar. Underfoot is the carriageway
// and kerb edge at the avatar's feet, left of its legs. Fractions keep the
// crops comparable between a 1280-wide headless frame and the MSI window.
export const DIGIT1_GROUND_CROPS = Object.freeze({
  'road-ahead': Object.freeze({ x0: 0.42, x1: 0.56, y0: 0.62, y1: 0.70 }),
  'south-kerb': Object.freeze({ x0: 0.06, x1: 0.30, y0: 0.74, y1: 0.94 }),
  'right-kerb': Object.freeze({ x0: 0.56, x1: 0.78, y0: 0.76, y1: 0.97 }),
  underfoot: Object.freeze({ x0: 0.34, x1: 0.46, y0: 0.82, y1: 0.99 })
});

export function cropRgba(data, width, height, rect) {
  const x0 = Math.max(0, Math.floor(rect.x0 * width));
  const x1 = Math.min(width, Math.ceil(rect.x1 * width));
  const y0 = Math.max(0, Math.floor(rect.y0 * height));
  const y1 = Math.min(height, Math.ceil(rect.y1 * height));
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((y0 + y) * width + x0 + x) * 4;
      const dst = (y * w + x) * 4;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

// Catmull-Rom reconstruction weights for a sample at fractional texel offset f.
// The photograph is magnified 10-20x underfoot (2 cm per texel on the eye tile
// against about 1.4 mm per pixel at the avatar's feet). Bilinear reads that as
// a smeared ramp between texel centres. These are the weights the shader uses.
export function catmullRomWeights(f) {
  const f2 = f * f;
  const f3 = f2 * f;
  return [
    -0.5 * f3 + f2 - 0.5 * f,
    1.5 * f3 - 2.5 * f2 + 1,
    -1.5 * f3 + 2 * f2 + 0.5 * f,
    0.5 * f3 - 0.5 * f2
  ];
}

// Texels per screen pixel is the footprint the sampler sees. The reconstruction
// and the unsharp gain are full where the photograph is magnified and fade out
// by one texel per pixel, so minified ground keeps the plain filter.
export const HK_GROUND_PHOTO_MAG_FULL = 0.5;
export const HK_GROUND_PHOTO_MAG_NONE = 1;
export const HK_GROUND_PHOTO_SHARPEN = 2.5;
export const HK_GROUND_PHOTO_RADIUS = 1.5;

export function groundPhotoMagnification(texelsPerPixel) {
  if (!Number.isFinite(texelsPerPixel) || texelsPerPixel < 0) return 0;
  const t = (texelsPerPixel - HK_GROUND_PHOTO_MAG_FULL) / (HK_GROUND_PHOTO_MAG_NONE - HK_GROUND_PHOTO_MAG_FULL);
  const x = Math.min(1, Math.max(0, t));
  return 1 - x * x * (3 - 2 * x);
}

// CPU twin of the shader's sharpen: the photograph's own texel minus the mean
// of its four neighbours, added back with a gain. A flat patch has no detail,
// so it stays flat. This does not add noise.
export function unsharpPhotoRgba(data, width, height, gain = HK_GROUND_PHOTO_SHARPEN) {
  const out = new Uint8ClampedArray(data.length);
  const at = (x, y, k) => data[(Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4 + k];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) {
        const c = data[o + k];
        const mean = (at(x - 1, y, k) + at(x + 1, y, k) + at(x, y - 1, k) + at(x, y + 1, k)) / 4;
        out[o + k] = c + gain * (c - mean);
      }
      out[o + 3] = data[o + 3];
    }
  }
  return out;
}

export const HK_GROUND_RESIDUAL_CROPS = Object.freeze(['right-kerb', 'underfoot']);

// Cut #45 bar: the #41 residual crops. Both must clear digit1GroundOwnership on
// a live pair. One crop passing, a missing crop, or a painted buffer is a fail.
export function digit1GroundResiduals(capture) {
  const rows = {};
  const live = capture?.live === true && capture?.synthetic !== true;
  for (const name of HK_GROUND_RESIDUAL_CROPS) {
    const crop = capture?.crops?.[name];
    rows[name] = crop
      ? digit1GroundOwnership({ ...crop, live, ownership: crop.ownership || capture.ownership })
      : { pass: false, reason: 'crop-missing', mad: 0, grainDelta: 0 };
  }
  const pass = HK_GROUND_RESIDUAL_CROPS.every((name) => rows[name].pass);
  return { pass, reason: pass ? 'live-residuals' : 'residual-open', rows };
}

// Band index of a screenshot pixel of a ?groundTint=gsd frame, or -1 when the
// pixel is not tint paint (sky, avatar, a facade).
export function groundTintBandOfRgb(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const span = max - min;
  if (max < 0.3 || span / (max || 1) < 0.45) return -1;
  let hue;
  if (max === r / 255) hue = (((g - b) / 255 / span) % 6 + 6) % 6;
  else if (max === g / 255) hue = (b - r) / 255 / span + 2;
  else hue = (r - g) / 255 / span + 4;
  hue *= 60;
  if (hue > 340) hue -= 360;
  return HK_GROUND_TINT_BANDS.findIndex((band) => hue >= band.hue[0] && hue < band.hue[1]);
}

export const HK_GROUND_TINT_DELTA = 90;
// The carriageway and left kerb ahead of the avatar, as fractions of the frame. The
// covered arcade on the right is silhouette, not a LOD seam.
export const HK_GROUND_SEAM_ROI = Object.freeze({ x0: 0.15, x1: 0.52, y0: 0.75, y1: 1 });
export const HK_GROUND_SEAM_MIN_RUN = 3;
export const HK_GROUND_SEAM_MIN_ROWS = 20;
export const HK_GROUND_SEAM_BAND = 14;
export const HK_GROUND_SEAM_RAGGED_GAIN = 1;
export const HK_GROUND_SEAM_RAGGED_CEIL = 1.2;
export const HK_GROUND_SEAM_BAND_MAD = 0.5;

// LOD seams in a ?groundTint=gsd frame, read where it differs from the photograph
// frame of the same page (tile pixels; a facade stripe is orange in both): every place two different GSD bands meet
// along a row, grouped by band pair. A world line is a straight line on screen, so
// each seam is fitted x = a + b y; rmsPx is the spread of its transitions about that
// line and teeth the transitions per row beyond the first. Two photographs fighting
// for the same overlap give a ragged edge (rmsPx of several pixels); one owner
// gives a line (well under a pixel).
export const HK_GROUND_SEAM_REACH = 24;

export function groundSeamLines(tint, photo, width, height, roi = HK_GROUND_SEAM_ROI) {
  const y0 = Math.max(0, Math.floor(roi.y0 * height));
  const y1 = Math.min(height, Math.ceil(roi.y1 * height));
  const x0 = Math.max(0, Math.floor(roi.x0 * width));
  const x1 = Math.min(width, Math.ceil(roi.x1 * width));
  const tracks = [];
  const bands = new Int8Array(x1 - x0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4;
      const painted = Math.abs(tint[o] - photo[o]) + Math.abs(tint[o + 1] - photo[o + 1]) + Math.abs(tint[o + 2] - photo[o + 2]) >= HK_GROUND_TINT_DELTA;
      bands[x - x0] = painted ? groundTintBandOfRgb(tint[o], tint[o + 1], tint[o + 2]) : -1;
    }
    // Runs shorter than a few pixels are anti-aliasing blends between two bands
    // (green over orange reads yellow), not a third owner.
    let prev = -1;
    let start = 0;
    while (start < bands.length) {
      let end = start;
      while (end < bands.length && bands[end] === bands[start]) end++;
      const band = bands[start];
      if (band >= 0 && end - start >= HK_GROUND_SEAM_MIN_RUN) {
        if (prev >= 0 && band !== prev) {
          const x = x0 + start;
          const low = Math.min(band, prev);
          const high = Math.max(band, prev);
          let track = null;
          let best = HK_GROUND_SEAM_REACH;
          for (const candidate of tracks) {
            if (candidate.low !== low || candidate.high !== high || y - candidate.lastY > 3) continue;
            const gap = Math.abs(candidate.lastX - x);
            if (gap <= best) {
              best = gap;
              track = candidate;
            }
          }
          if (!track) {
            track = { low, high, points: [], lastX: x, lastY: y };
            tracks.push(track);
          }
          track.points.push([x, y]);
          track.lastX = x;
          track.lastY = y;
        }
        prev = band;
      } else if (band < 0 && end - start >= HK_GROUND_SEAM_MIN_RUN) {
        prev = -1;
      }
      start = end;
    }
  }
  const seams = [];
  for (const track of tracks) {
    const rows = new Set(track.points.map((point) => point[1])).size;
    if (rows < HK_GROUND_SEAM_MIN_ROWS) continue;
    const byRow = new Map();
    for (const [x, y] of track.points) {
      const row = byRow.get(y) || { sum: 0, n: 0 };
      row.sum += x;
      row.n += 1;
      byRow.set(y, row);
    }
    let n = 0;
    let sy = 0;
    let sx = 0;
    let syy = 0;
    let sxy = 0;
    for (const [y, row] of byRow) {
      const x = row.sum / row.n;
      n += 1;
      sy += y;
      sx += x;
      syy += y * y;
      sxy += x * y;
    }
    const denom = n * syy - sy * sy;
    const slope = denom ? (n * sxy - sx * sy) / denom : 0;
    const intercept = (sx - slope * sy) / n;
    let sq = 0;
    for (const [x, y] of track.points) sq += (x - (intercept + slope * y)) ** 2;
    seams.push({
      key: `${track.low}-${track.high}`,
      low: track.low,
      high: track.high,
      rows,
      transitions: track.points.length,
      slope,
      intercept,
      rmsPx: Math.sqrt(sq / track.points.length),
      teeth: track.points.length / rows - 1
    });
  }
  seams.sort((a, b) => b.rows - a.rows);
  return seams;
}

// Pixels within half px of the fitted seam line, per row of the ROI.
export function groundSeamBandMask(seam, width, height, roi = HK_GROUND_SEAM_ROI, half = HK_GROUND_SEAM_BAND) {
  const mask = new Uint8Array(width * height);
  const y0 = Math.max(0, Math.floor(roi.y0 * height));
  const y1 = Math.min(height, Math.ceil(roi.y1 * height));
  for (let y = y0; y < y1; y++) {
    const centre = Math.round(seam.intercept + seam.slope * y);
    for (let x = Math.max(0, centre - half); x <= Math.min(width - 1, centre + half); x++) mask[y * width + x] = 1;
  }
  return mask;
}

export function maskedMad(before, after, mask) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    sum += (Math.abs(before[o] - after[o]) + Math.abs(before[o + 1] - after[o + 1]) + Math.abs(before[o + 2] - after[o + 2])) / 3;
    n += 1;
  }
  return n ? sum / n : 0;
}

export function maskedGrain(data, width, height, mask) {
  let sum = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!mask[y * width + x]) continue;
      let mean = 0;
      let meanSq = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const o = ((y + dy) * width + x + dx) * 4;
          const luma = keithEyeLuma(data[o], data[o + 1], data[o + 2]);
          mean += luma;
          meanSq += luma * luma;
        }
      }
      mean /= 9;
      sum += Math.sqrt(Math.max(0, meanSq / 9 - mean * mean));
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

// Cut #46 bar. A live pair of Digit1 eye frames, each as a ?groundTint=gsd frame
// and a photograph frame (BEFORE is the same page with ?groundPriority=off, which
// is the #45 mount). PASS needs tiles ownership, a LOD seam on the eye frame, the
// seam's ragged edge gone (rms spread cut by a pixel and at most 1.2 px after,
// with no teeth left) and the photograph within the seam band changed at
// above the frame-to-frame noise of one tip (about 0.1). Soft is not SD.
export function digit1GroundSeams(capture) {
  const empty = { pass: false, reason: 'live-msi-required', seam: null };
  if (!capture || capture.live !== true || capture.synthetic === true) return empty;
  const { width, height } = capture;
  const ownership = capture.ownership || '';
  const photo = ownership === 'tiles' || ownership === 'infrastructure' || ownership === 'terrain';
  const whole = new Uint8Array(width * height).fill(1);
  const grainAfter = maskedGrain(capture.after, width, height, whole);
  if (grainAfter < HK_GROUND_BLANK_GRAIN) return { pass: false, reason: 'blank-frame', seam: null, ownership };
  if (!photo) return { pass: false, reason: 'ownership-open', seam: null, ownership };
  const after = groundSeamLines(capture.afterTint, capture.after, width, height);
  const before = groundSeamLines(capture.beforeTint, capture.before, width, height);
  if (!after.length || !before.length) return { pass: false, reason: 'no-seam', seam: null, ownership };
  const seam = after[0];
  const was = before.find((entry) => entry.key === seam.key) || before[0];
  const mask = groundSeamBandMask(seam, width, height);
  const bandMad = maskedMad(capture.before, capture.after, mask);
  const row = {
    key: seam.key,
    rows: seam.rows,
    raggedBefore: was.rmsPx,
    raggedAfter: seam.rmsPx,
    teethBefore: was.teeth,
    teethAfter: seam.teeth,
    bandMad,
    bandGrainBefore: maskedGrain(capture.before, width, height, mask),
    bandGrainAfter: maskedGrain(capture.after, width, height, mask)
  };
  const ragged = was.rmsPx - seam.rmsPx >= HK_GROUND_SEAM_RAGGED_GAIN && seam.rmsPx <= HK_GROUND_SEAM_RAGGED_CEIL;
  const pass = ragged && bandMad >= HK_GROUND_SEAM_BAND_MAD;
  return { pass, reason: pass ? 'live-seam' : ragged ? 'band-below-floor' : 'seam-open', seam: row, ownership };
}
