import assert from 'node:assert/strict';
import test from 'node:test';
import { HK_CORE_WORLD, HONG_KONG_ISLAND_COASTLINE, ROADS, BLOCKS, blockInHkCore, hkFootprintHeight } from '../js/city-config.js';
import { canyonGlassWalls, clipCanyonWalls, planHkStreetCanyon, pointInRing } from '../js/hk-ground-fill.js';

function contains(wall, x, z) {
  const dx = x - wall.obb.cx;
  const dz = z - wall.obb.cz;
  const lx = dx * wall.obb.cs - dz * wall.obb.sn;
  const lz = dx * wall.obb.sn + dz * wall.obb.cs;
  return Math.abs(lx) <= wall.obb.hx + 1e-6 && Math.abs(lz) <= wall.obb.hz + 1e-6;
}

const island = [
  { x: -80, z: -30 },
  { x: 80, z: -30 },
  { x: 80, z: 80 },
  { x: -80, z: 80 }
];

test('a setback closes onto the footprint and an empty side gets a street wall', () => {
  const roads = [
    { name: 'QUEEN', w: 7, lanes: 2, dir: 'FT', highway: false, pts: [{ x: 0, z: 0 }, { x: 0, z: 40 }] }
  ];
  const buildings = [{
    minX: 16,
    maxX: 34,
    minZ: 8,
    maxZ: 32,
    height: 48,
    poly: [{ x: 16, z: 8 }, { x: 34, z: 8 }, { x: 34, z: 32 }, { x: 16, z: 32 }]
  }];
  const plan = planHkStreetCanyon({ roads, buildings, core: { minX: -50, maxX: 50, minZ: -10, maxZ: 50 }, island });
  const east = plan.walls.filter((wall) => wall.x > 0);
  const west = plan.walls.filter((wall) => wall.x < 0);
  assert.equal(east.length, 1);
  assert.equal(west.length, 1);
  assert.ok(east[0].depth < 12, 'the wall stops at the footprint instead of crossing it');
  assert.ok(east[0].depth > 4);
  assert.equal(contains(east[0], 0, 20), false);
  assert.equal(contains(east[0], 12, 20), true);
  assert.equal(contains(east[0], 20, 20), false);
  assert.ok(Math.abs(west[0].depth - 12) < 0.2);
  assert.equal(contains(west[0], -10, 20), true);
  assert.equal(pointInRing(0, -40, island), false);
});

test('a footprint already on the sidewalk is not buried, and water gets no wall', () => {
  const roads = [
    { name: 'HILL', w: 4, lanes: 1, dir: 'FT', highway: false, pts: [{ x: 0, z: 0 }, { x: 0, z: 30 }] }
  ];
  const tight = [{
    minX: 5.2,
    maxX: 18,
    minZ: 4,
    maxZ: 26,
    height: 30,
    poly: [{ x: 5.2, z: 4 }, { x: 18, z: 4 }, { x: 18, z: 26 }, { x: 5.2, z: 26 }]
  }];
  const shore = [
    { x: -4, z: -5 },
    { x: 30, z: -5 },
    { x: 30, z: 40 },
    { x: -4, z: 40 }
  ];
  const plan = planHkStreetCanyon({
    roads,
    buildings: tight,
    core: { minX: -20, maxX: 40, minZ: -10, maxZ: 40 },
    island: shore
  });
  assert.equal(plan.walls.some((wall) => wall.x > 0), false);
  assert.equal(plan.walls.some((wall) => wall.x < 0), false);
});

test('Central walls crowd Des Voeux and stay off the harbour', () => {
  const buildings = BLOCKS.filter((b) => blockInHkCore(b) && hkFootprintHeight(b) > 0 && b.poly && b.poly.length >= 3);
  const plan = planHkStreetCanyon({
    roads: ROADS,
    buildings,
    core: HK_CORE_WORLD,
    island: HONG_KONG_ISLAND_COASTLINE
  });
  assert.ok(plan.walls.length > 200 && plan.walls.length < 8000);
  assert.equal(plan.walls.some((wall) => contains(wall, 0, -860)), false);
  assert.equal(plan.walls.some((wall) => contains(wall, -1.4, 29.3)), false);
  const verge = plan.walls.some((wall) => contains(wall, -1.4, 14) || contains(wall, -1.4, 8) || contains(wall, 8, 20));
  assert.equal(verge, true);
  for (const wall of plan.walls) {
    assert.equal(pointInRing(wall.x, wall.z, HONG_KONG_ISLAND_COASTLINE), true);
    assert.ok(wall.depth >= 1.5 && wall.depth <= 18.5);
    assert.ok(wall.len >= 3);
  }
});

test('a LandsD footprint hides the canyon stretch it covers and leaves the gap', () => {
  const wall = {
    x: 0,
    z: 0,
    yaw: 0,
    depth: 10,
    len: 40,
    side: 1,
    rx: -1,
    rz: 0,
    dx: 0,
    dz: 1,
    raw: 'DES VOEUX ROAD CENTRAL',
    highway: false,
    narrow: false
  };
  const meshes = [{ minX: -8, maxX: 8, minZ: -6, maxZ: 6 }];
  const pieces = clipCanyonWalls([wall], meshes, { sample: 4, margin: 1, minLen: 3.2 });
  assert.equal(pieces.length, 2);
  assert.ok(pieces.every((piece) => Math.abs(piece.z) > 6));
  assert.ok(pieces.every((piece) => piece.len < 20 && piece.len >= 3.2));
  assert.equal(clipCanyonWalls([wall], []).length, 1);
  const covered = clipCanyonWalls([wall], [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }]);
  assert.equal(covered.length, 0);
});

test('a LandsD mesh within 80 m of the Des Voeux eye removes the canyon in that disc', () => {
  const wall = {
    x: -1.4,
    z: 29.3,
    yaw: Math.PI / 2,
    depth: 8,
    len: 220,
    side: 1,
    rx: 0,
    rz: 1,
    dx: 1,
    dz: 0,
    raw: 'DES VOEUX ROAD CENTRAL',
    highway: false,
    narrow: false
  };
  const beside = [{ minX: -4, maxX: 4, minZ: 50, maxZ: 70 }];
  const untouched = clipCanyonWalls([wall], beside, { sample: 4, minLen: 3.2 });
  assert.equal(untouched.length, 1);
  assert.ok(untouched[0].len > 200);
  const cut = clipCanyonWalls([wall], beside, {
    eye: { x: -1.4, z: 29.3 },
    near: 80,
    sample: 4,
    minLen: 3.2
  });
  assert.ok(cut.length >= 1);
  assert.ok(cut.every((piece) => Math.hypot(piece.x + 1.4, piece.z - 29.3) > 70));
  const far = clipCanyonWalls([wall], [{ minX: 400, maxX: 420, minZ: 400, maxZ: 420 }], {
    eye: { x: -1.4, z: 29.3 },
    near: 80,
    sample: 4,
    minLen: 3.2
  });
  assert.equal(far.length, 1);
  assert.ok(far[0].len > 200);
});

test('a sidewalk ribbon whose outer face hits a LandsD mesh is not drawn over the shopfront', () => {
  const wall = {
    x: 0,
    z: 10,
    yaw: Math.PI / 2,
    depth: 10,
    len: 40,
    side: 1,
    rx: 0,
    rz: 1,
    dx: 1,
    dz: 0,
    raw: 'DES VOEUX ROAD CENTRAL',
    highway: false,
    narrow: false
  };
  // Centreline at z=10 is outside the lot. The outer face at z=15 bites the mesh.
  const mesh = [{ minX: -30, maxX: 30, minZ: 14, maxZ: 48 }];
  assert.equal(clipCanyonWalls([wall], mesh, { sample: 4, margin: 3, minLen: 3.2 }).length, 0);
  const gap = [{ minX: -30, maxX: 30, minZ: 40, maxZ: 70 }];
  const kept = clipCanyonWalls([wall], gap, { sample: 4, margin: 3, minLen: 3.2 });
  assert.equal(kept.length, 1);
  assert.ok(kept[0].len > 30);
});

test('a podium slab whose body reaches a LandsD mesh is not drawn over the shopfront', () => {
  const wall = {
    x: 0,
    z: 0,
    yaw: 0,
    depth: 12,
    len: 20,
    side: 1,
    rx: 0,
    rz: 1,
    dx: 1,
    dz: 0,
    raw: 'DES VOEUX ROAD CENTRAL',
    highway: false,
    narrow: false
  };
  // Centreline at z = 0. Half the 12 m slab reaches z = 6. The photograph starts at z = 8.
  const mesh = [{ minX: -20, maxX: 20, minZ: 8, maxZ: 40 }];
  assert.equal(clipCanyonWalls([wall], mesh, { sample: 4, margin: 3, minLen: 3.2 }).length, 0);
  const clear = [{ minX: -20, maxX: 20, minZ: 30, maxZ: 50 }];
  const kept = clipCanyonWalls([wall], clear, { sample: 4, margin: 3, minLen: 3.2 });
  assert.equal(kept.length, 1);
  assert.ok(kept[0].len > 15);
});

// Digit1 gap ribbon. Centreline is 81.3 m from the eye, so the 80 m disc keeps
// the shopfront. Henderson's box is the photograph the curtain was hiding.
// Long axis across the radius from the eye. Both samples stay just outside
// the 80 m disc, which is the measured 6.5 m ribbon (centreline 81.3 m).
const digit1Gap = {
  x: 77.2,
  z: 49.9,
  yaw: 0,
  depth: 12,
  len: 6.5,
  side: 1,
  rx: 0,
  rz: 1,
  dx: -0.253,
  dz: 0.967,
  raw: 'DES VOEUX ROAD CENTRAL',
  highway: false,
  narrow: false
};
const digit1Eye = { x: -1.4, z: 29.3, heading: 1.29 };
const henderson = {
  minX: 217.54,
  maxX: 263.57,
  minZ: 53.74,
  maxZ: 104.96,
  minH: 5.75,
  maxH: 195.21
};

test('the Digit1 gap keeps its shopfront and drops the curtain in front of Henderson', () => {
  const near = { minX: -4, maxX: 2, minZ: 27, maxZ: 32, minH: 5, maxH: 40 };
  const retail = clipCanyonWalls([digit1Gap], [near, henderson], {
    eye: digit1Eye,
    near: 80,
    sample: 4,
    minLen: 3.2
  });
  assert.equal(retail.length, 1);
  assert.ok(retail[0].len > 5);
  const glass = canyonGlassWalls([digit1Gap], [henderson], { eye: digit1Eye });
  assert.equal(glass.length, 0);
  assert.equal(canyonGlassWalls([digit1Gap], []).length, 1);
  const behind = { ...digit1Gap, x: -80, z: 10 };
  assert.equal(canyonGlassWalls([behind], [henderson], { eye: digit1Eye }).length, 1);
  const kiosk = { ...henderson, minH: 5.75, maxH: 9.75 };
  assert.equal(canyonGlassWalls([digit1Gap], [kiosk], { eye: digit1Eye }).length, 1);
  const courtyard = {
    minX: 300,
    maxX: 360,
    minZ: 80,
    maxZ: 150,
    minH: 5,
    maxH: 80
  };
  assert.equal(canyonGlassWalls([digit1Gap], [courtyard], { eye: digit1Eye }).length, 1);
});
