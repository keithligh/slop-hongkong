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
  HK_GROUND_LIFT_MAX,
  HK_GROUND_RESIDUAL_CROPS,
  HK_GROUND_SEAM_BAND_MAD,
  HK_GROUND_SEAM_RAGGED_CEIL,
  HK_GROUND_TINT_BANDS,
  catmullRomWeights,
  cropRgba,
  digit1GroundResiduals,
  digit1GroundSeams,
  groundSeamBandMask,
  groundSeamLines,
  groundTileGsdCm,
  groundTileLift,
  groundTintBand,
  groundTintBandOfRgb,
  maskedGrain,
  maskedMad,
  resolveGroundPriority,
  resolveGroundTint,
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
  assert.match(body, /return aggregate\.mul\(wetDarkening\)/);
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
  assert.equal(resolveGroundTilesRequest('http://localhost/'), null);
  assert.equal(resolveGroundTilesRequest('http://localhost/?groundTiles=on').enabled, true);
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

// Cut #46: LOD seams under the mounted tiles.

test('tile GSD is the world size of one texel on the ground band', () => {
  // 1 m x 1 m of ground over a 100 x 100 texel photograph: 1 cm per texel.
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  assert.ok(Math.abs(groundTileGsdCm(positions, uvs, indices, 100, 100) - 1) < 1e-6);
  assert.ok(Math.abs(groundTileGsdCm(positions, uvs, indices, 50, 100) - Math.sqrt(2)) < 1e-6);
  // A facade triangle above the ceiling does not count as ground.
  const tall = new Float32Array([...positions, 0, 9, 0, 1, 9, 0, 1, 9, 0.001]);
  const tallUv = new Float32Array([...uvs, 0, 0, 0.9, 0, 0.9, 0.9]);
  const tallIdx = new Uint16Array([...indices, 4, 5, 6]);
  assert.ok(Math.abs(groundTileGsdCm(tall, tallUv, tallIdx, 100, 100, 1.8) - 1) < 1e-6);
  assert.equal(groundTileGsdCm(positions, uvs, new Uint16Array(), 100, 100), 0);
});

test('finer tiles are lifted over coarser ones and the eye tile does not move', () => {
  const eye = 2.1;
  assert.equal(groundTileLift(eye, eye), 0);
  const fine = groundTileLift(0.5, eye);
  const coarse = groundTileLift(4, eye);
  const coarser = groundTileLift(6, eye);
  assert.ok(fine > 0 && coarse < 0 && coarser < coarse, `${fine} ${coarse} ${coarser}`);
  // The gap between the 2 cm and 4 cm photographs clears the depth noise of an overlap (about 2 mm).
  assert.ok(groundTileLift(2.1, eye) - coarse >= 0.005);
  assert.ok(Math.abs(groundTileLift(90, eye)) <= HK_GROUND_LIFT_MAX);
  assert.equal(groundTileLift(0, eye), 0, 'a tile with no ground triangles has no GSD to rank');
  assert.equal(groundTileLift(2, 0), 0);
});

test('seam queries default to finer-wins and keep a tint diagnostic', () => {
  assert.equal(resolveGroundPriority('http://localhost/'), 'finer');
  assert.equal(resolveGroundPriority('http://localhost/?groundPriority=off'), 'off');
  assert.equal(resolveGroundPriority('http://localhost/?groundPriority=0'), 'off');
  assert.equal(resolveGroundTint('http://localhost/'), '');
  assert.equal(resolveGroundTint('http://localhost/?groundTint=gsd'), 'gsd');
  assert.equal(resolveGroundTint('http://localhost/?groundTint=tile'), 'tile');
  assert.equal(resolveGroundTint('http://localhost/?groundTint=x'), '');
  assert.equal(groundTintBand(0.5), 0);
  assert.equal(groundTintBand(2.1), 1);
  assert.equal(groundTintBand(4), 3);
  assert.equal(groundTintBand(40), HK_GROUND_TINT_BANDS.length - 1);
});

test('tint bands are read back from tone-mapped screenshot colours', () => {
  assert.equal(groundTintBandOfRgb(169, 112, 28), 3, 'orange, 3.5-5 cm');
  assert.equal(groundTintBandOfRgb(77, 149, 56), 1, 'green, 1-2.2 cm');
  assert.equal(groundTintBandOfRgb(240, 220, 60), 2, 'yellow, 2.2-3.5 cm');
  assert.equal(groundTintBandOfRgb(200, 40, 40), 4, 'red, over 5 cm');
  assert.equal(groundTintBandOfRgb(230, 40, 230), 0, 'magenta, under 1 cm');
  assert.equal(groundTintBandOfRgb(40, 44, 50), -1, 'sky, asphalt and the avatar are not paint');
  assert.equal(groundTintBandOfRgb(0, 0, 0), -1);
});

const SEAM_W = 240;
const SEAM_H = 120;
const ORANGE = [240, 150, 40];
const GREEN = [100, 210, 80];
const ASPHALT = [28, 30, 34];

function seamFrames({ ragged = false, shift = 0, grit = 0 } = {}) {
  const tint = new Uint8ClampedArray(SEAM_W * SEAM_H * 4);
  const photo = new Uint8ClampedArray(SEAM_W * SEAM_H * 4);
  for (let y = 0; y < SEAM_H; y++) {
    // The seam leans like a ground line seen ahead: x = 90 + 0.25 y.
    const line = 90 + 0.25 * y + shift;
    // Z-fighting hands whole triangles to one tile or the other.
    const tooth = ragged ? Math.round(((y * 7919) % 13) - 6) * 1.8 : 0;
    for (let x = 0; x < SEAM_W; x++) {
      const o = (y * SEAM_W + x) * 4;
      const rgb = x < line + tooth ? ORANGE : GREEN;
      tint[o] = rgb[0];
      tint[o + 1] = rgb[1];
      tint[o + 2] = rgb[2];
      tint[o + 3] = 255;
      const noise = grit ? ((x * 31 + y * 17) % 5) * grit : 0;
      photo[o] = ASPHALT[0] + noise;
      photo[o + 1] = ASPHALT[1] + noise;
      photo[o + 2] = ASPHALT[2] + noise;
      photo[o + 3] = 255;
    }
  }
  return { tint, photo };
}

const SEAM_ROI = { x0: 0.1, x1: 0.9, y0: 0.2, y1: 1 };

test('a clean LOD seam is one straight line and a z-fought one is ragged', () => {
  const clean = seamFrames();
  const lines = groundSeamLines(clean.tint, clean.photo, SEAM_W, SEAM_H, SEAM_ROI);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].key, '1-3');
  assert.ok(lines[0].rmsPx < 0.5, `rms ${lines[0].rmsPx}`);
  assert.ok(lines[0].teeth < 0.05);
  assert.ok(Math.abs(lines[0].slope - 0.25) < 0.02);
  const torn = seamFrames({ ragged: true });
  const tornLines = groundSeamLines(torn.tint, torn.photo, SEAM_W, SEAM_H, SEAM_ROI);
  assert.equal(tornLines.length, 1);
  assert.ok(tornLines[0].rmsPx > 3, `rms ${tornLines[0].rmsPx}`);
  // A facade stripe that is orange in the photograph too is not tile paint.
  const stripe = seamFrames();
  for (let i = 0; i < stripe.photo.length; i += 4) {
    stripe.photo[i] = stripe.tint[i];
    stripe.photo[i + 1] = stripe.tint[i + 1];
    stripe.photo[i + 2] = stripe.tint[i + 2];
  }
  assert.equal(groundSeamLines(stripe.tint, stripe.photo, SEAM_W, SEAM_H, SEAM_ROI).length, 0);
  const flat = seamFrames();
  for (let i = 0; i < flat.tint.length; i += 4) {
    flat.tint[i] = GREEN[0];
    flat.tint[i + 1] = GREEN[1];
    flat.tint[i + 2] = GREEN[2];
  }
  assert.equal(groundSeamLines(flat.tint, flat.photo, SEAM_W, SEAM_H, SEAM_ROI).length, 0, 'one owner has no seam');
});

test('anti-aliased blends between two bands are not a third owner', () => {
  const frame = seamFrames();
  for (let y = 0; y < SEAM_H; y++) {
    const x = Math.round(90 + 0.25 * y);
    const o = (y * SEAM_W + x) * 4;
    frame.tint[o] = 235;
    frame.tint[o + 1] = 215;
    frame.tint[o + 2] = 60;
  }
  const lines = groundSeamLines(frame.tint, frame.photo, SEAM_W, SEAM_H, SEAM_ROI);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].key, '1-3');
});

function seamCapture(overrides = {}) {
  const before = seamFrames({ ragged: true, grit: 2 });
  const after = seamFrames({ grit: 2 });
  // The teeth are where the finer photograph now wins: those pixels change.
  for (let y = 0; y < SEAM_H; y++) {
    for (let x = 60; x < 130; x++) {
      const o = (y * SEAM_W + x) * 4;
      if (before.tint[o] !== after.tint[o]) {
        before.photo[o] += 40;
        before.photo[o + 1] += 36;
        before.photo[o + 2] += 30;
      }
    }
  }
  return {
    live: true,
    ownership: 'tiles',
    width: SEAM_W,
    height: SEAM_H,
    beforeTint: before.tint,
    before: before.photo,
    afterTint: after.tint,
    after: after.photo,
    ...overrides
  };
}

test('digit1GroundSeams passes only a live frame whose seam went from torn to straight', () => {
  const live = digit1GroundSeams(seamCapture());
  assert.equal(live.reason, 'live-seam');
  assert.equal(live.pass, true);
  assert.ok(live.seam.raggedBefore - live.seam.raggedAfter >= 1);
  assert.ok(live.seam.raggedAfter <= HK_GROUND_SEAM_RAGGED_CEIL);
  assert.ok(live.seam.bandMad >= HK_GROUND_SEAM_BAND_MAD);
  assert.equal(digit1GroundSeams().pass, false);
  assert.equal(digit1GroundSeams(seamCapture({ live: false })).reason, 'live-msi-required');
  assert.equal(digit1GroundSeams(seamCapture({ synthetic: true })).pass, false);
  assert.equal(digit1GroundSeams(seamCapture({ ownership: 'megascans' })).reason, 'ownership-open');
  assert.equal(digit1GroundSeams(seamCapture({ ownership: 'procedural' })).pass, false);
  assert.equal(digit1GroundSeams(seamCapture({ ownership: 'infrastructure' })).pass, true);
  const blank = digit1GroundSeams(seamCapture({ after: new Uint8ClampedArray(SEAM_W * SEAM_H * 4).fill(0) }));
  assert.equal(blank.reason, 'blank-frame');
  const none = seamFrames();
  assert.equal(digit1GroundSeams(seamCapture({ afterTint: none.tint, beforeTint: none.tint, after: none.photo, before: none.photo })).pass, false, 'a seam that was already clean did not improve');
});

test('digit1GroundSeams refuses a seam that is still torn, unchanged, or absent', () => {
  const torn = seamFrames({ ragged: true, grit: 2 });
  const stillTorn = digit1GroundSeams(seamCapture({ afterTint: torn.tint, after: torn.photo }));
  assert.equal(stillTorn.pass, false);
  assert.equal(stillTorn.reason, 'seam-open');
  const same = seamFrames({ grit: 2 });
  const unchanged = digit1GroundSeams(seamCapture({ beforeTint: same.tint, before: same.photo }));
  assert.equal(unchanged.pass, false, 'a seam that was already straight did not improve');
  const flat = seamFrames();
  for (let i = 0; i < flat.tint.length; i += 4) {
    flat.tint[i] = GREEN[0];
    flat.tint[i + 1] = GREEN[1];
    flat.tint[i + 2] = GREEN[2];
  }
  assert.equal(digit1GroundSeams(seamCapture({ afterTint: flat.tint })).reason, 'no-seam');
  const quiet = seamCapture();
  quiet.before = new Uint8ClampedArray(quiet.after);
  const below = digit1GroundSeams(quiet);
  assert.equal(below.pass, false);
  assert.equal(below.reason, 'band-below-floor');
});

test('seam band masks and masked metrics follow the fitted line', () => {
  const frame = seamFrames({ grit: 3 });
  const [seam] = groundSeamLines(frame.tint, frame.photo, SEAM_W, SEAM_H, SEAM_ROI);
  const mask = groundSeamBandMask(seam, SEAM_W, SEAM_H, SEAM_ROI, 5);
  let inside = 0;
  for (const v of mask) inside += v;
  assert.ok(inside > 0 && inside <= (SEAM_H * 11));
  assert.equal(mask[(SEAM_H - 1) * SEAM_W + Math.round(seam.intercept + seam.slope * (SEAM_H - 1))], 1);
  assert.equal(mask[(SEAM_H - 1) * SEAM_W + 2], 0);
  const brighter = new Uint8ClampedArray(frame.photo);
  for (let i = 0; i < brighter.length; i += 4) brighter[i] += 6;
  assert.ok(Math.abs(maskedMad(frame.photo, brighter, mask) - 2) < 1e-9);
  assert.ok(maskedGrain(frame.photo, SEAM_W, SEAM_H, mask) > 0);
  assert.equal(maskedMad(frame.photo, frame.photo, new Uint8Array(mask.length)), 0);
});

test('the mount ranks overlapping tiles and keeps the grain bars out of the seam cut', () => {
  const page = read('js/hk-ground-tiles.js');
  assert.match(page, /groundTileLift\(gsdCm, eyeGsd\)/);
  assert.match(page, /resolveGroundPriority/);
  assert.match(page, /groundTintBand/);
  assert.match(page, /hkGsdCm/);
  // Cut #45's reconstruction, the far-frame Soft-grain work and Soft paint are not reopened.
  const photo = read('js/hk-ground-photo.js');
  assert.match(photo, /HK_GROUND_PHOTO_SHARPEN/);
  assert.doesNotMatch(photo, /gsd|lift|tint/i);
  const frame = read('js/hk-ground-tiles-frame.js');
  assert.doesNotMatch(frame, /landsdFarGrain|landsdFarChart|farGrain|mapillary/i);
  assert.doesNotMatch(read('tools/digit1-ground-seam.mjs'), /writeFileSync|fillRect|putImageData/);
  assert.match(read('tools/digit1-ground-seams.html'), /OrthographicCamera/);
});
