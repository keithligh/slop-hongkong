import * as THREE from 'three/webgpu';
import { Fn, float, smoothstep, texture, uniform } from 'three/tsl';
import { HK_STREET_EYE, HK_STREET_NEAR, hkCentralSignSites } from './city-config.js';
import { clipCanyonWalls } from './hk-ground-fill.js';
import { centralCanyonWalls, planHkCanyonNeon } from './hk-neon.js';
import { omitPlandCorridorGlass } from './hk-pland-frame.js';
import { cityUniforms } from './tsl-materials.js';

// Street-name plates, plus hanging boards and neon strips on the canyon face.

const HK_SIGN_FONT = '"PingFang HK","PingFang TC","Microsoft JhengHei","Noto Sans CJK TC","Noto Sans TC","WenQuanYi Micro Hei","Droid Sans Fallback",sans-serif';

const painted = [];

function strokeFrame(ctx, w, h, inset, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  const rw = w - inset * 2;
  const rh = h - inset * 2;
  const radius = Math.min(28, rw * 0.08, rh * 0.08);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(inset, inset, rw, rh, radius);
  else ctx.rect(inset, inset, rw, rh);
  ctx.stroke();
}

function paintPlate(ctx, site, w, h) {
  ctx.fillStyle = site.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = site.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 72px ${HK_SIGN_FONT}`;
  ctx.fillText(site.text, w / 2, h / 2 + 2);
}

function paintNeon(ctx, site, w, h, vertical) {
  ctx.fillStyle = site.bg;
  ctx.fillRect(0, 0, w, h);
  strokeFrame(ctx, w, h, vertical ? 14 : 16, site.fg, vertical ? 12 : 16);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = vertical ? 5 : 6;
  ctx.strokeRect(vertical ? 32 : 36, vertical ? 32 : 36, w - (vertical ? 64 : 72), h - (vertical ? 64 : 72));
  ctx.fillStyle = site.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (vertical) {
    const chars = Array.from(site.text);
    const fontPx = chars.length <= 2 ? 148 : chars.length <= 4 ? 112 : 88;
    ctx.font = `700 ${fontPx}px ${HK_SIGN_FONT}`;
    const gap = (h - 80) / chars.length;
    chars.forEach((ch, i) => ctx.fillText(ch, w / 2, 40 + gap * (i + 0.5)));
    return;
  }
  const n = Array.from(site.text).length;
  const fontPx = n <= 3 ? 132 : n <= 5 ? 108 : 88;
  ctx.font = `700 ${fontPx}px ${HK_SIGN_FONT}`;
  ctx.fillText(site.text, w / 2, h / 2 + 4);
}

function paintCanvas(canvas, site) {
  const ctx = canvas.getContext('2d');
  const vertical = site.kind === 'blade';
  if (site.kind === 'plate') paintPlate(ctx, site, canvas.width, canvas.height);
  else paintNeon(ctx, site, canvas.width, canvas.height, vertical);
}

function createSignTexture(site) {
  const canvas = document.createElement('canvas');
  if (site.kind === 'blade') {
    canvas.width = 256;
    canvas.height = 1024;
  } else if (site.kind === 'plate') {
    canvas.width = 640;
    canvas.height = 192;
  } else {
    canvas.width = 1024;
    canvas.height = 256;
  }
  paintCanvas(canvas, site);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  const record = { canvas, site, tex, clones: [] };
  painted.push(record);
  return record;
}

function refreshSignFonts() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
  document.fonts.load(`700 112px ${HK_SIGN_FONT}`).then(() => {
    for (const item of painted) {
      paintCanvas(item.canvas, item.site);
      item.tex.needsUpdate = true;
      for (const clone of item.clones) clone.needsUpdate = true;
    }
  }).catch(() => {});
}

function makeSignMaterial(map, glow) {
  const mat = new THREE.MeshStandardNodeMaterial({
    map,
    roughness: glow ? 0.48 : 0.72,
    metalness: 0.04
  });
  if (!glow) {
    mat.emissive = new THREE.Color(0x1a1a1a);
    mat.emissiveMap = map;
    mat.emissiveIntensity = 0.14;
    return mat;
  }
  // Painted enamel by day. The interior-glow uniform lifts the same map into
  // bloom at blue hour and midnight without hiding the characters at noon.
  mat.emissiveNode = Fn(() => {
    const night = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
    const gain = float(0.58).add(night.mul(1.25));
    return texture(map).bias(float(-0.75)).rgb.mul(gain);
  })();
  mat.toneMapped = false;
  return mat;
}

function meshName(kind) {
  if (kind === 'plate') return 'HkStreetPlates';
  if (kind === 'blade') return 'HkHangingBoards';
  if (kind === 'fascia') return 'HkNeonStrips';
  const unexpected = kind;
  throw new Error(`Unknown sign kind ${unexpected}`);
}

function addInstancedSigns(group, sites, glow) {
  const buckets = new Map();
  for (const site of sites) {
    const key = `${site.kind}|${site.text}|${site.bg}|${site.fg}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = []));
    bucket.push(site);
  }
  const plane = new THREE.PlaneGeometry(1, 1);
  const dummy = new THREE.Object3D();
  for (const bucket of buckets.values()) {
    const sample = bucket[0];
    const paintedSign = createSignTexture(sample);
    const fronts = [];
    const backs = [];
    for (const site of bucket) {
      fronts.push(site);
      if (glow && site.kind === 'blade') {
        const nx = Math.sin(site.rotY);
        const nz = Math.cos(site.rotY);
        backs.push({
          ...site,
          x: site.x - nx * 0.045,
          z: site.z - nz * 0.045,
          rotY: site.rotY + Math.PI
        });
      }
    }
    const place = (list, mat, name) => {
      const mesh = new THREE.InstancedMesh(plane, mat, list.length);
      mesh.name = name;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 4;
      for (let i = 0; i < list.length; i++) {
        const site = list[i];
        dummy.position.set(site.x, site.y, site.z);
        dummy.rotation.set(0, site.rotY, 0);
        dummy.scale.set((site.flip || 1) * site.w, site.h, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    };
    place(fronts, makeSignMaterial(paintedSign.tex, glow), meshName(sample.kind));
    if (!backs.length) continue;
    // The far face is the same enamel, mirrored in U so 繁體 still reads after the board is turned around.
    const backMap = paintedSign.tex.clone();
    backMap.wrapS = THREE.RepeatWrapping;
    backMap.repeat.x = -1;
    backMap.offset.x = 1;
    paintedSign.clones.push(backMap);
    place(backs, makeSignMaterial(backMap, glow), 'HkHangingBoardsBack');
  }
}

function addArms(group, arms) {
  if (!arms.length) return;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x3a342c, roughness: 0.42, metalness: 0.62 });
  mat.name = 'hkSignArm';
  const mesh = new THREE.InstancedMesh(geo, mat, arms.length);
  mesh.name = 'HkSignArms';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    dummy.position.set(arm.x, arm.y, arm.z);
    dummy.rotation.set(0, arm.rotY, 0);
    dummy.scale.set(arm.len, 0.07, 0.09);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
}

function buildStreetDetails(scene, gltfPlan = null) {
  const group = new THREE.Group();
  group.name = 'HongKongStreetDetails';
  const plates = hkCentralSignSites();
  addInstancedSigns(group, plates, false);
  const gltfMeshes = gltfPlan?.selected || [];
  const walls = clipCanyonWalls(centralCanyonWalls(), gltfMeshes, gltfMeshes.length ? {
    eye: HK_STREET_EYE,
    near: HK_STREET_NEAR
  } : {});
  const plandOn = gltfPlan?.plandMode === 'donor' || gltfPlan?.plandMode === 'compare';
  const shown = omitPlandCorridorGlass(walls, { enabled: plandOn });
  const neon = planHkCanyonNeon(shown);
  addInstancedSigns(group, neon.signs, true);
  addArms(group, neon.arms);
  refreshSignFonts();
  const blades = neon.signs.filter((site) => site.kind === 'blade').length;
  const strips = neon.signs.filter((site) => site.kind === 'fascia').length;
  console.info(
    `[neon] podium-belt boards ${blades} strips ${strips} arms ${neon.arms.length} ` +
    `on ${neon.walls} gap podiums (德輔道中 ${neon.desVoeux}, side ${neon.side})`
  );
  console.info(`[streetDetails] plates ${plates.length}`);
  return { group, footprints: [], signalClock: uniform(0), audioSignals: [], update() {} };
}

export { buildStreetDetails };
