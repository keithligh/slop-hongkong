// Central street canyon. The carriageway keeps its tagged width. Past a narrow
// curb and sidewalk the next thing is a podium, either meeting a LandsD
// footprint or standing in for a side that has none. There is no plaza fill
// and no lawn verge. Victoria Harbour stays outside the island ring.

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
