// Central street canyon. The carriageway keeps its tagged width. Past a narrow
// curb and sidewalk the next thing is a podium, either meeting a LandsD
// footprint or standing in for a side that has none. There is no plaza fill
// and no lawn verge. Victoria Harbour stays outside the island ring.

import { digit1ChasePose } from './digit1-probe-frame.js';
import { carriagewayWidth, HK_CURB_W, HK_WALK_W, segmentFrame } from './hk-road-deck.js';

export const HK_CANYON_DEPTH = 12;
export const HK_CANYON_HEIGHT = 18;
export const HK_CANYON_REACH = 22;

// Same footprint set the street-wall mesh uses. Neon placement calls this so a
// sign cannot drift onto a lot the canyon builder skipped.
export function hkCanyonBuildings(blocks, core) {
  const buildings = [];
  if (!core) return buildings;
  const minX = core.minX - 40;
  const maxX = core.maxX + 40;
  const minZ = core.minZ - 40;
  const maxZ = core.maxZ + 40;
  for (const b of blocks || []) {
    if (!b || b.park > 0.6 || b.median || !(b.height > 0) || !b.poly || b.poly.length < 3) continue;
    if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
    buildings.push(b);
  }
  return buildings;
}
const MIN_LEN = 5.5;
const END_GAP = 1.15;
const BITE = 0.3;
const CELL = 28;

export function pointInRing(x, z, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function hitsBox(ax, az, bx, bz, box) {
  if (!box) return true;
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minZ = Math.min(az, bz);
  const maxZ = Math.max(az, bz);
  return maxX >= box.minX && minX <= box.maxX && maxZ >= box.minZ && minZ <= box.maxZ;
}

function distToSeg(px, pz, seg) {
  const dx = seg.bx - seg.ax;
  const dz = seg.bz - seg.az;
  const len2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - seg.ax) * dx + (pz - seg.az) * dz) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (seg.ax + t * dx), pz - (seg.az + t * dz));
}

function cellKey(x, z, cell) {
  return `${Math.floor(x / cell)}:${Math.floor(z / cell)}`;
}

function buildGrid(items, boundsOf, cell) {
  const grid = new Map();
  for (const item of items) {
    const box = boundsOf(item);
    const ix0 = Math.floor(box.minX / cell);
    const ix1 = Math.floor(box.maxX / cell);
    const iz0 = Math.floor(box.minZ / cell);
    const iz1 = Math.floor(box.maxZ / cell);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = `${ix}:${iz}`;
        let bucket = grid.get(key);
        if (!bucket) grid.set(key, (bucket = []));
        bucket.push(item);
      }
    }
  }
  return grid;
}

function footprintAt(x, z, grid) {
  const bucket = grid.get(cellKey(x, z, CELL));
  if (!bucket) return null;
  for (const b of bucket) {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (pointInRing(x, z, b.poly)) return b;
  }
  return null;
}

function insideOtherAsphalt(x, z, grid, selfId) {
  const bucket = grid.get(cellKey(x, z, 24));
  if (!bucket) return false;
  for (const seg of bucket) {
    if (seg.id === selfId) continue;
    if (distToSeg(x, z, seg) < seg.half - 0.35) return true;
  }
  return false;
}

function obbOf(x, z, yaw, depth, len) {
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const hx = depth * 0.5;
  const hz = len * 0.5;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const lx of [hx, -hx]) {
    for (const lz of [hz, -hz]) {
      const wx = x + lx * cs + lz * sn;
      const wz = z - lx * sn + lz * cs;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    obb: { cx: x, cz: z, cs, sn, hx, hz }
  };
}

function frontage(seg, sign, buildings, asphalt, island, walk, curb, depth, reach) {
  const sidewalkOuter = seg.half + curb + walk;
  let hit = null;
  const limit = seg.half + reach;
  for (let d = seg.half + 0.4; d <= limit; d += 1.5) {
    const x = seg.x + seg.rx * sign * d;
    const z = seg.z + seg.rz * sign * d;
    const found = footprintAt(x, z, buildings);
    if (found) {
      hit = d;
      break;
    }
  }
  let wallDepth = depth;
  if (hit != null) {
    const gap = hit - sidewalkOuter;
    if (gap <= 0.8) return null;
    wallDepth = gap <= depth + 6 ? gap + BITE : depth;
  }
  wallDepth = Math.min(depth + 6, Math.max(wallDepth, 0));
  const tries = [wallDepth, Math.min(wallDepth, depth), 8, 5, 3.2];
  for (const candidate of tries) {
    if (candidate < 1.5 || candidate > wallDepth + 0.01) continue;
    const mid = sidewalkOuter - 0.12 + candidate * 0.5;
    const outer = sidewalkOuter - 0.12 + candidate;
    const mx = seg.x + seg.rx * sign * mid;
    const mz = seg.z + seg.rz * sign * mid;
    const ox = seg.x + seg.rx * sign * outer;
    const oz = seg.z + seg.rz * sign * outer;
    if (island && (!pointInRing(mx, mz, island) || !pointInRing(ox, oz, island))) continue;
    if (insideOtherAsphalt(mx, mz, asphalt, seg.id) || insideOtherAsphalt(ox, oz, asphalt, seg.id)) continue;
    const len = seg.len - END_GAP * 2;
    if (len < 3.2) return null;
    const box = obbOf(mx, mz, seg.yaw, candidate, len);
    return {
      x: mx,
      z: mz,
      yaw: seg.yaw,
      depth: candidate,
      len,
      side: sign,
      rx: seg.rx,
      rz: seg.rz,
      dx: seg.dx,
      dz: seg.dz,
      raw: seg.raw || '',
      highway: !!seg.highway,
      narrow: seg.half < 4.5,
      ...box
    };
  }
  return null;
}

export function planHkStreetCanyon({
  roads,
  buildings,
  core,
  island,
  walk = HK_WALK_W,
  curb = HK_CURB_W,
  depth = HK_CANYON_DEPTH,
  reach = HK_CANYON_REACH
} = {}) {
  const segs = [];
  let id = 0;
  for (const road of roads || []) {
    const width = carriagewayWidth(road);
    const pts = road.pts || [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a || !b) continue;
      if (!hitsBox(a.x, a.z, b.x, b.z, core)) continue;
      const frame = segmentFrame(a.x, a.z, b.x, b.z, MIN_LEN);
      if (!frame) continue;
      segs.push({
        ...frame,
        id: id++,
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        half: width * 0.5,
        raw: road.raw || '',
        highway: !!road.highway
      });
    }
  }
  const asphalt = buildGrid(
    segs,
    (seg) => ({
      minX: Math.min(seg.ax, seg.bx) - seg.half,
      maxX: Math.max(seg.ax, seg.bx) + seg.half,
      minZ: Math.min(seg.az, seg.bz) - seg.half,
      maxZ: Math.max(seg.az, seg.bz) + seg.half
    }),
    24
  );
  const footprints = (buildings || []).filter((b) => b && b.poly && b.poly.length >= 3 && b.maxX > b.minX && b.maxZ > b.minZ);
  const blocks = buildGrid(footprints, (b) => b, CELL);
  const walls = [];
  for (const seg of segs) {
    if (island && !pointInRing(seg.x, seg.z, island)) continue;
    for (const sign of [1, -1]) {
      const wall = frontage(seg, sign, blocks, asphalt, island, walk, curb, depth, reach);
      if (wall) walls.push(wall);
    }
  }
  return { walls };
}

function boxClosestDistance(box, eye) {
  const x = Math.max(box.minX, Math.min(eye.x, box.maxX));
  const z = Math.max(box.minZ, Math.min(eye.z, box.maxZ));
  return Math.hypot(x - eye.x, z - eye.z);
}

function hitsMesh(x, z, meshes, margin) {
  return meshes.some((mesh) => (
    x >= mesh.minX - margin && x <= mesh.maxX + margin
    && z >= mesh.minZ - margin && z <= mesh.maxZ + margin
  ));
}

function distToMesh(x, z, meshes) {
  let best = Infinity;
  for (const mesh of meshes) {
    const cx = Math.max(mesh.minX, Math.min(x, mesh.maxX));
    const cz = Math.max(mesh.minZ, Math.min(z, mesh.maxZ));
    const d = Math.hypot(x - cx, z - cz);
    if (d < best) best = d;
  }
  return best;
}

// Drop invented street wall where a LandsD mesh covers the centreline, the
// outer face, or the slab itself. A 12 m ribbon can sit entirely in front of
// the photograph: the centreline misses the mesh, and so does the face that
// points at the lot the ribbon was built for, while the body still covers the
// shopfront. Half the depth plus `margin` is that body. A gap with no mesh
// behind it keeps its wall. When `eye` is set and a mesh lies within `near`
// of it, the same disc is dropped too.
export function clipCanyonWalls(walls, meshes, { margin = 3, sample = 4, minLen = 3.2, eye = null, near = 80 } = {}) {
  if (!meshes?.length) return (walls || []).slice();
  const killNear = !!(eye && meshes.some((mesh) => boxClosestDistance(mesh, eye) <= near));
  const out = [];
  for (const wall of walls || []) {
    if (!wall || !Number.isFinite(wall.dx) || !Number.isFinite(wall.dz) || !(wall.len > 0)) {
      if (wall) out.push(wall);
      continue;
    }
    const half = wall.len * 0.5;
    const steps = Math.max(1, Math.ceil(wall.len / sample));
    const dt = wall.len / steps;
    const covered = [];
    for (let i = 0; i < steps; i++) {
      const t = -half + (i + 0.5) * dt;
      const x = wall.x + wall.dx * t;
      const z = wall.z + wall.dz * t;
      const reach = wall.depth > 0 && Number.isFinite(wall.rx) && Number.isFinite(wall.side) ? wall.depth * 0.5 : 0;
      const ox = x + (wall.rx || 0) * (wall.side || 0) * reach;
      const oz = z + (wall.rz || 0) * (wall.side || 0) * reach;
      // The ribbon is a slab. Its centreline can miss the photograph while the
      // body still stands in front of the shopfront. Half the depth is the
      // slab; `margin` is the gap that still reads as one podium.
      const inMesh = distToMesh(x, z, meshes) <= reach + margin
        || hitsMesh(x, z, meshes, margin)
        || (reach > 0 && hitsMesh(ox, oz, meshes, margin));
      const inEye = killNear && Math.hypot(x - eye.x, z - eye.z) <= near;
      covered.push(inMesh || inEye);
    }
    let i = 0;
    while (i < steps) {
      if (covered[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < steps && !covered[j]) j++;
      const t0 = -half + i * dt;
      const t1 = -half + j * dt;
      const len = t1 - t0;
      if (len >= minLen) {
        const mid = (t0 + t1) * 0.5;
        const x = wall.x + wall.dx * mid;
        const z = wall.z + wall.dz * mid;
        out.push({
          ...wall,
          x,
          z,
          len,
          ...obbOf(x, z, wall.yaw, wall.depth, len)
        });
      }
      i = j;
    }
  }
  return out;
}

function chaseLook(eye) {
  const pose = digit1ChasePose({
    x: eye?.x ?? -1.4,
    z: eye?.z ?? 29.3,
    heading: Number.isFinite(eye?.heading) ? eye.heading : 1.29
  });
  return { origin: pose.cam };
}

function lookFrame(x, z, eye) {
  const heading = Number.isFinite(eye?.heading) ? eye.heading : 1.29;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const dx = x - (eye?.x ?? -1.4);
  const dz = z - (eye?.z ?? 29.3);
  return {
    along: dx * fx + dz * fz,
    side: dx * -fz + dz * fx
  };
}

function meshRiseBox(mesh, sidewalk) {
  if (!mesh || !Number.isFinite(mesh.minX)) return null;
  const rise = Number.isFinite(mesh.maxH) && Number.isFinite(mesh.minH) ? mesh.maxH - mesh.minH : null;
  if (!(rise > 0)) return null;
  return {
    minX: mesh.minX,
    maxX: mesh.maxX,
    minZ: mesh.minZ,
    maxZ: mesh.maxZ,
    minY: sidewalk,
    maxY: sidewalk + rise
  };
}

function rayAabb(origin, dir, box) {
  let t0 = 0;
  let t1 = Infinity;
  const axes = [
    ['x', 'minX', 'maxX'],
    ['y', 'minY', 'maxY'],
    ['z', 'minZ', 'maxZ']
  ];
  for (const [key, lo, hi] of axes) {
    const delta = dir[key];
    if (Math.abs(delta) < 1e-9) {
      if (origin[key] < box[lo] || origin[key] > box[hi]) return null;
      continue;
    }
    let ta = (box[lo] - origin[key]) / delta;
    let tb = (box[hi] - origin[key]) / delta;
    if (ta > tb) {
      const swap = ta;
      ta = tb;
      tb = swap;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t1 < t0) return null;
  }
  if (t1 < 0.2) return null;
  return t0 > 0.2 ? t0 : t1;
}

function glassPointHitsMesh(origin, dir, boxes, beyond, reach) {
  for (const box of boxes) {
    const t = rayAabb(origin, dir, box);
    if (t != null && t > beyond && t <= reach) return true;
  }
  return false;
}

// Closest point of a tall box to the ribbon's outer face. The box counts when
// that point lies on the lot side (not across the carriageway) and within
// `behind` metres. A facade beside the outward normal still counts: the camera
// ray often misses it. A box across the street has a negative lot component
// and does not.
function tallMeshBehindCell(x, z, wall, boxes, behind) {
  if (!(behind > 0)) return false;
  const nx = (wall.rx || 0) * (wall.side || 0);
  const nz = (wall.rz || 0) * (wall.side || 0);
  const span = Math.hypot(nx, nz);
  if (!(span > 0)) return false;
  const ux = nx / span;
  const uz = nz / span;
  const outer = wall.depth > 0 ? wall.depth * 0.5 : 0;
  const ax = x + ux * outer;
  const az = z + uz * outer;
  for (const box of boxes) {
    const cx = Math.max(box.minX, Math.min(ax, box.maxX));
    const cz = Math.max(box.minZ, Math.min(az, box.maxZ));
    const ox = cx - ax;
    const oz = cz - az;
    const along = ox * ux + oz * uz;
    if (along < -3) continue;
    if (Math.hypot(ox, oz) <= behind && along <= behind) return true;
  }
  return false;
}

// The retail belt stays where no LandsD box occupies the curb. The curtain
// above it does not. From the Des Voeux chase, a glass sample is omitted when
// a loaded mesh is the facade that curtain stands in for:
// - the look ray meets a mesh beyond the ribbon and within `cover`, or
// - a mesh that rises through the belt sits on the lot side of the cell,
//   within `behind` metres of the outer face (the ray can miss that box).
// A sample outside the look corridor, a short kiosk, or a far courtyard keeps
// its glass. Raising the 80 m disc is not this test: an empty curb just
// outside that disc keeps its shopfront.
export function canyonGlassWalls(walls, meshes, {
  eye = null,
  belt = 8.02,
  sidewalk = 0.22,
  sample = 4,
  minLen = 3.2,
  reach = 500,
  half = 72,
  // A box farther than this is not the street face the glass is hiding.
  // Henderson is about 230 m down the Des Voeux ray. A 100 m courtyard box
  // past 360 m can contain that ray and still have no triangle on it.
  cover = 260,
  // One block back from the outer face, including a facade beside the
  // outward normal. Past this the box is the next street.
  behind = 36,
  // The mesh has to occupy the curtain band. A rise that stops in the
  // shopfront is the kiosk case and does not delete the glass above it.
  tall = 1
} = {}) {
  const list = (meshes || []).map((mesh) => meshRiseBox(mesh, sidewalk)).filter(Boolean);
  if (!eye || !list.length) return (walls || []).slice();
  const tallBoxes = list.filter((box) => box.maxY > belt + tall);
  const look = chaseLook(eye);
  const out = [];
  for (const wall of walls || []) {
    if (!wall || !Number.isFinite(wall.dx) || !Number.isFinite(wall.dz) || !(wall.len > 0)) {
      if (wall) out.push(wall);
      continue;
    }
    const span = wall.len * 0.5;
    const steps = Math.max(1, Math.ceil(wall.len / sample));
    const dt = wall.len / steps;
    const drop = [];
    for (let i = 0; i < steps; i++) {
      const t = -span + (i + 0.5) * dt;
      const x = wall.x + wall.dx * t;
      const z = wall.z + wall.dz * t;
      const frame = lookFrame(x, z, eye);
      if (!(frame.along > 8 && frame.along <= reach && Math.abs(frame.side) <= half)) {
        drop.push(false);
        continue;
      }
      const y = belt + 1.2;
      const dx = x - look.origin.x;
      const dy = y - look.origin.y;
      const dz = z - look.origin.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
      const ray = glassPointHitsMesh(look.origin, dir, list, dist + 2, cover);
      const lot = tallMeshBehindCell(x, z, wall, tallBoxes, behind);
      drop.push(ray || lot);
    }
    let i = 0;
    while (i < steps) {
      if (drop[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < steps && !drop[j]) j++;
      const t0 = -span + i * dt;
      const t1 = -span + j * dt;
      const len = t1 - t0;
      if (len >= minLen) {
        const mid = (t0 + t1) * 0.5;
        const x = wall.x + wall.dx * mid;
        const z = wall.z + wall.dz * mid;
        out.push({
          ...wall,
          x,
          z,
          len,
          ...obbOf(x, z, wall.yaw, wall.depth, len)
        });
      }
      i = j;
    }
  }
  return out;
}
