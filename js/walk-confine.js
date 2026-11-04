import { HK_STREET_EYE, HK_WALK_RADIUS } from './city-config.js';

// Person body radius (controllers.js uses 0.48). The body centre stays this far inside the disc.
const WALK_BODY_INSET = 0.5;

function createWalkFence(eye = HK_STREET_EYE, radius = HK_WALK_RADIUS) {
  return Object.freeze({ x: eye.x, z: eye.z, radius });
}

// ?confine=off|0|false|no leaves the person free (MSI/dev escape). ?confine=on keeps the fence and shows the debug disc.
function parseWalkConfineRequest(href) {
  let value = null;
  try {
    value = new URL(href).searchParams.get('confine');
  } catch { /* A bad URL keeps the default fence. */ }
  const flag = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const off = ['off', '0', 'false', 'no'].includes(flag);
  return { enabled: !off, debug: flag === 'on' };
}

function walkFenceContains(fence, x, z) {
  return Math.hypot(x - fence.x, z - fence.z) <= fence.radius - WALK_BODY_INSET;
}

// Project onto the circle when outside, so tangential motion survives and the walker slides along the fence.
function confineToWalkFence(fence, x, z) {
  if (!fence) return { x, z, clamped: false };
  const limit = fence.radius - WALK_BODY_INSET;
  const dx = x - fence.x;
  const dz = z - fence.z;
  const d = Math.hypot(dx, dz);
  if (d <= limit) return { x, z, clamped: false };
  if (d === 0 || !Number.isFinite(d)) return { x: fence.x, z: fence.z, clamped: true };
  const k = limit / d;
  return { x: fence.x + dx * k, z: fence.z + dz * k, clamped: true };
}

export { WALK_BODY_INSET, createWalkFence, parseWalkConfineRequest, walkFenceContains, confineToWalkFence };
