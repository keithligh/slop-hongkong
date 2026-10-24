import * as THREE from 'three/webgpu';
import { BLOCKS } from './city-config.js';
import { landsdAlbedoRow } from './hk-gltf-frame.js';
import {
  DIGIT1_PROBE_SAMPLES,
  HENDERSON_BUILDING_ID,
  classifyTexel,
  digit1ChasePose,
  isMagentaRgb,
  isPaleRgb,
  judgeDigit1Premise,
  ndcToReadPixel,
  rowAgreement
} from './digit1-probe-frame.js';

// Reads the live WebGPU frame at the Digit1 chase. Raycast names a triangle.
// An unlit id pass names the mesh the rasterizer kept. An unlit albedo pass
// is the texel the GPU sampled. The lit pass is that surface under the scene
// lights, before the post grade. Three toggles then falsify the padding premise.

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const sheets = new WeakMap();

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function footprintAt(x, z) {
  for (const block of BLOCKS) {
    if (!block || x < block.minX || x > block.maxX || z < block.minZ || z > block.maxZ) continue;
    if (!(block.rect || (block.poly && pointInPoly(block.poly, x, z)))) continue;
    return block.name || String(block.id);
  }
  return '';
}

function sourceOf(mesh) {
  if (mesh.userData?.hkSource) return mesh.userData.hkSource;
  let parent = mesh.parent;
  while (parent) {
    if (parent.name === 'HkIndividualModels') return 'landsd';
    if (parent.name === 'HkPlandCorridor') return 'pland';
    if (parent.name === 'HongKongCityBlocks') return 'extrude';
    if (parent.name === 'HongKongLandmarks') return 'landmark';
    if (parent.name === 'HongKongCityGrid') return 'ground';
    parent = parent.parent;
  }
  return '';
}

function isHendersonMesh(mesh) {
  const id = mesh.userData?.hkBuildingId || '';
  const file = mesh.userData?.hkFile || '';
  return id === HENDERSON_BUILDING_ID || file.includes(HENDERSON_BUILDING_ID);
}

function drawableMeshes(scene, camera, sky) {
  const meshes = [];
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    if (obj.userData?.shadowProxy) return;
    if (sky && obj === sky) return;
    if (!obj.layers.test(camera.layers)) return;
    meshes.push(obj);
  });
  return meshes;
}

function raycastScene(scene, camera, ndcX, ndcY, sky) {
  ndc.set(ndcX, ndcY);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const hit of hits) {
    const mesh = hit.object;
    if (!mesh?.isMesh) continue;
    if (mesh.userData?.shadowProxy) continue;
    if (sky && mesh === sky) continue;
    let hidden = false;
    for (let node = mesh; node; node = node.parent) {
      if (node.visible === false) hidden = true;
    }
    if (hidden) continue;
    return hit;
  }
  return null;
}

function materialAt(mesh, materialIndex) {
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return list[materialIndex] || list[0] || null;
}

function mapOf(material) {
  if (!material) return null;
  if (material.map?.isTexture) return material.map;
  if (material.emissiveMap?.isTexture) return material.emissiveMap;
  return null;
}

function sheetOf(map) {
  if (!map) return null;
  if (sheets.has(map)) return sheets.get(map);
  const img = map.image;
  const w0 = img?.width || 0;
  const h0 = img?.height || 0;
  if (!w0 || !h0 || typeof document === 'undefined') {
    sheets.set(map, null);
    return null;
  }
  const scale = Math.min(1, 512 / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      sheets.set(map, null);
      return null;
    }
    ctx.drawImage(img, 0, 0, w, h);
    const sheet = { w, h, data: ctx.getImageData(0, 0, w, h).data };
    sheets.set(map, sheet);
    return sheet;
  } catch {
    sheets.set(map, null);
    return null;
  }
}

function sampleSheet(sheet, u, v, flipped) {
  if (!sheet) return null;
  let uu = u % 1;
  let vv = v % 1;
  if (uu < 0) uu += 1;
  if (vv < 0) vv += 1;
  const x = Math.min(sheet.w - 1, (uu * sheet.w) | 0);
  const y = flipped
    ? Math.min(sheet.h - 1, ((1 - vv) * sheet.h) | 0)
    : landsdAlbedoRow(vv, sheet.h);
  const i = (y * sheet.w + x) * 4;
  return [sheet.data[i], sheet.data[i + 1], sheet.data[i + 2]];
}

function describeHit(hit) {
  if (!hit) {
    return {
      miss: true,
      mesh: 'none',
      buildingId: '',
      source: '',
      material: '',
      map: false,
      class: 'miss',
      footprint: ''
    };
  }
  const mesh = hit.object;
  const material = materialAt(mesh, hit.face?.materialIndex || 0);
  const map = mapOf(material);
  const uv = hit.uv ? [hit.uv.x, hit.uv.y] : null;
  const sheet = sheetOf(map);
  const cpuGpu = uv ? sampleSheet(sheet, uv[0], uv[1], false) : null;
  const cpuFlip = uv ? sampleSheet(sheet, uv[0], uv[1], true) : null;
  const klass = classifyTexel(cpuGpu, !!map);
  return {
    miss: false,
    mesh: mesh.name || mesh.type || 'mesh',
    buildingId: mesh.userData?.hkBuildingId || '',
    file: mesh.userData?.hkFile || '',
    sheet: mesh.userData?.hkSheet || '',
    source: sourceOf(mesh),
    material: material?.name || material?.type || '',
    map: !!map,
    flipY: map ? map.flipY : null,
    image: map?.image ? [map.image.width || 0, map.image.height || 0] : null,
    mipmaps: map ? !!map.generateMipmaps : null,
    nullDropped: mesh.userData?.hkNullDropped ?? null,
    uv,
    texel: cpuGpu,
    texelFlipped: cpuFlip,
    class: klass,
    footprint: footprintAt(hit.point.x, hit.point.z),
    point: [round1(hit.point.x), round1(hit.point.y), round1(hit.point.z)],
    distance: round1(hit.distance)
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function rgbAt(buffer, width, x, y) {
  const i = (y * width + x) * 4;
  if (!buffer || i < 0 || i + 2 >= buffer.length) return null;
  return [buffer[i], buffer[i + 1], buffer[i + 2]];
}

function idColor(index, levels) {
  const n = index + 1;
  const x = n % levels;
  const y = Math.floor(n / levels) % levels;
  const z = Math.floor(n / (levels * levels)) % levels;
  const scale = levels <= 1 ? 0 : 255 / (levels - 1);
  return [Math.round(x * scale), Math.round(y * scale), Math.round(z * scale)];
}

function cssColor(rgb) {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function nearestMesh(rgb, table, threshold) {
  if (!rgb) return null;
  let best = null;
  let bestD = Infinity;
  for (const row of table) {
    const d = Math.abs(rgb[0] - row.rgb[0]) + Math.abs(rgb[1] - row.rgb[1]) + Math.abs(rgb[2] - row.rgb[2]);
    if (d < bestD) {
      bestD = d;
      best = row;
    }
  }
  if (!best || bestD > threshold) return null;
  return best.mesh;
}

function albedoStandIn(material) {
  const list = Array.isArray(material) ? material : [material];
  const made = list.map((mat) => {
    const map = mapOf(mat);
    return new THREE.MeshBasicMaterial({
      map: map || null,
      color: 0xffffff,
      side: mat?.side ?? THREE.FrontSide,
      fog: false,
      toneMapped: false
    });
  });
  return made.length === 1 ? made[0] : made;
}

function disposeMaterial(material) {
  const list = Array.isArray(material) ? material : [material];
  for (const mat of list) mat?.dispose?.();
}

function applyPose(camera, pose, aspect) {
  camera.position.set(pose.cam.x, pose.cam.y, pose.cam.z);
  camera.up.set(0, 1, 0);
  camera.lookAt(pose.look.x, pose.look.y, pose.look.z);
  camera.fov = pose.fov;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function cameraRecord(camera) {
  const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
  return {
    position: [round1(camera.position.x), round1(camera.position.y), round1(camera.position.z)],
    look: [round1(look.x), round1(look.y), round1(look.z)],
    fov: camera.fov,
    aspect: Math.round(camera.aspect * 1000) / 1000
  };
}

function poseDelta(camera, pose) {
  return Math.hypot(camera.position.x - pose.cam.x, camera.position.y - pose.cam.y, camera.position.z - pose.cam.z);
}

export async function runDigit1Probe({
  renderer,
  scene,
  camera,
  cameraSystem,
  entity,
  sky = null,
  requestedAt = null,
  groundAt = () => 0,
  renderPipeline = null,
  samples = DIGIT1_PROBE_SAMPLES
}) {
  const width = renderer.domElement?.width || 0;
  const height = renderer.domElement?.height || 0;
  if (!(width > 1) || !(height > 1)) {
    return {
      premise: 'INCONCLUSIVE',
      painter: '',
      reason: `drawing buffer is ${width}x${height}`,
      page: null,
      locked: null
    };
  }
  if (cameraSystem) {
    for (let i = 0; i < 4; i++) cameraSystem.update(0.5, 2);
  }
  const requested = requestedAt || {
    x: entity.position.x,
    z: entity.position.z,
    heading: entity.heading
  };
  const groundY = groundAt(requested.x, requested.z);
  const lockedPose = digit1ChasePose({
    x: requested.x,
    y: groundY,
    z: requested.z,
    heading: requested.heading
  });
  const playerMovedM = Math.hypot(entity.position.x - requested.x, entity.position.z - requested.z);
  const pageDelta = poseDelta(camera, lockedPose);

  const saved = {
    pos: camera.position.clone(),
    quat: camera.quaternion.clone(),
    fov: camera.fov,
    aspect: camera.aspect,
    toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
    fog: scene.fog,
    fogNode: scene.fogNode,
    sky: sky ? sky.visible : null,
    target: renderer.getRenderTarget?.() || null
  };
  const meshes = drawableMeshes(scene, camera, sky);
  const levels = Math.max(2, Math.ceil(Math.cbrt(meshes.length + 1)));
  const idScale = levels <= 1 ? 255 : 255 / (levels - 1);
  // Half a palette step. Black clear (0,0,0) stays a miss, and an sRGB round-trip of ±1 still matches.
  const idThreshold = Math.max(1, idScale * 0.45);
  const idTable = meshes.map((mesh, index) => {
    const rgb = idColor(index, levels);
    const side = materialAt(mesh, 0)?.side ?? THREE.FrontSide;
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(cssColor(rgb)),
      side,
      fog: false,
      toneMapped: false
    });
    return { mesh, rgb, mat };
  });
  const albedoCache = new Map();
  const henderson = meshes.filter(isHendersonMesh);
  function magentaSwap() {
    const prev = henderson.map((mesh) => mesh.material);
    const made = henderson.map((mesh) => new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      side: materialAt(mesh, 0)?.side ?? THREE.FrontSide,
      fog: false,
      toneMapped: false
    }));
    henderson.forEach((mesh, index) => {
      mesh.material = made[index];
    });
    return () => {
      henderson.forEach((mesh, index) => {
        mesh.material = prev[index];
      });
      for (const mat of made) mat.dispose();
    };
  }
  const landsdGroup = scene.getObjectByName('HkIndividualModels');

  function restoreCamera() {
    camera.position.copy(saved.pos);
    camera.quaternion.copy(saved.quat);
    camera.fov = saved.fov;
    camera.aspect = saved.aspect;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  function restoreScene() {
    renderer.toneMapping = saved.toneMapping;
    renderer.toneMappingExposure = saved.exposure;
    scene.fog = saved.fog;
    scene.fogNode = saved.fogNode;
    if (sky) sky.visible = saved.sky;
    renderer.setRenderTarget(saved.target);
  }

  // SwiftShader rejects the render-target copy used by readRenderTargetPixelsAsync
  // (the fallback texture has no GPU descriptor). The canvas is the image the
  // page already presents. drawImage reads that bitmap after the GPU queue drains.
  async function readCanvas(label) {
    renderer.setRenderTarget(null);
    const device = renderer.backend?.device;
    if (device?.queue?.onSubmittedWorkDone) {
      try {
        await device.queue.onSubmittedWorkDone();
      } catch (err) {
        console.warn(`[digit1-probe] ${label} queue`, err?.message || err);
      }
    }
    const src = renderer.domElement;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = src.width;
      canvas.height = src.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(src, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch (err) {
      console.warn(`[digit1-probe] ${label} canvas read failed`, err?.message || err);
      return null;
    }
  }

  async function draw(mode) {
    if (mode === 'lit') {
      renderer.toneMapping = saved.toneMapping;
      renderer.toneMappingExposure = saved.exposure;
      scene.fog = saved.fog;
      scene.fogNode = saved.fogNode;
      if (sky) sky.visible = saved.sky;
    } else {
      renderer.toneMapping = THREE.NoToneMapping;
      scene.fog = null;
      scene.fogNode = null;
      if (sky) sky.visible = false;
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
    renderer.render(scene, camera);
    return readCanvas(mode);
  }

  async function drawPresented() {
    if (!renderPipeline?.render) return null;
    renderer.toneMapping = saved.toneMapping;
    renderer.toneMappingExposure = saved.exposure;
    scene.fog = saved.fog;
    scene.fogNode = saved.fogNode;
    if (sky) sky.visible = saved.sky;
    renderer.setRenderTarget(null);
    try {
      renderPipeline.render();
    } catch (err) {
      console.warn('[digit1-probe] presented render failed', err?.message || err);
      return null;
    }
    return readCanvas('presented');
  }

  async function withMeshMaterials(pairs, fn) {
    const previous = pairs.map(([mesh]) => [mesh, mesh.material]);
    for (const [mesh, material] of pairs) mesh.material = material;
    try {
      return await fn();
    } finally {
      for (const [mesh, material] of previous) mesh.material = material;
    }
  }

  function surfaceFromRay(described, presented) {
    const skyPixel = described.miss && isPaleRgb(presented);
    return {
      miss: described.miss && !skyPixel,
      mesh: skyPixel ? 'sky' : described.mesh,
      buildingId: described.buildingId,
      source: skyPixel ? 'sky' : described.source,
      material: described.material,
      map: described.map,
      class: described.miss ? (skyPixel ? 'sky' : 'miss') : described.class,
      albedo: described.texel,
      albedoSource: 'cpu-gpu-row',
      flipY: described.flipY,
      footprint: described.footprint,
      nullDropped: described.nullDropped
    };
  }

  function liveSnapRgb(ndcX, ndcY) {
    const rows = globalThis.__digit1LiveRgb;
    if (!Array.isArray(rows)) return null;
    const row = rows.find((item) => item?.ndc?.[0] === ndcX && item?.ndc?.[1] === ndcY);
    return Array.isArray(row?.rgb) ? row.rgb : null;
  }

  function readableRgb(rgb) {
    return !!rgb && (rgb[0] !== 0 || rgb[1] !== 0 || rgb[2] !== 0);
  }

  async function capture(origin) {
    // The animation loop already presented this camera. A direct renderer.render
    // of a per-mesh id material drops the SwiftShader device, so the colour is
    // the canvas bitmap and the mesh is the ray. The live snap is taken while
    // that loop is still presenting; a later read is often cleared to zero.
    const presentedBuffer = origin === 'locked' ? await drawPresented() : await readCanvas('baseline');
    const centre = presentedBuffer ? rgbAt(presentedBuffer, width, width >> 1, height >> 1) : null;
    console.info(`[digit1-probe] ${origin} canvas centre ${centre ? centre.join(',') : 'unread'}`);
    const rays = samples.map(([ndcX, ndcY]) => ({
      ndcX,
      ndcY,
      hit: raycastScene(scene, camera, ndcX, ndcY, sky),
      top: ndcToReadPixel(ndcX, ndcY, width, height, 'top')
    }));
    const rows = rays.map((ray) => {
      const fromBuffer = presentedBuffer ? rgbAt(presentedBuffer, width, ray.top.x, ray.top.y) : null;
      const snapped = origin === 'page' ? liveSnapRgb(ray.ndcX, ray.ndcY) : null;
      const presented = readableRgb(fromBuffer) ? fromBuffer : (readableRgb(snapped) ? snapped : fromBuffer);
      const described = describeHit(ray.hit);
      return {
        ndc: [ray.ndcX, ray.ndcY],
        pixel: ray.top,
        baseline: {
          lit: { rgb: presented, pale: isPaleRgb(presented) },
          presented: presented ? { rgb: presented, pale: isPaleRgb(presented) } : null,
          gpu: surfaceFromRay(described, presented),
          ray: described,
          row: described.uv ? 'cpu-gpu-row' : 'unread',
          idAgrees: null
        }
      };
    });
    return {
      origin: 'top',
      idScore: { top: 0, bottom: 0 },
      camera: cameraRecord(camera),
      samples: rows
    };
  }

  function publishStage(stage) {
    if (!stage) return Promise.resolve();
    window.__digit1Stage = stage;
    const deadline = performance.now() + 20000;
    return new Promise((resolve) => {
      const tick = () => {
        if (window.__digit1Shot === stage || performance.now() > deadline) resolve();
        else setTimeout(tick, 30);
      };
      tick();
    });
  }

  async function experiment(name, mutate, viewSamples, stage) {
    const undo = mutate();
    try {
      const presentedBuffer = await drawPresented();
      // The canvas bitmap stays zero under this WebGPU present. The harness
      // screenshots the swapchain while the mutation is still on screen.
      await publishStage(stage);
      return viewSamples.map((sample) => {
        const pixel = ndcToReadPixel(sample.ndc[0], sample.ndc[1], width, height, 'top');
        const presented = presentedBuffer ? rgbAt(presentedBuffer, width, pixel.x, pixel.y) : null;
        const hit = raycastScene(scene, camera, sample.ndc[0], sample.ndc[1], sky);
        const described = describeHit(hit);
        return {
          lit: { rgb: presented, pale: isPaleRgb(presented), magenta: isMagentaRgb(presented) },
          presented: presented ? { rgb: presented, pale: isPaleRgb(presented) } : null,
          gpu: surfaceFromRay(described, presented)
        };
      });
    } finally {
      undo();
    }
  }

  try {
    console.info(`[digit1-probe] buffer ${width}x${height} meshes ${meshes.length} henderson ${henderson.length} player moved ${playerMovedM.toFixed(2)} m`);
    const page = await capture('page');
    for (const sample of page.samples) sample._origin = page.origin;
    console.info('[digit1-probe] hide Henderson');
    const hidden = await experiment('hideHenderson', () => {
      const prev = henderson.map((mesh) => mesh.visible);
      for (const mesh of henderson) mesh.visible = false;
      return () => {
        henderson.forEach((mesh, index) => {
          mesh.visible = prev[index];
        });
      };
    }, page.samples, 'hide-henderson');
    console.info('[digit1-probe] magenta Henderson');
    const painted = await experiment('magentaHenderson', magentaSwap, page.samples, 'magenta-henderson');
    console.info('[digit1-probe] hide LandsD');
    const bare = await experiment('hideLandsd', () => {
      const prev = landsdGroup ? landsdGroup.visible : null;
      if (landsdGroup) landsdGroup.visible = false;
      const loose = meshes.filter((mesh) => sourceOf(mesh) === 'landsd' && mesh.visible);
      for (const mesh of loose) mesh.visible = false;
      return () => {
        if (landsdGroup) landsdGroup.visible = prev;
        for (const mesh of loose) mesh.visible = true;
      };
    }, page.samples, 'hide-landsd');
    page.samples.forEach((sample, index) => {
      sample.hideHenderson = hidden[index];
      sample.magentaHenderson = { magenta: painted[index].lit.magenta, lit: painted[index].lit, gpu: painted[index].gpu };
      sample.hideLandsd = bare[index];
      delete sample._origin;
    });

    let locked = null;
    if (pageDelta > 0.4) {
      console.info(`[digit1-probe] locked eye, page camera is ${pageDelta.toFixed(2)} m off the documented pose`);
      applyPose(camera, lockedPose, width / height);
      const lockedView = await capture('locked');
      for (const sample of lockedView.samples) sample._origin = lockedView.origin;
      const lockedHidden = await experiment('hideHenderson', () => {
        const prev = henderson.map((mesh) => mesh.visible);
        for (const mesh of henderson) mesh.visible = false;
        return () => henderson.forEach((mesh, index) => {
          mesh.visible = prev[index];
        });
      }, lockedView.samples, 'locked-hide-henderson');
      const lockedPainted = await experiment('magentaHenderson', magentaSwap, lockedView.samples, 'locked-magenta-henderson');
      const lockedBare = await experiment('hideLandsd', () => {
        const prev = landsdGroup ? landsdGroup.visible : null;
        if (landsdGroup) landsdGroup.visible = false;
        return () => {
          if (landsdGroup) landsdGroup.visible = prev;
        };
      }, lockedView.samples, 'locked-hide-landsd');
      lockedView.samples.forEach((sample, index) => {
        sample.hideHenderson = lockedHidden[index];
        sample.magentaHenderson = { magenta: lockedPainted[index].lit.magenta, lit: lockedPainted[index].lit, gpu: lockedPainted[index].gpu };
        sample.hideLandsd = lockedBare[index];
        delete sample._origin;
      });
      locked = lockedView;
    }

    const report = {
      requested: { x: requested.x, z: requested.z, heading: requested.heading, groundY },
      player: {
        x: round1(entity.position.x),
        y: round1(entity.position.y),
        z: round1(entity.position.z),
        heading: entity.heading
      },
      playerMovedM: Math.round(playerMovedM * 100) / 100,
      pageCameraDeltaM: Math.round(pageDelta * 100) / 100,
      hendersonMeshes: henderson.length,
      landsdGroup: !!landsdGroup,
      presentedPass: !!renderPipeline?.render,
      width,
      height,
      page,
      locked
    };
    const judged = judgeDigit1Premise(report);
    report.premise = judged.premise;
    report.painter = judged.painter;
    report.reason = judged.reason;
    report.paleCount = judged.paleCount;
    if (locked) {
      const lockedJudged = judgeDigit1Premise({ page: locked });
      report.lockedPremise = lockedJudged.premise;
      report.lockedPainter = lockedJudged.painter;
      report.lockedReason = lockedJudged.reason;
    }
    if (playerMovedM > 0.5) {
      report.reason += ` The page player is ${playerMovedM.toFixed(2)} m from the requested eye.`;
    }
    report.idAgreement = {
      top: page.idScore.top,
      bottom: page.idScore.bottom,
      origin: page.origin,
      agreed: page.samples.filter((sample) => sample.baseline.idAgrees).length,
      rayHits: page.samples.filter((sample) => !sample.baseline.ray.miss).length
    };
    return report;
  } finally {
    restoreCamera();
    restoreScene();
    if (renderPipeline?.render) {
      try {
        renderPipeline.render();
        const device = renderer.backend?.device;
        if (device?.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
      } catch (err) {
        console.warn('[digit1-probe] final present failed', err?.message || err);
      }
    }
    for (const row of idTable) row.mat.dispose();
    for (const stand of albedoCache.values()) disposeMaterial(stand);
  }
}
