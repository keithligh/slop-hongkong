import { HK_RETAIL_BELT, HK_STREET_EYE } from './city-config.js';
import { digit1ChasePose, projectChaseNdc } from './digit1-probe-frame.js';
import { canyonGlassWalls, digit1EyeFrameHalf } from './hk-ground-fill.js';
import { landsdSealFarNullTriangles } from './hk-gltf-frame.js';

// Keith-eye crop metrics. hp_std_3x3 is the mean standard deviation of luma
// in a 3×3 box. MAD is the mean per-channel absolute RGB difference.
// A static path check is not this measurement.

export function keithEyeLuma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function keithEyeGrain(data, width, height) {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let mean = 0;
      let meanSq = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const i = (yy * width + xx) * 4;
          const luma = keithEyeLuma(data[i], data[i + 1], data[i + 2]);
          mean += luma;
          meanSq += luma * luma;
          count++;
        }
      }
      const avg = mean / count;
      sum += Math.sqrt(Math.max(0, meanSq / count - avg * avg));
      n++;
    }
  }
  return n ? sum / n : 0;
}

export function keithEyeMad(before, after, width, height) {
  const n = width * height;
  if (!n || before.length < n * 4 || after.length < n * 4) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    sum += (Math.abs(before[o] - after[o])
      + Math.abs(before[o + 1] - after[o + 1])
      + Math.abs(before[o + 2] - after[o + 2])) / 3;
  }
  return sum / n;
}

function paint(buf, width, x, y, rgb) {
  const o = (y * width + x) * 4;
  buf[o] = rgb[0];
  buf[o + 1] = rgb[1];
  buf[o + 2] = rgb[2];
  buf[o + 3] = 255;
}

function lookWall(eye, along, side) {
  const fx = Math.sin(eye.heading);
  const fz = Math.cos(eye.heading);
  const sx = -fz;
  const sz = fx;
  return {
    x: eye.x + fx * along + sx * side,
    z: eye.z + fz * along + sz * side,
    yaw: Math.atan2(fx, fz),
    depth: 12,
    len: 3.5,
    side: 1,
    rx: sx,
    rz: sz,
    dx: fx,
    dz: fz,
    raw: 'DES VOEUX ROAD CENTRAL',
    highway: false,
    narrow: false
  };
}

function solidOnRay(origin, dir, t) {
  const px = origin.x + dir.x * t;
  const py = origin.y + dir.y * t;
  const pz = origin.z + dir.z * t;
  const span = Math.hypot(-dir.z, dir.x) || 1;
  const ux = -dir.z / span;
  const uz = dir.x / span;
  const s = 28;
  const triangles = new Float32Array([
    px - ux * s, py - s, pz - uz * s,
    px + ux * s, py - s, pz + uz * s,
    px, py + s, pz
  ]);
  return {
    minX: px - s,
    maxX: px + s,
    minY: py - s,
    maxY: py + s,
    minZ: pz - s,
    maxZ: pz + s,
    triangles
  };
}

const CURTAIN_A = [92, 148, 168];
const CURTAIN_B = [214, 198, 176];
const PHOTO = [32, 44, 62];
const NULL_FILL = [136, 138, 137];

function regionMad(before, after, width, height, x0, x1) {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4;
      sum += (Math.abs(before[o] - after[o])
        + Math.abs(before[o + 1] - after[o + 1])
        + Math.abs(before[o + 2] - after[o + 2])) / 3;
      n++;
    }
  }
  return n ? sum / n : 0;
}

// Eye crop of one far ribbon the 72 m corridor misses and the chase camera
// still frames, plus a null-fill hole sealed to a photograph UV.
// Before is the corridor-half curtain and the open hole. After is the frame
// test and the sealed chart. The pixels are that policy, not a file export.
export function measureDigit1FarFrame(eye = HK_STREET_EYE) {
  const along = 210;
  const side = 96;
  const wall = lookWall(eye, along, side);
  const pose = digit1ChasePose(eye);
  const y = HK_RETAIL_BELT + 1.2;
  const dx = wall.x - pose.cam.x;
  const dy = y - pose.cam.y;
  const dz = wall.z - pose.cam.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
  const solid = solidOnRay(pose.cam, dir, dist + 40);
  const beforeGlass = canyonGlassWalls([wall], [], { eye, solids: [solid], frameEye: false }).length;
  const afterGlass = canyonGlassWalls([wall], [], { eye, solids: [solid] }).length;
  const bare = canyonGlassWalls([wall], [], { eye }).length;
  const colors = [
    NULL_FILL,
    NULL_FILL,
    NULL_FILL,
    PHOTO,
    [28, 40, 56],
    [36, 48, 66]
  ];
  const uvs = [
    [0.04, 0.06],
    [0.08, 0.05],
    [0.06, 0.1],
    [0.72, 0.64],
    [0.78, 0.66],
    [0.74, 0.7]
  ];
  const sealed = landsdSealFarNullTriangles(
    [0, 1, 2, 3, 4, 5],
    (vertex) => colors[vertex],
    null,
    (vertex) => uvs[vertex],
    6
  );
  const sealUv = sealed.copies[0] || null;
  const width = 96;
  const height = 36;
  const curtainW = 64;
  const before = new Uint8ClampedArray(width * height * 4);
  const after = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) {
    const stripe = (py & 1) === 0 ? CURTAIN_A : CURTAIN_B;
    for (let px = 0; px < width; px++) {
      if (px < curtainW) {
        paint(before, width, px, py, beforeGlass ? stripe : PHOTO);
        paint(after, width, px, py, afterGlass ? stripe : PHOTO);
      } else {
        paint(before, width, px, py, NULL_FILL);
        paint(after, width, px, py, sealUv && sealUv.u > 0.5 ? PHOTO : NULL_FILL);
      }
    }
  }
  const ndc = projectChaseNdc(pose, { x: wall.x, y: y + 4, z: wall.z });
  const grainBefore = keithEyeGrain(before, width, height);
  const grainAfter = keithEyeGrain(after, width, height);
  return {
    along,
    side,
    frameHalf: digit1EyeFrameHalf(along),
    corridorHalf: 72,
    beforeGlass,
    afterGlass,
    bareGlass: bare,
    width,
    height,
    ndcX: ndc.ndcX,
    ndcY: ndc.ndcY,
    depth: ndc.depth,
    sealed: sealed.sealed,
    sealU: sealUv ? sealUv.u : 0,
    sealV: sealUv ? sealUv.v : 0,
    mad: keithEyeMad(before, after, width, height),
    curtainMad: regionMad(before, after, width, height, 0, curtainW),
    sealMad: regionMad(before, after, width, height, curtainW, width),
    grainBefore,
    grainAfter,
    grainDelta: grainAfter - grainBefore
  };
}
