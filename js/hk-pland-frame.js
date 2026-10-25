import {
  BLOCKS,
  HK_GLTF_STREET_HALF,
  HK_GLTF_STREET_REACH,
  HK_RETAIL_BELT,
  HK_STREET_EYE,
  HK_STREET_NEAR,
  ISLAND_BOUNDS,
  blockInHkCore,
  hkCoreUnproject,
  hkFootprintHeight
} from './city-config.js';
import { GEO } from './geo-source.js';
import { boxClosestDistance, gltfBoxChase, gltfInStreetChase, hk80GridToWgs84, hk80ToWorld } from './hk-gltf-frame.js';
import { HK_CURB_W, HK_WALK_W } from './hk-road-deck.js';

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
// The capture JPEGs are 8192². Eight of those, plus mipmaps, killed the WebGPU
// device (GPU process exit 9) before the Digit1 eye could present. The page
// uploads this edge. The mesh triangles stay the corridor clip.
export const PLAND_PAGE_TEX_EDGE = 2048;
// Street-side apron in front of a loaded LandsD box. The 2017 shell can sit
// proud of The Henderson and paint a pale face over the photograph. Interior
// triangles of a box inside the 80 m disc are omitted only in the retail band.
// A centre above that band, or a box farther than the disc, including The
// Henderson, can still show the aerial through a chart hole.
export const PLAND_LANDSD_SKIRT = 16;
// Outward pad so a shell proud of the lot face is the same podium omit as the
// interior. It stays inside half a metre. The 16 m skirt is a different test.
export const PLAND_PODIUM_FACE = 0.5;
// Metres above the retail belt. Podium omit stops here. A higher centre keeps
// the donor, so a near LandsD hole is not punched into sky.
export const PLAND_PODIUM_ABOVE_BELT = 1;
export const PLAND_CAPTURE = 'Hong Kong Island aerial photographs, March 2017; tile files dated February 2019';

// Metres above the sidewalk. Triangles entirely below this are the road carpet.
// A facade that still touches the pavement is kept, because the test is the highest corner.
export const PLAND_GROUND_CLEARANCE = 1.2;
// Old height band. A high corner no longer keeps a triangle that meets the
// carriageway or the sidewalk: that spike is the jagged kerb scrap.
export const PLAND_STREET_SHELL_TOP = 4.5;
// Metres outside the tagged half-width. Kerb plus sidewalk, 0.4 m short of the
// building line (curb 0.42 + walk 2.05), so a lot-face vertex is not this band.
export const PLAND_STREET_SHELL_APRON = HK_CURB_W + HK_WALK_W - 0.4;
// Digit1 chase look, not the Des Voeux centreline. Heading 1.29 leaves the
// ~7 m apron near 70 m. The mid-road melt is on the look (side ~0.3 m) and
// about 14 m off that centreline, so a wider apron never reaches it.
// Along 8–216 m, 16 m either side of the ray, centroids below 18 m.
// 12 m still leaves the mat_tex_2 sheet at along ~151 m (centroid y ~16.4).
// 216 m stops short of the Henderson shell at along ~223 m, which the 16 m
// skirt still owns. A lot face outside the half-width stays. A centroid at
// 18 m or above stays, so this is not a full-height punch.
export const PLAND_DIGIT1_LOOK_ALONG_MIN = 8;
export const PLAND_DIGIT1_LOOK_ALONG_MAX = 216;
export const PLAND_DIGIT1_LOOK_HALF = 16;
export const PLAND_DIGIT1_LOOK_Y_CLEAR = 18;
// Digit1 flank. The mid-road corridor is ±16 m and the near-box omit stops
// at the retail belt, so a shell on the down-street face of a chart, and the
// flank charts past 80 m, still draw tile_21_26. Proud distance is the shell
// just outside that face (the measured east cap is ~2 m). The face depth is
// how far inside the lot the same facade can sit while the box is loose.
// The top is the street-eye canyon, not the tower crown. A box whose closest
// point is inside 12 m contains the eye; its interior stays belt-only.
export const PLAND_FLANK_PROUD = 4;
export const PLAND_FLANK_FACE = 6;
export const PLAND_FLANK_TOP = 64;
export const PLAND_FLANK_EYE_BOX = 12;
// Digit1 mid-band. The eye hits at ~(84.9, 14.7, 77.3), ~(80.9, 18.3, 71.1),
// and ~(141.2, 21.6, 44.1) are not on a LandsD ring and not on a mounted
// BUILDING chart. The right cluster is the gap east of the Bank of China
// Building; the left cluster is the 2017 Murray approach west of The Henderson.
// Side stays outside the ±16 m look corridor, so this is not the mid-road omit.
// The far side stays inside the ray to the Bank of China Tower (side/along ~0.35
// on the right) and off the centre ray to The Henderson. World y stops at the
// flank canyon top, so the crown is not a full-height punch. Compare passes no
// boxes, so the omit does not run. The replacement wall is HkMidbandCanyon
// (shopfront belt and window grid; still chartless).
export const DIGIT1_MIDBAND_PLATES = Object.freeze([
  Object.freeze({
    id: 'digit1-midband-right',
    alongMin: 82,
    alongMax: 112,
    sideMin: 16.5,
    sideMax: 27
  }),
  Object.freeze({
    id: 'digit1-midband-left',
    alongMin: 128,
    alongMax: 162,
    sideMin: -36,
    sideMax: -16.5
  })
]);
// Chartless Bank of China Tower plate. The LandsD footprint is the owner.
// Proud is a shell just outside that ring, not the bounding-box wedges.
// The peak is the prism cap already on the tallest edge. The 52.4 m mast stays.
export const PLAND_BOC_PLATE_PROUD = 2;
export const PLAND_BOC_PLATE_PEAK = 11.7;
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

export function desVoeuxCarriageSegments(graph = GEO.roadGraph) {
  const nodes = graph?.nodes;
  const links = graph?.links;
  if (!nodes || !links || !graph.names) return [];
  const out = [];
  for (const link of links) {
    const [a, b, nameIndex, width, , , inner] = link;
    if (graph.names[nameIndex] !== 'DES VOEUX ROAD CENTRAL') continue;
    const carriage = Number(width);
    if (!(carriage >= 3)) continue;
    const ax0 = nodes[a * 2];
    const az0 = nodes[a * 2 + 1];
    const bx1 = nodes[b * 2];
    const bz1 = nodes[b * 2 + 1];
    const pts = [[ax0, az0]];
    const mids = inner || [];
    for (let k = 0; k + 1 < mids.length; k += 2) pts.push([mids[k], mids[k + 1]]);
    pts.push([bx1, bz1]);
    const half = carriage * 0.5;
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i][0];
      const az = pts[i][1];
      const bx = pts[i + 1][0];
      const bz = pts[i + 1][1];
      if (![ax, az, bx, bz].every(Number.isFinite)) continue;
      if (Math.hypot(bx - ax, bz - az) < 0.05) continue;
      out.push({ ax, az, bx, bz, half });
    }
  }
  return out;
}

export function plandCarriageDistance(x, z, segments) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  let best = null;
  for (const seg of segments || []) {
    const abx = seg.bx - seg.ax;
    const abz = seg.bz - seg.az;
    const len2 = abx * abx + abz * abz;
    const t = len2 > 1e-8 ? Math.max(0, Math.min(1, ((x - seg.ax) * abx + (z - seg.az) * abz) / len2)) : 0;
    const dist = Math.hypot(x - (seg.ax + abx * t), z - (seg.az + abz * t));
    if (!best || dist < best.dist) best = { dist, half: seg.half };
  }
  return best;
}

function pointOnCarriageway(x, z, segments, apron) {
  for (const seg of segments) {
    const abx = seg.bx - seg.ax;
    const abz = seg.bz - seg.az;
    const len2 = abx * abx + abz * abz;
    const t = len2 > 1e-8 ? Math.max(0, Math.min(1, ((x - seg.ax) * abx + (z - seg.az) * abz) / len2)) : 0;
    const dist = Math.hypot(x - (seg.ax + abx * t), z - (seg.az + abz * t));
    if (dist <= seg.half + apron) return true;
  }
  return false;
}

// Mount-time. The fetch clip keeps a triangle when any corner clears the 1.2 m
// carpet, so an aerial sliver can sit on the asphalt with one vertex metres up.
// At the Des Voeux eye that sliver is the jagged grey scrap on the kerb. Any
// corner or the centre in the carriageway-plus-sidewalk band drops the triangle,
// however high the other vertex is. A lot face clear of that band stays.
export function plandOmitsCarriageShell(a, b, c, segments, {
  apron = PLAND_STREET_SHELL_APRON
} = {}) {
  if (!segments?.length || !a || !b || !c) return false;
  const points = [a, b, c, {
    x: (a.x + b.x + c.x) / 3,
    z: (a.z + b.z + c.z) / 3
  }];
  for (const point of points) {
    if (pointOnCarriageway(point.x, point.z, segments, apron)) return true;
  }
  return false;
}

// Mount-time. Apron omit only covers the Des Voeux carriageway. The Digit1
// centre ray is off that apron by ~80 m and hits PlanD on the look itself:
// mat_tex_1 around (80.3, 10.3, 52.9), then a mat_tex_2 sheet near along 151 m
// at centroid y ~16. Drop those centroids. The Henderson shell past the along
// cap is a different test (the street-side skirt).
export function plandOmitsDigit1LookGround(point, {
  eye = HK_STREET_EYE,
  alongMin = PLAND_DIGIT1_LOOK_ALONG_MIN,
  alongMax = PLAND_DIGIT1_LOOK_ALONG_MAX,
  half = PLAND_DIGIT1_LOOK_HALF,
  yClear = PLAND_DIGIT1_LOOK_Y_CLEAR
} = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return false;
  if (!(point.y < yClear)) return false;
  const heading = Number.isFinite(eye?.heading) ? eye.heading : HK_STREET_EYE.heading;
  const ox = Number.isFinite(eye?.x) ? eye.x : HK_STREET_EYE.x;
  const oz = Number.isFinite(eye?.z) ? eye.z : HK_STREET_EYE.z;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const dx = point.x - ox;
  const dz = point.z - oz;
  const along = dx * fx + dz * fz;
  if (along < alongMin || along > alongMax) return false;
  const side = dx * -fz + dz * fx;
  if (Math.abs(side) > half) return false;
  return true;
}

export function plandYieldsToLandsd(point, boxes, {
  eye = HK_STREET_EYE,
  skirt = PLAND_LANDSD_SKIRT,
  sidewalk = ISLAND_BOUNDS.sidewalkHeight
} = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return false;
  for (const box of boxes || []) {
    if (!box || !Number.isFinite(box.minX) || !Number.isFinite(box.maxX) || !Number.isFinite(box.minZ) || !Number.isFinite(box.maxZ)) {
      continue;
    }
    if (Number.isFinite(point.y) && Number.isFinite(box.maxH) && Number.isFinite(box.minH)) {
      const top = sidewalk + Math.max(0, box.maxH - box.minH) + 2;
      if (point.y > top) continue;
    }
    const cx = Math.max(box.minX, Math.min(point.x, box.maxX));
    const cz = Math.max(box.minZ, Math.min(point.z, box.maxZ));
    const outX = point.x - cx;
    const outZ = point.z - cz;
    const outLen = Math.hypot(outX, outZ);
    if (!(outLen > 0.05) || outLen > skirt) continue;
    const ex = eye.x - cx;
    const ez = eye.z - cz;
    const eyeLen = Math.hypot(ex, ez);
    if (!(eyeLen > 1)) continue;
    const dot = (outX * ex + outZ * ez) / (outLen * eyeLen);
    if (dot > 0.5) return true;
  }
  return false;
}

// Donor mount. LandsD null-fill opens atlas holes, and a PlanD centre inside
// that box was the melted right podium at the Des Voeux eye. Drop the centre
// when the box is within the street disc, the centre is in the footprint (or
// the half-metre face pad), and it is still in the retail band. A higher
// centre stays, and so does a box past the disc, including The Henderson.
// The corridor does not extrude a grey slab into that band.
export function plandOmitsPodiumInsideLandsd(point, boxes, {
  eye = HK_STREET_EYE,
  near = HK_STREET_NEAR,
  belt = HK_RETAIL_BELT,
  face = PLAND_PODIUM_FACE,
  aboveBelt = PLAND_PODIUM_ABOVE_BELT
} = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return false;
  if (!(point.y < belt + aboveBelt)) return false;
  const pad = Number.isFinite(face) && face > 0 ? face : 0;
  for (const box of boxes || []) {
    if (!box || !Number.isFinite(box.minX) || !Number.isFinite(box.maxX) || !Number.isFinite(box.minZ) || !Number.isFinite(box.maxZ)) {
      continue;
    }
    if (boxClosestDistance(box, eye) > near) continue;
    if (point.x < box.minX - pad || point.x > box.maxX + pad) continue;
    if (point.z < box.minZ - pad || point.z > box.maxZ + pad) continue;
    return true;
  }
  return false;
}

function finiteBox(box) {
  return !!(box && Number.isFinite(box.minX) && Number.isFinite(box.maxX) && Number.isFinite(box.minZ) && Number.isFinite(box.maxZ));
}

function chartRoofY(box, sidewalk) {
  if (!Number.isFinite(box.maxH) || !Number.isFinite(box.minH)) return Infinity;
  return sidewalk + Math.max(0, box.maxH - box.minH) + 2;
}

// Outward of the nearest vertical face, when the point is inside that face band.
function insetFaceOutward(point, box, face) {
  const faces = [
    { dist: point.x - box.minX, ox: -1, oz: 0 },
    { dist: box.maxX - point.x, ox: 1, oz: 0 },
    { dist: point.z - box.minZ, ox: 0, oz: -1 },
    { dist: box.maxZ - point.z, ox: 0, oz: 1 }
  ];
  let best = faces[0];
  for (let i = 1; i < faces.length; i++) {
    if (faces[i].dist < best.dist) best = faces[i];
  }
  if (!(best.dist <= face)) return null;
  return best;
}

function lookAxisDot(ox, oz, fx, fz) {
  const len = Math.hypot(ox, oz);
  if (!(len > 1e-6)) return 0;
  return (ox * fx + oz * fz) / len;
}

function eyeOutwardDot(ox, oz, eyeX, eyeZ, box, point) {
  const cx = Math.max(box.minX, Math.min(point.x, box.maxX));
  const cz = Math.max(box.minZ, Math.min(point.z, box.maxZ));
  const ex = eyeX - cx;
  const ez = eyeZ - cz;
  const outLen = Math.hypot(ox, oz);
  const eyeLen = Math.hypot(ex, ez);
  if (!(outLen > 1e-6) || !(eyeLen > 1)) return 0;
  return (ox * ex + oz * ez) / (outLen * eyeLen);
}

// Donor mount. The Digit1 right flank is still tile_21_26 after the belt omit
// and the mid-road corridor. Two shells:
// - A centroid a few metres outside a chase chart, on the look axis. The 16 m
//   skirt only keeps a shell whose outward points back at the eye, so the
//   down-street cap (the measured ~2 m east of the Bank of China chart at
//   y ~10.6) stays. This drops that cap. It does not widen the street skirt.
// - Past the 80 m disc, a centroid inside a chase chart whose near edge is
//   still short of The Henderson. The belt omit never sees that box. The
//   drop stops at the canyon top, so the crown is not a full-height punch.
// A near box (inside 80 m) keeps its deep interior above the belt. Only the
// outer face band yields, and a box that contains the eye stays belt-only.
// The Henderson interior and a centroid above the canyon top stay.
export function plandOmitsDigit1FlankChart(point, boxes, {
  eye = HK_STREET_EYE,
  proud = PLAND_FLANK_PROUD,
  face = PLAND_FLANK_FACE,
  top = PLAND_FLANK_TOP,
  alongMax = PLAND_DIGIT1_LOOK_ALONG_MAX,
  eyeBox = PLAND_FLANK_EYE_BOX,
  near = HK_STREET_NEAR,
  belt = HK_RETAIL_BELT,
  aboveBelt = PLAND_PODIUM_ABOVE_BELT,
  sidewalk = ISLAND_BOUNDS.sidewalkHeight
} = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return false;
  if (!(point.y < top)) return false;
  const heading = Number.isFinite(eye?.heading) ? eye.heading : HK_STREET_EYE.heading;
  const eyeX = Number.isFinite(eye?.x) ? eye.x : HK_STREET_EYE.x;
  const eyeZ = Number.isFinite(eye?.z) ? eye.z : HK_STREET_EYE.z;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const faceBand = Number.isFinite(face) && face > 0 ? face : 0;
  const proudBand = Number.isFinite(proud) && proud > 0 ? proud : 0;
  for (const box of boxes || []) {
    if (!finiteBox(box)) continue;
    if (!gltfInStreetChase(box, eye)) continue;
    const chase = gltfBoxChase(box, eye);
    if (!(chase.maxAlong >= 8 && chase.minAlong <= alongMax)) continue;
    if (point.y > chartRoofY(box, sidewalk)) continue;
    const dist = boxClosestDistance(box, eye);
    const cx = Math.max(box.minX, Math.min(point.x, box.maxX));
    const cz = Math.max(box.minZ, Math.min(point.z, box.maxZ));
    const outX = point.x - cx;
    const outZ = point.z - cz;
    const outLen = Math.hypot(outX, outZ);
    const inside = !(outLen > 0.05);
    if (!inside && outLen <= proudBand && Math.abs(lookAxisDot(outX, outZ, fx, fz)) > 0.5) return true;
    if (dist > near) {
      const pad = PLAND_PODIUM_FACE;
      if (point.x < box.minX - pad || point.x > box.maxX + pad) continue;
      if (point.z < box.minZ - pad || point.z > box.maxZ + pad) continue;
      return true;
    }
    if (dist <= eyeBox || !inside) continue;
    if (!(point.y >= belt + aboveBelt)) continue;
    const inset = insetFaceOutward(point, box, faceBand);
    if (!inset) continue;
    const onLook = Math.abs(lookAxisDot(inset.ox, inset.oz, fx, fz)) > 0.5;
    const onEye = eyeOutwardDot(inset.ox, inset.oz, eyeX, eyeZ, box, point) > 0.5;
    if (onLook || onEye) return true;
  }
  return false;
}

function isDigit1BocTowerPlate(plate) {
  return !!(plate
    && plate.name === 'Bank of China Tower'
    && plate.height === 303.3
    && Number.isFinite(plate.minX)
    && Number.isFinite(plate.maxX)
    && Number.isFinite(plate.minZ)
    && Number.isFinite(plate.maxZ)
    && Array.isArray(plate.poly)
    && plate.poly.length >= 3);
}

export function digit1BocTowerPlate(blocks = BLOCKS) {
  for (const block of blocks || []) {
    if (isDigit1BocTowerPlate(block)) return block;
  }
  return null;
}

function ringHasPoint(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    const denom = zj - zi;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (denom || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function ringClearance(ring, x, z) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j].x;
    const az = ring[j].z;
    const bx = ring[i].x;
    const bz = ring[i].z;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const dist = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (dist < best) best = dist;
  }
  return best;
}

// Donor mount. The Bank of China Tower plate has no BUILDING mesh, and the
// flank yield will not punch a chartless lot. This plate is the one exception:
// the LandsD footprint already owns the shaft. A centroid inside that ring, or
// within a couple of metres of it, is omitted below the prism peak. The mast
// above that line stays, so the omit is not a hole into sky. The bounding-box
// corners sit off the ring and are not this plate. No other landmark matches.
export function digit1LookAxes(eye = HK_STREET_EYE) {
  const heading = Number.isFinite(eye?.heading) ? eye.heading : HK_STREET_EYE.heading;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  return {
    heading,
    x: Number.isFinite(eye?.x) ? eye.x : HK_STREET_EYE.x,
    z: Number.isFinite(eye?.z) ? eye.z : HK_STREET_EYE.z,
    fx,
    fz,
    sx: -fz,
    sz: fx
  };
}

export function digit1LookFrame(point, eye = HK_STREET_EYE) {
  const axes = digit1LookAxes(eye);
  const dx = point.x - axes.x;
  const dz = point.z - axes.z;
  return {
    along: dx * axes.fx + dz * axes.fz,
    side: dx * axes.sx + dz * axes.sz
  };
}

// Donor mount. Chartless mid-band plates the Digit1 eye actually reads.
// A centroid inside either look-frame plate, below the canyon top, is omitted.
// The Bank of China Tower ray and the Henderson centre ray stay outside.
// Soft centre_low and the right_mid_low apron stay outside. The look corridor
// (side within 16 m) stays on the mid-road omit.
export function plandOmitsDigit1MidbandPlate(point, {
  plates = DIGIT1_MIDBAND_PLATES,
  top = PLAND_FLANK_TOP,
  eye = HK_STREET_EYE
} = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return false;
  if (!(point.y < top)) return false;
  const frame = digit1LookFrame(point, eye);
  for (const plate of plates || []) {
    if (!plate) continue;
    if (frame.along < plate.alongMin || frame.along > plate.alongMax) continue;
    if (frame.side < plate.sideMin || frame.side > plate.sideMax) continue;
    return true;
  }
  return false;
}

// Look-aligned box for one mid-band plate. Local +X is the look axis and
// local +Z is side (right positive). Three.js rotation Y sends local +X to
// (cos θ, −sin θ); θ = heading − π/2 matches (sin heading, cos heading).
export function digit1MidbandWallSpec(plate, eye = HK_STREET_EYE, {
  base = ISLAND_BOUNDS.sidewalkHeight,
  top = PLAND_FLANK_TOP
} = {}) {
  const axes = digit1LookAxes(eye);
  const along = (plate.alongMin + plate.alongMax) * 0.5;
  const side = (plate.sideMin + plate.sideMax) * 0.5;
  return {
    id: plate.id,
    size: {
      along: plate.alongMax - plate.alongMin,
      height: top - base,
      side: plate.sideMax - plate.sideMin
    },
    position: {
      x: axes.x + axes.fx * along + axes.sx * side,
      y: (base + top) * 0.5,
      z: axes.z + axes.fz * along + axes.sz * side
    },
    rotationY: axes.heading - Math.PI / 2
  };
}

export function plandOmitsDigit1BocPlate(point, plate, {
  proud = PLAND_BOC_PLATE_PROUD,
  peak = PLAND_BOC_PLATE_PEAK,
  sidewalk = ISLAND_BOUNDS.sidewalkHeight
} = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return false;
  if (!isDigit1BocTowerPlate(plate)) return false;
  const cap = sidewalk + plate.height + (Number.isFinite(peak) ? peak : 0);
  if (!(point.y < cap)) return false;
  const pad = Number.isFinite(proud) && proud > 0 ? proud : 0;
  if (ringHasPoint(plate.poly, point.x, point.z)) return true;
  return ringClearance(plate.poly, point.x, point.z) <= pad;
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

// Canyon ribbons in the Digit1 chase corridor. Glass and the retail shopfront
// are the same kind of stand-in: while the PlanD clip is mounted, either one
// hides the 2017 photograph. The retail mesh is HkCentralStreetWalls. Its atlas
// is the orange tile, black mouth, and red/green sign bands. Pass that list
// here too. ?pland=off leaves `enabled` false, so the non-pale shopfront stays.
// A ribbon outside the corridor keeps both faces. The 80 m LandsD disc is not
// this test.
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
  // Towers stay in hiddenIds. podiumFillIds stays empty: the Digit1 right
  // plates are not extruded as grey belt slabs, and they are not replaced
  // with a shopfront ribbon. LandsD charts and the belt-capped PlanD donor
  // are what that look keeps.
  const podiumFillIds = new Set();
  if (!gltfPlan) {
    return {
      sheet: '',
      sheets: [],
      selected: [],
      hiddenIds,
      podiumFillIds,
      skippedSpeck: 0,
      skippedOutside: 0,
      skippedCap: 0,
      reason: ''
    };
  }
  return { ...gltfPlan, hiddenIds, podiumFillIds };
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
