import assert from 'node:assert/strict';
import test from 'node:test';
import { HK_CORE_WORLD, ROADS } from '../js/city-config.js';
import {
  carriagewayWidth,
  expandDashes,
  HK_CURB_W,
  HK_KERB_STONE,
  HK_WALK_W,
  isTwoWay,
  markingLayout,
  markingPose,
  planHkRoadDeck,
  segmentFrame
} from '../js/hk-road-deck.js';

test('carriageway width keeps a real tag and only floors a hairline', () => {
  assert.equal(carriagewayWidth({ w: 3, lanes: 1 }), 3.6);
  assert.equal(carriagewayWidth({ w: 5, lanes: 1 }), 5);
  assert.equal(carriagewayWidth({ w: 7, lanes: 2 }), 7);
  assert.equal(carriagewayWidth({ w: 6, lanes: 2 }), 6);
  assert.equal(carriagewayWidth({ w: 10, lanes: 3 }), 10);
  assert.equal(carriagewayWidth({ w: 11, lanes: 3 }), 11);
  assert.equal(carriagewayWidth({ w: 17, lanes: 5, highway: true }), 17);
  assert.equal(carriagewayWidth({ w: 4, lanes: 2, highway: true }), 10.5);
  assert.equal(carriagewayWidth({ w: 40, lanes: 8 }), 22);
  assert.equal(carriagewayWidth({}), 3.6);
});

test('travel direction treats an untagged centreline as two-way', () => {
  assert.equal(isTwoWay('TW'), true);
  assert.equal(isTwoWay(''), true);
  assert.equal(isTwoWay(0), true);
  assert.equal(isTwoWay('FT'), false);
  assert.equal(isTwoWay('TF'), false);
});

test('segment frame points along the centreline and rejects a stub', () => {
  const south = segmentFrame(0, 0, 0, 10);
  assert.equal(south.len, 10);
  assert.ok(Math.abs(south.yaw) < 1e-9);
  assert.equal(south.rx, -1);
  assert.equal(south.rz, 0);
  assert.equal(segmentFrame(0, 0, 0.2, 0), null);
});

test('two-way paint is a double yellow centre, one-way paint is white lane dashes', () => {
  const two = markingLayout({ width: 11, lanes: 3, dir: 'TW', length: 40 });
  assert.equal(two.filter((m) => m.role === 'centre' && m.color === 'yellow').length, 2);
  assert.ok(two.filter((m) => m.role === 'edge' && m.color === 'white').length >= 2);
  assert.equal(two.some((m) => m.role === 'lane'), true);

  const one = markingLayout({ width: 10.2, lanes: 3, dir: 'FT', length: 40 });
  assert.equal(one.some((m) => m.role === 'centre'), false);
  assert.equal(one.filter((m) => m.role === 'lane' && m.color === 'white' && m.dash > 0).length, 2);

  const junction = markingLayout({
    width: 11,
    lanes: 3,
    dir: 'TW',
    length: 36,
    junctionStart: false,
    junctionEnd: true
  });
  assert.ok(junction.some((m) => m.role === 'stop' && m.color === 'white'));
  assert.ok(junction.filter((m) => m.role === 'box' && m.color === 'yellow').length >= 3);
});

test('dashes leave a gap and a pose sits on the carriageway', () => {
  const dashes = expandDashes({ role: 'lane', color: 'white', offset: 1.5, width: 0.16, u0: 0, u1: 30, dash: 10, duty: 0.5 });
  assert.ok(dashes.length >= 2);
  assert.ok(dashes[1].u0 - dashes[0].u1 > 1);
  assert.equal(dashes.every((d) => d.dash === 0), true);

  const frame = segmentFrame(0, 0, 0, 10);
  const pose = markingPose(frame, { role: 'lane', color: 'white', offset: 2, width: 0.16, u0: 0, u1: 10, dash: 0 });
  assert.ok(Math.abs(pose.x + 2) < 1e-6);
  assert.ok(Math.abs(pose.z - 5) < 1e-6);
  assert.equal(pose.w, 0.16);
  assert.equal(pose.len, 10);
});

test('parallel centrelines share one painted corridor and keep the outer curb', () => {
  const box = { minX: -80, maxX: 80, minZ: -80, maxZ: 80 };
  const deck = planHkRoadDeck([
    { name: 'DES VOEUX', w: 10, lanes: 3, dir: 'FT', highway: false, pts: [{ x: 0, z: 0 }, { x: 0, z: 40 }] },
    { name: 'DES VOEUX', w: 6, lanes: 2, dir: 'FT', highway: false, pts: [{ x: 4, z: 0 }, { x: 4, z: 40 }] },
    { name: 'SIDE', w: 3, lanes: 1, dir: 'FT', highway: false, pts: [{ x: 0, z: 40 }, { x: 30, z: 40 }] },
    { name: 'FAR', w: 11, lanes: 3, dir: 'TW', highway: false, pts: [{ x: 500, z: 500 }, { x: 560, z: 500 }] }
  ], box);

  const des = deck.asphalt.filter((s) => s.name === 'DES VOEUX');
  assert.equal(des.length, 2);
  assert.ok(des.some((s) => s.w >= 10));
  assert.ok(des.some((s) => Math.abs(s.x - 4) < 0.01 && s.w === 6));

  const mid = deck.markings.filter((m) => m.z > 8 && m.z < 32);
  assert.ok(mid.length > 0);
  assert.ok(mid.every((m) => Math.abs(m.x) < 5.5), 'paint stays on the wider carriageway');
  assert.ok(mid.some((m) => m.role === 'lane' && m.color === 'white'));
  assert.equal(mid.some((m) => m.role === 'centre'), false);

  const between = deck.sidewalks.filter((s) => s.x > 0.4 && s.x < 3.6 && s.z > 5 && s.z < 35);
  assert.equal(between.length, 0);
  const outer = deck.sidewalks.filter((s) => (s.x < -5 || s.x > 8) && s.z > 5 && s.z < 35);
  assert.ok(outer.length >= 2);
  const curbs = deck.curbs.filter((s) => s.z > 5 && s.z < 35);
  assert.ok(curbs.some((s) => s.x < -4));
  assert.ok(curbs.some((s) => s.x > 7));

  assert.ok(curbs.every((s) => s.w === HK_KERB_STONE));
  assert.equal(deck.markings.filter((m) => m.x > 400).length, 0);
  assert.ok(deck.asphalt.some((s) => s.name === 'FAR' && s.w >= 11));
  assert.ok(deck.markings.some((m) => m.role === 'stop'));
});

test('committed Des Voeux Central is an asphalt corridor with paint and a curb', () => {
  const deck = planHkRoadDeck(ROADS, HK_CORE_WORLD);
  assert.ok(deck.asphalt.length > 1000);
  assert.ok(deck.asphalt.every((s) => s.w >= 3.2 && s.w <= 22));

  const named = ROADS.find((r) => r.raw === 'DES VOEUX ROAD CENTRAL' && r.w >= 10);
  assert.ok(named);
  const a = named.pts[0];
  const b = named.pts[1];
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const near = (list, radius) => list.filter((s) => Math.hypot(s.x - mx, s.z - mz) < radius);
  const asphalt = near(deck.asphalt, 16);
  assert.ok(asphalt.some((s) => s.w >= 8), 'Des Voeux carriageway is wider than a map stroke');
  const paint = near(deck.markings, 20);
  assert.ok(paint.some((s) => s.color === 'white' && (s.role === 'lane' || s.role === 'edge')));
  const curbs = near(deck.curbs, 24);
  assert.ok(curbs.length >= 1);
  const half = Math.max(...asphalt.map((s) => s.w)) / 2;
  assert.ok(curbs.some((s) => Math.hypot(s.x - mx, s.z - mz) > half * 0.45));

  const chater = ROADS.find((r) => r.raw === 'CHATER ROAD' && r.dir === 'TW');
  const c0 = chater.pts[0];
  const c1 = chater.pts[1];
  const cx = (c0.x + c1.x) / 2;
  const cz = (c0.z + c1.z) / 2;
  const yellow = deck.markings.filter((s) => s.color === 'yellow' && Math.hypot(s.x - cx, s.z - cz) < 24);
  assert.ok(yellow.length >= 1);
});

test('the kerb stone is narrower than the canyon margin and the walk keeps the outer edge', () => {
  assert.equal(HK_KERB_STONE, 0.18);
  assert.ok(HK_KERB_STONE < HK_CURB_W);
  const deck = planHkRoadDeck([
    { name: 'DES VOEUX', w: 10, lanes: 3, dir: 'FT', highway: false, pts: [{ x: 0, z: 0 }, { x: 0, z: 40 }] }
  ], { minX: -80, maxX: 80, minZ: -80, maxZ: 80 });
  const curb = deck.curbs.find((s) => s.x < 0 && s.z > 5 && s.z < 35);
  const walk = deck.sidewalks.find((s) => s.x < 0 && s.z > 5 && s.z < 35);
  assert.ok(curb);
  assert.ok(walk);
  const half = 5;
  assert.equal(curb.w, HK_KERB_STONE);
  assert.ok(Math.abs(Math.abs(curb.x) - (half + HK_KERB_STONE * 0.5)) < 1e-6);
  const outer = Math.abs(walk.x) + walk.w * 0.5;
  const inner = Math.abs(walk.x) - walk.w * 0.5;
  assert.ok(Math.abs(outer - (half + HK_CURB_W + HK_WALK_W)) < 1e-6);
  assert.ok(Math.abs(inner - (half + HK_KERB_STONE)) < 1e-6);
});
