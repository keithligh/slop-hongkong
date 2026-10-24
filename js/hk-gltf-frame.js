import {
  BLOCKS,
  HK_CORE_WORLD,
  HK_GLTF_CAP,
  HK_GLTF_SHEET,
  HK_GLTF_SHEETS,
  HK_GLTF_STREET_HALF,
  HK_GLTF_STREET_REACH,
  HK_GLTF_TEX_NEAR,
  HK_STREET_EYE,
  HK_STREET_NEAR,
  ISLAND_BOUNDS,
  blockInHkCore,
  hkCoreProject,
  hkFootprintHeight
} from './city-config.js';

// LandsD individualised glTF (Open3Dhk, EPSG:2326). Node matrices are column-major:
// X = HK1980 easting, Y = HKPD, Z = −northing. Local glTF Z is up; the node swaps it onto Y.
// Inverse Transverse Mercator matches LandsD explanatory notes (worked example, page C9).
// WGS84 is the published small-area shift: latitude −5.5″, longitude +8.8″ (about a metre
// against the Geodetic Survey API on the 11-SW-9B terrain centre, checked 2026-10-24).

const A_HK = 6378388;
const E2_HK = 6.722670022e-3;
const E4_HK = E2_HK * E2_HK;
const GRID_N0 = 819069.8;
const GRID_E0 = 836694.05;
const PHI0 = (22 + 18 / 60 + 43.68 / 3600) * Math.PI / 180;
const LAM0 = (114 + 10 / 60 + 42.8 / 3600) * Math.PI / 180;
const M0 = 2468395.728;
const A0 = 1 - E2_HK / 4 - (3 * E4_HK) / 64;
const A2 = (3 / 8) * (E2_HK + E4_HK / 4);
const A4 = (15 * E4_HK) / 256;
const SHEET_RE = /^[0-9]{1,2}-[NS][EW]-[0-9]{1,2}[A-D]$/i;
const HK_GLTF_MIN_SPAN = 8;

function meridian(phi) {
  return A_HK * (A0 * phi - A2 * Math.sin(2 * phi) + A4 * Math.sin(4 * phi));
}

export function hk80GridToHk80Geog(easting, northing) {
  const target = M0 + (northing - GRID_N0);
  let phi = PHI0;
  for (let i = 0; i < 30; i++) {
    const deriv = A_HK * (A0 - 2 * A2 * Math.cos(2 * phi) + 4 * A4 * Math.cos(4 * phi));
    phi += (target - meridian(phi)) / deriv;
  }
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const t = Math.tan(phi);
  const nu = A_HK / Math.sqrt(1 - E2_HK * s * s);
  const rho = (A_HK * (1 - E2_HK)) / (1 - E2_HK * s * s) ** 1.5;
  const psi = nu / rho;
  const dE = easting - GRID_E0;
  const x = dE / nu;
  const lat = phi - (t / rho) * (dE * dE) / (2 * nu);
  const lam = LAM0 + x / c - (x ** 3) / (6 * c) * (psi + 2 * t * t);
  return { lat: (lat * 180) / Math.PI, lon: (lam * 180) / Math.PI };
}

export function hk80GridToWgs84(easting, northing) {
  const hk = hk80GridToHk80Geog(easting, northing);
  return { lat: hk.lat - 5.5 / 3600, lon: hk.lon + 8.8 / 3600 };
}

export function hkpdToSidewalkY(hkpd, minHkpd, sidewalk = ISLAND_BOUNDS.sidewalkHeight) {
  return (hkpd - minHkpd) + sidewalk;
}

export function hk80ToWorld(easting, northing, hkpd, minHkpd = hkpd) {
  const { lat, lon } = hk80GridToWgs84(easting, northing);
  const [x, z] = hkCoreProject(lon, lat);
  return [x, hkpdToSidewalkY(hkpd, minHkpd), z];
}

function localMatrix(node) {
  if (node.matrix && node.matrix.length === 16) return node.matrix;
  const t = node.translation || [0, 0, 0];
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
}

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

export function boundsFromGltf(doc) {
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

  let name = '';
  for (const node of nodes) {
    if (node.name) {
      name = node.name;
      break;
    }
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minH = Infinity;
  let maxH = -Infinity;
  let any = false;
  nodes.forEach((node, index) => {
    if (node.mesh == null) return;
    const mesh = (doc.meshes || [])[node.mesh];
    const m = worlds[index] || localMatrix(node);
    for (const prim of mesh?.primitives || []) {
      const acc = (doc.accessors || [])[prim.attributes?.POSITION];
      if (!acc?.min || !acc?.max) continue;
      const [x0, y0, z0] = acc.min;
      const [x1, y1, z1] = acc.max;
      const corners = [
        [x0, y0, z0], [x0, y0, z1], [x0, y1, z0], [x0, y1, z1],
        [x1, y0, z0], [x1, y0, z1], [x1, y1, z0], [x1, y1, z1]
      ];
      for (const [x, y, z] of corners) {
        const placed = applyMat4(m, x, y, z);
        const [wx, , wz] = hk80ToWorld(placed[0], -placed[2], placed[1]);
        minX = Math.min(minX, wx);
        maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz);
        maxZ = Math.max(maxZ, wz);
        minH = Math.min(minH, placed[1]);
        maxH = Math.max(maxH, placed[1]);
        any = true;
      }
    }
  });
  if (!any) throw new Error(`no POSITION bounds in ${name || 'gltf'}`);
  return {
    name,
    minX,
    maxX,
    minZ,
    maxZ,
    minH,
    maxH,
    span: Math.max(maxX - minX, maxZ - minZ)
  };
}

export function isBuildingGltf(filePath) {
  const norm = String(filePath).replace(/\\/g, '/');
  const file = norm.split('/').pop() || '';
  if (!file.toLowerCase().endsWith('.gltf')) return false;
  const upper = norm.toUpperCase();
  return upper.includes('/BUILDING/') || upper.startsWith('BUILDING/') || file.toUpperCase().startsWith('BUILDING_');
}

export function assertSheetAllowed(sheet) {
  const id = String(sheet || '').trim().toUpperCase();
  if (!SHEET_RE.test(id)) throw new Error(`bad sheet ${sheet}`);
  return id;
}

export function chooseCentralSheet(reports) {
  if (!reports?.length) throw new Error('no sheet reports');
  const first = reports[0];
  if (first.overlap > 0) {
    return {
      sheet: first.sheet,
      reason: `${first.sheet} has ${first.overlap} BUILDING glTF models overlapping Central`
    };
  }
  const fallback = reports.find((report) => report.sheet === '11-SW-9A' && report !== first);
  if (first.sheet === '11-SW-9B' && fallback) {
    return {
      sheet: '11-SW-9A',
      reason: `11-SW-9B has ${first.buildingFiles} BUILDING glTF files and ${first.overlap} overlapping Central. Using 11-SW-9A (${fallback.buildingFiles} BUILDING files, ${fallback.overlap} overlapping).`
    };
  }
  return {
    sheet: first.sheet,
    reason: `${first.sheet} has no Central BUILDING overlap`
  };
}

function intersectsCore(entry, core) {
  return entry.maxX >= core.minX && entry.minX <= core.maxX && entry.maxZ >= core.minZ && entry.minZ <= core.maxZ;
}

export function boxClosestDistance(box, eye) {
  if (!box || !eye) return Infinity;
  const x = Math.max(box.minX, Math.min(eye.x, box.maxX));
  const z = Math.max(box.minZ, Math.min(eye.z, box.maxZ));
  return Math.hypot(x - eye.x, z - eye.z);
}

export function footprintOverlapRatio(block, mesh, margin = 2) {
  if (!block || !mesh) return 0;
  const minX = Math.max(block.minX, mesh.minX - margin);
  const maxX = Math.min(block.maxX, mesh.maxX + margin);
  const minZ = Math.max(block.minZ, mesh.minZ - margin);
  const maxZ = Math.min(block.maxZ, mesh.maxZ + margin);
  const iw = maxX - minX;
  const iz = maxZ - minZ;
  if (iw <= 0 || iz <= 0) return 0;
  const blockArea = Math.max(1, (block.maxX - block.minX) * (block.maxZ - block.minZ));
  const meshArea = Math.max(1, (mesh.maxX - mesh.minX) * (mesh.maxZ - mesh.minZ));
  return (iw * iz) / Math.min(blockArea, meshArea);
}

export function gltfCoversFootprint(block, meshes, margin = 2) {
  if (!block || !meshes?.length) return false;
  return meshes.some((mesh) => footprintOverlapRatio(block, mesh, margin) >= 0.15);
}

// 0 keeps the file's native edge (LandsD facade JPEGs are 4096). Off-chase masses may drop to 2048.
export const HK_GLTF_FAR_TEX = 2048;

function chaseAxes(eye) {
  const heading = Number.isFinite(eye?.heading) ? eye.heading : HK_STREET_EYE.heading;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  return { x: eye?.x ?? HK_STREET_EYE.x, z: eye?.z ?? HK_STREET_EYE.z, fx, fz, sx: -fz, sz: fx };
}

// Along / side of the mesh box in the Des Voeux look frame. Side 0 is the look ray.
export function gltfBoxChase(entry, eye = HK_STREET_EYE) {
  const { x, z, fx, fz, sx, sz } = chaseAxes(eye);
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  let minSide = Infinity;
  let maxSide = -Infinity;
  const xs = [entry?.minX, entry?.maxX];
  const zs = [entry?.minZ, entry?.maxZ];
  for (const px of xs) {
    for (const pz of zs) {
      const dx = px - x;
      const dz = pz - z;
      const along = dx * fx + dz * fz;
      const side = dx * sx + dz * sz;
      if (along < minAlong) minAlong = along;
      if (along > maxAlong) maxAlong = along;
      if (side < minSide) minSide = side;
      if (side > maxSide) maxSide = side;
    }
  }
  return { minAlong, maxAlong, minSide, maxSide };
}

// The person chase, not a radius. A facade whose box crosses the look corridor
// is on screen at eye height: The Henderson sits on this ray past 120 m, and a
// mip chain there is the brown smear. Masses behind the camera do not qualify.
export function gltfInStreetChase(entry, eye = HK_STREET_EYE, reach = HK_GLTF_STREET_REACH, half = HK_GLTF_STREET_HALF) {
  if (!entry || !Number.isFinite(entry.minX)) return false;
  const { minAlong, maxAlong, minSide, maxSide } = gltfBoxChase(entry, eye);
  return maxAlong >= -12 && minAlong <= reach && maxSide >= -half && minSide <= half;
}

// Native photo: the 120 m disc (a glance off the ray still hits the colonnade)
// or the chase corridor past that disc.
export function gltfStreetPhoto(entry, eye = HK_STREET_EYE, near = HK_GLTF_TEX_NEAR) {
  if (!entry) return false;
  if (boxClosestDistance(entry, eye) <= near) return true;
  return gltfInStreetChase(entry, eye);
}

export function gltfTextureMaxEdge(entry, eye = HK_STREET_EYE, near = HK_GLTF_TEX_NEAR) {
  if (!entry) return HK_GLTF_FAR_TEX;
  return gltfStreetPhoto(entry, eye, near) ? 0 : HK_GLTF_FAR_TEX;
}

// Chase atlases stay one mip, sampled with a linear filter and no anisotropy.
// A generated mip chain on these 4096 charts smears a street-height wall, so
// the chase sampler still does not ask for one. That sampler is not what paints
// the blank podium. LandsD leaves large triangles on a constant atlas fill
// (about 136,138,137, also 128,128,128 and black). Those triangles are omitted
// so the same mesh's photographic charts remain. The sample uses glTF v = 0 as
// the first image row, the same row flipY false uploads. Off-look masses still
// keep a real mip chain and anisotropy 16.

// LandsD atlas padding. A texel this flat is not a facade photograph.
export function isLandsdNullTexel(r, g, b) {
  if (r <= 3 && g <= 3 && b <= 3) return true;
  if (Math.abs(r - 128) <= 2 && Math.abs(g - 128) <= 2 && Math.abs(b - 128) <= 2) return true;
  if (Math.abs(r - 136) <= 4 && Math.abs(g - 138) <= 4 && Math.abs(b - 137) <= 4) return true;
  return false;
}

// glTF v = 0 is the first row of the file (the top). flipY false uploads that
// row to texture v = 0. Row (1-v) is the other side of the chart.
export function landsdAlbedoRow(v, height) {
  if (!(height > 0)) return 0;
  let vv = v % 1;
  if (vv < 0) vv += 1;
  return Math.min(height - 1, (vv * height) | 0);
}

function texelIsNull(rgb) {
  return !!(rgb && isLandsdNullTexel(rgb[0], rgb[1], rgb[2]));
}

// Drop a triangle when every corner is padding, or when the face centre is.
// A photographed centre stays. A missing sample stays (the mesh is not deleted).
// The centre test is what removes a padding face that only shares a corner with a chart.
export function landsdNullFillTriangles(index, sampleVertex, sampleCentroid) {
  const kept = [];
  let dropped = 0;
  const src = index || [];
  for (let t = 0; t + 2 < src.length; t += 3) {
    const a = src[t];
    const b = src[t + 1];
    const c = src[t + 2];
    const ca = sampleVertex(a);
    const cb = sampleVertex(b);
    const cc = sampleVertex(c);
    const cornersNull = texelIsNull(ca) && texelIsNull(cb) && texelIsNull(cc);
    const centroidNull = sampleCentroid ? texelIsNull(sampleCentroid(a, b, c)) : false;
    if (cornersNull || centroidNull) {
      dropped++;
      continue;
    }
    kept.push(a, b, c);
  }
  return { index: kept, dropped };
}

const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function componentBytes(type) {
  if (type === 5120 || type === 5121) return 1;
  if (type === 5122 || type === 5123) return 2;
  if (type === 5125 || type === 5126) return 4;
  return 0;
}

function readComponent(view, offset, type) {
  switch (type) {
    case 5120: return view.getInt8(offset);
    case 5121: return view.getUint8(offset);
    case 5122: return view.getInt16(offset, true);
    case 5123: return view.getUint16(offset, true);
    case 5125: return view.getUint32(offset, true);
    case 5126: return view.getFloat32(offset, true);
    default: {
      const unknown = type;
      throw new Error(`gltf component ${unknown}`);
    }
  }
}

function readAccessor(doc, index, buffers) {
  const acc = doc.accessors[index];
  const view = doc.bufferViews[acc.bufferView];
  const buf = buffers[view.buffer];
  const bytes = componentBytes(acc.componentType);
  if (!buf || !bytes) throw new Error('gltf accessor buffer');
  const data = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const comps = COMPS[acc.type];
  if (!comps) throw new Error(`gltf accessor ${acc.type}`);
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = view.byteStride || comps * bytes;
  const out = new Float64Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) {
    const base = start + i * stride;
    for (let c = 0; c < comps; c++) out[i * comps + c] = readComponent(data, base + c * bytes, acc.componentType);
  }
  return out;
}

// World triangles for one LandsD building, sidewalk-snapped the same way the
// mounted mesh is. Used to test look rays past the box cap, where a hollow
// shell's bounds are not a facade. Returns null when the file has no positions.
export function bakeGltfWorldTriangles(doc, buffers, sidewalk = ISLAND_BOUNDS.sidewalkHeight) {
  if (!doc) return null;
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
  const parts = [];
  let minH = Infinity;
  nodes.forEach((node, index) => {
    if (node.mesh == null) return;
    const mesh = (doc.meshes || [])[node.mesh];
    const m = worlds[index] || localMatrix(node);
    for (const prim of mesh?.primitives || []) {
      if (prim.attributes?.POSITION == null) continue;
      const pos = readAccessor(doc, prim.attributes.POSITION, buffers);
      const count = pos.length / 3;
      const placed = new Float64Array(pos.length);
      for (let i = 0; i < count; i++) {
        const p = applyMat4(m, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        const [x, , z] = hk80ToWorld(p[0], -p[2], p[1]);
        placed[i * 3] = x;
        placed[i * 3 + 1] = p[1];
        placed[i * 3 + 2] = z;
        if (p[1] < minH) minH = p[1];
      }
      let indexData;
      if (prim.indices != null) indexData = readAccessor(doc, prim.indices, buffers);
      else {
        indexData = new Float64Array(count);
        for (let i = 0; i < count; i++) indexData[i] = i;
      }
      parts.push({ placed, indexData });
    }
  });
  if (!parts.length || !Number.isFinite(minH)) return null;
  const shift = sidewalk - minH;
  const floats = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const part of parts) {
    const { placed, indexData } = part;
    for (let i = 1; i < placed.length; i += 3) placed[i] += shift;
    for (let t = 0; t + 2 < indexData.length; t += 3) {
      for (const id of [indexData[t], indexData[t + 1], indexData[t + 2]]) {
        const x = placed[id * 3];
        const y = placed[id * 3 + 1];
        const z = placed[id * 3 + 2];
        floats.push(x, y, z);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
  }
  if (floats.length < 9) return null;
  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    triangles: Float32Array.from(floats)
  };
}

export function gltfAlbedoSampler(entry, eye = HK_STREET_EYE, near = HK_GLTF_TEX_NEAR) {
  const maxEdge = gltfTextureMaxEdge(entry, eye, near);
  if (maxEdge === 0) return { maxEdge: 0, mipmaps: false, anisotropy: 1, minFilter: 'linear' };
  return { maxEdge, mipmaps: true, anisotropy: 16, minFilter: 'mipmap' };
}

function bankOfChinaPins() {
  const pins = [];
  for (const block of BLOCKS) {
    if (block?.name === 'Bank of China Tower' && block.height === 303.3) pins.push(block);
  }
  return pins;
}

export function planGltfManifest(manifest, {
  cap = HK_GLTF_CAP,
  minSpan = HK_GLTF_MIN_SPAN,
  core = HK_CORE_WORLD,
  eye = HK_STREET_EYE,
  pins = null
} = {}) {
  const buildings = Array.isArray(manifest?.buildings) ? manifest.buildings : [];
  let skippedSpeck = 0;
  let skippedOutside = 0;
  const masses = [];
  for (const entry of buildings) {
    if (!(entry.span >= minSpan)) {
      skippedSpeck++;
      continue;
    }
    if (!intersectsCore(entry, core)) {
      skippedOutside++;
      continue;
    }
    masses.push({ ...entry, dist: boxClosestDistance(entry, eye) });
  }
  const pinBoxes = pins || bankOfChinaPins();
  const pinned = [];
  const rest = [];
  for (const entry of masses) {
    if (pinBoxes.some((pin) => footprintOverlapRatio(pin, entry, 2) >= 0.15)) pinned.push(entry);
    else rest.push(entry);
  }
  // Street faces first. A nearer Sheung Wan block behind the camera must not
  // take the cap slot of a facade on the Des Voeux look.
  const byChase = (a, b) => {
    const pa = gltfStreetPhoto(a, eye) ? 0 : 1;
    const pb = gltfStreetPhoto(b, eye) ? 0 : 1;
    return pa - pb || a.dist - b.dist || (b.span - a.span);
  };
  pinned.sort(byChase);
  rest.sort(byChase);
  const selected = pinned.concat(rest).slice(0, cap).map(({ dist, ...entry }) => entry);
  return {
    sheet: manifest?.sheet || '',
    reason: manifest?.reason || '',
    selected,
    skippedSpeck,
    skippedOutside,
    skippedCap: Math.max(0, masses.length - selected.length)
  };
}

export function hiddenExtrudeIds(blocks, meshes, {
  margin = 2,
  eye = HK_STREET_EYE,
  near = HK_STREET_NEAR
} = {}) {
  const list = meshes || [];
  const killNear = list.some((mesh) => boxClosestDistance(mesh, eye) <= near);
  const ids = [];
  for (const block of blocks) {
    if (block.park > 0.6 || block.median) continue;
    if (!blockInHkCore(block)) continue;
    if (!(hkFootprintHeight(block) > 0)) continue;
    const nearField = killNear && boxClosestDistance(block, eye) <= near;
    if (nearField || gltfCoversFootprint(block, list, margin)) ids.push(block.id);
  }
  return ids;
}

export function resolveHkGltfRequest(href, { configured = HK_GLTF_SHEET, sheets = HK_GLTF_SHEETS, cap = HK_GLTF_CAP } = {}) {
  let sheetQuery = '';
  let capQuery = '';
  try {
    const params = new URL(href || 'http://local/', 'http://local/').searchParams;
    sheetQuery = params.get('gltf') || '';
    capQuery = params.get('gltfCap') || '';
  } catch {
    sheetQuery = '';
  }
  let n = cap;
  if (capQuery) {
    const parsed = Number(capQuery);
    if (Number.isFinite(parsed) && parsed > 0) n = parsed;
  }
  const clamped = Math.min(800, Math.floor(n));
  const query = sheetQuery.trim();
  if (query) {
    if (!SHEET_RE.test(query)) return null;
    const sheet = query.toUpperCase();
    return { sheet, sheets: [sheet], cap: clamped };
  }
  const list = (Array.isArray(sheets) && sheets.length ? sheets : (configured ? [configured] : []))
    .map((id) => String(id || '').trim().toUpperCase())
    .filter((id) => SHEET_RE.test(id));
  if (!list.length) return null;
  return { sheet: list[0], sheets: list, cap: clamped };
}

export function formatGltfLog(info) {
  return `[gltf] sheet ${info.sheet} loaded ${info.loaded} skipped ${info.skipped} ` +
    `(speck ${info.skippedSpeck} outside ${info.skippedOutside} cap ${info.skippedCap}); ` +
    `extrudes hidden ${info.hidden}; ` +
    `transform EPSG:2326 HK1980 grid → WGS84 (−5.5″ lat, +8.8″ lon) → Central ENU; ` +
    `y snaps min HKPD to sidewalk ${info.sidewalk}m; ` +
    `street eye ${HK_STREET_EYE.x},${HK_STREET_EYE.z} hides procedural within ${HK_STREET_NEAR}m when a LandsD mesh is inside that disc`;
}

export { HK_GLTF_MIN_SPAN };
