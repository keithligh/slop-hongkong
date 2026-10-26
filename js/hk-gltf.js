import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BLOCKS, HK_GLTF_CAP, HK_GLTF_SHEET, HK_GLTF_SHEETS, HK_STREET_EYE, ISLAND_BOUNDS } from './city-config.js';
import {
  bakeGltfWorldTriangles,
  boxClosestDistance,
  formatGltfLog,
  clampLandsdAnisotropy,
  gltfAlbedoSampler,
  filterPinSheetBuildings,
  gltfInStreetChase,
  hiddenExtrudeIds,
  hk80ToWorld,
  isGltfPinSheet,
  landsdAlbedoRow,
  groupLandsdOnEyeCharts,
  isLandsdOnEyeChart,
  LANDSD_ON_EYE_ATLAS,
  LANDSD_ON_EYE_PAD,
  landsdChartPixels,
  landsdChartRect,
  landsdChartWrap,
  landsdDilateGutter,
  packLandsdChartBins,
  landsdGutterFraction,
  landsdGutterMip,
  landsdNullFillTriangles,
  nullFillSampleSize,
  planGltfManifest,
  remapLandsdChartUv,
  resolveHkGltfRequest
} from './hk-gltf-frame.js';
import { filterDigit1ProbeBuildings, parseDigit1ProbeRequest } from './digit1-probe-frame.js';

// LandsD individualised sheets for Central street faces. A missing manifest leaves the extrudes.
// GLTFLoader is a static import. index.html pins that one addon file: the jsDelivr
// `@dev` alias currently answers 403 for GLTFLoader.js ("package size exceeded").

const position = new THREE.Vector3();
const normal = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();

function bakeMesh(mesh) {
  const geo = mesh.geometry.clone();
  const pos = geo.getAttribute('position');
  if (!pos) return null;
  mesh.updateWorldMatrix(true, false);
  const matrix = mesh.matrixWorld;
  normalMatrix.getNormalMatrix(matrix);
  const baked = new Float32Array(pos.count * 3);
  let minH = Infinity;
  for (let i = 0; i < pos.count; i++) {
    position.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    const hkpd = position.y;
    const [x, , z] = hk80ToWorld(position.x, -position.z, hkpd);
    baked[i * 3] = x;
    baked[i * 3 + 1] = hkpd;
    baked[i * 3 + 2] = z;
    if (hkpd < minH) minH = hkpd;
  }
  const shift = ISLAND_BOUNDS.sidewalkHeight - minH;
  for (let i = 0; i < pos.count; i++) baked[i * 3 + 1] += shift;
  geo.setAttribute('position', new THREE.BufferAttribute(baked, 3));
  const srcNormal = geo.getAttribute('normal');
  if (srcNormal) {
    const bakedNormal = new Float32Array(srcNormal.count * 3);
    for (let i = 0; i < srcNormal.count; i++) {
      normal.fromBufferAttribute(srcNormal, i).applyMatrix3(normalMatrix).normalize();
      bakedNormal[i * 3] = normal.x;
      bakedNormal[i * 3 + 1] = normal.y;
      bakedNormal[i * 3 + 2] = normal.z;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(bakedNormal, 3));
  } else {
    geo.computeVertexNormals();
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function limitPhoto(tex, maxEdge) {
  if (!(maxEdge > 0)) return;
  const img = tex?.image;
  const w = img?.width || 0;
  const h = img?.height || 0;
  if (!w || !h || (w <= maxEdge && h <= maxEdge)) return;
  if (typeof document === 'undefined') return;
  const scale = maxEdge / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  tex.image = canvas;
  tex.needsUpdate = true;
}

const PHOTO_MAPS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'];

// The device limit. Core WebGPU reports 16; an adapter that only allows 1 cannot
// take the anisotropic taps, and a second mip without those taps only blurs.
let anisotropyLimit = 16;

export function setLandsdAnisotropyLimit(value) {
  anisotropyLimit = clampLandsdAnisotropy(value, value);
}

const GUTTER_MIP_FRACTION = 0.02;
// A 4096² dilate is a load-time stall. Charts that were cropped are already
// well under this. Full-bleed atlases still get a gutter-aware chain; only
// the shore dilate is skipped when the pixel count is past the cap.
const DILATE_PIXEL_CAP = 2048 * 2048;

function uvBounds(geo) {
  const uv = geo.getAttribute('uv');
  if (!uv?.count) return null;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  const visit = (i) => {
    if (i < 0 || i >= uv.count) return;
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  };
  const index = geo.getIndex();
  if (index) {
    const arr = index.array;
    const start = geo.drawRange?.start || 0;
    const count = geo.drawRange && Number.isFinite(geo.drawRange.count) ? geo.drawRange.count : arr.length;
    const end = Math.min(arr.length, start + count);
    for (let i = start; i < end; i++) visit(arr[i]);
  } else {
    for (let i = 0; i < uv.count; i++) visit(i);
  }
  if (!Number.isFinite(minU)) return null;
  return { minU, minV, maxU, maxV };
}

function remapGeoUv(geo, rect) {
  const uv = geo.getAttribute('uv');
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) {
    const [u, v] = remapLandsdChartUv(uv.getX(i), uv.getY(i), rect);
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function canvasFromPixels(data, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

function readImagePixels(img) {
  const w = img?.width || 0;
  const h = img?.height || 0;
  if (!w || !h || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  try {
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
  } catch {
    return null;
  }
}

function cropTextureToChart(tex, rect) {
  const key = `${rect.u0},${rect.v0},${rect.u1},${rect.v1}`;
  if (tex.userData.hkChartKey === key) return true;
  if (tex.userData.hkChartKey) return false;
  const img = tex.image;
  const w = img?.width || 0;
  const h = img?.height || 0;
  const px = landsdChartPixels(rect, w, h);
  if (!px || typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, px.x0, px.y0, px.width, px.height, 0, 0, px.width, px.height);
  tex.image = canvas;
  tex.userData.hkChartKey = key;
  tex.needsUpdate = true;
  return true;
}

// Manual chain: level 0 is the (shore-dilated) photograph, and every deeper
// level averages photograph texels only. generateMipmaps stays false so the
// GPU does not replace this chain with one that blends the gutter back in.
function uploadGutterMips(tex, pixels, anisotropy) {
  let current = pixels;
  if (current.width * current.height <= DILATE_PIXEL_CAP) {
    current = {
      data: landsdDilateGutter(current.data, current.width, current.height, 2),
      width: current.width,
      height: current.height
    };
  }
  const levels = [];
  let data = current.data;
  let w = current.width;
  let h = current.height;
  const base = canvasFromPixels(data, w, h);
  if (!base) return false;
  levels.push(base);
  while ((w > 1 || h > 1) && levels.length < 16) {
    const next = landsdGutterMip(data, w, h);
    const canvas = canvasFromPixels(next.data, next.width, next.height);
    if (!canvas) return false;
    levels.push(canvas);
    data = next.data;
    w = next.width;
    h = next.height;
  }
  tex.image = levels[0];
  tex.mipmaps = levels;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = anisotropy;
  tex.userData.hkChartMips = true;
  tex.userData.hkFullRes = true;
  tex.needsUpdate = true;
  return true;
}

function uploadChaseMips(tex, sampler, wrap) {
  if (tex.userData?.hkChartMips) return;
  const aniso = clampLandsdAnisotropy(sampler.anisotropy, anisotropyLimit);
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = tex.wrapS;
  tex.flipY = false;
  tex.anisotropy = aniso;
  const pixels = readImagePixels(tex.image);
  const gutter = pixels ? landsdGutterFraction(pixels.data, pixels.width, pixels.height, 4) : 0;
  if (pixels && gutter >= GUTTER_MIP_FRACTION && uploadGutterMips(tex, pixels, aniso)) return;
  tex.mipmaps = [];
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.userData.hkChartMips = true;
  tex.userData.hkFullRes = true;
  tex.needsUpdate = true;
}

function activeIndex(geo) {
  const index = geo.getIndex();
  if (!index) {
    const n = geo.getAttribute('position')?.count || 0;
    const out = [];
    for (let i = 0; i < n; i++) out.push(i);
    return out;
  }
  const arr = index.array;
  const start = geo.drawRange?.start || 0;
  const count = geo.drawRange && Number.isFinite(geo.drawRange.count) ? geo.drawRange.count : arr.length;
  const end = Math.min(arr.length, start + count);
  const out = [];
  for (let i = start; i < end; i++) out.push(arr[i]);
  return out;
}

function triangleUv(uv, index, triangle) {
  const base = triangle * 3;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let k = 0; k < 3; k++) {
    const vertex = index[base + k];
    if (vertex < 0 || vertex >= uv.count) continue;
    const u = uv.getX(vertex);
    const v = uv.getY(vertex);
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  }
  return { minU, minV, maxU, maxV };
}

function copyChartPixels(src, sw, atlas, size, pixels, slot) {
  const { x0, y0, width, height } = pixels;
  const destX = slot.contentX;
  const destY = slot.contentY;
  for (let dy = 0; dy < height; dy++) {
    const srcRow = (y0 + dy) * sw + x0;
    const dstRow = (destY + dy) * size + destX;
    for (let dx = 0; dx < width; dx++) {
      const s = (srcRow + dx) * 4;
      const d = (dstRow + dx) * 4;
      atlas[d] = src[s];
      atlas[d + 1] = src[s + 1];
      atlas[d + 2] = src[s + 2];
      atlas[d + 3] = src[s + 3];
    }
  }
  const pad = slot.pad;
  for (let dy = 0; dy < height; dy++) {
    const row = (destY + dy) * size;
    const left = (row + destX) * 4;
    const right = (row + destX + width - 1) * 4;
    for (let p = 1; p <= pad; p++) {
      const dl = (row + destX - p) * 4;
      const dr = (row + destX + width - 1 + p) * 4;
      atlas[dl] = atlas[left];
      atlas[dl + 1] = atlas[left + 1];
      atlas[dl + 2] = atlas[left + 2];
      atlas[dl + 3] = atlas[left + 3];
      atlas[dr] = atlas[right];
      atlas[dr + 1] = atlas[right + 1];
      atlas[dr + 2] = atlas[right + 2];
      atlas[dr + 3] = atlas[right + 3];
    }
  }
  const span = width + pad * 2;
  const slotX = slot.x;
  for (let p = 1; p <= pad; p++) {
    for (let dx = 0; dx < span; dx++) {
      const top = ((destY) * size + slotX + dx) * 4;
      const up = ((destY - p) * size + slotX + dx) * 4;
      const bot = ((destY + height - 1) * size + slotX + dx) * 4;
      const down = ((destY + height - 1 + p) * size + slotX + dx) * 4;
      atlas[up] = atlas[top];
      atlas[up + 1] = atlas[top + 1];
      atlas[up + 2] = atlas[top + 2];
      atlas[up + 3] = atlas[top + 3];
      atlas[down] = atlas[bot];
      atlas[down + 1] = atlas[bot + 1];
      atlas[down + 2] = atlas[bot + 2];
      atlas[down + 3] = atlas[bot + 3];
    }
  }
}

function geometryForTriangles(geo, index, triangleIds) {
  const kept = new Uint32Array(triangleIds.length * 3);
  let n = 0;
  for (const id of triangleIds) {
    const base = id * 3;
    kept[n++] = index[base];
    kept[n++] = index[base + 1];
    kept[n++] = index[base + 2];
  }
  const part = geo.clone();
  part.setIndex(new THREE.BufferAttribute(kept, 1));
  part.clearGroups();
  return part;
}

function remapChartUv(geo, index, triangleIds, sw, sh, pixels, slot) {
  const uv = geo.getAttribute('uv');
  const seen = new Set();
  const atlas = LANDSD_ON_EYE_ATLAS;
  for (const id of triangleIds) {
    const base = id * 3;
    for (let k = 0; k < 3; k++) {
      const vertex = index[base + k];
      if (seen.has(vertex)) continue;
      seen.add(vertex);
      if (vertex < 0 || vertex >= uv.count) continue;
      const u = uv.getX(vertex);
      const v = uv.getY(vertex);
      let nu = (slot.contentX + (u * sw - pixels.x0)) / atlas;
      let nv = (slot.contentY + (v * sh - pixels.y0)) / atlas;
      if (nu < 0) nu = 0;
      else if (nu > 1) nu = 1;
      if (nv < 0) nv = 0;
      else if (nv > 1) nv = 1;
      uv.setXY(vertex, nu, nv);
    }
  }
  uv.needsUpdate = true;
}

function atlasTexture(sourceTex, canvas, sampler) {
  const tex = new THREE.Texture(canvas);
  tex.colorSpace = sourceTex.colorSpace || THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.userData = { hkOnEyeAtlas: true };
  uploadChaseMips(tex, sampler, 'clamp');
  return tex;
}

// Full-bleed on-eye atlases (tower _002/_003, flank _001) address one face
// per triangle. The primitive bounds cover the file, so the sub-rectangle
// crop never runs, and the anisotropic kernel steps across the one-pixel
// gutter into the next chart. Each face is copied with a replicated edge
// and sampled from its own clamp border. Other materials keep packLandsdChart.
export function splitLandsdOnEyeCharts(geo, material, sampler) {
  if (!sampler?.chartMips || !geo || Array.isArray(material)) return null;
  if (!isLandsdOnEyeChart(material?.name)) return null;
  const sourceTex = material.map;
  if (!sourceTex?.isTexture || !sourceTex.image) return null;
  const uv = geo.getAttribute('uv');
  if (!uv?.count) return null;
  const index = activeIndex(geo);
  if (index.length < 3) return null;
  const bounds = uvBounds(geo);
  if (!bounds) return null;
  const triangles = [];
  for (let t = 0; t + 2 < index.length; t += 3) triangles.push(triangleUv(uv, index, t / 3));
  const grouped = groupLandsdOnEyeCharts(bounds.minU, bounds.minV, bounds.maxU, bounds.maxV, triangles);
  if (!grouped) return null;
  const pixels = readImagePixels(sourceTex.image);
  if (!pixels) return null;
  const sw = pixels.width;
  const sh = pixels.height;
  const charts = grouped.groups.map((group) => {
    const px = landsdChartPixels(group.rect, sw, sh);
    return { group, px };
  });
  const slots = packLandsdChartBins(charts.map((chart) => ({
    width: chart.px.width,
    height: chart.px.height
  })), LANDSD_ON_EYE_ATLAS, LANDSD_ON_EYE_PAD);
  const byAtlas = new Map();
  const restIds = grouped.rest.slice();
  charts.forEach((chart, i) => {
    const slot = slots[i];
    if (!slot || !chart.px) {
      restIds.push(...chart.group.triangles);
      return;
    }
    let bin = byAtlas.get(slot.atlas);
    if (!bin) {
      bin = {
        data: new Uint8ClampedArray(LANDSD_ON_EYE_ATLAS * LANDSD_ON_EYE_ATLAS * 4),
        triangles: []
      };
      byAtlas.set(slot.atlas, bin);
    }
    copyChartPixels(pixels.data, sw, bin.data, LANDSD_ON_EYE_ATLAS, chart.px, slot);
    bin.triangles.push({ ids: chart.group.triangles, px: chart.px, slot });
  });
  if (!byAtlas.size) return null;
  const pieces = [];
  for (const bin of byAtlas.values()) {
    const ids = [];
    for (const part of bin.triangles) ids.push(...part.ids);
    const partGeo = geometryForTriangles(geo, index, ids);
    for (const part of bin.triangles) remapChartUv(partGeo, index, part.ids, sw, sh, part.px, part.slot);
    const canvas = canvasFromPixels(bin.data, LANDSD_ON_EYE_ATLAS, LANDSD_ON_EYE_ATLAS);
    if (!canvas) return null;
    const mat = material.clone();
    const tex = atlasTexture(sourceTex, canvas, sampler);
    mat.map = tex;
    if (mat.emissiveMap === sourceTex) mat.emissiveMap = tex;
    pieces.push({ geo: partGeo, material: mat, atlas: true });
  }
  if (restIds.length) {
    pieces.push({
      geo: geometryForTriangles(geo, index, restIds),
      material,
      atlas: false
    });
  }
  return pieces;
}

// Crop a sub-rectangle chart, remap its UVs into that crop, and mip the
// photograph. Repeating primitives are not cropped. Called before sharpenPhoto
// so null-fill omission still sees the file's own UVs.
export function packLandsdChart(geo, material, sampler) {
  if (!sampler?.chartMips || !geo) return null;
  const bounds = uvBounds(geo);
  if (!bounds) return null;
  const wrap = landsdChartWrap(bounds.minU, bounds.minV, bounds.maxU, bounds.maxV);
  const rect = wrap === 'clamp'
    ? landsdChartRect(bounds.minU, bounds.minV, bounds.maxU, bounds.maxV)
    : null;
  const list = Array.isArray(material) ? material : [material];
  let sawMap = false;
  let cropped = true;
  for (const mat of list) {
    if (!mat) continue;
    for (const key of PHOTO_MAPS) {
      const tex = mat[key];
      if (!tex?.isTexture || !tex.image) continue;
      sawMap = true;
      if (rect && !cropTextureToChart(tex, rect)) cropped = false;
      if (key === 'map' || key === 'emissiveMap') tex.colorSpace = THREE.SRGBColorSpace;
      uploadChaseMips(tex, sampler, wrap);
    }
  }
  if (rect && sawMap && cropped) remapGeoUv(geo, rect);
  return rect && cropped ? rect : null;
}

function buildingIdOf(entry) {
  if (entry?.name && /[A-Z]\d{6,}/i.test(entry.name)) return entry.name;
  const match = String(entry?.file || '').match(/([A-Z]\d{6,}[A-Z0-9]*)\.gltf/i);
  return match ? match[1] : (entry?.name || '');
}

function albedoMap(material) {
  const list = Array.isArray(material) ? material : [material];
  for (const mat of list) {
    if (mat?.map?.image) return mat.map;
  }
  return null;
}

function nullFillSheet(tex) {
  if (tex.userData?.hkNullFill) return tex.userData.hkNullFill;
  if (tex.userData?.hkNullFillFailed) return null;
  const img = tex.image;
  const w0 = img?.width || 0;
  const h0 = img?.height || 0;
  if (!w0 || !h0 || typeof document === 'undefined') {
    if (tex.userData) tex.userData.hkNullFillFailed = true;
    return null;
  }
  const { w, h } = nullFillSampleSize(w0, h0);
  if (!w || !h) {
    tex.userData.hkNullFillFailed = true;
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    tex.userData.hkNullFillFailed = true;
    return null;
  }
  ctx.drawImage(img, 0, 0, w, h);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    tex.userData.hkNullFillFailed = true;
    return null;
  }
  const sheet = { w, h, data };
  tex.userData.hkNullFill = sheet;
  return sheet;
}

function sampleAlbedoTexel(tex, u, v) {
  const sheet = nullFillSheet(tex);
  if (!sheet) return null;
  let uu = u % 1;
  if (uu < 0) uu += 1;
  const x = Math.min(sheet.w - 1, (uu * sheet.w) | 0);
  const y = landsdAlbedoRow(v, sheet.h);
  const i = (y * sheet.w + x) * 4;
  return [sheet.data[i], sheet.data[i + 1], sheet.data[i + 2]];
}

function triangleIndex(geo) {
  const index = geo.getIndex();
  if (index) return index.array;
  const n = geo.getAttribute('position').count;
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

// Triangles on LandsD null fill are omitted: every corner, or the face centre.
// The sheet is 1024 on the long side so a chart edge is not averaged into the
// grey fill. The building and its photographic charts stay. A triangle that
// cannot be sampled stays too. Pale atlas faces are still holes.
function omitLandsdNullFill(geo, material) {
  const map = albedoMap(material);
  const uv = geo.getAttribute('uv');
  if (!map || !uv) return 0;
  const src = triangleIndex(geo);
  const { index, dropped } = landsdNullFillTriangles(src, (vertex) => {
    if (vertex < 0 || vertex >= uv.count) return null;
    return sampleAlbedoTexel(map, uv.getX(vertex), uv.getY(vertex));
  }, (a, b, c) => {
    if (a < 0 || b < 0 || c < 0 || a >= uv.count || b >= uv.count || c >= uv.count) return null;
    const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
    const v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
    return sampleAlbedoTexel(map, u, v);
  });
  if (!dropped) return 0;
  if (!index.length) {
    geo.setDrawRange(0, 0);
    return dropped;
  }
  geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(index), 1));
  geo.clearGroups();
  return dropped;
}

// The glTF material keeps its baseColor texture, UV set, and alpha. This only
// corrects the sampler and the constant FME metal factor.
export function sharpenPhoto(material, sampler) {
  const list = Array.isArray(material) ? material : [material];
  for (const mat of list) {
    if (!mat) continue;
    for (const key of PHOTO_MAPS) {
      const tex = mat[key];
      if (!tex?.isTexture) continue;
      if (key === 'map' || key === 'emissiveMap') tex.colorSpace = THREE.SRGBColorSpace;
      if (tex.userData?.hkChartMips) {
        tex.anisotropy = clampLandsdAnisotropy(sampler.anisotropy, anisotropyLimit);
        tex.needsUpdate = true;
        continue;
      }
      if (sampler.chartMips) {
        tex.flipY = false;
        tex.wrapS = sampler.wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        tex.wrapT = tex.wrapS;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.anisotropy = clampLandsdAnisotropy(sampler.anisotropy, anisotropyLimit);
        tex.userData.hkChartMips = true;
        tex.userData.hkFullRes = true;
        tex.needsUpdate = true;
        continue;
      }
      if (sampler.mipmaps) {
        if (!tex.userData.hkFullRes) limitPhoto(tex, sampler.maxEdge);
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.anisotropy = clampLandsdAnisotropy(sampler.anisotropy, anisotropyLimit);
      } else {
        // One level. LinearMipmapLinearFilter on that level is the brown patch:
        // the GPU's anisotropic lookup steps off the 4096 chart into a mip that
        // was never uploaded, and the street-height wall is where that happens.
        tex.userData.hkFullRes = true;
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.anisotropy = clampLandsdAnisotropy(sampler.anisotropy, anisotropyLimit);
      }
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
    }
    // FME 2024 writes a constant metallicFactor (0.5 on the Des Voeux sheets) and
    // no metalness map. That is not a measured metal: it replaces half the
    // photograph with a rough-metal response, which is brown dirt in street shadow.
    if (!mat.metalnessMap) mat.metalness = 0;
  }
}

// Boxes inside this distance can already satisfy the 260 m look-ray test.
// Farther chase meshes are baked so a real triangle past that cap can drop
// glass without a hollow shell's box doing it.
const LOOK_SOLID_PAST = 200;

async function fetchLookSolid(entry) {
  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(String(res.status));
  const doc = await res.json();
  const base = new URL(entry.url, window.location.href);
  const buffers = [];
  for (const buffer of doc.buffers || []) {
    if (!buffer.uri || buffer.uri.startsWith('data:')) throw new Error('embedded buffer');
    const bufRes = await fetch(new URL(buffer.uri, base));
    if (!bufRes.ok) throw new Error(String(bufRes.status));
    buffers.push(new Uint8Array(await bufRes.arrayBuffer()));
  }
  return bakeGltfWorldTriangles(doc, buffers);
}

export async function loadLookSolids(entries, eye = HK_STREET_EYE) {
  const solids = [];
  for (const entry of entries || []) {
    if (!entry?.url || !gltfInStreetChase(entry, eye)) continue;
    if (boxClosestDistance(entry, eye) <= LOOK_SOLID_PAST) continue;
    try {
      const solid = await fetchLookSolid(entry);
      if (solid) solids.push(solid);
    } catch (err) {
      console.warn(`[gltf] look solid ${entry.file || entry.url}: ${err.message || err}`);
    }
  }
  return solids;
}

async function readSheetManifest(sheet) {
  const manifestUrl = `./hk-3d/${sheet}/manifest.json`;
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(String(res.status));
  const manifest = await res.json();
  const id = manifest.sheet || sheet;
  const buildings = (Array.isArray(manifest.buildings) ? manifest.buildings : []).map((entry) => ({
    ...entry,
    sheet: entry.sheet || id
  }));
  return { ...manifest, sheet: id, buildings };
}

export async function prepareHkGltfSheet(href) {
  const request = resolveHkGltfRequest(href, {
    configured: HK_GLTF_SHEET,
    sheets: HK_GLTF_SHEETS,
    cap: HK_GLTF_CAP
  });
  if (!request) {
    console.info('[gltf] no LandsD sheet configured; extrudes cover Central');
    return null;
  }
  const buildings = [];
  const loadedSheets = [];
  const reasons = [];
  for (const sheet of request.sheets) {
    try {
      const manifest = await readSheetManifest(sheet);
      let sheetBuildings = manifest.buildings;
      if (isGltfPinSheet(manifest.sheet)) {
        const pinned = filterPinSheetBuildings(sheetBuildings);
        console.info(`[gltf] pin sheet ${manifest.sheet} kept ${pinned.length} of ${sheetBuildings.length}`);
        sheetBuildings = pinned;
      }
      buildings.push(...sheetBuildings);
      loadedSheets.push(manifest.sheet);
      if (manifest.reason) reasons.push(manifest.reason);
      const count = manifest.counts || {};
      console.info(
        `[gltf] manifest ${manifest.sheet} buildings ${manifest.buildings.length}` +
        (count.buildingFiles != null ? ` sheet files ${count.buildingFiles} core ${count.overlap ?? '?'}` : '')
      );
    } catch (err) {
      console.warn(`[gltf] sheet ${sheet} manifest not loaded (${err.message})`);
    }
  }
  if (!loadedSheets.length) {
    console.warn('[gltf] no individualised manifest; extrudes stay');
    return null;
  }
  const plan = planGltfManifest({
    sheet: loadedSheets.join('+'),
    reason: reasons.join(' | '),
    buildings
  }, { cap: request.cap });
  const probe = parseDigit1ProbeRequest(href).enabled;
  if (probe) {
    plan.selected = filterDigit1ProbeBuildings(plan.selected, true);
    plan.reason = `${plan.reason ? `${plan.reason} ` : ''}Digit1 probe mounts ${plan.selected.length} ray buildings so the frame can present.`;
    console.info(`[gltf] digit1 probe buildings ${plan.selected.map((entry) => entry.name || entry.file).join(' ')}`);
  }
  const hidden = hiddenExtrudeIds(BLOCKS, plan.selected);
  const selected = plan.selected.map((entry) => ({
    ...entry,
    url: `./hk-3d/${entry.sheet}/${entry.file}`
  }));
  const lookSolids = probe ? [] : await loadLookSolids(selected);
  if (lookSolids.length) {
    const triangles = lookSolids.reduce((sum, solid) => sum + solid.triangles.length / 9, 0);
    console.info(`[gltf] look solids ${lookSolids.length} triangles ${triangles}`);
  }
  return {
    ...plan,
    sheet: loadedSheets.join('+'),
    sheets: loadedSheets,
    hiddenIds: new Set(hidden),
    selected,
    lookSolids
  };
}

export async function mountHkGltfBuildings(scene, plan) {
  if (!plan) return { colliders: [], loaded: 0, failed: 0, group: null };
  const group = new THREE.Group();
  group.name = 'HkIndividualModels';
  const loader = new GLTFLoader();
  const colliders = [];
  let loaded = 0;
  let failed = 0;
  for (const entry of plan.selected) {
    try {
      const gltf = await loader.loadAsync(entry.url);
      gltf.scene.updateMatrixWorld(true);
      let meshes = 0;
      let nullDropped = 0;
      gltf.scene.traverse((obj) => {
        if (!obj.isMesh) return;
        const geo = bakeMesh(obj);
        if (!geo) return;
        const dropped = omitLandsdNullFill(geo, obj.material);
        nullDropped += dropped;
        if (geo.drawRange.count === 0) {
          geo.dispose();
          return;
        }
        const sampler = gltfAlbedoSampler(entry);
        const placeMesh = (partGeo, material) => {
          const mesh = new THREE.Mesh(partGeo, material);
          mesh.name = 'HkGltfBuilding';
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.hkBuildingId = buildingIdOf(entry);
          mesh.userData.hkFile = entry.file || '';
          mesh.userData.hkSheet = entry.sheet || '';
          mesh.userData.hkSource = 'landsd';
          mesh.userData.hkNullDropped = dropped;
          group.add(mesh);
          meshes++;
        };
        const pieces = splitLandsdOnEyeCharts(geo, obj.material, sampler);
        if (!pieces) {
          packLandsdChart(geo, obj.material, sampler);
          sharpenPhoto(obj.material, sampler);
          placeMesh(geo, obj.material);
        } else {
          // Atlas UVs already sit inside the replicated pad. A second crop
          // would cut that pad off. Rest triangles still use the file.
          geo.dispose();
          const bins = pieces.filter((piece) => piece.atlas).length;
          console.info(`[gltf] on-eye atlas ${obj.material?.name || ''} bins ${bins}`);
          for (const piece of pieces) {
            if (!piece.atlas) packLandsdChart(piece.geo, piece.material, sampler);
            sharpenPhoto(piece.material, sampler);
            placeMesh(piece.geo, piece.material);
          }
        }
      });
      if (nullDropped) console.info(`[gltf] ${entry.file || entry.url} null-fill triangles omitted ${nullDropped}`);
      if (!meshes) throw new Error('no meshes');
      colliders.push({
        minX: entry.minX,
        maxX: entry.maxX,
        minZ: entry.minZ,
        maxZ: entry.maxZ,
        maxY: ISLAND_BOUNDS.sidewalkHeight + Math.max(0, entry.maxH - entry.minH)
      });
      loaded++;
    } catch (err) {
      failed++;
      console.warn(`[gltf] skip ${entry.file || entry.url}: ${err.message}`);
    }
  }
  if (group.children.length) scene.add(group);
  const skipped = plan.skippedSpeck + plan.skippedOutside + plan.skippedCap + failed;
  console.info(formatGltfLog({
    sheet: plan.sheet,
    loaded,
    skipped,
    skippedSpeck: plan.skippedSpeck,
    skippedOutside: plan.skippedOutside,
    skippedCap: plan.skippedCap,
    hidden: plan.hiddenIds ? plan.hiddenIds.size : 0,
    sidewalk: ISLAND_BOUNDS.sidewalkHeight
  }));
  if (plan.reason) console.info(`[gltf] ${plan.reason}`);
  return { colliders, loaded, failed, group };
}
