import * as THREE from 'three/webgpu';
import {
  HK_RETAIL_BELT,
  ISLAND_BOUNDS,
  hkMassingPlan,
  hkPlanCorners,
  hkResolveLandmarks,
  hkScaleRing
} from './city-config.js';
import { gltfCoversFootprint } from './hk-gltf-frame.js';
import { createCurtainWallMaterial, createRetailPodiumMaterial } from './tsl-materials.js';

// Named Hong Kong places on LandsD footprints and the Central Star Ferry pier.
// Victoria Peak and the Tsim Sha Tsui clock stay empty until a later step.

function hkMat(color, extra = {}) {
  return new THREE.MeshStandardNodeMaterial({ color, roughness: 0.42, metalness: 0.25, ...extra });
}

function hkLabelMaterial(text, bg, fg) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = fg;
  ctx.font = '700 68px "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicNodeMaterial({ map });
}

function addPrism(group, mat, a, b, c, yA0, yB0, yC0, yA1, yB1, yC1) {
  const positions = new Float32Array([
    a.x, yA0, a.z, b.x, yB0, b.z, c.x, yC0, c.z,
    a.x, yA1, a.z, c.x, yC1, c.z, b.x, yB1, b.z,
    a.x, yA0, a.z, b.x, yB0, b.z, b.x, yB1, b.z,
    a.x, yA0, a.z, b.x, yB1, b.z, a.x, yA1, a.z,
    b.x, yB0, b.z, c.x, yC0, c.z, c.x, yC1, c.z,
    b.x, yB0, b.z, c.x, yC1, c.z, b.x, yB1, b.z,
    c.x, yC0, c.z, a.x, yA0, a.z, a.x, yA1, a.z,
    c.x, yC0, c.z, a.x, yA1, a.z, c.x, yC1, c.z
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addBeam(group, mat, up, dir, ax, ay, az, bx, by, bz, thickness) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.4) return;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, len, thickness), mat);
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  dir.set(dx / len, dy / len, dz / len);
  mesh.quaternion.setFromUnitVectors(up, dir);
  mesh.castShadow = true;
  group.add(mesh);
}

function yawAabb(x, z, hx, hz, yaw, maxY) {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return {
    minX: x - (c * hx + s * hz),
    maxX: x + (c * hx + s * hz),
    minZ: z - (s * hx + c * hz),
    maxZ: z + (s * hx + c * hz),
    maxY
  };
}

function roofSpan(block) {
  const span = Math.min(block.maxX - block.minX, block.maxZ - block.minZ);
  const plan = hkMassingPlan(block);
  const tower = plan && plan.parts[plan.parts.length - 1];
  const scale = tower && tower.scale < 1 ? tower.scale : 1;
  return span * scale * 0.46;
}

function addTwoIfc(group, site, glass, metal, ground) {
  const block = site.block;
  const radius = roofSpan(block);
  const crownH = 10;
  const mastH = 27.3;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.22, radius, crownH, 8), glass);
  crown.position.set(site.x, ground + block.height + crownH / 2, site.z);
  crown.castShadow = true;
  group.add(crown);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.85, mastH, 6), metal);
  mast.position.set(site.x, ground + block.height + crownH + mastH / 2, site.z);
  mast.castShadow = true;
  group.add(mast);
}

function addOneIfc(group, site, glass, ground) {
  const span = roofSpan(site.block);
  const pent = new THREE.Mesh(new THREE.BoxGeometry(span, 5.5, span * 0.9), glass);
  pent.position.set(site.x, ground + site.block.height + 2.75, site.z);
  pent.castShadow = true;
  group.add(pent);
}

function addExchange(group, site, bronze, metal, ground) {
  const span = roofSpan(site.block);
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(span, span * 1.04, 1.8, 8), bronze);
  lip.position.set(site.x, ground + site.block.height + 0.9, site.z);
  lip.castShadow = true;
  group.add(lip);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 11, 6), metal);
  mast.position.set(site.x, ground + site.block.height + 7.3, site.z);
  mast.castShadow = true;
  group.add(mast);
}

function addBankOfChina(group, site, colliders, up, dir, ground) {
  const block = site.block;
  const corners = hkPlanCorners(block.poly, block.cx, block.cz);
  if (corners.length !== 4) throw new Error(`Bank of China footprint did not resolve to 4 corners (${corners.length})`);
  const center = { x: block.cx, z: block.cz };
  let north = 0;
  let northZ = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const mz = (corners[i].z + corners[(i + 1) % corners.length].z) / 2;
    if (mz < northZ) {
      northZ = mz;
      north = i;
    }
  }
  const fractions = [1, 0.76, 0.51, 0.33];
  const peak = 11.7;
  const mastH = 52.4;
  const ySkirt = HK_RETAIL_BELT;
  const skirt = createRetailPodiumMaterial();
  // No individualised BUILDING mesh on this plate (11-SW-9C / 8D / 9D / 10C / 8C).
  // The prism stays on the LandsD corners. Metalness 0.72 with a 0.18 reflection
  // floor is a chrome skin. Dielectric glass keeps the diagrid. The tint is light
  // enough that a ~230 m street eye reads blue glass, not a black plate.
  const face = createCurtainWallMaterial({
    glassTint: 0x7aa3c2,
    frameTint: 0xd5dee6,
    windowWidth: 2.35,
    floorHeight: 3.9,
    litProbability: 0.7,
    warmth: 0.4,
    reflectivity: 0.22,
    reflectionFloor: 0.04,
    glassMetalness: 0,
    glassRoughness: 0.48,
    seed: 4.2,
    boxLocal: false
  });
  face.polygonOffset = true;
  face.polygonOffsetFactor = 1;
  face.polygonOffsetUnits = 1;
  // One full-height X is a pair of ~1 m lines. At the Digit1 eye that is a dark
  // slab. A bay about every 52 m, a few metres thick, is the same diagrid at a
  // size that plate can show. Emissive keeps the member in shade. Metalness stays
  // near zero, so this is not a chrome skin.
  const braceMat = hkMat(0xe8eef2, { metalness: 0.04, roughness: 0.46, emissive: 0xc9d3da, emissiveIntensity: 0.7 });
  braceMat.polygonOffset = true;
  braceMat.polygonOffsetFactor = -2;
  braceMat.polygonOffsetUnits = -2;
  const mastMat = hkMat(0x8d939a, { metalness: 0.16, roughness: 0.6 });
  const tagBoc = () => {
    const mesh = group.children[group.children.length - 1];
    if (mesh) mesh.name = 'BankOfChinaTower';
  };
  const addBocBeam = (ax, ay, az, bx, by, bz, thickness) => {
    const before = group.children.length;
    addBeam(group, braceMat, up, dir, ax, ay, az, bx, by, bz, thickness);
    if (group.children.length > before) group.children[group.children.length - 1].name = 'BankOfChinaTower';
  };
  const edgeTop = (step) => {
    const y = ground + block.height * fractions[step];
    return step === 0 ? y + peak : y;
  };
  for (let step = 0; step < 4; step++) {
    const a = corners[(north + step) % 4];
    const b = corners[(north + step + 1) % 4];
    const yTop = ground + block.height * fractions[step];
    const yOuter = step === 0 ? yTop + peak : yTop;
    const yCenter = yTop;
    addPrism(group, skirt, a, b, center, ground, ground, ground, ySkirt, ySkirt, ySkirt);
    tagBoc();
    addPrism(group, face, a, b, center, ySkirt, ySkirt, ySkirt, yOuter, yOuter, yCenter);
    tagBoc();
    const yBrace0 = ground + 12;
    const yBrace1 = yOuter - 6;
    const rise = yBrace1 - yBrace0;
    if (rise > 20) {
      const bays = Math.max(2, Math.round(rise / 52));
      const thick = 2.8;
      for (let bay = 0; bay < bays; bay++) {
        const yLo = yBrace0 + (rise * bay) / bays;
        const yHi = yBrace0 + (rise * (bay + 1)) / bays;
        addBocBeam(a.x, yLo, a.z, b.x, yHi, b.z, thick);
        addBocBeam(b.x, yLo, b.z, a.x, yHi, a.z, thick);
        addBocBeam(a.x, yHi, a.z, b.x, yHi, b.z, thick * 0.72);
      }
      addBocBeam(a.x, yOuter, a.z, b.x, yOuter, b.z, 2.4);
    }
    if (step === 0) {
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const el = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const ox = ((b.x - a.x) / el) * 2.2;
      const oz = ((b.z - a.z) / el) * 2.2;
      for (const sign of [-1, 1]) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.55, mastH, 6), mastMat);
        mast.position.set(mx + ox * sign, yOuter + mastH / 2, mz + oz * sign);
        mast.name = 'BankOfChinaTower';
        mast.castShadow = true;
        group.add(mast);
      }
    }
  }
  for (let k = 0; k < 4; k++) {
    const corner = corners[(north + k) % 4];
    const yPost = Math.max(edgeTop(k), edgeTop((k + 3) % 4));
    addBocBeam(corner.x, ySkirt, corner.z, corner.x, yPost, corner.z, 2.2);
  }
  colliders.push({
    minX: block.minX,
    maxX: block.maxX,
    minZ: block.minZ,
    maxZ: block.maxZ,
    maxY: ground + block.height + peak
  });
}

function addJardine(group, site, mat, up, ground) {
  const plan = hkMassingPlan(site.block);
  const spots = [];
  const parts = plan ? plan.parts : [{ scale: 1, y0: 0, h: site.block.height }];
  for (const part of parts) {
    const ring = part.scale < 1 ? hkScaleRing(site.block.poly, part.scale) : site.block.poly;
    const y0 = Math.max(ground + part.y0 + 6, HK_RETAIL_BELT + 1.2);
    const y1 = ground + part.y0 + part.h - 4;
    if (!(y1 > y0 + 6) || !ring) continue;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 16) continue;
      let nx = -dz / length;
      let nz = dx / length;
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      if ((mx + nx - site.x) * nx + (mz + nz - site.z) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const count = Math.max(1, Math.floor((length - 6) / 6.6));
      for (let k = 0; k < count; k++) {
        const t = (k + 1) / (count + 1);
        const x = a.x + dx * t + nx * 0.7;
        const z = a.z + dz * t + nz * 0.7;
        for (let y = y0; y <= y1; y += 7.2) spots.push({ x, y, z, nx, nz });
      }
    }
  }
  if (!spots.length) return;
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.35, 1.35, 0.55, 10), mat, spots.length);
  const dummy = new THREE.Object3D();
  const normal = new THREE.Vector3();
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    dummy.position.set(spot.x, spot.y, spot.z);
    dummy.quaternion.setFromUnitVectors(up, normal.set(spot.nx, 0, spot.nz));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = 'jardine-portholes';
  group.add(mesh);
}

function addCourtDome(group, site, stone, metal, ground) {
  const y = ground + site.height;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(8, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), stone);
  dome.position.set(site.x, y, site.z);
  dome.castShadow = true;
  group.add(dome);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.1, 2.8, 8), stone);
  lantern.position.set(site.x, y + 8.6, site.z);
  group.add(lantern);
  const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, 3.6, 6), metal);
  finial.position.set(site.x, y + 11.6, site.z);
  group.add(finial);
}

function addStarFerry(group, site, colliders, white, roofMat, clockMat, ground) {
  const pier = site.pier;
  const yaw = Math.atan2(Math.cos(pier.ang), Math.sin(pier.ang));
  const terminal = new THREE.Group();
  terminal.name = 'central-star-ferry';
  terminal.position.set(pier.cx, ground, pier.cz);
  terminal.rotation.y = yaw;
  const hall = new THREE.Mesh(new THREE.BoxGeometry(20, 7.2, 36), white);
  hall.position.y = 3.6;
  hall.castShadow = true;
  hall.receiveShadow = true;
  terminal.add(hall);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(22, 1.4, 38), roofMat);
  roof.position.y = 7.7;
  roof.castShadow = true;
  terminal.add(roof);
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.3, 20), clockMat);
  clock.rotation.x = Math.PI / 2;
  clock.position.set(0, 4.6, 18.2);
  terminal.add(clock);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(12, 2.2, 0.18), hkLabelMaterial('天星小輪', '#f4f7f2', '#143028'));
  sign.position.set(0, 6.4, 18.25);
  terminal.add(sign);
  group.add(terminal);
  colliders.push(yawAabb(pier.cx, pier.cz, 10, 18, yaw, ground + 9));
}

function addPeakTram(group, site, colliders, green, ground) {
  let north = site.block.poly[0];
  for (const p of site.block.poly) if (p.z < north.z) north = p;
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(16, 0.35, 5.2), green);
  canopy.position.set(north.x, ground + 4.3, north.z - 2.4);
  canopy.castShadow = true;
  group.add(canopy);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(11, 2.4, 0.22), hkLabelMaterial('山頂纜車', '#0e6a45', '#f3ffe8'));
  sign.position.set(north.x, ground + 6.4, north.z - 4.9);
  group.add(sign);
  colliders.push({
    minX: north.x - 8,
    maxX: north.x + 8,
    minZ: north.z - 5.2,
    maxZ: north.z + 0.3,
    maxY: ground + 8
  });
}

function buildHkLandmarks(scene, gltfPlan = null) {
  const { placed, deferred } = hkResolveLandmarks();
  const gltfMeshes = gltfPlan?.selected || [];
  const group = new THREE.Group();
  group.name = 'HongKongLandmarks';
  const colliders = [];
  const ground = ISLAND_BOUNDS.sidewalkHeight;
  const glass = hkMat(0xd5dee8, { metalness: 0.72, roughness: 0.14 });
  const metal = hkMat(0xb7c0c8, { metalness: 0.8, roughness: 0.22 });
  const bronze = hkMat(0x8d7350, { metalness: 0.55, roughness: 0.38 });
  const porthole = hkMat(0x12181e, { metalness: 0.15, roughness: 0.35 });
  const stone = hkMat(0xddd6c8, { metalness: 0.04, roughness: 0.74 });
  const ferryWhite = hkMat(0xf3f1ea, { metalness: 0.02, roughness: 0.62 });
  const ferryRoof = hkMat(0x2c6b4e, { metalness: 0.08, roughness: 0.58 });
  const clockFace = hkMat(0xf7f4ea, { metalness: 0.05, roughness: 0.4 });
  const tramGreen = hkMat(0x0e6a45, { metalness: 0.12, roughness: 0.5 });
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  for (const site of placed) {
    switch (site.kind) {
      case 'two-ifc':
        addTwoIfc(group, site, glass, metal, ground);
        break;
      case 'one-ifc':
        addOneIfc(group, site, glass, ground);
        break;
      case 'boc':
        // Individualised GLTF already carries the LandsD photograph. The prism is only
        // the footprint fallback, and it uses the extrude shopfront and curtain, not a toy skin.
        if (!gltfCoversFootprint(site.block, gltfMeshes)) {
          addBankOfChina(group, site, colliders, up, dir, ground);
        }
        break;
      case 'exchange':
        addExchange(group, site, bronze, metal, ground);
        break;
      case 'jardine':
        addJardine(group, site, porthole, up, ground);
        break;
      case 'cfa':
        addCourtDome(group, site, stone, metal, ground);
        break;
      case 'star-ferry':
        addStarFerry(group, site, colliders, ferryWhite, ferryRoof, clockFace, ground);
        break;
      case 'peak-tram':
        addPeakTram(group, site, colliders, tramGreen, ground);
        break;
      default: {
        const unknown = site.kind;
        throw new Error(`Unhandled Hong Kong landmark ${unknown}`);
      }
    }
  }
  scene.add(group);
  console.info(
    `[landmarks] ${placed.map((site) => `${site.label} ${site.lat.toFixed(5)},${site.lon.toFixed(5)}`).join('; ')}` +
    `; deferred ${deferred.map((site) => site.label).join(', ')}`
  );
  return { group, colliders };
}

function buildLandmarks(scene, gltfPlan = null) {
  return buildHkLandmarks(scene, gltfPlan);
}

export { buildLandmarks };
