// Central pavement, crossings, and bus stops from OpenStreetMap.
// The carriageway stays the LandsD centreline. This layer is only what OSM tagged:
// a footway or sidewalk way, a crossing node, a bus_stop node, a bench, a street lamp.
// Nothing is added where the extract has no feature.

import { carriagewayWidth, segmentFrame } from './hk-road-deck.js';

export const HK_SIDEWALK_WIDTH = 3.4;
export const HK_FOOTWAY_WIDTH = 2.05;
export const HK_STOP_DEDUPE_M = 8;
// 皇后像廣場 sits 14–21 m from the Des Voeux eye, on the north pavement.
// The roof runs along the kerb. The plate faces the carriageway and crosses
// the eye line (person eye ≈ 1.9 m), so the Chinese name is readable there.
// Nothing here is drawn unless the node is highway=bus_stop and shelter=yes.
export const HK_BUS_SHELTER = Object.freeze({
  roofW: 1.85,
  roofLen: 5.4,
  roofY: 2.46,
  roofH: 0.18,
  roofSetback: 0.85,
  signW: 2.4,
  signH: 0.72,
  signD: 0.08,
  signY: 1.92,
  poleW: 0.16,
  poleY: 0.22,
  poleH: 2.42
});
const ROAD_CELL = 28;

function round1(value) {
  return Math.round(value * 10) / 10;
}

export function parsePavementWidth(raw) {
  if (raw == null || raw === '') return 0;
  const n = parseFloat(String(raw).replace(/,/g, '.').replace(/metres|meters|meter|m/gi, ''));
  if (!Number.isFinite(n) || n < 0.6 || n > 12) return 0;
  return round1(n);
}

export function pavementWidth(tags = {}) {
  const tagged = parsePavementWidth(tags.width);
  if (tagged) return tagged;
  if (tags.footway === 'sidewalk') return HK_SIDEWALK_WIDTH;
  if (tags.highway === 'pedestrian') return 4;
  if (tags.footway === 'alley') return 1.5;
  if (tags.public_transport === 'platform') return 2.4;
  return HK_FOOTWAY_WIDTH;
}

function offGround(tags) {
  if (!tags) return true;
  if (tags.indoor === 'yes' || tags.tunnel === 'yes' || tags.bridge === 'yes') return true;
  if (tags.location === 'underground' || tags.location === 'overground') return true;
  if (tags.layer != null && tags.layer !== '' && tags.layer !== '0') return true;
  if (tags.level != null && tags.level !== '' && tags.level !== '0') return true;
  if (tags.highway === 'steps' || tags.highway === 'corridor' || tags.footway === 'stairway') return true;
  return false;
}

function isCrossingTags(tags) {
  return tags.footway === 'crossing' || tags.highway === 'crossing';
}

function isWalkTags(tags) {
  if (offGround(tags) || isCrossingTags(tags)) return false;
  if (tags.public_transport === 'platform') return true;
  return tags.highway === 'footway' || tags.highway === 'pedestrian' || tags.footway === 'sidewalk';
}

export function crossingPaint(tags = {}) {
  const markings = tags['crossing:markings'];
  const crossing = tags.crossing || '';
  if (markings === 'no' || crossing === 'unmarked' || crossing === 'informal') return null;
  if (markings === 'zebra' || markings === 'yes' || crossing === 'traffic_signals' || crossing === 'uncontrolled' || crossing === 'marked') {
    return 'zebra';
  }
  return null;
}

function stopName(tags) {
  return tags['name:zh'] || tags.name || tags['name:en'] || tags.ref || '';
}

function wayPoints(el, project) {
  const geom = el.geometry;
  if (!Array.isArray(geom) || geom.length < 2) return [];
  const pts = [];
  for (const p of geom) {
    if (!p || !Number.isFinite(p.lon) || !Number.isFinite(p.lat)) continue;
    const [x, z] = project(p.lon, p.lat);
    const point = { x: round1(x), z: round1(z) };
    const prev = pts[pts.length - 1];
    if (prev && Math.hypot(prev.x - point.x, prev.z - point.z) < 0.35) continue;
    pts.push(point);
  }
  return pts;
}

function ringArea(pts) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  }
  return Math.abs(area) * 0.5;
}

function isFilledArea(tags, pts) {
  if (tags.area !== 'yes' || pts.length < 4) return false;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (Math.hypot(a.x - b.x, a.z - b.z) > 1.2) return false;
  const area = ringArea(pts);
  return area >= 20 && area <= 4500;
}

function dedupeStops(stops) {
  const ranked = stops.slice().sort((a, b) => (b.shelter - a.shelter) || (b.name.length - a.name.length));
  const kept = [];
  for (const stop of ranked) {
    if (kept.some((other) => Math.hypot(other.x - stop.x, other.z - stop.z) < HK_STOP_DEDUPE_M)) continue;
    kept.push(stop);
  }
  return kept;
}

export function collectHkPedestrian(elements, project) {
  const walks = [];
  const areas = [];
  const crossings = [];
  const stops = [];
  const furniture = [];
  for (const el of elements || []) {
    const tags = el.tags || {};
    if (el.type === 'node') {
      if (!Number.isFinite(el.lon) || !Number.isFinite(el.lat)) continue;
      const [x, z] = project(el.lon, el.lat);
      const point = { x: round1(x), z: round1(z) };
      if (tags.highway === 'bus_stop') {
        stops.push({ ...point, name: stopName(tags), shelter: tags.shelter === 'yes' });
      } else if (tags.highway === 'crossing') {
        const paint = crossingPaint(tags);
        if (paint) crossings.push({ ...point, paint });
      } else if (tags.amenity === 'bench') {
        furniture.push({ ...point, kind: 'bench' });
      } else if (tags.highway === 'street_lamp') {
        furniture.push({ ...point, kind: 'lamp' });
      }
      continue;
    }
    if (el.type !== 'way') continue;
    const pts = wayPoints(el, project);
    if (pts.length < 2) continue;
    if (isCrossingTags(tags)) {
      const paint = crossingPaint(tags);
      if (paint) {
        const mid = pts[Math.floor((pts.length - 1) / 2)];
        crossings.push({ x: mid.x, z: mid.z, paint });
      }
      continue;
    }
    if (!isWalkTags(tags)) continue;
    if (isFilledArea(tags, pts)) {
      areas.push(pts.map((p) => ({ x: p.x, z: p.z })));
      continue;
    }
    walks.push({
      w: pavementWidth(tags),
      pts: pts.flatMap((p) => [p.x, p.z])
    });
  }
  return {
    walks,
    areas,
    crossings,
    stops: dedupeStops(stops),
    furniture
  };
}

function roadSegments(roads) {
  const segs = [];
  for (const road of roads || []) {
    const width = carriagewayWidth(road);
    const pts = road.pts || [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a || !b) continue;
      const frame = segmentFrame(a.x, a.z, b.x, b.z);
      if (!frame) continue;
      segs.push({
        ...frame,
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        half: width * 0.5,
        width
      });
    }
  }
  return segs;
}

function buildGrid(segs) {
  const grid = new Map();
  for (const seg of segs) {
    const pad = seg.half + 16;
    const ix0 = Math.floor((Math.min(seg.ax, seg.bx) - pad) / ROAD_CELL);
    const ix1 = Math.floor((Math.max(seg.ax, seg.bx) + pad) / ROAD_CELL);
    const iz0 = Math.floor((Math.min(seg.az, seg.bz) - pad) / ROAD_CELL);
    const iz1 = Math.floor((Math.max(seg.az, seg.bz) + pad) / ROAD_CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = `${ix}:${iz}`;
        let bucket = grid.get(key);
        if (!bucket) grid.set(key, (bucket = []));
        bucket.push(seg);
      }
    }
  }
  return grid;
}

function candidates(grid, x, z) {
  const ix = Math.floor(x / ROAD_CELL);
  const iz = Math.floor(z / ROAD_CELL);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const bucket = grid.get(`${ix + dx}:${iz + dz}`);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

function projectToSeg(px, pz, seg) {
  const dx = seg.bx - seg.ax;
  const dz = seg.bz - seg.az;
  const len2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - seg.ax) * dx + (pz - seg.az) * dz) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const x = seg.ax + t * dx;
  const z = seg.az + t * dz;
  return { d: Math.hypot(px - x, pz - z), x, z, t, seg };
}

function nearestRoad(grid, x, z, limit) {
  let best = null;
  for (const seg of candidates(grid, x, z)) {
    const hit = projectToSeg(x, z, seg);
    if (hit.d > limit) continue;
    if (!best || hit.d < best.d) best = hit;
  }
  return best;
}

function inCarriageway(grid, x, z) {
  const hit = nearestRoad(grid, x, z, 24);
  return !!(hit && hit.d < hit.seg.half - 0.35);
}

function faceYaw(stop, hit) {
  if (!hit) return 0;
  const side = (stop.x - hit.x) * hit.seg.rx + (stop.z - hit.z) * hit.seg.rz;
  const sign = side >= 0 ? 1 : -1;
  const nx = -sign * hit.seg.rx;
  const nz = -sign * hit.seg.rz;
  return Math.atan2(nx, nz);
}

export function planHkStreetGround(features, roads) {
  const segs = roadSegments(roads);
  const grid = buildGrid(segs);
  const walks = [];
  for (const walk of features?.walks || []) {
    const width = walk.w > 0 ? walk.w : HK_FOOTWAY_WIDTH;
    const pts = walk.pts || [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const frame = segmentFrame(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], 0.8);
      if (!frame) continue;
      if (inCarriageway(grid, frame.x, frame.z)) continue;
      walks.push({ x: frame.x, z: frame.z, yaw: frame.yaw, w: width, len: frame.len });
    }
  }
  const areas = [];
  for (const ring of features?.areas || []) {
    if (!ring || ring.length < 3) continue;
    let x = 0;
    let z = 0;
    for (const p of ring) {
      x += p.x;
      z += p.z;
    }
    x /= ring.length;
    z /= ring.length;
    if (inCarriageway(grid, x, z)) continue;
    areas.push(ring);
  }
  const crossings = [];
  const seen = [];
  let crossingSites = 0;
  for (const node of features?.crossings || []) {
    if (node.paint !== 'zebra') continue;
    const hit = nearestRoad(grid, node.x, node.z, 12);
    if (!hit) continue;
    if (seen.some((other) => Math.hypot(other.x - hit.x, other.z - hit.z) < 9)) continue;
    seen.push(hit);
    crossingSites++;
    const across = Math.max(2.2, hit.seg.width - 1.05);
    const bar = 0.42;
    const gap = 0.5;
    const count = 6;
    for (let i = 0; i < count; i++) {
      const u = (i - (count - 1) / 2) * (bar + gap);
      crossings.push({
        x: hit.x + hit.seg.dx * u,
        z: hit.z + hit.seg.dz * u,
        yaw: hit.seg.yaw,
        w: across,
        len: bar
      });
    }
  }
  const stops = [];
  for (const stop of features?.stops || []) {
    const hit = nearestRoad(grid, stop.x, stop.z, 22);
    const inRoad = !!(hit && hit.d < hit.seg.half - 0.2);
    stops.push({
      x: stop.x,
      z: stop.z,
      yaw: faceYaw(stop, hit),
      roadYaw: hit ? hit.seg.yaw : 0,
      name: stop.name || '',
      shelter: !!stop.shelter,
      inRoad
    });
  }
  const furniture = [];
  for (const item of features?.furniture || []) {
    if (item.kind !== 'bench' && item.kind !== 'lamp') {
      const unknown = item.kind;
      throw new Error(`Unhandled street furniture ${unknown}`);
    }
    if (inCarriageway(grid, item.x, item.z)) continue;
    const hit = nearestRoad(grid, item.x, item.z, 18);
    furniture.push({
      x: item.x,
      z: item.z,
      yaw: hit ? hit.seg.yaw : 0,
      kind: item.kind
    });
  }
  return { walks, areas, crossings, crossingSites, stops, furniture };
}
