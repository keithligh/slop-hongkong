import { HK_STREET_EYE, HK_STREET_NEAR, HK_WALK_RADIUS } from './city-config.js';
import { keithEyeGrain, keithEyeMad } from './digit1-far-frame.js';
import {
  DIGIT1_GROUND_CROPS,
  HK_GROUND_BLANK_GRAIN,
  HK_GROUND_MAD_FLOOR,
  HK_GROUND_TILE_DISC,
  cropRgba
} from './hk-ground-tiles-frame.js';

// Cut #47. Digit1 ground is the game deck: LandsD / OSM ribbons, not the Open3DHK
// aerial tiles (#41 to #46, abandoned for the Digit1 eye). The tiles stay behind
// ?groundTiles=on. Nothing here claims Sleeping Dogs; Soft is not SD.

export const HK_GAME_GROUND_OSM = Object.freeze([
  'HkOsmPavement',
  'HkOsmPedestrianArea',
  'HkCrossings'
]);

export const HK_GAME_GROUND_DECK = Object.freeze([
  'HkRoadCentrelines',
  'HkSidewalks',
  'HkCurbs',
  'HkLaneMarkingsWhite',
  'HkLaneMarkingsYellow'
]);

export const HK_GAME_GROUND_TILES = Object.freeze(['HkGroundTile']);

// Crops that must read as a changed street against the #46 tiles frame.
export const HK_GAME_GROUND_CROPS = Object.freeze(['road-ahead', 'right-kerb', 'underfoot']);

// Metres from the eye along the walk heading, and to the right of it (the north
// sidewalk is on the right at ?at=-1.4,29.3,1.29). Down-rays are cast at these.
const AHEAD = Object.freeze([0, 4, 8, 16]);
const RIGHT = Object.freeze([3, 5, 7]);

// The coast plate (olive 0x6a7264) reads teal under the sky. Where the LandsD
// meshes and the canyon ribbons are gone from the 80 m disc, it is the only
// ground between the OSM pavement and the walls: Statue Square, the bank plaza,
// the lots behind the kerb. The plate is paved across the walk fence and the
// overlay disc, and fades back to olive outside it.
export function digit1PlazaDisc(eye = HK_STREET_EYE) {
  return Object.freeze({
    x: eye.x,
    z: eye.z,
    inner: HK_STREET_NEAR,
    outer: HK_STREET_NEAR + 30,
    walk: HK_WALK_RADIUS
  });
}

export function classifyGroundHit(name) {
  if (typeof name !== 'string' || !name) return 'none';
  if (HK_GAME_GROUND_TILES.includes(name)) return 'tiles';
  if (HK_GAME_GROUND_OSM.includes(name)) return 'osm';
  if (HK_GAME_GROUND_DECK.includes(name)) return 'deck';
  return 'other';
}

export function digit1GroundProbePoints(eye = HK_STREET_EYE) {
  const fx = Math.sin(eye.heading);
  const fz = Math.cos(eye.heading);
  const rx = -fz;
  const rz = fx;
  const points = AHEAD.map((d) => ({ label: `ahead-${d}`, x: eye.x + fx * d, z: eye.z + fz * d }));
  for (const d of RIGHT) points.push({ label: `right-${d}`, x: eye.x + rx * d, z: eye.z + rz * d });
  return points;
}

// hits: [{ label, name }] where name is the first mesh a down-ray met. The eye
// point (ahead-0) must be deck or osm, and no probe may be a tile.
export function digit1GameGroundOwner(hits) {
  const rows = (hits || []).map((hit) => ({ label: hit.label, name: hit.name || '', owner: classifyGroundHit(hit.name) }));
  const eyeRow = rows.find((row) => row.label === 'ahead-0');
  const tiles = rows.filter((row) => row.owner === 'tiles').length;
  const owner = eyeRow ? eyeRow.owner : 'none';
  const game = owner === 'deck' || owner === 'osm';
  return { owner, game, tiles, rows, pass: game && tiles === 0 };
}

// Mapped street life inside the disc, counted from the planHkStreetGround output
// and the road deck (not invented props).
export function digit1StreetLife(plan, deck, eye = HK_STREET_EYE, radius = HK_GROUND_TILE_DISC) {
  const near = (item) => Number.isFinite(item?.x) && Number.isFinite(item?.z)
    && Math.hypot(item.x - eye.x, item.z - eye.z) <= radius;
  const count = (list) => (Array.isArray(list) ? list.filter(near).length : 0);
  return {
    asphalt: count(deck?.asphalt),
    sidewalks: count(deck?.sidewalks),
    curbs: count(deck?.curbs),
    markings: count(deck?.markings),
    walks: count(plan?.walks),
    crossings: count(plan?.crossings),
    stops: count(plan?.stops),
    benches: count(plan?.furniture?.filter((item) => item.kind === 'bench')),
    lamps: count(plan?.furniture?.filter((item) => item.kind === 'lamp'))
  };
}

export function digit1StreetLifeReadable(life) {
  if (!life) return false;
  return life.asphalt > 0 && life.sidewalks > 0 && life.curbs > 0 && life.markings > 0
    && life.walks > 0 && (life.crossings > 0 || life.stops > 0);
}

// Cut #47 bar (digit1GameGround). A live pair of Digit1 eye frames: BEFORE is the
// #46 tip with the tiles mounted (03d4ab0) or this page with ?groundTiles=on,
// AFTER is the default page. PASS needs all of:
//   - the capture is live and not synthetic, and the AFTER frame is not blank
//   - the down-ray first hits at and about the eye are deck or osm, never tiles
//   - the tiles did not mount (no HkGroundTile mesh in the AFTER scene)
//   - mapped street life (walks, crossings or stops, kerb, paint) is present in the disc
//   - road-ahead, right-kerb and underfoot each differ from BEFORE by MAD >= 6
// It is a Keith-eye direction bar, not a ground-ownership floor and not Sleeping
// Dogs. Soft PASS is not the Keith eye.
export function digit1GameGround(capture) {
  const empty = { pass: false, reason: 'live-msi-required', owner: 'none', crops: {} };
  if (!capture || capture.live !== true || capture.synthetic === true) return empty;
  const { width, height } = capture;
  const grainAfter = keithEyeGrain(capture.after, width, height);
  if (grainAfter < HK_GROUND_BLANK_GRAIN) return { ...empty, reason: 'blank-frame' };
  const owner = digit1GameGroundOwner(capture.hits);
  if (capture.tilesMounted !== false) return { ...empty, reason: 'tiles-mounted', owner: owner.owner };
  if (!owner.pass) return { ...empty, reason: owner.tiles ? 'tiles-first-hit' : 'ownership-open', owner: owner.owner };
  if (!digit1StreetLifeReadable(capture.life)) return { ...empty, reason: 'street-life-missing', owner: owner.owner };
  const crops = {};
  for (const name of HK_GAME_GROUND_CROPS) {
    const rect = DIGIT1_GROUND_CROPS[name];
    const before = cropRgba(capture.before, width, height, rect);
    const after = cropRgba(capture.after, width, height, rect);
    crops[name] = { mad: keithEyeMad(before.data, after.data, before.width, before.height) };
  }
  const open = HK_GAME_GROUND_CROPS.filter((name) => !(crops[name].mad >= HK_GROUND_MAD_FLOOR));
  const pass = open.length === 0;
  return { pass, reason: pass ? 'live-game-ground' : 'below-floor', owner: owner.owner, crops, open };
}
