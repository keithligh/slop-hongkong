import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HK_STREET_EYE } from '../js/city-config.js';
import { keithEyeGrain } from '../js/digit1-far-frame.js';
import {
  DIGIT1_GROUND_CROPS,
  HK_GROUND_ATTRIBUTION,
  HK_GROUND_GRAIN_FLOOR,
  HK_GROUND_PHOTO_MAG_FULL,
  HK_GROUND_PHOTO_MAG_NONE,
  HK_GROUND_PHOTO_SHARPEN,
  HK_GROUND_RESIDUAL_CROPS,
  catmullRomWeights,
  cropRgba,
  digit1GroundResiduals,
  groundPhotoMagnification,
  resolveGroundPhotoMode,
  resolveGroundPhotoTuning,
  unsharpPhotoRgba,
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

function photoPatch(width, height, edgeAt = 6) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const v = x < edgeAt ? 40 : 92;
      data[o] = v;
      data[o + 1] = v + 2;
      data[o + 2] = v + 6;
      data[o + 3] = 255;
    }
  }
  return data;
}

test('Catmull-Rom weights sum to one and reproduce the texel at the centre', () => {
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const sum = catmullRomWeights(f).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `f ${f} sum ${sum}`);
  }
  assert.deepEqual(catmullRomWeights(0).map((w) => Math.abs(w) < 1e-12 ? 0 : w), [0, 1, 0, 0]);
  const half = catmullRomWeights(0.5);
  assert.ok(half[0] < 0 && half[3] < 0, 'negative lobes are the sharpening');
});

test('photo reconstruction applies where the tile is magnified and fades to the plain filter', () => {
  assert.equal(groundPhotoMagnification(0.1), 1);
  assert.equal(groundPhotoMagnification(HK_GROUND_PHOTO_MAG_FULL), 1);
  assert.equal(groundPhotoMagnification(HK_GROUND_PHOTO_MAG_NONE), 0);
  assert.equal(groundPhotoMagnification(4), 0);
  assert.equal(groundPhotoMagnification(NaN), 0);
  const mid = groundPhotoMagnification((HK_GROUND_PHOTO_MAG_FULL + HK_GROUND_PHOTO_MAG_NONE) / 2);
  assert.ok(mid > 0.4 && mid < 0.6);
});

test('unsharp uses only the photograph: flat ground stays flat, an edge gains grain', () => {
  const width = 16;
  const height = 12;
  const flat = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < flat.length; i += 4) {
    flat[i] = 50;
    flat[i + 1] = 52;
    flat[i + 2] = 56;
    flat[i + 3] = 255;
  }
  assert.deepEqual(Array.from(unsharpPhotoRgba(flat, width, height)), Array.from(flat));
  const edge = photoPatch(width, height);
  const sharp = unsharpPhotoRgba(edge, width, height, HK_GROUND_PHOTO_SHARPEN);
  assert.ok(keithEyeGrain(sharp, width, height) > keithEyeGrain(edge, width, height));
  const far = [0, 1, 2, 3].map((x) => sharp[x * 4]);
  assert.equal(far[0], 40, 'texels away from the edge are untouched');
});

test('ground photo shader samples only the tile and invents no noise', () => {
  const photo = read('js/hk-ground-photo.js');
  const page = read('js/hk-ground-tiles.js');
  assert.match(photo, /hkGroundTilePhoto/);
  assert.match(photo, /MeshBasicNodeMaterial/);
  assert.match(photo, /dFdx/);
  assert.match(photo, /texture\(map/);
  assert.doesNotMatch(photo, /noise|hash|random|\bsin\(|grit|megascans|mapillary/i);
  assert.match(page, /createGroundPhotoMaterial/);
  assert.match(page, /resolveGroundPhotoMode/);
  assert.match(page, /MeshBasicMaterial/);
  assert.match(page, /landsd-3dtiles/);
  assert.equal(resolveGroundPhotoMode('http://localhost/?groundPhoto=plain'), 'plain');
  assert.equal(resolveGroundPhotoMode('http://localhost/'), 'reconstruct');
  assert.deepEqual(resolveGroundPhotoTuning('http://localhost/'), { sharpen: HK_GROUND_PHOTO_SHARPEN, radius: 1.5 });
  assert.equal(resolveGroundPhotoTuning('http://localhost/?groundSharpen=99').sharpen, 4);
  assert.equal(resolveGroundPhotoTuning('http://localhost/?groundSharpen=x').sharpen, HK_GROUND_PHOTO_SHARPEN);
});

test('Digit1 ground crops are inside the frame and cropRgba cuts them', () => {
  for (const name of HK_GROUND_RESIDUAL_CROPS) assert.ok(DIGIT1_GROUND_CROPS[name], name);
  for (const rect of Object.values(DIGIT1_GROUND_CROPS)) {
    assert.ok(rect.x0 >= 0 && rect.x1 <= 1 && rect.x0 < rect.x1);
    assert.ok(rect.y0 >= 0 && rect.y1 <= 1 && rect.y0 < rect.y1);
  }
  const frame = photoPatch(100, 50);
  const cut = cropRgba(frame, 100, 50, { x0: 0.5, x1: 0.75, y0: 0.2, y1: 0.6 });
  assert.equal(cut.width, 25);
  assert.equal(cut.height, 20);
  assert.equal(cut.data[0], 92);
});

test('a blank AFTER frame is not a ground crop', () => {
  const { before, width, height } = crops();
  const blank = new Uint8ClampedArray(before.length);
  for (let i = 3; i < blank.length; i += 4) blank[i] = 255;
  const row = digit1GroundOwnership({ live: true, ownership: 'tiles', before, after: blank, width, height });
  assert.equal(row.pass, false);
  assert.equal(row.reason, 'blank-frame');
});

test('Cut #45 residual bar needs live right-kerb AND underfoot floors', () => {
  const { before, after, width, height } = crops();
  const pair = { before, after, width, height };
  const both = digit1GroundResiduals({ live: true, ownership: 'tiles', crops: { 'right-kerb': pair, underfoot: pair } });
  assert.equal(both.pass, true);
  assert.equal(both.reason, 'live-residuals');
  const one = digit1GroundResiduals({ live: true, ownership: 'tiles', crops: { 'right-kerb': pair } });
  assert.equal(one.pass, false);
  assert.equal(one.rows.underfoot.reason, 'crop-missing');
  const quiet = { before, after: new Uint8ClampedArray(before), width, height };
  assert.equal(digit1GroundResiduals({ live: true, ownership: 'tiles', crops: { 'right-kerb': pair, underfoot: quiet } }).pass, false);
  assert.equal(digit1GroundResiduals({ live: false, ownership: 'tiles', crops: { 'right-kerb': pair, underfoot: pair } }).pass, false);
  assert.equal(digit1GroundResiduals({ live: true, synthetic: true, ownership: 'tiles', crops: { 'right-kerb': pair, underfoot: pair } }).pass, false);
  assert.equal(digit1GroundResiduals({ live: true, ownership: 'procedural', crops: { 'right-kerb': pair, underfoot: pair } }).pass, false);
  assert.equal(HK_GROUND_GRAIN_FLOOR, 0.35);
});
