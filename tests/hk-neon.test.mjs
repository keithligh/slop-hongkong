import assert from 'node:assert/strict';
import test from 'node:test';
import { HK_CORE_WORLD, HONG_KONG_ISLAND_COASTLINE } from '../js/city-config.js';
import { planHkStreetCanyon, pointInRing } from '../js/hk-ground-fill.js';
import {
  HK_BLADE_COPY,
  HK_FASCIA_COPY,
  centralCanyonWalls,
  hkNeonDensity,
  hkNeonPoint,
  planHkCanyonNeon
} from '../js/hk-neon.js';

const SIMPLIFIED = /[银钟药发电万宁参楼厅产馆烧饭换宝图书险号锁叶云面车铺东国华门开长]/u;

function faceWall(raw, len, extras = {}) {
  return {
    x: -9,
    z: 0,
    yaw: 0,
    depth: 12,
    len,
    side: 1,
    rx: -1,
    rz: 0,
    dx: 0,
    dz: 1,
    raw,
    highway: false,
    narrow: false,
    ...extras
  };
}

test('density packs Des Voeux tighter than a side street, and skips highways', () => {
  const dv = hkNeonDensity('DES VOEUX ROAD CENTRAL');
  const side = hkNeonDensity('WELLINGTON STREET');
  const shop = hkNeonDensity("QUEEN'S ROAD CENTRAL");
  const other = hkNeonDensity('CONNAUGHT ROAD CENTRAL');
  const alley = hkNeonDensity('', { narrow: true });
  const highway = hkNeonDensity('HARCOURT ROAD', { highway: true });
  assert.equal(dv.id, 'des-voeux');
  assert.equal(side.id, 'side');
  assert.equal(shop.id, 'shop');
  assert.equal(other.id, 'other');
  assert.equal(alley.id, 'side');
  assert.equal(highway.rows, 0);
  assert.ok(dv.blade < side.blade && side.blade < other.blade);
  assert.ok(dv.fascia < side.fascia && side.fascia <= shop.fascia && shop.fascia < other.fascia);
  assert.equal(dv.rows, 2);
  assert.equal(side.rows, 2);
  assert.equal(shop.rows, 2);
  assert.equal(other.rows, 1);
  assert.ok(dv.high > 0 && dv.high < dv.blade + side.blade);
});

test('a point sits proud of the street face, on either side of the carriageway', () => {
  const east = { x: 0, z: 0, depth: 10, side: 1, rx: -1, rz: 0, dx: 0, dz: 1 };
  const west = { ...east, side: -1 };
  const a = hkNeonPoint(east, 4, 0.2);
  const b = hkNeonPoint(west, 4, 0.2);
  assert.ok(Math.abs(a.x - 5.2) < 1e-9);
  assert.ok(Math.abs(a.z - 4) < 1e-9);
  assert.ok(Math.abs(b.x + 5.2) < 1e-9);
  assert.ok(Math.abs(b.z - 4) < 1e-9);
});

test('shop copy is Traditional Chinese in more than one neon colour', () => {
  const copy = [...HK_BLADE_COPY, ...HK_FASCIA_COPY];
  assert.ok(copy.length > 40);
  const families = new Set();
  for (const sign of copy) {
    assert.match(sign.text, /^[\u3400-\u9FFF]+$/u);
    assert.equal(SIMPLIFIED.test(sign.text), false, sign.text);
    assert.equal(/[A-Za-z0-9]/.test(sign.text), false);
    const n = parseInt(sign.bg.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    if (r > 160 && g > 60 && g < 180 && b < 80) families.add('orange');
    else if (r > 180 && g > 160 && b < 140) families.add('yellow');
    else if (r > 140 && r > g + 40 && r > b + 40) families.add('red');
    else if (g > 70 && g >= r - 10 && b < 140) families.add('green');
    else if (b > 90 && b > r && b >= g - 20) families.add('blue');
  }
  for (const family of ['red', 'orange', 'green', 'blue', 'yellow']) {
    assert.ok(families.has(family), family);
  }
  assert.ok(HK_FASCIA_COPY.some((sign) => sign.text === '茶餐廳'));
  assert.ok(HK_BLADE_COPY.some((sign) => sign.text === '參茸藥材'));
  assert.ok(HK_FASCIA_COPY.some((sign) => sign.text === '雲吞麵'));
});

test('one block of canyon gets many boards and strips, highways get none', () => {
  const dv = planHkCanyonNeon([faceWall('DES VOEUX ROAD CENTRAL', 96)]);
  const side = planHkCanyonNeon([faceWall('POTTINGER STREET', 96)]);
  const other = planHkCanyonNeon([faceWall('CONNAUGHT ROAD CENTRAL', 96)]);
  const highway = planHkCanyonNeon([{ ...faceWall('HARCOURT ROAD', 96), highway: true }]);
  const blades = dv.signs.filter((sign) => sign.kind === 'blade');
  const strips = dv.signs.filter((sign) => sign.kind === 'fascia');
  assert.ok(blades.length >= 8 && blades.length <= 18, `blades ${blades.length}`);
  assert.ok(strips.length >= 16 && strips.length <= 36, `strips ${strips.length}`);
  assert.ok(dv.signs.length > side.signs.length, `dv ${dv.signs.length} side ${side.signs.length}`);
  assert.ok(side.signs.length > other.signs.length, `side ${side.signs.length} other ${other.signs.length}`);
  assert.equal(highway.signs.length, 0);
  assert.equal(dv.arms.length, blades.length);
  const colours = new Set(dv.signs.map((sign) => sign.bg));
  assert.ok(colours.size >= 4, `colours ${colours.size}`);
  for (const sign of dv.signs) {
    assert.match(sign.text, /^[\u3400-\u9FFF]+$/u);
    assert.equal(SIMPLIFIED.test(sign.text), false, sign.text);
    assert.ok(sign.y > 2.4 && sign.y < 8.05, `y ${sign.y}`);
    assert.ok(Math.abs(sign.z) < 48);
    if (sign.kind === 'blade') assert.ok(sign.y - sign.h * 0.5 > 2.5);
  }
  for (const arm of dv.arms) {
    assert.ok(arm.y > 4 && arm.y < 8.05, `arm ${arm.y}`);
    assert.ok(arm.len > 0.3 && arm.len < 1.4);
  }
});

test('signs hang on the street face of a Des Voeux canyon and stay out of the lane', () => {
  const island = [
    { x: -40, z: -10 },
    { x: 40, z: -10 },
    { x: 40, z: 120 },
    { x: -40, z: 120 }
  ];
  const roads = [{
    raw: 'DES VOEUX ROAD CENTRAL',
    name: 'Des Voeux Road Central',
    w: 7,
    lanes: 2,
    dir: 'FT',
    highway: false,
    pts: [{ x: 0, z: 0 }, { x: 0, z: 96 }]
  }];
  const lot = (minX, maxX) => ({
    minX,
    maxX,
    minZ: 4,
    maxZ: 92,
    height: 40,
    poly: [{ x: minX, z: 4 }, { x: maxX, z: 4 }, { x: maxX, z: 92 }, { x: minX, z: 92 }]
  });
  const plan = planHkStreetCanyon({
    roads,
    buildings: [lot(16, 40), lot(-40, -16)],
    core: { minX: -50, maxX: 50, minZ: -20, maxZ: 120 },
    island
  });
  assert.equal(plan.walls.length, 2);
  assert.equal(plan.walls.every((wall) => wall.raw === 'DES VOEUX ROAD CENTRAL'), true);
  const neon = planHkCanyonNeon(plan.walls);
  assert.ok(neon.signs.length >= 24 && neon.signs.length <= 90, `signs ${neon.signs.length}`);
  const blades = neon.signs.filter((sign) => sign.kind === 'blade');
  const strips = neon.signs.filter((sign) => sign.kind === 'fascia');
  assert.ok(blades.length >= 10 && strips.length >= 16, `blades ${blades.length} strips ${strips.length}`);
  for (const sign of neon.signs) {
    assert.ok(Math.abs(sign.x) > 4.2 && Math.abs(sign.x) < 7.2, `x ${sign.x}`);
    assert.equal(pointInRing(sign.x, sign.z, island), true);
    const host = plan.walls.find((wall) => Math.sign(wall.x) === Math.sign(sign.x));
    const along = (sign.z - host.z) * host.dz + (sign.x - host.x) * host.dx;
    assert.ok(Math.abs(along) <= host.len * 0.5 + 0.05);
    if (sign.kind === 'fascia') {
      const nx = Math.sin(sign.rotY);
      assert.ok(sign.x * nx < 0, 'the strip faces the carriageway');
    }
  }
});

test('Central Des Voeux shows several 繁體 signs from the street camera', () => {
  const walls = centralCanyonWalls();
  const neon = planHkCanyonNeon(walls);
  const cam = { x: -1.4, z: 29.3 };
  const near = neon.signs.filter((sign) => Math.hypot(sign.x - cam.x, sign.z - cam.z) < 28);
  const blades = near.filter((sign) => sign.kind === 'blade');
  const strips = near.filter((sign) => sign.kind === 'fascia');
  assert.ok(near.length >= 8 && near.length <= 48, `near ${near.length}`);
  assert.ok(blades.length >= 2, `blades ${blades.length}`);
  assert.ok(strips.length >= 4, `strips ${strips.length}`);
  const minD = Math.min(...near.map((sign) => Math.hypot(sign.x - cam.x, sign.z - cam.z)));
  assert.ok(minD > 4 && minD < 16, `nearest ${minD}`);
  const colours = new Set(near.map((sign) => sign.bg));
  assert.ok(colours.size >= 3, `colours ${[...colours].join(' ')}`);
  for (const sign of near) {
    assert.match(sign.text, /^[\u3400-\u9FFF]+$/u);
    assert.equal(SIMPLIFIED.test(sign.text), false, sign.text);
    assert.ok(sign.x >= HK_CORE_WORLD.minX - 2 && sign.x <= HK_CORE_WORLD.maxX + 2);
    assert.ok(sign.z >= HK_CORE_WORLD.minZ - 2 && sign.z <= HK_CORE_WORLD.maxZ + 2);
  }
  assert.equal(walls.some((wall) => pointInRing(wall.x, wall.z, HONG_KONG_ISLAND_COASTLINE) === false), false);
  const metres = { 'des-voeux': 0, side: 0, other: 0 };
  for (const wall of walls) {
    const density = hkNeonDensity(wall.raw, { highway: wall.highway, narrow: wall.narrow });
    if (metres[density.id] != null) metres[density.id] += wall.len;
  }
  const perMetre = (id) => neon.signs.filter((sign) => sign.tier === id).length / metres[id];
  assert.ok(perMetre('des-voeux') > perMetre('side'), `dv ${perMetre('des-voeux')} side ${perMetre('side')}`);
  assert.ok(perMetre('side') > perMetre('other'), `side ${perMetre('side')} other ${perMetre('other')}`);
});
