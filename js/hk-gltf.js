import * as THREE from 'three/webgpu';
import { color as tslColor, float, texture } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BLOCKS, HK_GLTF_CAP, HK_GLTF_SHEET, HK_GLTF_SHEETS, ISLAND_BOUNDS } from './city-config.js';
import {
  formatGltfLog,
  gltfTextureMaxEdge,
  hiddenExtrudeIds,
  hk80ToWorld,
  planGltfManifest,
  resolveHkGltfRequest
} from './hk-gltf-frame.js';

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

// Street-near atlases stay at the file resolution. Anisotropy plus a negative LOD bias
// keeps the 4096 facade JPEG on a sharp mip when the camera is at eye height.
function sharpenPhoto(material, maxEdge) {
  const list = Array.isArray(material) ? material : [material];
  const bias = maxEdge === 0 ? -1.25 : -0.6;
  for (const mat of list) {
    if (!mat) continue;
    for (const key of PHOTO_MAPS) {
      const tex = mat[key];
      if (!tex?.isTexture) continue;
      if (key === 'map' || key === 'emissiveMap') tex.colorSpace = THREE.SRGBColorSpace;
      if (maxEdge === 0) tex.userData.hkFullRes = true;
      else if (!tex.userData.hkFullRes) limitPhoto(tex, maxEdge);
      tex.anisotropy = 16;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
    }
    if (!mat.map || mat.userData.hkPhotoBias) continue;
    const tint = tslColor(mat.color || 0xffffff);
    mat.colorNode = texture(mat.map).bias(float(bias)).mul(tint);
    mat.userData.hkPhotoBias = true;
  }
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
  const hidden = hiddenExtrudeIds(BLOCKS, plan.selected);
  return {
    ...plan,
    sheet: loadedSheets.join('+'),
    sheets: loadedSheets,
    hiddenIds: new Set(hidden),
    selected: plan.selected.map((entry) => ({
      ...entry,
      url: `./hk-3d/${entry.sheet}/${entry.file}`
    }))
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
      gltf.scene.traverse((obj) => {
        if (!obj.isMesh) return;
        const geo = bakeMesh(obj);
        if (!geo) return;
        sharpenPhoto(obj.material, gltfTextureMaxEdge(entry));
        const mesh = new THREE.Mesh(geo, obj.material);
        mesh.name = 'HkGltfBuilding';
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        meshes++;
      });
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
