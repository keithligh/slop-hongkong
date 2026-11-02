import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HK_STREET_EYE } from '../js/city-config.js';
import {
  HK_GROUND_ATTRIBUTION,
  HK_GROUND_DECK_NAMES,
  HK_GROUND_MAD_FLOOR,
  deckInstancesToYield,
  digit1GroundOwnership,
  ecefToWorld,
  glbPositions,
  groundSnapOffset,
  readGlbMesh,
  parseB3dm,
  resolveGroundTilesRequest,
  ribbonYieldsToGroundTiles,
  selectDigit1GroundTiles,
  tileTriangleYieldsToBuilding,
  worldOfGltfVertex,
  worldToGroundEcef
} from '../js/hk-ground-tiles-frame.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

function roadBody() {
  const source = read('js/tsl-materials.js');
  const start = source.indexOf('function createRoadSurfaceMaterial');
  const end = source.indexOf('function createRoadPaintMaterial');
  return source.slice(start, end);
}

test('road shader no longer draws NYC manhole lids', () => {
  const body = roadBody();
  assert.equal(/cManhole|isManhole|mhCell|ConEd|manhole/i.test(body), false);
  assert.match(body, /return baseAsphalt\.mul\(wetDarkening\)/);
});

test('Digit1 eye round-trips through ECEF into the world frame', () => {
  const ecef = worldToGroundEcef(HK_STREET_EYE.x, HK_STREET_EYE.z, 5);
  const world = ecefToWorld(ecef[0], ecef[1], ecef[2]);
  assert.ok(Math.abs(world.x - HK_STREET_EYE.x) < 0.05);
  assert.ok(Math.abs(world.z - HK_STREET_EYE.z) < 0.05);
  assert.ok(Math.abs(world.y - 5) < 0.05);
});

test('ground snap uses the low tail and chart yield stays above the sidewalk', () => {
  const offset = groundSnapOffset([9, 4.2, 4.5, 12, 4.4]);
  assert.ok(Math.abs(offset - (4.2 - 0.07)) < 1e-9);
  assert.equal(groundSnapOffset([]), null);
  const wall = { minX: -66.9, maxX: 13.4, minZ: 29.2, maxZ: 102.1 };
  assert.equal(tileTriangleYieldsToBuilding({ x: -1.4, y: 0.1, z: 29.3 }, [wall]), false);
  assert.equal(tileTriangleYieldsToBuilding({ x: -1.4, y: 6, z: 40 }, [wall]), true);
  assert.equal(tileTriangleYieldsToBuilding({ x: 80, y: 6, z: 40 }, [wall]), false);
});

test('procedural deck yields only inside the Digit1 disc', () => {
  assert.equal(ribbonYieldsToGroundTiles(-1.4, 29.3), true);
  assert.equal(ribbonYieldsToGroundTiles(80, 29.3), false);
  const indexes = deckInstancesToYield([
    { x: -1.4, z: 29.3 },
    { x: 40, z: 29.3 },
    { x: 200, z: 29.3 }
  ]);
  assert.deepEqual(indexes, [0, 1]);
  assert.equal(resolveGroundTilesRequest('http://localhost/?groundTiles=off'), null);
  assert.equal(resolveGroundTilesRequest('http://localhost/').enabled, true);
});

test('tile walk keeps the mesh on the eye and skips a far sibling', async () => {
  const eye = worldToGroundEcef(HK_STREET_EYE.x, HK_STREET_EYE.z, 5);
  const near = [eye[0], eye[1], eye[2], 5, 0, 0, 0, 5, 0, 0, 0, 5];
  const far = [eye[0] + 8000, eye[1], eye[2], 5, 0, 0, 0, 5, 0, 0, 0, 5];
  const docs = {
    'tileset.json': {
      root: {
        refine: 'REPLACE',
        children: [
          {
            geometricError: 1,
            boundingVolume: { box: near },
            content: { uri: 'nest/tileset.json' }
          },
          {
            geometricError: 0,
            boundingVolume: { box: far },
            content: { uri: 'far.b3dm' }
          }
        ]
      }
    },
    'nest/tileset.json': {
      root: {
        refine: 'REPLACE',
        boundingVolume: { box: near },
        geometricError: 0,
        content: { uri: 'eye.b3dm' }
      }
    }
  };
  const fetched = [];
  const tiles = await selectDigit1GroundTiles({
    root: 'https://tiles.example/tileset.json',
    key: '',
    fetchImpl: async (href) => {
      fetched.push(href);
      const name = new URL(href).pathname.replace(/^\//, '');
      if (!docs[name]) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => docs[name] };
    }
  });
  assert.deepEqual(fetched.filter((href) => href.endsWith('.b3dm')), []);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].url, 'https://tiles.example/nest/eye.b3dm');
  assert.ok(tiles[0].centre < 1);
});

function paint(buffer, width, x, y, rgb) {
  const offset = (y * width + x) * 4;
  buffer[offset] = rgb[0];
  buffer[offset + 1] = rgb[1];
  buffer[offset + 2] = rgb[2];
  buffer[offset + 3] = 255;
}

function crops() {
  const width = 12;
  const height = 8;
  const before = new Uint8ClampedArray(width * height * 4);
  const after = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      paint(before, width, x, y, [40, 42, 44]);
      const grit = ((x * 3 + y * 5) % 7) * 12;
      paint(after, width, x, y, [70 + grit, 68 + (grit >> 1), 60]);
    }
  }
  return { before, after, width, height };
}

test('digit1GroundOwnership passes only on a live photo-mesh crop', () => {
  const { before, after, width, height } = crops();
  assert.equal(digit1GroundOwnership().pass, false);
  assert.equal(digit1GroundOwnership({
    live: true,
    synthetic: true,
    ownership: 'tiles',
    before,
    after,
    width,
    height
  }).pass, false);
  const megascans = digit1GroundOwnership({
    live: true,
    ownership: 'megascans',
    before,
    after,
    width,
    height
  });
  assert.equal(megascans.pass, false);
  assert.equal(megascans.reason, 'ownership-open');
  assert.ok(megascans.mad >= HK_GROUND_MAD_FLOOR);
  const manhole = digit1GroundOwnership({
    live: true,
    ownership: 'procedural',
    before,
    after,
    width,
    height
  });
  assert.equal(manhole.pass, false);
  assert.equal(manhole.reason, 'ownership-open');
  const flat = new Uint8ClampedArray(before);
  const quiet = digit1GroundOwnership({
    live: true,
    ownership: 'tiles',
    before,
    after: flat,
    width,
    height
  });
  assert.equal(quiet.pass, false);
  assert.equal(quiet.reason, 'below-floor');
  const live = digit1GroundOwnership({
    live: true,
    ownership: 'tiles',
    before,
    after,
    width,
    height
  });
  assert.equal(live.pass, true);
  assert.equal(live.reason, 'live-ground');
  assert.equal(digit1GroundOwnership({
    live: true,
    ownership: 'infrastructure',
    before,
    after,
    width,
    height
  }).pass, true);
});

test('page mounts LandsD tiles and yields the named deck', () => {
  const main = read('js/main.js');
  const grid = read('js/city-grid.js');
  const page = read('js/hk-ground-tiles.js');
  assert.match(main, /mountHkGroundTiles\(scene, renderer/);
  assert.match(page, /selectDigit1GroundTiles/);
  assert.match(read('js/hk-ground-tiles-frame.js'), /3dtiles\/f2\/tileset\.json/);
  assert.match(page, /hkGroundTilePhoto/);
  assert.match(page, /tileTriangleYieldsToBuilding/);
  assert.match(grid, /hkCentres/);
  for (const name of HK_GROUND_DECK_NAMES) assert.match(grid, new RegExp(name));
  assert.match(HK_GROUND_ATTRIBUTION, /Lands Department/);
  assert.match(HK_GROUND_ATTRIBUTION, /CSDI/);
  assert.match(read('index.html'), /hud-ground-credit/);
  assert.doesNotMatch(page, /mapillary|megascans|meshy/i);
});

test('published tileset leaf covers the Digit1 eye', { timeout: 40000 }, async () => {
  const tiles = await selectDigit1GroundTiles();
  assert.ok(tiles.length >= 8);
  assert.ok(tiles.length <= 72);
  const closest = tiles[0];
  assert.ok(closest.centre < 12, `closest centre ${closest.centre}`);
  assert.match(closest.url, /\.b3dm(\?|$)/);
  const res = await fetch(closest.url);
  assert.equal(res.ok, true);
  const packed = parseB3dm(new Uint8Array(await res.arrayBuffer()));
  const positions = glbPositions(packed.glb);
  const mesh = readGlbMesh(packed.glb);
  assert.ok(positions.length >= 9);
  assert.ok(mesh.indices.length >= 3);
  assert.equal(mesh.ktx2[0], 0xab);
  assert.equal(String.fromCharCode(...mesh.ktx2.subarray(1, 7)), 'KTX 20');
  let best = Infinity;
  const stride = Math.max(1, Math.floor(positions.length / 3 / 80));
  for (let i = 0; i < positions.length; i += 3 * stride) {
    const world = worldOfGltfVertex(
      positions[i],
      positions[i + 1],
      positions[i + 2],
      closest.matrix,
      packed.feature.RTC_CENTER || null
    );
    best = Math.min(best, Math.hypot(world.x - HK_STREET_EYE.x, world.z - HK_STREET_EYE.z));
  }
  assert.ok(best < 15, `nearest sampled vertex ${best.toFixed(2)} m`);
});
