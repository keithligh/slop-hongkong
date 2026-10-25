import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BLOCKS, HK_GLTF_CAP, HK_GLTF_SHEET, HK_GLTF_SHEETS, HK_STREET_EYE, ISLAND_BOUNDS } from './city-config.js';
import {
  bakeGltfWorldTriangles,
  boxClosestDistance,
  formatGltfLog,
  clampLandsdAnisotropy,
  gltfAlbedoSampler,
  gltfInStreetChase,
  hiddenExtrudeIds,
  hk80ToWorld,
  landsdAlbedoRow,
  landsdNullFillTriangles,
  nullFillSampleSize,
  planGltfManifest,
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

// Level 0 is the JPEG. Level 1 is half resolution, so the GPU may filter
// anisotropically and still cannot select the deep mips where atlas fill
// smears a street-height chart. The Digit1 chase past 80 m uses this same
// upload. No second level is uploaded when the device cannot do anisotropy.
function uploadNearFacadeMips(tex, anisotropy) {
  const aniso = clampLandsdAnisotropy(anisotropy, anisotropyLimit);
  tex.userData.hkFullRes = true;
  const img = tex.image;
  const w = img?.width || 0;
  const h = img?.height || 0;
  if (tex.userData.hkNearChain) {
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = aniso;
    return;
  }
  // A second mip without anisotropic taps is only a blur. Keep the one-tap sample.
  if (aniso < 2 || !(w >= 2 && h >= 2) || typeof document === 'undefined') {
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.anisotropy = 1;
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(w / 2));
  canvas.height = Math.max(1, Math.floor(h / 2));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.anisotropy = 1;
    return;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  tex.mipmaps = [img, canvas];
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = aniso;
  tex.userData.hkNearChain = true;
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
      if (sampler.mipLevels === 2) {
        uploadNearFacadeMips(tex, sampler.anisotropy);
      } else if (sampler.mipmaps) {
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
      buildings.push(...manifest.buildings);
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
        sharpenPhoto(obj.material, gltfAlbedoSampler(entry));
        const mesh = new THREE.Mesh(geo, obj.material);
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
