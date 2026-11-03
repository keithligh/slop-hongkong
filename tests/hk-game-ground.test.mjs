import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HK_CORE_WORLD, HK_STREET_EYE, ROADS } from '../js/city-config.js';
import { HK_PEDESTRIAN } from '../js/hk-pedestrian-data.js';
import { planHkStreetGround } from '../js/hk-pedestrian.js';
import { planHkRoadDeck } from '../js/hk-road-deck.js';
import { DIGIT1_GROUND_CROPS, HK_GROUND_DECK_NAMES, deckInstancesToYield, resolveGroundTilesRequest } from '../js/hk-ground-tiles-frame.js';
import {
  HK_GAME_GROUND_CROPS,
  HK_GAME_GROUND_DECK,
  HK_GAME_GROUND_OSM,
  classifyGroundHit,
  digit1GameGround,
  digit1GameGroundOwner,
  digit1GroundProbePoints,
  digit1StreetLife,
  digit1StreetLifeReadable
} from '../js/hk-game-ground-frame.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const deck = planHkRoadDeck(ROADS, HK_CORE_WORLD);
const plan = planHkStreetGround(HK_PEDESTRIAN, ROADS);

function insideRibbon(item, x, z) {
  const dx = x - item.x;
  const dz = z - item.z;
  const c = Math.cos(item.yaw);
  const s = Math.sin(item.yaw);
  // Ribbon boxes are unit boxes scaled (w, len) and rotated about Y: local x is width, local z is length.
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= item.w / 2 && Math.abs(lz) <= item.len / 2;
}

function frame(width, height, shade) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const v = shade(x, y);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return data;
}

const W = 100;
const H = 60;
const before = frame(W, H, (x, y) => 40 + ((x * 7 + y * 13) % 50));
const after = frame(W, H, (x, y) => 150 + ((x * 11 + y * 5) % 60));
const gameHits = [
  { label: 'ahead-0', name: 'HkLaneMarkingsWhite' },
  { label: 'ahead-4', name: 'HkRoadCentrelines' },
  { label: 'right-5', name: 'HkSidewalks' }
];
const life = digit1StreetLife(plan, deck);
const live = {
  live: true,
  width: W,
  height: H,
  before,
  after,
  hits: gameHits,
  tilesMounted: false,
  life
};

test('LandsD aerial tiles are opt-in and the default Digit1 eye mounts none', () => {
  assert.equal(resolveGroundTilesRequest('http://localhost/'), null);
  assert.equal(resolveGroundTilesRequest('http://localhost/?at=-1.4,29.3,1.29'), null);
  assert.equal(resolveGroundTilesRequest('http://localhost/?groundTiles=off'), null);
  assert.equal(resolveGroundTilesRequest('http://localhost/?groundTiles=0'), null);
  assert.equal(resolveGroundTilesRequest('http://localhost/?groundTiles=maybe'), null);
  assert.equal(resolveGroundTilesRequest('http://localhost/?groundTiles=on').enabled, true);
  assert.equal(resolveGroundTilesRequest('http://localhost/?groundTiles=1').enabled, true);
  assert.equal(resolveGroundTilesRequest('http://localhost/?groundTiles=true').enabled, true);
});

test('the deck is only punched after the opt-in gate, so the default disc keeps every ribbon', () => {
  const page = read('js/hk-ground-tiles.js');
  const gate = page.indexOf('resolveGroundTilesRequest(href');
  const punch = page.indexOf('punchDeck(cityGroup');
  assert.ok(gate > 0 && punch > gate);
  assert.match(page.slice(gate, gate + 160), /return emptyMount\(\{ disabled: true \}\)/);
  assert.match(read('js/main.js'), /mountHkGroundTiles\(scene, renderer, \{\s*href: window\.location\.href/);
  assert.doesNotMatch(read('js/main.js'), /groundTiles=on/);
  // The yield list is the same one #41 used. Under the opt-in it still names the same deck.
  assert.deepEqual([...HK_GROUND_DECK_NAMES], [
    'HkRoadCentrelines',
    'HkSidewalks',
    'HkCurbs',
    'HkLaneMarkingsWhite',
    'HkLaneMarkingsYellow',
    'HkOsmPavement'
  ]);
  assert.ok(deckInstancesToYield(deck.asphalt).length >= 0);
});

test('mesh names split into tiles, deck and osm', () => {
  assert.equal(classifyGroundHit('HkGroundTile'), 'tiles');
  for (const name of HK_GAME_GROUND_DECK) assert.equal(classifyGroundHit(name), 'deck');
  for (const name of HK_GAME_GROUND_OSM) assert.equal(classifyGroundHit(name), 'osm');
  assert.equal(classifyGroundHit('HongKongCoastGround'), 'other');
  assert.equal(classifyGroundHit(''), 'none');
  assert.equal(classifyGroundHit(undefined), 'none');
  const grid = read('js/city-grid.js');
  for (const name of [...HK_GAME_GROUND_DECK, ...HK_GAME_GROUND_OSM]) assert.match(grid, new RegExp(name));
});

test('probe points start at the eye and walk ahead and to the right of the heading', () => {
  const points = digit1GroundProbePoints();
  assert.equal(points[0].label, 'ahead-0');
  assert.equal(points[0].x, HK_STREET_EYE.x);
  assert.equal(points[0].z, HK_STREET_EYE.z);
  const ahead = points.find((point) => point.label === 'ahead-8');
  assert.ok(Math.abs(ahead.x - (HK_STREET_EYE.x + 8 * Math.sin(HK_STREET_EYE.heading))) < 1e-9);
  assert.ok(Math.abs(ahead.z - (HK_STREET_EYE.z + 8 * Math.cos(HK_STREET_EYE.heading))) < 1e-9);
  const right = points.find((point) => point.label === 'right-5');
  // Looking east (+x), right is south (+z).
  assert.ok(right.z > HK_STREET_EYE.z);
});

test('the plan puts a deck ribbon under the Digit1 eye and the walk', () => {
  const eye = HK_STREET_EYE;
  const underEye = [...deck.asphalt, ...deck.markings].some((item) => insideRibbon(item, eye.x, eye.z));
  assert.equal(underEye, true);
  const points = digit1GroundProbePoints();
  const covered = points.filter((p) => [...deck.asphalt, ...deck.sidewalks, ...deck.curbs, ...plan.walks].some((item) => insideRibbon(item, p.x, p.z)));
  assert.ok(covered.length >= points.length - 1, `covered ${covered.length}/${points.length}`);
});

test('mapped street life is present in the 42 m disc and is OSM / LandsD, not invented', () => {
  assert.equal(digit1StreetLifeReadable(life), true, JSON.stringify(life));
  assert.ok(life.crossings > 0);
  assert.ok(life.stops > 0);
  assert.ok(life.walks > 0);
  assert.equal(digit1StreetLifeReadable(null), false);
  assert.equal(digit1StreetLifeReadable({ ...life, walks: 0 }), false);
  assert.equal(digit1StreetLifeReadable({ ...life, crossings: 0, stops: 0 }), false);
  const grid = read('js/city-grid.js');
  assert.match(grid, /planHkStreetGround\(HK_PEDESTRIAN, ROADS\)/);
  assert.match(grid, /HkCrossings/);
  assert.match(grid, /HkBusStopSign/);
  const page = read('js/hk-game-ground.js');
  assert.doesNotMatch(page, /BoxGeometry|addHkRibbonMesh|MeshStandard/);
});

test('digit1GameGroundOwner needs the eye ray on deck or osm and no tile anywhere', () => {
  assert.equal(digit1GameGroundOwner(gameHits).pass, true);
  assert.equal(digit1GameGroundOwner(gameHits).owner, 'deck');
  assert.equal(digit1GameGroundOwner([{ label: 'ahead-0', name: 'HkOsmPavement' }]).owner, 'osm');
  const tiles = digit1GameGroundOwner([{ label: 'ahead-0', name: 'HkGroundTile' }, ...gameHits.slice(1)]);
  assert.equal(tiles.pass, false);
  assert.equal(tiles.owner, 'tiles');
  const edge = digit1GameGroundOwner([...gameHits, { label: 'right-7', name: 'HkGroundTile' }]);
  assert.equal(edge.game, true);
  assert.equal(edge.pass, false);
  assert.equal(digit1GameGroundOwner([]).owner, 'none');
  assert.equal(digit1GameGroundOwner(undefined).pass, false);
});

test('digit1GameGround passes a live game-deck pair and refuses everything else', () => {
  const ok = digit1GameGround(live);
  assert.equal(ok.pass, true, JSON.stringify(ok));
  assert.equal(ok.reason, 'live-game-ground');
  assert.deepEqual(Object.keys(ok.crops), [...HK_GAME_GROUND_CROPS]);
  for (const name of HK_GAME_GROUND_CROPS) assert.ok(DIGIT1_GROUND_CROPS[name]);

  assert.equal(digit1GameGround().reason, 'live-msi-required');
  assert.equal(digit1GameGround({ ...live, live: false }).pass, false);
  assert.equal(digit1GameGround({ ...live, synthetic: true }).reason, 'live-msi-required');

  const flat = frame(W, H, () => 12);
  assert.equal(digit1GameGround({ ...live, after: flat }).reason, 'blank-frame');

  assert.equal(digit1GameGround({ ...live, tilesMounted: true }).reason, 'tiles-mounted');
  assert.equal(digit1GameGround({ ...live, tilesMounted: undefined }).reason, 'tiles-mounted');
  const tiled = digit1GameGround({ ...live, hits: [{ label: 'ahead-0', name: 'HkGroundTile' }] });
  assert.equal(tiled.pass, false);
  assert.equal(tiled.reason, 'tiles-first-hit');
  assert.equal(digit1GameGround({ ...live, hits: [] }).reason, 'ownership-open');
  assert.equal(digit1GameGround({ ...live, life: { ...life, walks: 0 } }).reason, 'street-life-missing');

  const same = digit1GameGround({ ...live, after: before });
  assert.equal(same.pass, false);
  assert.equal(same.reason, 'below-floor');
  assert.deepEqual(same.open, [...HK_GAME_GROUND_CROPS]);
});

test('Cut #47 does not reopen the tiles method, the far frame, paint, Mapillary or Megascans', () => {
  for (const file of ['js/hk-game-ground-frame.js', 'js/hk-game-ground.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /mapillary|megascans|meshy|fab\.com/i);
    assert.doesNotMatch(source, /hk-gltf|hk-pland/);
    assert.doesNotMatch(source, /createGroundPhotoMaterial|groundPhoto|groundSharpen|groundPriority|groundTint/);
  }
  assert.match(read('js/hk-game-ground-frame.js'), /HkGroundTile/);
  assert.doesNotMatch(read('js/tsl-materials.js'), /mapillary|megascans/i);
});

test('road, kerb and walk materials carry the Cut #47 stone read and keep the wet field', () => {
  const source = read('js/tsl-materials.js');
  assert.match(source, /const stoneChips = Fn/);
  const road = source.slice(source.indexOf('function createRoadSurfaceMaterial'), source.indexOf('function createRoadPaintMaterial'));
  assert.match(road, /stoneChips/);
  assert.match(road, /roadWetMasks/);
  assert.match(road, /uRoadWetness|film/);
  assert.equal(/cManhole|ConEd|manhole/i.test(road), false);
  const kerb = source.slice(source.indexOf('function createCurbMaterial'), source.indexOf('Tileable wind-wave texture'));
  assert.match(kerb, /arris/);
  assert.match(kerb, /stoneChips/);
  assert.match(kerb, /uRoadWetness/);
  const walk = source.slice(source.indexOf('function createSidewalkMaterial'), source.indexOf('function createCurbMaterial'));
  assert.match(walk, /stoneChips/);
  assert.match(walk, /roadWetMasks/);
});

test('docs name the abandoned method, the escape and the bar, and do not claim Sleeping Dogs', () => {
  const tiles = read('docs/HK_GROUND_TILES_CUT.md');
  assert.match(tiles, /Cut #47/);
  assert.match(tiles, /groundTiles=on/);
  assert.match(tiles, /abandoned/i);
  const game = read('docs/HK_GAME_GROUND_CUT.md');
  assert.match(game, /digit1GameGround/);
  assert.match(game, /groundTiles=on/);
  assert.match(game, /SD NOT YET/);
  assert.match(game, /Soft is not SD/i);
  assert.doesNotMatch(game, /achieves? Sleeping Dogs|is Sleeping Dogs|matches Sleeping Dogs/i);
  assert.ok(read('plans/cut47-sd-digit1-game-ground.md').includes('Cut #47'));
});
