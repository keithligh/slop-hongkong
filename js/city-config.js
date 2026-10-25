import { GEO } from './geo-source.js';

// js/city-config.js
// The shipped page is Hong Kong: GEO comes from js/hk-geodata.js (true north, origin at Central).
// World frame: 1 unit = 1 m, x = east, z = south (north = -z).

const toPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};
const CUT_Z = GEO.frame.cutZ;
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Numbered streets: real z of every street (1st..~130th St) & its x-runs ([x0, x1, dir (+1 east / -1 west / 0 both),
// curb-to-curb roadway width])
// ---------------------------------------------------------------------------------------------------------------------
const STREET_BY_NUMBER = new Map(GEO.streets.map((s) => [s.n, s]));
function streetZ(n) {
  const s = STREET_BY_NUMBER.get(n);
  if (s) return s.z;
  // interpolate a missing number from its neighbours (~79.5 m per street)
  let lo = n - 1;
  let hi = n + 1;
  while (lo > 0 && !STREET_BY_NUMBER.has(lo)) lo--;
  while (hi < 300 && !STREET_BY_NUMBER.has(hi)) hi++;
  const a = STREET_BY_NUMBER.get(lo);
  const b = STREET_BY_NUMBER.get(hi);
  if (a && b) return a.z + ((n - lo) / (hi - lo)) * (b.z - a.z);
  return (42 - n) * 79.5;
}

// ---------------------------------------------------------------------------------------------------------------------
// Avenues (real x, extents along z, one-way direction: +1 southbound, -1 northbound, 0 two-way)
// ---------------------------------------------------------------------------------------------------------------------
function prettyName(n) {
  const m = /^(E|W)\s+(\d+)\s+ST$/.exec(n);
  if (m) return `${m[1]} ${ordinal(+m[2])} St`;
  return n.replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(\d+) (St|Ave)\b/g, (_, d, t) => `${ordinal(+d)} ${t}`);
}

const ALL_AVENUES = (GEO.avenues || []).map((a) => {
  const segs = a.segs;
  const main = segs.reduce((m, s) => (s.z1 - s.z0 > m.z1 - m.z0 ? s : m), segs[0]);
  return {
    id: a.id,
    x: a.x,
    name: a.label,
    short: a.label,
    dir: main.dir,
    width: main.w,
    sidewalk: 5.2,
    lanes: main.lanes,
    minZ: Math.min(...segs.map((s) => s.z0)),
    maxZ: Math.max(...segs.map((s) => s.z1)),
    segs,
    hasMedian: false,
    isSecondary: false,
    splitByCentralPark: false
  };
});
const AVENUE_BY_ID = new Map(ALL_AVENUES.map((a) => [a.id, a]));
const avenueX = (id) => {
  const avenue = AVENUE_BY_ID.get(String(id));
  return avenue ? avenue.x : 0;
};
function avenueNameAt(ave, z) {
  if (!ave.segs) return ave.short;
  for (const s of ave.segs) {
    if (z < s.z0 - 30 || z > s.z1 + 30) continue;
    for (const [a, b, n] of s.names) if (z >= a - 30 && z <= b + 30) return prettyName(n);
  }
  return ave.short;
}

const AVENUES = [];
const STREETS = [];

// Empty when the extract has no park rectangle. A zero box must not open the sky at the origin.
const CENTRAL_PARK_BOUNDS = { ...(GEO.centralPark && GEO.centralPark.bounds ? GEO.centralPark.bounds : { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }) };

// ---------------------------------------------------------------------------------------------------------------------
// Shoreline: Hong Kong Island (GEO.hongKongIsland) and Kowloon (GEO.kowloon).
// West / east x at a given z are the outermost bulkhead crossings of one landmass.
// ---------------------------------------------------------------------------------------------------------------------
const HONG_KONG_ISLAND_COASTLINE = toPts(GEO.hongKongIsland);
const KOWLOON_COASTLINE = Array.isArray(GEO.kowloon) && GEO.kowloon.length ? toPts(GEO.kowloon) : [];
function buildShore(P) {
  if (!P || P.length < 3) return null;
  const step = 2;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of P) {
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  z0 = Math.ceil(z0 / step) * step;
  const n = Math.floor((z1 - z0) / step) + 1;
  if (n < 2) return null;
  const west = new Float32Array(n).fill(NaN);
  const east = new Float32Array(n).fill(NaN);
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[j];
    const b = P[i];
    if (a.z === b.z) continue;
    const lo = Math.min(a.z, b.z);
    const hi = Math.max(a.z, b.z);
    for (let k = Math.max(0, Math.ceil((lo - z0) / step)); k < n && z0 + k * step < hi; k++) {
      const z = z0 + k * step + 1e-3;
      if (z < lo || z >= hi) continue;
      const x = a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z);
      if (!(west[k] <= x)) west[k] = x;
      if (!(east[k] >= x)) east[k] = x;
    }
  }
  // close any gaps (exactly horizontal runs) from the neighbours
  for (let k = 1; k < n; k++) if (Number.isNaN(west[k])) { west[k] = west[k - 1]; east[k] = east[k - 1]; }
  for (let k = n - 2; k >= 0; k--) if (Number.isNaN(west[k])) { west[k] = west[k + 1]; east[k] = east[k + 1]; }
  return { z0, step, n, west, east, z1 };
}
const SHORE = buildShore(HONG_KONG_ISLAND_COASTLINE);
const KOWLOON_SHORE = buildShore(KOWLOON_COASTLINE);

function sampleShore(shore, z) {
  const f = (z - shore.z0) / shore.step;
  const k = Math.max(0, Math.min(shore.n - 2, Math.floor(f)));
  const t = Math.max(0, Math.min(1, f - k));
  return {
    westX: shore.west[k] + (shore.west[k + 1] - shore.west[k]) * t,
    eastX: shore.east[k] + (shore.east[k + 1] - shore.east[k]) * t,
    insideZ: z >= shore.z0 && z <= shore.z1
  };
}

/**
 * West / east shore x at z. With no x, this is Hong Kong Island (clamped at its ends).
 * Pass x to prefer Kowloon when that point lies on the opposite shore, or when z is north
 * of the island and still on Kowloon.
 */
function getIslandBoundsAtZ(z, x) {
  const island = sampleShore(SHORE, z);
  if (x == null || !KOWLOON_SHORE) return { westX: island.westX, eastX: island.eastX };
  const kowloon = sampleShore(KOWLOON_SHORE, z);
  const on = (bounds) => bounds.insideZ && x > bounds.westX && x < bounds.eastX;
  if (on(kowloon) && !on(island)) return { westX: kowloon.westX, eastX: kowloon.eastX };
  if (!island.insideZ && kowloon.insideZ) return { westX: kowloon.westX, eastX: kowloon.eastX };
  return { westX: island.westX, eastX: island.eastX };
}

// ---------------------------------------------------------------------------------------------------------------------
// Broadway: the real centreline (north to south), its x at any z
// ---------------------------------------------------------------------------------------------------------------------
const BROADWAY_LINE = toPts(GEO.broadway);
function getBroadwayX(z) {
  const L = BROADWAY_LINE;
  if (L.length < 2) return L[0] ? L[0].x : 0;
  if (z <= L[0].z) return L[0].x;
  if (z >= L[L.length - 1].z) return L[L.length - 1].x;
  let lo = 0;
  let hi = L.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (L[mid].z <= z) lo = mid;
    else hi = mid;
  }
  const a = L[lo];
  const b = L[hi];
  return a.x + ((z - a.z) / Math.max(1e-6, b.z - a.z)) * (b.x - a.x);
}

// Numbered-avenue corridors are empty on the Hong Kong extract. Traffic uses GEO.roadGraph.
const ALL_STREETS = [];
const ROADS = GEO.roads.map(([name, w, dir, lanes, hw, flat]) => ({ name: prettyName(name), raw: name, w, dir, lanes, highway: !!hw, pts: toPts(flat) }));

// Nearest-road index (labels, sidewalk tests): uniform grid of road segments
const ROAD_CELL = 64;
const ROAD_GRID = new Map();
for (const r of ROADS) {
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const a = r.pts[i];
    const b = r.pts[i + 1];
    const seg = { r, ax: a.x, az: a.z, bx: b.x, bz: b.z };
    const ix0 = Math.floor(Math.min(a.x, b.x) / ROAD_CELL), ix1 = Math.floor(Math.max(a.x, b.x) / ROAD_CELL);
    const iz0 = Math.floor(Math.min(a.z, b.z) / ROAD_CELL), iz1 = Math.floor(Math.max(a.z, b.z) / ROAD_CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const k = ix * 100000 + iz;
      if (!ROAD_GRID.has(k)) ROAD_GRID.set(k, []);
      ROAD_GRID.get(k).push(seg);
    }
  }
}
/** Nearest roads to (x, z) within `radius`: [{ road, dist }] sorted by distance (one entry per road name) */
function nearestRoads(x, z, radius = 60) {
  const best = new Map();
  const ix0 = Math.floor((x - radius) / ROAD_CELL), ix1 = Math.floor((x + radius) / ROAD_CELL);
  const iz0 = Math.floor((z - radius) / ROAD_CELL), iz1 = Math.floor((z + radius) / ROAD_CELL);
  for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
    const list = ROAD_GRID.get(ix * 100000 + iz);
    if (!list) continue;
    for (const s of list) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
      const d = Math.hypot(s.ax + t * dx - x, s.az + t * dz - z);
      if (d > radius) continue;
      const prev = best.get(s.r.name);
      if (!prev || d < prev.dist) best.set(s.r.name, { road: s.r, dist: d, horizontal: Math.abs(dx) > Math.abs(dz) });
    }
  }
  return [...best.values()].sort((a, b) => a.dist - b.dist);
}

// ---------------------------------------------------------------------------------------------------------------------
// Central CBD, the only footprints the page extrudes. WGS84 degrees, south / west / north / east.
// Same local ENU as tools/geo-frame.mjs (theta from GEO.frame.bearingDeg, origin at LAT0/LON0).
// A null LandsD height is skipped: the lot stays on BLOCKS and no storey count is invented.
// ---------------------------------------------------------------------------------------------------------------------
const HK_CORE_BBOX = Object.freeze({
  south: 22.276,
  west: 114.150,
  north: 22.288,
  east: 114.170
});
const HK_NULL_HEIGHT = 'skip';
// Street faces prefer LandsD individualised sheets when hk-3d/<sheet>/manifest.json is present.
// 11-SW-9C covers Statue Square and Des Voeux looking east. 11-SW-8D is the dense sheet on the west side of that corner.
// 11-SW-14A is the pin sheet on the south edge of 9C. It holds the Bank of China Tower
// photograph (B346831557701063A0). Only a mesh that covers that plate is mounted from it.
// A missing manifest leaves the extrude fallback in place.
const HK_GLTF_SHEETS = Object.freeze(['11-SW-9C', '11-SW-8D', '11-SW-14A']);
const HK_GLTF_SHEET = HK_GLTF_SHEETS[0];
// Des Voeux eye for street proof and for which individualised meshes load first.
// Person chase, heading 1.29 rad, looking east along the carriageway. A flyover is not this camera.
const HK_STREET_EYE = Object.freeze({ x: -1.4, z: 29.3, heading: 1.29 });
const HK_STREET_NEAR = 80;
const HK_GLTF_TEX_NEAR = 120;
// The chase looks east-south-east. The Henderson is about 220 m down that ray,
// Fairmont House about 290 m, Lippo Centre about 380 m. A disc of 120 m leaves
// those street faces on a mip chain. The corridor is the look, not the whole disc:
// masses behind the camera stay on the far sampler.
const HK_GLTF_STREET_REACH = 500;
const HK_GLTF_STREET_HALF = 72;
const HK_GLTF_CAP = 200;

function hkCoreScale() {
  const lat0 = GEO.frame.lat0;
  const lon0 = GEO.frame.lon0;
  const phi0 = (lat0 * Math.PI) / 180;
  const sin0 = Math.sin(phi0);
  const A = 6378137.0;
  const E2 = 6.69437999014e-3;
  const nrad = A / Math.sqrt(1 - E2 * sin0 * sin0);
  const mrad = (A * (1 - E2)) / Math.pow(1 - E2 * sin0 * sin0, 1.5);
  const theta = ((GEO.frame.bearingDeg || 0) * Math.PI) / 180;
  return {
    lat0,
    lon0,
    kx: (Math.PI / 180) * nrad * Math.cos(phi0),
    ky: (Math.PI / 180) * mrad,
    c: Math.cos(theta),
    s: Math.sin(theta)
  };
}

function hkCoreProject(lon, lat) {
  const { lat0, lon0, kx, ky, c, s } = hkCoreScale();
  const east = (lon - lon0) * kx;
  const north = (lat - lat0) * ky;
  return [east * c - north * s, -(east * s + north * c)];
}

function hkCoreUnproject(x, z) {
  const { lat0, lon0, kx, ky, c, s } = hkCoreScale();
  const east = x * c - z * s;
  const north = -x * s - z * c;
  return { lon: lon0 + east / kx, lat: lat0 + north / ky };
}

function hkLonLatInCore(lon, lat) {
  return lat >= HK_CORE_BBOX.south && lat <= HK_CORE_BBOX.north
    && lon >= HK_CORE_BBOX.west && lon <= HK_CORE_BBOX.east;
}

const HK_CORE_WORLD = (() => {
  const corners = [
    [HK_CORE_BBOX.west, HK_CORE_BBOX.south],
    [HK_CORE_BBOX.east, HK_CORE_BBOX.south],
    [HK_CORE_BBOX.west, HK_CORE_BBOX.north],
    [HK_CORE_BBOX.east, HK_CORE_BBOX.north]
  ].map(([lon, lat]) => hkCoreProject(lon, lat));
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return Object.freeze({ minX, maxX, minZ, maxZ });
})();

function blockInHkCore(block, bounds = HK_CORE_WORLD) {
  return block.cx >= bounds.minX && block.cx <= bounds.maxX && block.cz >= bounds.minZ && block.cz <= bounds.maxZ;
}

function hkFootprintHeight(block) {
  if (typeof block.height === 'number' && block.height > 0) return block.height;
  switch (HK_NULL_HEIGHT) {
    case 'skip':
      return null;
    default: {
      const unknown = HK_NULL_HEIGHT;
      throw new Error(`Unhandled null-height policy ${unknown}`);
    }
  }
}

// Commercial storey used by the Central curtain wall. Podium height is a whole number of these
// storeys. Part heights always sum to the LandsD extrusion; a null height stays null.
const HK_CURTAIN_STOREY = 3.9;

function hkMassingPlan(block) {
  const height = hkFootprintHeight(block);
  if (!(height > 0)) return null;
  const span = Math.min(block.maxX - block.minX, block.maxZ - block.minZ);
  const long = Math.max(block.maxX - block.minX, block.maxZ - block.minZ);
  const id = block.id | 0;
  const podiumStoreys = 4 + (id % 3);
  const podiumH = podiumStoreys * HK_CURTAIN_STOREY;
  const setback = 0.74 + (id % 4) * 0.03;
  const glass = (role) => (role === 'podium' || (role === 'shaft' && height < 32)) ? 'podium' : `tower${id % 3}`;
  const supportsTower = height >= 52
    && span >= 26
    && long >= 34
    && height - podiumH >= HK_CURTAIN_STOREY * 4
    && span * setback >= 16;
  if (!supportsTower) {
    return {
      height,
      parts: [{ role: 'shaft', scale: 1, y0: 0, h: height, style: glass('shaft') }]
    };
  }
  return {
    height,
    parts: [
      { role: 'podium', scale: 1, y0: 0, h: podiumH, style: 'podium' },
      { role: 'tower', scale: setback, y0: podiumH, h: height - podiumH, style: glass('tower') }
    ]
  };
}

function hkScaleRing(pts, scale) {
  if (!(scale < 1) || !pts || pts.length < 3) return pts;
  let twiceArea = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cross = pts[j].x * pts[i].z - pts[i].x * pts[j].z;
    twiceArea += cross;
    cx += (pts[j].x + pts[i].x) * cross;
    cz += (pts[j].z + pts[i].z) * cross;
  }
  if (Math.abs(twiceArea) < 1e-3) {
    cx = 0;
    cz = 0;
    for (const p of pts) {
      cx += p.x;
      cz += p.z;
    }
    cx /= pts.length;
    cz /= pts.length;
  } else {
    cx /= 3 * twiceArea;
    cz /= 3 * twiceArea;
  }
  return pts.map((p) => ({
    x: cx + (p.x - cx) * scale,
    z: cz + (p.z - cz) * scale
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Blocks: every real curb island (raised sidewalk slab) with its lot rectangles inside the property line
//   poly: curb outline [{x, z}], rects: [[x0, x1, z0, z1], ...] building lots (axis-aligned; one for a grid block),
//   park: share covered by parkland (NYC Parks), parkName, rect: the island is an axis-aligned rectangle,
//   frames: irregular islands' lots laid out along the streets they front, [[θ, px, pz, rects], ...] (rects in a
//   frame turned by θ about (px, pz): world = p + R_y(θ)·(local − p)), or null
// ---------------------------------------------------------------------------------------------------------------------
const BLOCKS = GEO.blocks.map((tuple, id) => {
  const [flat, rects, park, parkName, isRect, frames, height, base, name] = tuple;
  const poly = toPts(flat);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, a = 0, cx = 0, cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[i], q = poly[j];
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    const c = q.x * p.z - p.x * q.z;
    a += c; cx += (q.x + p.x) * c; cz += (q.z + p.z) * c;
  }
  a *= 0.5;
  const area = Math.abs(a);
  // Hong Kong tuples append [height, base, name]. An empty lot list is filled with the
  // ring's bounding box so older rect walks still have an entry. That box overfills
  // rotated and L-shaped Central footprints. The page extrudes `poly`, not this rect.
  // Narrow HK footprints are buildings, not Park Avenue malls.
  let lotRects = rects && rects.length ? rects : [];
  if (GEO.frame.city === 'hk' && !lotRects.length && maxX > minX && maxZ > minZ) {
    lotRects = [[minX, maxX, minZ, maxZ]];
  }
  const hk = GEO.frame.city === 'hk';
  return {
    id, poly, rects: lotRects, frames: frames || null, park, parkName, rect: !!isRect, area,
    minX, maxX, minZ, maxZ,
    cx: a ? cx / (6 * a) : (minX + maxX) / 2,
    cz: a ? cz / (6 * a) : (minZ + maxZ) / 2,
    median: hk ? /Malls?$/.test(parkName || '') : (/Malls?$/.test(parkName || '') || Math.min(maxX - minX, maxZ - minZ) < 9),
    height: typeof height === 'number' ? height : null,
    base: typeof base === 'number' ? base : null,
    name: typeof name === 'string' ? name : ''
  };
});
// Spatial index of the blocks (64 m cells)
const BLOCK_CELL = 64;
const BLOCK_GRID = new Map();
for (const b of BLOCKS) {
  for (let ix = Math.floor(b.minX / BLOCK_CELL); ix <= Math.floor(b.maxX / BLOCK_CELL); ix++) {
    for (let iz = Math.floor(b.minZ / BLOCK_CELL); iz <= Math.floor(b.maxZ / BLOCK_CELL); iz++) {
      const k = ix * 100000 + iz;
      if (!BLOCK_GRID.has(k)) BLOCK_GRID.set(k, []);
      BLOCK_GRID.get(k).push(b);
    }
  }
}
function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
/** The block (curb island) under (x, z), or null on the roadway / in the water */
function blockAt(x, z) {
  const list = BLOCK_GRID.get(Math.floor(x / BLOCK_CELL) * 100000 + Math.floor(z / BLOCK_CELL));
  if (!list) return null;
  for (const b of list) {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (b.rect || pointInPoly(b.poly, x, z)) return b;
  }
  return null;
}
/** Blocks whose bounds overlap a rectangle */
function blocksInRect(minX, maxX, minZ, maxZ) {
  const out = new Set();
  for (let ix = Math.floor(minX / BLOCK_CELL); ix <= Math.floor(maxX / BLOCK_CELL); ix++) {
    for (let iz = Math.floor(minZ / BLOCK_CELL); iz <= Math.floor(maxZ / BLOCK_CELL); iz++) {
      const list = BLOCK_GRID.get(ix * 100000 + iz);
      if (list) for (const b of list) if (b.maxX > minX && b.minX < maxX && b.maxZ > minZ && b.minZ < maxZ) out.add(b);
    }
  }
  return [...out];
}

// Named Central places. Anchors are LandsD footprints or the OSM pier already in GEO.
// A gazetteer pin is kept only as a check against that anchor. Peak and the TST clock
// are outside HK_CORE_BBOX and stay deferred: no mesh is drawn for them.
const HK_LANDMARK_CATALOG = Object.freeze([
  {
    id: 'two-ifc',
    label: 'Two International Finance Centre',
    kind: 'two-ifc',
    landsd: { name: 'Two International Finance Centre', height: 378.5 },
    pin: {
      lat: 22.285291,
      lon: 114.159294,
      within: 8,
      source: '22.285291 N, 114.159294 E (Google Maps 22.285232, 114.159260; Wikidata Q14226100 22°17′7.4″N 114°9′32.8″E)'
    }
  },
  {
    id: 'one-ifc',
    label: 'One International Finance Centre',
    kind: 'one-ifc',
    landsd: { name: 'One International Finance Centre', height: 169.8 },
    pin: null,
    survey: 'LandsD BuildingNameEN One International Finance Centre, about 240 m west of Two IFC'
  },
  {
    id: 'boc',
    label: 'Bank of China Tower',
    kind: 'boc',
    ownsShaft: true,
    landsd: { name: 'Bank of China Tower', height: 303.3 },
    pin: {
      lat: 22.27917,
      lon: 114.16139,
      within: 8,
      source: 'Wikipedia Bank of China Tower, 22°16′45″N 114°09′41″E (22.27917 N, 114.16139 E). Roof 315 m, antenna 52.4 m, tip 367.4 m. LandsD plate is 303.3 m.'
    }
  },
  {
    id: 'one-exchange',
    label: 'One Exchange Square',
    kind: 'exchange',
    landsd: { name: 'One Exchange Square', height: 182.4 },
    pin: null,
    survey: 'LandsD BuildingNameEN One Exchange Square. Wikipedia Exchange Square 22.28389 N, 114.15833 E sits on Two Exchange Square.'
  },
  {
    id: 'two-exchange',
    label: 'Two Exchange Square',
    kind: 'exchange',
    landsd: { name: 'Two Exchange Square', height: 182.4 },
    pin: {
      lat: 22.28389,
      lon: 114.15833,
      within: 8,
      source: 'Wikipedia Exchange Square, 22°17′2″N 114°9′30″E (22.28389 N, 114.15833 E). Roof 188 m for towers 1 and 2.'
    }
  },
  {
    id: 'three-exchange',
    label: 'Three Exchange Square',
    kind: 'exchange',
    landsd: { name: 'Three Exchange Square', height: 137.5 },
    pin: null,
    survey: 'LandsD BuildingNameEN Three Exchange Square, the western tower of the complex'
  },
  {
    id: 'jardine',
    label: 'Jardine House',
    kind: 'jardine',
    landsd: { name: 'Jardine House', height: 178.3 },
    pin: {
      lat: 22.28306,
      lon: 114.15889,
      within: 8,
      source: 'Wikipedia Jardine House, 22°16′59″N 114°9′32″E (22.28306 N, 114.15889 E). Roof 178.5 m.'
    }
  },
  {
    id: 'cfa',
    label: 'Court of Final Appeal',
    kind: 'cfa',
    landsd: { name: 'The Court of Final Appeal', height: 18.6 },
    pin: {
      lat: 22.280996,
      lon: 114.160116,
      within: 8,
      source: 'Wikipedia Court of Final Appeal Building, 22°16′52″N 114°09′36″E (22.280996 N, 114.160116 E)'
    }
  },
  {
    id: 'star-ferry',
    label: 'Central Star Ferry Pier',
    kind: 'star-ferry',
    pierName: '中環天星碼頭 Central Star Ferry Pier',
    pin: null,
    survey: 'OSM pier 中環天星碼頭 Central Star Ferry Pier in the committed GEO.piers extract. Wikidata Q7600710 22°17′26″N is north of the box and is not used.'
  },
  {
    id: 'peak-tram',
    label: 'Peak Tram Central Terminus',
    kind: 'peak-tram',
    landsd: { name: "St. John's Building", height: 91.4 },
    pin: {
      lat: 22.277729,
      lon: 114.159172,
      within: 8,
      source: 'Wikipedia Central Terminus (Garden Road), 22°16′40″N 114°09′33″E, ground floor of St. John\'s Building'
    }
  },
  {
    id: 'victoria-peak',
    label: 'Victoria Peak',
    defer: true,
    pin: { lat: 22.27556, lon: 114.14389, source: 'Wikipedia Victoria Peak, 22°16′32″N 114°8′38″E' },
    reason: 'South and west of the Central box.'
  },
  {
    id: 'peak-terminus',
    label: 'Peak Tram upper terminus',
    defer: true,
    pin: { lat: 22.27104, lon: 114.14994, source: 'Wikipedia The Peak Terminus, 22°16′16″N 114°09′00″E' },
    reason: 'South and west of the Central box.'
  },
  {
    id: 'tst-clock',
    label: 'Tsim Sha Tsui Clock Tower',
    defer: true,
    pin: { lat: 22.2936778, lon: 114.1693639, source: 'Wikipedia Clock Tower, 22°17′37.24″N 114°10′09.71″E' },
    reason: 'North of the Central box.'
  }
]);

function hkMetresToRing(poly, x, z) {
  if (pointInPoly(poly, x, z)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j].x;
    const az = poly[j].z;
    const bx = poly[i].x;
    const bz = poly[i].z;
    const dx = bx - ax;
    const dz = bz - az;
    const length2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length2));
    best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z));
  }
  return best;
}

function hkPlanCorners(poly, cx, cz) {
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (const p of poly) {
    const dx = p.x - cx;
    const dz = p.z - cz;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const picks = [];
  for (const [ux, uz] of [[c, s], [-s, c]]) {
    let maxP = null;
    let minP = null;
    for (const p of poly) {
      const t = (p.x - cx) * ux + (p.z - cz) * uz;
      if (!maxP || t > maxP.t) maxP = { p, t };
      if (!minP || t < minP.t) minP = { p, t };
    }
    picks.push(maxP.p, minP.p);
  }
  const unique = [];
  for (const p of picks) {
    if (!unique.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.5)) unique.push(p);
  }
  unique.sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
  return unique;
}

function hkLandmarkOwnsShaft(block) {
  if (!block) return false;
  return HK_LANDMARK_CATALOG.some((spec) => spec.ownsShaft
    && spec.landsd
    && spec.landsd.name === block.name
    && spec.landsd.height === block.height);
}

function hkResolveLandmarks() {
  const placed = [];
  const deferred = [];
  for (const spec of HK_LANDMARK_CATALOG) {
    if (spec.defer) {
      const [x, z] = hkCoreProject(spec.pin.lon, spec.pin.lat);
      deferred.push({
        id: spec.id,
        label: spec.label,
        lat: spec.pin.lat,
        lon: spec.pin.lon,
        x,
        z,
        source: spec.pin.source,
        reason: spec.reason,
        inside: hkLonLatInCore(spec.pin.lon, spec.pin.lat)
      });
      continue;
    }
    let block = null;
    let pier = null;
    if (spec.landsd) {
      block = BLOCKS.find((b) => b.name === spec.landsd.name && b.height === spec.landsd.height) || null;
      if (!block) throw new Error(`LandsD landmark missing: ${spec.landsd.name}`);
    } else {
      pier = (GEO.piers || []).find((p) => p.name === spec.pierName) || null;
      if (!pier) throw new Error(`OSM pier missing: ${spec.pierName}`);
    }
    const x = block ? block.cx : pier.cx;
    const z = block ? block.cz : pier.cz;
    const { lon, lat } = hkCoreUnproject(x, z);
    const inside = hkLonLatInCore(lon, lat) && (block ? blockInHkCore(block) : true);
    let pinMetres = null;
    if (spec.pin) {
      const [px, pz] = hkCoreProject(spec.pin.lon, spec.pin.lat);
      pinMetres = block ? hkMetresToRing(block.poly, px, pz) : Math.hypot(px - x, pz - z);
    }
    const row = {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      lat,
      lon,
      x,
      z,
      height: block ? block.height : null,
      block,
      pier,
      pinMetres,
      pinWithin: spec.pin ? spec.pin.within : null,
      source: spec.pin ? spec.pin.source : spec.survey,
      inside
    };
    if (!inside) {
      deferred.push({
        id: spec.id,
        label: spec.label,
        lat,
        lon,
        x,
        z,
        source: row.source,
        reason: 'Anchor is outside the Central box.',
        inside: false
      });
      continue;
    }
    placed.push(row);
  }
  return { placed, deferred };
}

// Traditional Chinese street-name plates. Shop neon lives on the canyon face (hk-neon.js).
const HK_STREET_PLATES = new Map([
  ['DES VOEUX ROAD CENTRAL', '德輔道中'],
  ["QUEEN'S ROAD CENTRAL", '皇后大道中'],
  ["QUEEN'S ROAD WEST", '皇后大道西'],
  ['CONNAUGHT ROAD CENTRAL', '干諾道中'],
  ['CONNAUGHT ROAD WEST', '干諾道西'],
  ['CHATER ROAD', '遮打道'],
  ['PEDDER STREET', '畢打街'],
  ['ICE HOUSE STREET', '雪廠街'],
  ['WELLINGTON STREET', '威靈頓街'],
  ['HOLLYWOOD ROAD', '荷李活道'],
  ['QUEENSWAY', '金鐘道'],
  ['GARDEN ROAD', '花園道'],
  ['WYNDHAM STREET', '雲咸街'],
  ["D'AGUILAR STREET", '德己立街'],
  ['POTTINGER STREET', '砵甸乍街'],
  ['STANLEY STREET', '士丹利街'],
  ['WING LOK STREET', '永樂街'],
  ['BONHAM STRAND', '文咸東街'],
  ['QUEEN VICTORIA STREET', '域多利皇后街'],
  ['HARCOURT ROAD', '夏慤道'],
  ['COTTON TREE DRIVE', '紅棉路'],
  ['LYNDHURST TERRACE', '擺花街'],
  ['GAGE STREET', '結志街'],
  ['COCHRANE STREET', '閣麟街'],
  ['GRAHAM STREET', '嘉咸街'],
  ['ELGIN STREET', '伊利近街'],
  ['STAUNTON STREET', '士丹頓街'],
  ['PEEL STREET', '卑利街'],
  ['ABERDEEN STREET', '鴨巴甸街'],
  ['JUBILEE STREET', '租庇利街'],
  ['FINANCE STREET', '金融街'],
  ['MAN CHEUNG STREET', '民祥街'],
  ['EDINBURGH PLACE', '愛丁堡廣場'],
  ['LUNG WO ROAD', '龍和道'],
  ['TIM WA AVENUE', '添華道']
]);

function hkSignHash(x, z, salt) {
  const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 19.19) * 43758.5453;
  return s - Math.floor(s);
}

function hkCentralSignSites() {
  const core = HK_CORE_WORLD;
  const inCore = (x, z) => x >= core.minX && x <= core.maxX && z >= core.minZ && z <= core.maxZ;
  const occupied = new Set();
  const claim = (x, z) => {
    const key = `${Math.round(x / 5)}:${Math.round(z / 5)}`;
    if (occupied.has(key)) return false;
    occupied.add(key);
    return true;
  };
  const frontage = (x, z, nx, nz, side, half) => {
    let sidewalk = half + 0.45;
    for (const extra of [0.8, 2.2, 4.0, 6.5, 9]) {
      const off = half + extra;
      const sx = x + nx * side * off;
      const sz = z + nz * side * off;
      if (!inCore(sx, sz)) continue;
      const block = blockAt(sx, sz);
      if (!block || block.park > 0.6 || block.median || !blockInHkCore(block)) {
        sidewalk = off;
        continue;
      }
      const height = hkFootprintHeight(block);
      if (!(height > 4.5)) continue;
      return { block, height, off: sidewalk };
    }
    return null;
  };
  const sites = [];
  const plateRoads = [];
  for (const road of ROADS) {
    if (road.highway) continue;
    if (HK_STREET_PLATES.has(road.raw)) plateRoads.push(road);
  }
  const pushSite = (site) => {
    if (sites.length >= 3600) return false;
    if (!claim(site.x, site.z)) return false;
    sites.push(site);
    return true;
  };
  const walk = (roads, spacing, place) => {
    for (const road of roads) {
      if (sites.length >= 3600) return;
      const pts = road.pts;
      const half = Math.max(3.2, (road.w || 7.5) * 0.5);
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < spacing) continue;
        const nx = -dz / len;
        const nz = dx / len;
        const count = Math.floor(len / spacing);
        for (let s = 0; s < count; s++) {
          if (sites.length >= 3600) return;
          const t = (s + 0.5) / count;
          const x = a.x + dx * t;
          const z = a.z + dz * t;
          if (!inCore(x, z)) continue;
          for (const side of [1, -1]) {
            const hit = frontage(x, z, nx, nz, side, half);
            if (!hit) continue;
            const sx = x + nx * side * hit.off;
            const sz = z + nz * side * hit.off;
            if (!inCore(sx, sz)) continue;
            place({ road, x: sx, y: 0, z: sz, nx, nz, side, dx, dz, len, height: hit.height, along: s });
          }
        }
      }
    }
  };
  walk(plateRoads, 78, (at) => {
    if (at.side < 0) return;
    const label = HK_STREET_PLATES.get(at.road.raw);
    const hash = hkSignHash(at.x, at.z, 2);
    const y = Math.min(5.6 + hash * 0.4, at.height - 0.8);
    if (!(y > 3)) return;
    const rotY = Math.atan2(-at.nx * at.side, -at.nz * at.side);
    pushSite({
      kind: 'plate',
      text: label,
      bg: '#f4f1e8',
      fg: '#1b1b1b',
      x: at.x,
      y,
      z: at.z,
      rotY,
      w: 2.8,
      h: 0.78
    });
  });
  return sites;
}

// Neighbourhoods from the Hong Kong coast rings.
function districtAt(x, z) {
  if (pointInPoly(HONG_KONG_ISLAND_COASTLINE, x, z)) return Math.hypot(x, z) < 1200 ? 'hk_cbd' : 'hk_island';
  if (KOWLOON_COASTLINE.length && pointInPoly(KOWLOON_COASTLINE, x, z)) return 'hk_kowloon';
  return 'hk_harbour';
}
for (const b of BLOCKS) b.district = districtAt(b.cx, b.cz);

// ---------------------------------------------------------------------------------------------------------------------
// Landmarks (real footprints from OpenStreetMap: centre, grid-aligned width x depth, height)
// ---------------------------------------------------------------------------------------------------------------------
const LANDMARK_SITES = GEO.landmarks;
// Street-level arrivals. Heading 0 faces south (+z), PI north.
const TELEPORT_LOCATIONS = {
  central: { x: GEO.points.central[0], z: GEO.points.central[1], heading: Math.PI },
  tst: { x: GEO.points.tst[0], z: GEO.points.tst[1], heading: 0 },
  admiralty: { x: GEO.points.admiralty[0], z: GEO.points.admiralty[1], heading: Math.PI }
};
const PLACES = [
  { id: 'central', name: '中環', short: '中環', x: GEO.points.central[0], z: GEO.points.central[1], district: '香港島' },
  { id: 'tst', name: '尖沙咀', short: '尖沙咀', x: GEO.points.tst[0], z: GEO.points.tst[1], district: '九龍' },
  { id: 'admiralty', name: '金鐘', short: '金鐘', x: GEO.points.admiralty[0], z: GEO.points.admiralty[1], district: '香港島' }
];

function boundsOfRing(pts) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}
const HARBOUR_COASTLINES = ((GEO.harbour && GEO.harbour.rings) || []).map(toPts);
// Island + Kowloon + Victoria Harbour. The island ring alone is not the playable coast.
const ISLAND_BOUNDS = (() => {
  const boxes = [
    boundsOfRing(HONG_KONG_ISLAND_COASTLINE),
    boundsOfRing(KOWLOON_COASTLINE),
    ...HARBOUR_COASTLINES.map(boundsOfRing)
  ].filter((b) => Number.isFinite(b.minX));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
  }
  return { minX, maxX, minZ, maxZ, sidewalkHeight: 0.22, waterLevel: -2.2 };
})();
const PLAY_BOUNDS = ISLAND_BOUNDS;

// Opaque shopfront. Two curtain storeys above the sidewalk. Glass starts at this world Y.
const HK_RETAIL_BELT = ISLAND_BOUNDS.sidewalkHeight + HK_CURTAIN_STOREY * 2;

// Split a vertical extrusion so the street base is retail and glass starts at the belt.
// `ground` is the world Y of building y0 = 0 (the sidewalk the extrude sits on).
function hkRetailSlices(y0, h, style, ground = ISLAND_BOUNDS.sidewalkHeight) {
  if (!(h > 0)) return [];
  const bottom = ground + y0;
  const top = bottom + h;
  const cut = HK_RETAIL_BELT;
  if (bottom >= cut - 0.05) return [{ style, y0, h }];
  if (top <= cut + 0.05) return [{ style: 'retail', y0, h }];
  const beltH = cut - bottom;
  const glassH = h - beltH;
  if (beltH < 0.4 || glassH < 0.4) return [{ style: top <= cut ? 'retail' : style, y0, h }];
  return [
    { style: 'retail', y0, h: beltH },
    { style, y0: y0 + beltH, h: glassH }
  ];
}

const LANDMARK_BLOCKS = new Set();

function getLocationLabel(x, z) {
  for (const lm of PLACES) {
    if (Math.hypot(x - lm.x, z - lm.z) < 160) {
      const near = nearestRoads(x, z, 90);
      return near.length ? `${lm.name} · ${near[0].road.name}` : lm.name;
    }
  }
  const near = nearestRoads(x, z, 40);
  if (near.length && near[0].dist < near[0].road.w) return near[0].road.name;
  if (pointInPoly(HONG_KONG_ISLAND_COASTLINE, x, z)) return '香港島';
  if (KOWLOON_COASTLINE.length && pointInPoly(KOWLOON_COASTLINE, x, z)) return '九龍';
  return '維多利亞港';
}

// Keyboard shortcuts are ignored while typing into a form field (e.g. the map's street search box)
function isTypingInField(e) {
  return e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
}

// Traffic signal cycle shared by the signal heads (street-details.js) and the traffic (traffic.js), in seconds:
// avenues green until avenueAmber, amber until avenueRed; cross streets green from avenueRed until streetAmber,
// amber until the end of the cycle. Pedestrians cross with the traffic that runs parallel to them, stepping off
// only on the WALK, the first `walk` seconds of its green: long enough before the cross traffic's green for the
// slowest walker to get across the widest avenue.
const SIGNAL_TIMING = { cycle: 60, avenueAmber: 26, avenueRed: 30, streetAmber: 56, walk: 7 };

// 'green', 'amber' or 'red' for avenue or cross street traffic at a given time
function signalPhase(time, isAvenue) {
  const { cycle, avenueAmber, avenueRed, streetAmber } = SIGNAL_TIMING;
  const t = ((time % cycle) + cycle) % cycle;
  if (isAvenue) return t < avenueAmber ? 'green' : t < avenueRed ? 'amber' : 'red';
  return t < avenueRed ? 'red' : t < streetAmber ? 'green' : 'amber';
}

// Do pedestrians walking alongside avenue (or cross street) traffic have the WALK at a given time?
function walkSignal(time, isAvenue) {
  const { cycle, avenueRed, walk } = SIGNAL_TIMING;
  const t = (((time - (isAvenue ? 0 : avenueRed)) % cycle) + cycle) % cycle;
  return t < walk;
}

export {
  AVENUES,
  ALL_AVENUES,
  CENTRAL_PARK_BOUNDS,
  getIslandBoundsAtZ,
  HONG_KONG_ISLAND_COASTLINE,
  KOWLOON_COASTLINE,
  getBroadwayX,
  BROADWAY_LINE,
  STREETS,
  ALL_STREETS,
  ROADS,
  PLACES,
  LANDMARK_SITES,
  TELEPORT_LOCATIONS,
  ISLAND_BOUNDS,
  PLAY_BOUNDS,
  LANDMARK_BLOCKS,
  BLOCKS,
  HK_CORE_BBOX,
  HK_CORE_WORLD,
  HK_LANDMARK_CATALOG,
  HK_NULL_HEIGHT,
  HK_GLTF_SHEET,
  HK_GLTF_SHEETS,
  HK_GLTF_CAP,
  HK_STREET_EYE,
  HK_STREET_NEAR,
  HK_GLTF_TEX_NEAR,
  HK_GLTF_STREET_REACH,
  HK_GLTF_STREET_HALF,
  blockInHkCore,
  hkCoreProject,
  hkCoreUnproject,
  hkFootprintHeight,
  HK_RETAIL_BELT,
  hkRetailSlices,
  hkLandmarkOwnsShaft,
  hkLonLatInCore,
  hkMassingPlan,
  hkPlanCorners,
  hkResolveLandmarks,
  hkScaleRing,
  hkCentralSignSites,
  CUT_Z,
  SIGNAL_TIMING,
  streetZ,
  avenueX,
  avenueNameAt,
  districtAt,
  blockAt,
  blocksInRect,
  nearestRoads,
  getLocationLabel,
  isTypingInField,
  signalPhase,
  walkSignal
};
