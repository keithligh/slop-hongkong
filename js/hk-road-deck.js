// Central carriageway deck from the LandsD / OSM centreline.
// A tagged width is the carriageway. Class floors apply only when the tag is
// missing or a hairline, so a 3–5 m Central street is not widened into an avenue.
// Parallel parts of the same street (Des Voeux is several) contribute asphalt,
// and only the outer curb and the wider carriageway's paint are kept.

export const HK_CURB_W = 0.42;
// Granite upstand. Narrower than HK_CURB_W, which stays the canyon margin.
// The rest of that 0.42 m is sidewalk, meeting the back of this stone.
export const HK_KERB_STONE = 0.18;
// Narrow walk. The building face sits on the outer edge of this, not a setback.
export const HK_WALK_W = 2.05;
const CURB_W = HK_CURB_W;
const WALK_W = HK_WALK_W;
const CORE_MARGIN = 28;
const MIN_LEN = 0.8;
const JUNCTION_CELL = 6;

function round1(value) {
  return Math.round(value * 10) / 10;
}

export function carriagewayWidth({ w = 0, lanes = 0, highway = false } = {}) {
  const tagged = Number.isFinite(+w) ? +w : 0;
  const laneCount = Number.isFinite(+lanes) ? Math.max(0, Math.round(+lanes)) : 0;
  const fromLanes = laneCount >= 1 ? laneCount * 3.05 : 0;
  let floor = 3.6;
  if (laneCount >= 4) floor = 9.6;
  else if (laneCount >= 3) floor = 7.8;
  else if (laneCount >= 2) floor = 5.8;
  // Highways keep a floor so a bad tag cannot turn Connaught into a lane.
  // Every other tagged street keeps the tag, including a 3 m hill street.
  if (highway) return Math.min(22, round1(Math.max(10.5, tagged, fromLanes)));
  if (tagged >= 3.2) return Math.min(22, round1(tagged));
  const width = Math.max(floor, fromLanes);
  if (!Number.isFinite(width) || width <= 0) return 3.6;
  return Math.min(22, round1(width));
}

export function isTwoWay(dir) {
  return dir == null || dir === '' || dir === 0 || dir === '0' || dir === 'TW' || dir === 'tw' || dir === 'both';
}

export function segmentFrame(ax, az, bx, bz, minLen = MIN_LEN) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (!(len >= minLen)) return null;
  const ux = dx / len;
  const uz = dz / len;
  return {
    x: (ax + bx) * 0.5,
    z: (az + bz) * 0.5,
    len,
    yaw: Math.atan2(dx, dz),
    dx: ux,
    dz: uz,
    rx: -uz,
    rz: ux
  };
}

function stripe(role, color, offset, width, u0, u1, dash = 0) {
  return { role, color, offset, width, u0, u1, dash, duty: 0.5, across: false };
}

function across(role, color, width, u0, u1) {
  return { role, color, offset: 0, width, u0, u1, dash: 0, duty: 1, across: true };
}

export function markingLayout({ width, lanes, dir, length, junctionStart = false, junctionEnd = false }) {
  if (!(length >= 2.5) || !(width >= 4)) return [];
  const marks = [];
  const laneCount = Math.max(1, Math.round(+lanes) || 1);
  const edge = width * 0.5 - 0.62;
  if (edge > 0.4) {
    marks.push(stripe('edge', 'white', edge, 0.22, 0.6, length - 0.6));
    marks.push(stripe('edge', 'white', -edge, 0.22, 0.6, length - 0.6));
  }
  if (isTwoWay(dir)) {
    marks.push(stripe('centre', 'yellow', 0.16, 0.15, 0.4, length - 0.4));
    marks.push(stripe('centre', 'yellow', -0.16, 0.15, 0.4, length - 0.4));
    const perSide = Math.max(1, Math.round(laneCount / 2));
    if (perSide >= 2) {
      for (let i = 1; i < perSide; i++) {
        const off = (i / perSide) * (width * 0.5 - 0.9);
        marks.push(stripe('lane', 'white', off, 0.18, 0, length, 9));
        marks.push(stripe('lane', 'white', -off, 0.18, 0, length, 9));
      }
    }
  } else if (laneCount >= 2) {
    for (let i = 1; i < laneCount; i++) {
      const off = -width * 0.5 + (i * width) / laneCount;
      marks.push(stripe('lane', 'white', off, 0.18, 0, length, 9));
    }
  } else {
    marks.push(stripe('lane', 'white', 0, 0.18, 0, length, 9));
  }
  const stopW = Math.max(1.2, width - 1.5);
  if (junctionEnd) marks.push(across('stop', 'white', stopW, length - 1.05, length - 0.45));
  if (junctionStart) marks.push(across('stop', 'white', stopW, 0.45, 1.05));
  if (width >= 9 && (junctionStart || junctionEnd)) {
    const boxW = Math.max(1.4, width - 2.2);
    const approaches = [];
    if (junctionEnd) approaches.push(length - 8.2);
    if (junctionStart) approaches.push(1.4);
    for (const u0 of approaches) {
      if (u0 < 0.4 || u0 + 6 > length - 0.2) continue;
      for (let k = 0; k < 4; k++) {
        const u = u0 + k * 1.55;
        marks.push(across('box', 'yellow', boxW, u, u + 0.32));
      }
    }
  }
  return marks.filter((mark) => mark.u1 - mark.u0 >= 0.12 && mark.width >= 0.08);
}

export function expandDashes(mark) {
  if (!mark.dash) return [mark];
  const period = mark.dash;
  const duty = mark.duty ?? 0.5;
  const paint = period * duty;
  const out = [];
  let u = mark.u0 + (period - paint) * 0.5;
  while (u < mark.u1 - 0.15) {
    const u1 = Math.min(mark.u1, u + paint);
    if (u1 - u >= 0.8) out.push({ ...mark, u0: u, u1, dash: 0 });
    u += period;
  }
  return out;
}

export function markingPose(frame, mark) {
  const u = (mark.u0 + mark.u1) * 0.5;
  const along = u - frame.len * 0.5;
  const lateral = mark.offset || 0;
  return {
    x: frame.x + frame.dx * along + frame.rx * lateral,
    z: frame.z + frame.dz * along + frame.rz * lateral,
    yaw: frame.yaw,
    w: mark.width,
    len: mark.u1 - mark.u0,
    color: mark.color,
    role: mark.role
  };
}

function hitsCore(ax, az, bx, bz, box) {
  if (!box) return false;
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minZ = Math.min(az, bz);
  const maxZ = Math.max(az, bz);
  return maxX >= box.minX - CORE_MARGIN && minX <= box.maxX + CORE_MARGIN
    && maxZ >= box.minZ - CORE_MARGIN && minZ <= box.maxZ + CORE_MARGIN;
}

function laneCountOf(lanes, width) {
  const n = Math.round(+lanes);
  if (n >= 1 && n < 12) return n;
  return Math.max(1, Math.round(width / 3.4));
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

function cellKey(x, z) {
  return `${Math.round(x / JUNCTION_CELL)}:${Math.round(z / JUNCTION_CELL)}`;
}

function asphaltIndex(segs, cell = 24) {
  const grid = new Map();
  for (const seg of segs) {
    const ix0 = Math.floor((Math.min(seg.ax, seg.bx) - seg.half) / cell);
    const ix1 = Math.floor((Math.max(seg.ax, seg.bx) + seg.half) / cell);
    const iz0 = Math.floor((Math.min(seg.az, seg.bz) - seg.half) / cell);
    const iz1 = Math.floor((Math.max(seg.az, seg.bz) + seg.half) / cell);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = `${ix}:${iz}`;
        let bucket = grid.get(key);
        if (!bucket) grid.set(key, (bucket = []));
        bucket.push(seg);
      }
    }
  }
  return { grid, cell };
}

function coveredByAsphalt(x, z, index) {
  const bucket = index.grid.get(`${Math.floor(x / index.cell)}:${Math.floor(z / index.cell)}`);
  if (!bucket) return false;
  for (const seg of bucket) {
    if (distToSeg(x, z, seg) < seg.half - 0.25) return true;
  }
  return false;
}

function sidePose(seg, sign, slabW, extra, extend) {
  const inset = seg.half + extra;
  return {
    x: seg.x + seg.rx * sign * inset,
    z: seg.z + seg.rz * sign * inset,
    yaw: seg.yaw,
    w: slabW,
    len: Math.max(0.6, seg.len + extend)
  };
}

function suppressed(seg, segs) {
  for (const other of segs) {
    if (other === seg || other.name !== seg.name || !other.core) continue;
    const dist = distToSeg(seg.x, seg.z, other);
    if (dist < 0.4 || dist > (seg.width + other.width) * 0.45) continue;
    const closeWidth = Math.abs(other.width - seg.width) <= 0.4;
    const otherWins = other.width > seg.width + 0.4
      || (closeWidth && (other.len > seg.len + 1 || (Math.abs(other.len - seg.len) <= 1 && other.id < seg.id)));
    if (otherWins) return true;
  }
  return false;
}

export function planHkRoadDeck(roads, coreBox) {
  const asphalt = [];
  const sidewalks = [];
  const curbs = [];
  const markings = [];
  const segs = [];
  let id = 0;
  for (const road of roads || []) {
    const width = carriagewayWidth(road);
    const pts = road.pts || [];
    const name = road.name || road.raw || '';
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a || !b) continue;
      const frame = segmentFrame(a.x, a.z, b.x, b.z);
      if (!frame) continue;
      segs.push({
        ...frame,
        id: id++,
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        name,
        width,
        half: width * 0.5,
        lanes: laneCountOf(road.lanes, width),
        dir: road.dir,
        core: hitsCore(a.x, a.z, b.x, b.z, coreBox)
      });
    }
  }

  const coreSegs = segs.filter((seg) => seg.core);
  const ends = new Map();
  for (const seg of coreSegs) {
    for (const [x, z] of [[seg.ax, seg.az], [seg.bx, seg.bz]]) {
      const key = cellKey(x, z);
      let bucket = ends.get(key);
      if (!bucket) ends.set(key, (bucket = new Map()));
      bucket.set(seg.id, seg);
    }
  }
  const junctionAt = (x, z) => {
    const bucket = ends.get(cellKey(x, z));
    if (!bucket || bucket.size < 2) return false;
    const names = new Set();
    for (const seg of bucket.values()) names.add(seg.name);
    return bucket.size >= 3 || names.size >= 2;
  };
  const cover = asphaltIndex(coreSegs);

  for (const seg of segs) {
    const extend = Math.min(seg.width * 0.36, 5);
    asphalt.push({
      x: seg.x,
      z: seg.z,
      yaw: seg.yaw,
      w: seg.width,
      len: seg.len + extend,
      name: seg.name
    });
    const walkExtend = seg.core ? Math.min(seg.width * 0.12, 1.6) : Math.min(seg.width * 0.2, 2.2);
    for (const sign of [1, -1]) {
      const walkW = WALK_W + (CURB_W - HK_KERB_STONE);
      const walk = sidePose(seg, sign, walkW, HK_KERB_STONE + walkW * 0.5, walkExtend);
      if (seg.core && coveredByAsphalt(walk.x, walk.z, cover)) continue;
      sidewalks.push(walk);
      if (!seg.core || seg.len < 2) continue;
      const curb = sidePose(seg, sign, HK_KERB_STONE, HK_KERB_STONE * 0.5, -1.4);
      if (curb.len < 0.8) continue;
      if (coveredByAsphalt(curb.x, curb.z, cover)) continue;
      curbs.push(curb);
    }
    if (!seg.core || seg.len < 4 || suppressed(seg, coreSegs)) continue;
    const layout = markingLayout({
      width: seg.width,
      lanes: seg.lanes,
      dir: seg.dir,
      length: seg.len,
      junctionStart: junctionAt(seg.ax, seg.az),
      junctionEnd: junctionAt(seg.bx, seg.bz)
    });
    for (const mark of layout) {
      for (const piece of expandDashes(mark)) markings.push(markingPose(seg, piece));
    }
  }

  return { asphalt, sidewalks, curbs, markings };
}
