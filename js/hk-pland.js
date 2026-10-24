import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BLOCKS } from './city-config.js';
import {
  formatPlandLog,
  planPlandManifest,
  plandLocalToWorld,
  resolvePlandRequest,
  withPlandCorridorHidden
} from './hk-pland-frame.js';

// Loads the clipped PlanD corridor from hk-3d/pland/ when ?pland=donor or ?pland=compare.
// The default page does not fetch it. Donor keeps the LandsD photographs and draws this
// mesh behind them so an atlas hole can show the 2017 aerial surface. Compare leaves
// the LandsD meshes off. Neither mode invents a shopfront.

const MANIFEST_URL = './hk-3d/pland/manifest.json';

function donorOffset(mode) {
  switch (mode) {
    case 'donor':
      return true;
    case 'compare':
      return false;
    default: {
      const never = mode;
      throw new Error(`bad pland mode ${never}`);
    }
  }
}

function showPhoto(material, mode) {
  const donor = donorOffset(mode);
  const source = Array.isArray(material) ? material : [material];
  const list = source.filter(Boolean).map((mat) => mat.clone());
  for (const mat of list) {
    const map = mat.map;
    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      map.needsUpdate = true;
    }
    // The JPEG is already a sunlit aerial photograph. Leaving it as a lit base
    // colour multiplies that sun by the scene sun. The chart is shown as captured.
    if (mat.color) mat.color.set(0x000000);
    if (map && mat.emissive) {
      mat.emissive.set(0xffffff);
      mat.emissiveMap = map;
    }
    if ('metalness' in mat) mat.metalness = 0;
    if ('roughness' in mat) mat.roughness = 1;
    mat.side = THREE.DoubleSide;
    mat.polygonOffset = donor;
    mat.polygonOffsetFactor = donor ? 1 : 0;
    mat.polygonOffsetUnits = donor ? 1 : 0;
    mat.depthWrite = true;
  }
  if (!list.length) return material;
  return list.length === 1 ? list[0] : list;
}

function bakeGeometry(geometry, transform, streetHkpd, sidewalk) {
  const src = geometry.getAttribute('position');
  if (!src) return null;
  const baked = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) {
    const world = plandLocalToWorld(
      src.getX(i),
      src.getY(i),
      src.getZ(i),
      transform,
      streetHkpd,
      sidewalk
    );
    baked[i * 3] = world.x;
    baked[i * 3 + 1] = world.y;
    baked[i * 3 + 2] = world.z;
  }
  const geo = geometry.clone();
  geo.setAttribute('position', new THREE.BufferAttribute(baked, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function hidePlandCorridorExtrudes(gltfPlan) {
  return withPlandCorridorHidden(gltfPlan, BLOCKS);
}

export async function preparePlandCorridor(href) {
  const request = resolvePlandRequest(href);
  if (!request) return null;
  let manifest;
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) throw new Error(String(res.status));
    manifest = await res.json();
  } catch (err) {
    console.warn(`[pland] manifest not loaded (${err.message}); LandsD stays as it is`);
    return null;
  }
  const plan = planPlandManifest(manifest, request);
  if (!plan) {
    console.warn('[pland] manifest has no clipped OBJ tile; LandsD stays as it is');
    return null;
  }
  console.info(
    `[pland] manifest ${plan.tiles.map((tile) => tile.grid).join('+')} ` +
    `${plan.locTc || plan.tiles.map((tile) => tile.locTc).filter(Boolean).join('、')} ` +
    `street HKPD ${plan.streetHkpd}`
  );
  return plan;
}

export async function mountPlandCorridor(scene, plan) {
  if (!plan) return { loaded: 0, failed: 0, triangles: 0, group: null };
  const group = new THREE.Group();
  group.name = 'HkPlandCorridor';
  const loader = new GLTFLoader();
  let loaded = 0;
  let failed = 0;
  let triangles = 0;
  const donor = donorOffset(plan.mode);
  for (const tile of plan.tiles) {
    try {
      const gltf = await loader.loadAsync(`./hk-3d/pland/${tile.gltf}`);
      let meshes = 0;
      gltf.scene.traverse((obj) => {
        if (!obj.isMesh) return;
        const geo = bakeGeometry(obj.geometry, tile.modelTransform, plan.streetHkpd, plan.sidewalk);
        if (!geo) return;
        const mesh = new THREE.Mesh(geo, showPhoto(obj.material, plan.mode));
        mesh.name = 'HkPlandMesh';
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = donor ? -1 : 0;
        group.add(mesh);
        const index = geo.getIndex();
        triangles += index ? index.count / 3 : geo.getAttribute('position').count / 3;
        meshes++;
      });
      if (!meshes) throw new Error('no meshes');
      loaded++;
    } catch (err) {
      failed++;
      console.warn(`[pland] skip ${tile.grid}: ${err.message}`);
    }
  }
  if (group.children.length) scene.add(group);
  console.info(formatPlandLog({ ...plan, triangles }));
  return { loaded, failed, triangles, group };
}
