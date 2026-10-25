import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BLOCKS } from './city-config.js';
import {
  PLAND_PAGE_TEX_EDGE,
  desVoeuxCarriageSegments,
  formatPlandLog,
  planPlandManifest,
  plandLocalToWorld,
  digit1BocTowerPlate,
  plandOmitsCarriageShell,
  plandOmitsDigit1BocPlate,
  plandOmitsDigit1FlankChart,
  plandOmitsDigit1LookGround,
  plandOmitsPodiumInsideLandsd,
  plandYieldsToLandsd,
  resolvePlandRequest,
  withPlandCorridorHidden
} from './hk-pland-frame.js';

// Loads the clipped PlanD corridor from hk-3d/pland/. The Digit1 clip is on unless
// ?pland=off. Donor keeps the LandsD photographs and draws this mesh behind them.
// Compare leaves the LandsD meshes off. Neither mode invents a shopfront.

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

function capPlandMap(map, maxEdge = PLAND_PAGE_TEX_EDGE) {
  const image = map?.image;
  const width = image?.width || 0;
  const height = image?.height || 0;
  if (!(width > maxEdge || height > maxEdge) || typeof document === 'undefined') return;
  const scale = maxEdge / Math.max(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  map.image = canvas;
  map.needsUpdate = true;
}

function showPhoto(material, mode) {
  const donor = donorOffset(mode);
  const source = Array.isArray(material) ? material : [material];
  const list = source.filter(Boolean).map((mat) => mat.clone());
  for (const mat of list) {
    const map = mat.map;
    if (map) {
      capPlandMap(map);
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
  return geo;
}

function finishBaked(geo) {
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// LandsD skirt is donor only: a triangle whose centre sits on the street side
// of a loaded box is the 2017 shell in front of that photograph. Compare keeps
// that skirt off, and the near-podium omit with it, because no LandsD boxes
// are passed. The carriageway shell is both modes. It is the low aerial
// triangles on Des Voeux that the 1.2 m carpet test kept. The podium omit is
// the centre inside a near box, below the retail band, after those two tests.
// A higher centre stays. A far box is not punched through its crown. The Digit1
// look yield is both modes too: it drops street-height centroids on the chase
// ray, which is where the mid-road melt sits after the apron has already ended.
// The flank yield is donor only. It drops a look-axis shell proud of a chase
// chart, and the canyon of a chart past 80 m, short of The Henderson.
// The BoC Tower yield is donor only too. It drops the chartless LandsD plate
// the shaft prism already owns. Compare passes no boxes, so that plate stays.
function trimPlandInFrontOfLandsd(geo, boxes, segments) {
  const roads = segments || [];
  const bocPlate = boxes?.length ? digit1BocTowerPlate() : null;
  if (!geo) return { geo: null, landsd: 0, shell: 0, podium: 0, look: 0, flank: 0, boc: 0 };
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const index = geo.getIndex();
  if (!pos) return { geo: null, landsd: 0, shell: 0, podium: 0, look: 0, flank: 0, boc: 0 };
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
  const keptPos = new Float32Array(triCount * 9);
  const keptUv = uv ? new Float32Array(triCount * 6) : null;
  let written = 0;
  let landsd = 0;
  let shell = 0;
  let podium = 0;
  let look = 0;
  let flank = 0;
  let boc = 0;
  const corner = (slot) => {
    const vi = index ? index.getX(slot) : slot;
    return [pos.getX(vi), pos.getY(vi), pos.getZ(vi), uv ? uv.getX(vi) : 0, uv ? uv.getY(vi) : 0];
  };
  for (let t = 0; t < triCount; t++) {
    const a = corner(t * 3);
    const b = corner(t * 3 + 1);
    const c = corner(t * 3 + 2);
    const mid = {
      x: (a[0] + b[0] + c[0]) / 3,
      y: (a[1] + b[1] + c[1]) / 3,
      z: (a[2] + b[2] + c[2]) / 3
    };
    if (boxes?.length && plandYieldsToLandsd(mid, boxes)) {
      landsd++;
      continue;
    }
    if (plandOmitsCarriageShell(
      { x: a[0], y: a[1], z: a[2] },
      { x: b[0], y: b[1], z: b[2] },
      { x: c[0], y: c[1], z: c[2] },
      roads
    )) {
      shell++;
      continue;
    }
    if (boxes?.length && plandOmitsPodiumInsideLandsd(mid, boxes)) {
      podium++;
      continue;
    }
    if (plandOmitsDigit1LookGround(mid)) {
      look++;
      continue;
    }
    if (boxes?.length && plandOmitsDigit1FlankChart(mid, boxes)) {
      flank++;
      continue;
    }
    if (bocPlate && plandOmitsDigit1BocPlate(mid, bocPlate)) {
      boc++;
      continue;
    }
    const p = written * 9;
    keptPos[p] = a[0];
    keptPos[p + 1] = a[1];
    keptPos[p + 2] = a[2];
    keptPos[p + 3] = b[0];
    keptPos[p + 4] = b[1];
    keptPos[p + 5] = b[2];
    keptPos[p + 6] = c[0];
    keptPos[p + 7] = c[1];
    keptPos[p + 8] = c[2];
    if (keptUv) {
      const u = written * 6;
      keptUv[u] = a[3];
      keptUv[u + 1] = a[4];
      keptUv[u + 2] = b[3];
      keptUv[u + 3] = b[4];
      keptUv[u + 4] = c[3];
      keptUv[u + 5] = c[4];
    }
    written++;
  }
  geo.dispose();
  if (!written) return { geo: null, landsd, shell, podium, look, flank, boc };
  const next = new THREE.BufferGeometry();
  next.setAttribute('position', new THREE.BufferAttribute(keptPos.slice(0, written * 9), 3));
  if (keptUv) next.setAttribute('uv', new THREE.BufferAttribute(keptUv.slice(0, written * 6), 2));
  return { geo: finishBaked(next), landsd, shell, podium, look, flank, boc, kept: written };
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

export async function mountPlandCorridor(scene, plan, landsdBoxes = []) {
  if (!plan) return { loaded: 0, failed: 0, triangles: 0, group: null };
  const group = new THREE.Group();
  group.name = 'HkPlandCorridor';
  const loader = new GLTFLoader();
  let loaded = 0;
  let failed = 0;
  let triangles = 0;
  let yielded = 0;
  let shell = 0;
  let podium = 0;
  let look = 0;
  let flank = 0;
  let boc = 0;
  const donor = donorOffset(plan.mode);
  const boxes = donor ? landsdBoxes : [];
  const segments = desVoeuxCarriageSegments();
  for (const tile of plan.tiles) {
    try {
      const gltf = await loader.loadAsync(`./hk-3d/pland/${tile.gltf}`);
      let meshes = 0;
      gltf.scene.traverse((obj) => {
        if (!obj.isMesh) return;
        const baked = bakeGeometry(obj.geometry, tile.modelTransform, plan.streetHkpd, plan.sidewalk);
        if (!baked) return;
        const trimmed = trimPlandInFrontOfLandsd(baked, boxes, segments);
        yielded += trimmed.landsd;
        shell += trimmed.shell;
        podium += trimmed.podium;
        look += trimmed.look;
        flank += trimmed.flank;
        boc += trimmed.boc || 0;
        const geo = trimmed.geo;
        if (!geo) return;
        const mesh = new THREE.Mesh(geo, showPhoto(obj.material, plan.mode));
        mesh.name = 'HkPlandMesh';
        mesh.userData.hkSource = 'pland';
        mesh.userData.hkBuildingId = tile.grid || '';
        mesh.userData.hkFile = tile.gltf || '';
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
  if (yielded) console.info(`[pland] omitted ${yielded} triangles on the street side of a LandsD box`);
  if (shell) console.info(`[pland] omitted ${shell} low triangles on the Des Voeux carriageway`);
  if (podium) console.info(`[pland] omitted ${podium} podium triangles inside near LandsD boxes`);
  if (look) console.info(`[pland] omitted ${look} triangles on the Digit1 mid-road look`);
  if (flank) console.info(`[pland] omitted ${flank} triangles proud of Digit1 LandsD flank charts`);
  if (boc) console.info(`[pland] omitted ${boc} triangles on the Digit1 BoC Tower LandsD plate`);
  return { loaded, failed, triangles, yielded, shell, podium, look, flank, boc, group };
}
