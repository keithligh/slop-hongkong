import {
  BLOCKS,
  HK_GLTF_STREET_HALF,
  HK_GLTF_STREET_REACH,
  HK_STREET_EYE,
  ISLAND_BOUNDS,
  blockInHkCore,
  hkCoreUnproject,
  hkFootprintHeight
} from './city-config.js';
import { gltfInStreetChase, hk80GridToWgs84, hk80ToWorld } from './hk-gltf-frame.js';

// PlanD 3D Photo-realistic Model (規劃署). OBJ tiles are Altizure exports:
// Z-up, local X east, local Y north, local Z = HKPD. config.json model_transform
// is a row-major 4×4 that adds the HK1980 origin. The page then uses the same
// HK1980 → Central ENU path as the LandsD sheets.
// The mesh is one continuous surface per tile, not a building. The clip is the
// Digit1 corridor, so the page mounts it as a donor unless ?pland=off (or an
// unknown value). ?pland=compare still leaves the LandsD meshes unmounted.

export const PLAND_TILES_API = 'https://pdmap.pland.gov.hk/plandapi/Tiles';
export const PLAND_DATASET = 'https://data.gov.hk/en-data/dataset/hk-pland-pland1-3d-photo-realistic-model';
export const PLAND_ATTRIBUTION = '© 香港特別行政區政府規劃署 3D Photo-realistic Model / DATA.GOV.HK';
export const PLAND_CAPTURE = 'Hong Kong Island aerial photographs, March 2017; tile files dated February 2019';

// Metres above the sidewalk. Triangles entirely below this are the road carpet.
// A facade that still touches the pavement is kept, because the test is the highest corner.
export const PLAND_GROUND_CLEARANCE = 1.2;
// Vertices inside this radius of the Des Voeux eye set the HKPD of the pavement.
// The OBJ also contains heights down to about −188 m. Snapping that minimum
// to the sidewalk would lift the street into the sky.
export const PLAND_DATUM_RADIUS = 18;

// Shared Altizure frame on the Central tiles checked 2026-10-24 (tile_21_26 and tile_21_27).
// Each zip still carries its own model_transform. Do not assume the next tile matches.
export const PLAND_TILE_21_26_TRANSFORM = Object.freeze([
  Object.freeze([1, 0, 0, 836974.635391304153]),
  Object.freeze([0, 1, 0, 815456.572217391338]),
  Object.freeze([0, 0, 1, 0]),
  Object.freeze([0, 0, 0, 1])
]);

// First vertex of tile_21_27/level_5_0_0.obj. It falls just north of the Des Voeux eye.
export const PLAND_TILE_21_27_SAMPLE = Object.freeze({
  local: Object.freeze([-2468.8373226179, 300.8440847656, 4.5957884090])
});

// First vertex of tile_21_26/level_5_0_0.obj. Northing lands on the 815500 grid line,
// south of the Digit1 corridor.
export const PLAND_TILE_21_26_SAMPLE = Object.freeze({
  local: Object.freeze([-2470.2770313460, 43.4277826090, 22.3648518180])
});

// Person chase only. A helicopter frame is not the proof.
export const PLAND_DIGIT1_CAMERAS = Object.freeze([
  Object.freeze({ id: 'eye', x: -1.4, z: 29.3, heading: 1.29, query: '-1.4,29.3,1.29' }),
  Object.freeze({ id: 'along', x: 22.6, z: 36.2, heading: 1.29, query: '22.6,36.2,1.29' }),
  Object.freeze({ id: 'south', x: -1.4, z: 35.3, heading: 1.29, query: '-1.4,35.3,1.29' })
]);

export function assertPlandFileType(fileType) {
  const type = String(fileType || '').trim().toUpperCase();
  switch (type) {
    case 'OBJ':
    case 'OSGB':
    case 'CESIUM':
      return type;
    default: {
      throw new Error(`bad fileType ${type || '(empty)'}`);
    }
  }
}

export function plandTilesUrl(easting, northing, fileType = 'OBJ') {
  const type = assertPlandFileType(fileType);
  const e = Math.round(Number(easting));
  const n = Math.round(Number(northing));
  if (!Number.isFinite(e) || !Number.isFinite(n)) throw new Error('bad HK1980 coordinate');
  return `${PLAND_TILES_API}?e=${e}&n=${n}&fileType=${type}`;
}

function stripWrappedQuotes(value) {
  const text = String(value || '').trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  return text;
}

export function parsePlandTiles(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, message: 'empty', tiles: [] };
  if (payload.respCd !== 0) {
    return { ok: false, message: String(payload.msg || 'fail'), tiles: [] };
  }
  const tiles = [];
  for (const row of payload.gridList || []) {
    const grid = String(row.grid_name || '');
    if (!/^tile_\d+_\d+$/.test(grid)) continue;
    tiles.push({
      grid,
      fid: row.fid,
      locEn: stripWrappedQuotes(row.loc_en),
      locTc: String(row.loc_tc || ''),
      fileUrl: String(row.file_url || ''),
      modiDate: String(row.modi_date || '')
    });
  }
  return { ok: true, message: String(payload.msg || 'Success'), tiles };
}

export function plandModelTransform(config) {
  const rows = config?.model_transform;
  if (!Array.isArray(rows) || rows.length !== 4) throw new Error('PlanD config.json has no 4x4 model_transform');
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 4 || row.some((value) => !Number.isFinite(Number(value)))) {
      throw new Error('PlanD config.json has no 4x4 model_transform');
    }
    out.push(row.map(Number));
  }
  return out;
}

// Row-major, matching the Altizure config.json layout (translation in the last column).
export function plandLocalToHk80(x, y, z, transform) {
  const m = transform;
  return {
    easting: m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
    northing: m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
    hkpd: m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3]
  };
}

export function wgs84ToHk80Grid(lat, lon) {
  let easting = 834508.132;
  let northing = 815778.259;
  for (let i = 0; i < 12; i++) {
    const here = hk80GridToWgs84(easting, northing);
    const east = hk80GridToWgs84(easting + 1, northing);
    const north = hk80GridToWgs84(easting, northing + 1);
    const dLatE = east.lat - here.lat;
    const dLonE = east.lon - here.lon;
    const dLatN = north.lat - here.lat;
    const dLonN = north.lon - here.lon;
    const det = dLatE * dLonN - dLatN * dLonE;
    if (!(Math.abs(det) > 1e-18)) break;
    const dLat = lat - here.lat;
    const dLon = lon - here.lon;
    const stepE = (dLat * dLonN - dLon * dLatN) / det;
    const stepN = (dLatE * dLon - dLonE * dLat) / det;
    easting += stepE;
    northing += stepN;
    if (Math.hypot(stepE, stepN) < 1e-4) break;
  }
  return { easting, northing };
}

export function worldToHk80(x, z) {
  const { lat, lon } = hkCoreUnproject(x, z);
  return wgs84ToHk80Grid(lat, lon);
}

export function plandLocalToWorld(x, y, z, transform, streetHkpd, sidewalk = ISLAND_BOUNDS.sidewalkHeight) {
  const hk = plandLocalToHk80(x, y, z, transform);
  const [wx, , wz] = hk80ToWorld(hk.easting, hk.northing, hk.hkpd, hk.hkpd);
  return {
    ...hk,
    x: wx,
    y: (hk.hkpd - streetHkpd) + sidewalk,
    z: wz
  };
}

export function plandStreetHkpd(samples) {
  const values = (samples || []).filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.floor(values.length * 0.1));
  return values[index];
}

export function digit1CorridorSamples(step = 125) {
  const eye = HK_STREET_EYE;
  const reach = HK_GLTF_STREET_REACH;
  const out = [];
  for (let along = 0; along <= reach; along += step) {
    const x = eye.x + Math.sin(eye.heading) * along;
    const z = eye.z + Math.cos(eye.heading) * along;
    const grid = worldToHk80(x, z);
    out.push({ along, x, z, easting: grid.easting, northing: grid.northing });
  }
  return out;
}

export function plandKeepTriangle(a, b, c, {
  eye = HK_STREET_EYE,
  sidewalk = ISLAND_BOUNDS.sidewalkHeight,
  clearance = PLAND_GROUND_CLEARANCE,
  reach = HK_GLTF_STREET_REACH,
  half = HK_GLTF_STREET_HALF
} = {}) {
  const maxY = Math.max(a.y, b.y, c.y);
  if (!(maxY >= sidewalk + clearance)) return 'ground';
  const x = (a.x + b.x + c.x) / 3;
  const z = (a.z + b.z + c.z) / 3;
  if (!gltfInStreetChase({ minX: x, maxX: x, minZ: z, maxZ: z }, eye, reach, half)) return 'outside';
  return 'keep';
}

export function parsePlandMtl(text) {
  const maps = {};
  let current = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('newmtl ')) current = line.slice(7).trim();
    else if (current && line.startsWith('map_Kd ')) maps[current] = line.slice(7).trim();
  }
  return maps;
}

function grow(buffer, needed, ctor) {
  if (buffer && buffer.length >= needed) return buffer;
  const next = new ctor(Math.max(needed, buffer ? buffer.length * 2 : 4096));
  if (buffer) next.set(buffer);
  return next;
}

function faceIndex(token, count) {
  const value = Number(token);
  if (!Number.isFinite(value) || value === 0 || !count) return -1;
  const index = value > 0 ? value - 1 : count + value;
  if (index < 0 || index >= count) return -1;
  return index;
}

export function createPlandObjClipper({
  transform,
  streetHkpd = null,
  sidewalk = ISLAND_BOUNDS.sidewalkHeight,
  eye = HK_STREET_EYE,
  clearance = PLAND_GROUND_CLEARANCE,
  onProgress = null
} = {}) {
  if (!transform) throw new Error('missing model_transform');
  let vertCount = 0;
  let vertStore = new Float64Array(1024 * 3);
  let uvStore = new Float32Array(1024 * 2);
  let uvCount = 0;
  const datum = [];
  const groups = new Map();
  let material = 'default';
  let seenFace = false;
  let lockedDatum = Number.isFinite(streetHkpd) ? streetHkpd : null;
  const eyeGrid = worldToHk80(eye.x, eye.z);
  let worldCache = null;
  const dropped = { ground: 0, outside: 0, broken: 0 };
  let kept = 0;
  let lines = 0;
  const box = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity
  };

  function ensureDatum() {
    if (lockedDatum != null) return lockedDatum;
    lockedDatum = plandStreetHkpd(datum);
    return lockedDatum;
  }

  function worldOf(index) {
    const datumHeight = ensureDatum();
    if (datumHeight == null) return null;
    if (!worldCache) {
      worldCache = {
        x: new Float32Array(vertCount),
        y: new Float32Array(vertCount),
        z: new Float32Array(vertCount),
        hit: new Uint8Array(vertCount)
      };
    }
    if (worldCache.hit[index]) {
      return { x: worldCache.x[index], y: worldCache.y[index], z: worldCache.z[index] };
    }
    const world = plandLocalToWorld(
      vertStore[index * 3],
      vertStore[index * 3 + 1],
      vertStore[index * 3 + 2],
      transform,
      datumHeight,
      sidewalk
    );
    worldCache.hit[index] = 1;
    worldCache.x[index] = world.x;
    worldCache.y[index] = world.y;
    worldCache.z[index] = world.z;
    return world;
  }

  function pushCorner(index, vt, bucket) {
    const world = worldOf(index);
    const need = bucket.n + 1;
    if (need * 3 > bucket.local.length || need * 2 > bucket.uv.length) {
      const capacity = Math.floor(bucket.local.length / 3);
      const nextCount = Math.max(need, capacity * 2, 2048);
      const nextLocal = new Float32Array(nextCount * 3);
      nextLocal.set(bucket.local.subarray(0, bucket.n * 3));
      bucket.local = nextLocal;
      const nextUv = new Float32Array(nextCount * 2);
      nextUv.set(bucket.uv.subarray(0, bucket.n * 2));
      bucket.uv = nextUv;
    }
    const at = bucket.n;
    bucket.local[at * 3] = vertStore[index * 3];
    bucket.local[at * 3 + 1] = vertStore[index * 3 + 1];
    bucket.local[at * 3 + 2] = vertStore[index * 3 + 2];
    if (vt >= 0) {
      bucket.uv[at * 2] = uvStore[vt * 2];
      bucket.uv[at * 2 + 1] = uvStore[vt * 2 + 1];
    } else {
      bucket.uv[at * 2] = 0;
      bucket.uv[at * 2 + 1] = 0;
    }
    bucket.n = at + 1;
    if (world.x < box.minX) box.minX = world.x;
    if (world.x > box.maxX) box.maxX = world.x;
    if (world.y < box.minY) box.minY = world.y;
    if (world.y > box.maxY) box.maxY = world.y;
    if (world.z < box.minZ) box.minZ = world.z;
    if (world.z > box.maxZ) box.maxZ = world.z;
  }

  function groupFor(name) {
    let bucket = groups.get(name);
    if (!bucket) {
      bucket = { local: new Float32Array(4096), uv: new Float32Array(4096), n: 0 };
      groups.set(name, bucket);
    }
    return bucket;
  }

  return {
    pushLine(raw) {
      lines++;
      if (onProgress && lines % 400000 === 0) {
        onProgress({ lines, vertCount, uvCount, kept, dropped });
      }
      const line = String(raw || '').trim();
      if (!line || line.startsWith('#')) {
        const count = line.match(/^#\s+(\d+)\s+vertices\b/);
        if (count) {
          const n = Number(count[1]);
          if (n > vertStore.length / 3) {
            const next = new Float64Array(n * 3);
            next.set(vertStore.subarray(0, vertCount * 3));
            vertStore = next;
          }
        }
        return;
      }
      if (line.startsWith('v ')) {
        const parts = line.slice(2).trim().split(/\s+/);
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const z = Number(parts[2]);
        if (vertCount * 3 + 3 > vertStore.length) vertStore = grow(vertStore, (vertCount + 1) * 3, Float64Array);
        vertStore[vertCount * 3] = x;
        vertStore[vertCount * 3 + 1] = y;
        vertStore[vertCount * 3 + 2] = z;
        vertCount++;
        if (lockedDatum == null) {
          const hk = plandLocalToHk80(x, y, z, transform);
          // Grid metres match the Central ENU within about a metre, which is enough
          // to decide which vertices are the pavement under the eye.
          if (Math.hypot(hk.easting - eyeGrid.easting, hk.northing - eyeGrid.northing) <= PLAND_DATUM_RADIUS + 2) {
            datum.push(hk.hkpd);
          }
        }
        return;
      }
      if (line.startsWith('vt ')) {
        const parts = line.slice(3).trim().split(/\s+/);
        if (uvCount * 2 + 2 > uvStore.length) uvStore = grow(uvStore, (uvCount + 1) * 2, Float32Array);
        uvStore[uvCount * 2] = Number(parts[0]);
        uvStore[uvCount * 2 + 1] = Number(parts[1]);
        uvCount++;
        return;
      }
      if (line.startsWith('usemtl ')) {
        material = line.slice(7).trim() || 'default';
        return;
      }
      if (!line.startsWith('f ')) return;
      seenFace = true;
      if (ensureDatum() == null) {
        dropped.broken++;
        return;
      }
      const corners = line.slice(2).trim().split(/\s+/);
      const indices = [];
      for (const token of corners) {
        const [vToken, vtToken] = token.split('/');
        const v = faceIndex(vToken, vertCount);
        const vt = vtToken ? faceIndex(vtToken, uvCount) : -1;
        if (v < 0) {
          dropped.broken++;
          return;
        }
        indices.push({ v, vt });
      }
      if (indices.length < 3) {
        dropped.broken++;
        return;
      }
      for (let i = 1; i + 1 < indices.length; i++) {
        const tri = [indices[0], indices[i], indices[i + 1]];
        const worlds = tri.map((corner) => worldOf(corner.v));
        const decision = plandKeepTriangle(worlds[0], worlds[1], worlds[2], { eye, sidewalk, clearance });
        switch (decision) {
          case 'keep': {
            const bucket = groupFor(material);
            for (let k = 0; k < 3; k++) pushCorner(tri[k].v, tri[k].vt, bucket);
            kept++;
            break;
          }
          case 'ground':
            dropped.ground++;
            break;
          case 'outside':
            dropped.outside++;
            break;
          default: {
            const never = decision;
            throw new Error(`bad triangle decision ${never}`);
          }
        }
      }
    },
    finish() {
      const materials = {};
      for (const [name, bucket] of groups) {
        if (!bucket.n) continue;
        materials[name] = {
          local: new Float32Array(bucket.local.subarray(0, bucket.n * 3)),
          uv: new Float32Array(bucket.uv.subarray(0, bucket.n * 2))
        };
      }
      return {
        streetHkpd: lockedDatum,
        datumSamples: datum.length,
        triangles: kept,
        dropped,
        seenFace,
        materials,
        box: kept ? box : null,
        vertCount,
        uvCount
      };
    },
    status() {
      return { lines, vertCount, uvCount, kept, dropped };
    }
  };
}

export function clipPlandObjText(text, options) {
  const clipper = createPlandObjClipper(options);
  for (const line of String(text).split(/\r?\n/)) clipper.pushLine(line);
  return clipper.finish();
}

export function resolvePlandRequest(href) {
  let raw = '';
  try {
    raw = new URL(href || 'http://local/', 'http://local/').searchParams.get('pland') || '';
  } catch {
    raw = '';
  }
  const query = raw.trim().toLowerCase();
  switch (query) {
    // No flag: donor on the Digit1 clip. The chase URLs do not carry ?pland=donor.
    case '':
    case '1':
    case 'on':
    case 'donor':
      return { mode: 'donor' };
    case '0':
    case 'off':
    case 'false':
    case 'no':
      return null;
    case 'compare':
    case 'ab':
      return { mode: 'compare' };
    default:
      return null;
  }
}

// Curtain only. The retail shopfront is a separate mesh and must not be passed
// here. Samples inside the Digit1 chase corridor are dropped so the 2017 photo
// mass is not hidden behind hkCanyonGlass. The 80 m disc is not this test, and
// a ribbon outside the corridor keeps its glass. Shopfront cells stay on the
// caller’s other list, including the proven-empty Des Voeux curb.
export function omitPlandCorridorGlass(walls, {
  enabled = false,
  eye = HK_STREET_EYE,
  sample = 4,
  minLen = 3.2
} = {}) {
  const list = walls || [];
  if (!enabled) return list.slice();
  const out = [];
  for (const wall of list) {
    if (!wall || !Number.isFinite(wall.dx) || !Number.isFinite(wall.dz) || !(wall.len > 0)) {
      if (wall) out.push(wall);
      continue;
    }
    const half = wall.len * 0.5;
    const steps = Math.max(1, Math.ceil(wall.len / sample));
    const dt = wall.len / steps;
    const inside = [];
    for (let i = 0; i < steps; i++) {
      const t = -half + (i + 0.5) * dt;
      const x = wall.x + wall.dx * t;
      const z = wall.z + wall.dz * t;
      inside.push(gltfInStreetChase({ minX: x, maxX: x, minZ: z, maxZ: z }, eye));
    }
    let i = 0;
    while (i < steps) {
      if (inside[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < steps && !inside[j]) j++;
      const t0 = -half + i * dt;
      const t1 = -half + j * dt;
      const len = t1 - t0;
      if (len >= minLen) {
        const mid = (t0 + t1) * 0.5;
        out.push({
          ...wall,
          x: wall.x + wall.dx * mid,
          z: wall.z + wall.dz * mid,
          len
        });
      }
      i = j;
    }
  }
  return out;
}

export function planPlandManifest(manifest, request) {
  if (!request || (request.mode !== 'donor' && request.mode !== 'compare')) return null;
  const tiles = [];
  for (const tile of manifest?.tiles || []) {
    if (!tile?.gltf || !/^tile_\d+_\d+$/.test(String(tile.grid || ''))) continue;
    let transform;
    try {
      transform = plandModelTransform({ model_transform: tile.modelTransform });
    } catch {
      continue;
    }
    tiles.push({
      grid: tile.grid,
      gltf: String(tile.gltf),
      modelTransform: transform,
      locTc: String(tile.locTc || ''),
      modiDate: String(tile.modiDate || ''),
      fileUrl: String(tile.fileUrl || ''),
      triangles: tile.triangles || 0
    });
  }
  if (!tiles.length || !Number.isFinite(manifest.streetHkpd)) return null;
  return {
    mode: request.mode,
    streetHkpd: manifest.streetHkpd,
    sidewalk: Number.isFinite(manifest.sidewalk) ? manifest.sidewalk : ISLAND_BOUNDS.sidewalkHeight,
    attribution: manifest.attribution || PLAND_ATTRIBUTION,
    dataset: manifest.dataset || PLAND_DATASET,
    capture: manifest.capture || PLAND_CAPTURE,
    tiles
  };
}

export function plandCorridorExtrudeIds(blocks = BLOCKS, eye = HK_STREET_EYE) {
  const ids = [];
  for (const block of blocks || []) {
    if (block.park > 0.6 || block.median) continue;
    if (!blockInHkCore(block)) continue;
    if (!(hkFootprintHeight(block) > 0)) continue;
    if (gltfInStreetChase(block, eye)) ids.push(block.id);
  }
  return ids;
}

export function withPlandCorridorHidden(gltfPlan, blocks = BLOCKS) {
  const hiddenIds = new Set(gltfPlan?.hiddenIds || []);
  for (const id of plandCorridorExtrudeIds(blocks)) hiddenIds.add(id);
  if (!gltfPlan) {
    return {
      sheet: '',
      sheets: [],
      selected: [],
      hiddenIds,
      skippedSpeck: 0,
      skippedOutside: 0,
      skippedCap: 0,
      reason: ''
    };
  }
  return { ...gltfPlan, hiddenIds };
}

export function formatPlandLog(info) {
  const grids = (info.tiles || []).map((tile) => tile.grid || tile).join('+') || 'none';
  return `[pland] mode ${info.mode} tiles ${grids} triangles ${info.triangles} ` +
    `street HKPD ${info.streetHkpd}m; ` +
    `OBJ Z-up + model_transform → EPSG:2326 → Central ENU; ` +
    `${info.capture || PLAND_CAPTURE}; ` +
    `${info.attribution || PLAND_ATTRIBUTION}; ` +
    `Digit1 ${PLAND_DIGIT1_CAMERAS.map((camera) => camera.query).join(' | ')}; ` +
    `continuous 2017 mesh, not a current Henderson shopfront and not Sleeping Dogs`;
}
