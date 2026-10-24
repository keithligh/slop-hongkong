import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DIGIT1_PROBE_BUILDINGS,
  DIGIT1_PROBE_EXPERIMENTS,
  DIGIT1_PROBE_SAMPLES,
  HENDERSON_BUILDING_ID,
  classifyTexel,
  digit1ChasePose,
  filterDigit1ProbeBuildings,
  isDigit1CentreSample,
  isPaleRgb,
  judgeDigit1Premise,
  ndcToReadPixel,
  parseDigit1ProbeRequest,
  rowAgreement,
  shownColor
} from '../js/digit1-probe-frame.js';
import { decodePng, probeRepoRoot, screenshotSamples } from '../tools/digit1-pixel-probe.mjs';
import { deflateSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));

function paleHenderson(ndc, klass = 'padding') {
  return {
    ndc,
    baseline: {
      lit: { rgb: [214, 214, 210], pale: true },
      gpu: {
        miss: false,
        mesh: 'HkGltfBuilding',
        buildingId: HENDERSON_BUILDING_ID,
        source: 'landsd',
        material: 'B347491569901063A0_001',
        map: true,
        class: klass,
        albedo: klass === 'padding' ? [136, 138, 137] : [33, 44, 62]
      }
    },
    magentaHenderson: { magenta: true },
    hideHenderson: { lit: { rgb: [40, 48, 60], pale: false }, gpu: { miss: true, mesh: 'none' } },
    hideLandsd: { lit: { rgb: [40, 48, 60], pale: false }, gpu: { miss: true, mesh: 'none' } }
  };
}

test('Digit1 probe samples include the two centre picks and parses the page query', () => {
  assert.ok(DIGIT1_PROBE_SAMPLES.some((ndc) => ndc[0] === 0 && ndc[1] === 0.22));
  assert.ok(DIGIT1_PROBE_SAMPLES.some((ndc) => ndc[0] === 0 && ndc[1] === 0.36));
  assert.equal(isDigit1CentreSample([0, 0.22]), true);
  assert.equal(isDigit1CentreSample([0.14, 0.22]), false);
  assert.deepEqual(DIGIT1_PROBE_EXPERIMENTS, ['baseline', 'hideHenderson', 'magentaHenderson', 'hideLandsd']);
  const query = parseDigit1ProbeRequest('https://x/index.html?probe=digit1&at=-1.4,29.3,1.29&pland=donor');
  assert.equal(query.enabled, true);
  assert.deepEqual(query.at, { x: -1.4, z: 29.3, heading: 1.29 });
  assert.equal(parseDigit1ProbeRequest('https://x/index.html?at=-1.4,29.3,1.29').enabled, false);
  assert.equal(parseDigit1ProbeRequest('https://x/index.html?pland=compare').enabled, false);
  assert.ok(DIGIT1_PROBE_BUILDINGS.includes(HENDERSON_BUILDING_ID));
  const kept = filterDigit1ProbeBuildings([
    { name: HENDERSON_BUILDING_ID, file: `BUILDING/${HENDERSON_BUILDING_ID}/${HENDERSON_BUILDING_ID}.gltf` },
    { name: 'B344751569101063A0', file: 'BUILDING/B344751569101063A0/B344751569101063A0.gltf' },
    { file: 'BUILDING/B345471572201063A0/B345471572201063A0.gltf' }
  ], true);
  assert.deepEqual(kept.map((entry) => entry.name || entry.file), [
    HENDERSON_BUILDING_ID,
    'BUILDING/B345471572201063A0/B345471572201063A0.gltf'
  ]);
  assert.equal(filterDigit1ProbeBuildings([{ name: 'B344751569101063A0' }], false).length, 1);
});

test('chase pose sits behind the requested eye and the readback y origin is explicit', () => {
  const pose = digit1ChasePose({ x: -1.4, y: 0.22, z: 29.3, heading: 1.29 });
  assert.equal(pose.fov, 56);
  assert.ok(pose.cam.y > 0.22);
  assert.ok(pose.look.y > pose.cam.y);
  const ahead = Math.sin(1.29) * (pose.look.x - pose.cam.x) + Math.cos(1.29) * (pose.look.z - pose.cam.z);
  assert.ok(ahead > 1);
  const top = ndcToReadPixel(0, 1, 1280, 720, 'top');
  const bottom = ndcToReadPixel(0, 1, 1280, 720, 'bottom');
  assert.equal(top.y, 0);
  assert.equal(bottom.y, 719);
  assert.equal(ndcToReadPixel(0, 0.22, 11, 11, 'top').x, 5);
});

test('texel class separates padding, photograph, solid white, and an untextured material', () => {
  assert.equal(classifyTexel([136, 138, 137], true), 'padding');
  assert.equal(classifyTexel([128, 128, 128], true), 'padding');
  assert.equal(classifyTexel([0, 0, 0], true), 'padding');
  assert.equal(classifyTexel([33, 44, 62], true), 'photo');
  assert.equal(classifyTexel([255, 255, 255], true), 'solid-white');
  assert.equal(classifyTexel([255, 255, 255], false), 'solid-white');
  assert.equal(classifyTexel([180, 170, 160], false), 'untextured');
  assert.equal(classifyTexel(null, false), 'untextured');
  assert.equal(classifyTexel(null, true), 'unsampled');
  assert.equal(isPaleRgb([214, 214, 210]), true);
  assert.equal(isPaleRgb([33, 44, 62]), false);
  assert.equal(isPaleRgb([136, 138, 137]), false);
  assert.equal(rowAgreement([136, 138, 137], [33, 44, 62], [136, 138, 137]), 'flipped-row');
  assert.equal(rowAgreement([33, 44, 62], [33, 44, 62], [136, 138, 137]), 'gpu-row');
  assert.equal(rowAgreement([200, 20, 20], [33, 44, 62], [136, 138, 137]), 'neither');
});

test('premise is confirmed only when the pale pixel is Henderson padding and the toggles say so', () => {
  const offSlab = paleHenderson([0, 0], 'photo');
  offSlab.baseline.lit = { rgb: [33, 44, 62], pale: false };
  const confirmed = judgeDigit1Premise({
    page: { samples: [paleHenderson([0, 0.22]), paleHenderson([0, 0.36]), offSlab] }
  });
  assert.equal(confirmed.premise, 'CONFIRMED');
  assert.match(confirmed.painter, /B347491569901063A0/);
  assert.equal(confirmed.paleCount, 2);

  const photo = judgeDigit1Premise({
    page: { samples: [paleHenderson([0, 0.22], 'photo'), paleHenderson([0, 0.36], 'photo')] }
  });
  assert.equal(photo.premise, 'REJECTED');
  assert.match(photo.painter, /photo/);
  assert.doesNotMatch(photo.reason, /CONFIRMED/);

  const curtain = {
    ndc: [0, 0.22],
    baseline: {
      lit: { rgb: [230, 230, 228], pale: true },
      gpu: {
        miss: false,
        mesh: 'HkCurtainWall',
        buildingId: '',
        source: 'extrude',
        material: 'hkCurtain',
        map: false,
        class: 'untextured',
        albedo: [255, 255, 255],
        footprint: 'some tower'
      }
    },
    magentaHenderson: { magenta: false },
    hideHenderson: {
      lit: { rgb: [230, 230, 228], pale: true },
      gpu: { miss: false, mesh: 'HkCurtainWall', source: 'extrude', class: 'untextured' }
    },
    hideLandsd: {
      lit: { rgb: [230, 230, 228], pale: true },
      gpu: { miss: false, mesh: 'HkCurtainWall', source: 'extrude', material: 'hkCurtain', map: false, class: 'untextured' }
    }
  };
  const rejected = judgeDigit1Premise({ page: { samples: [curtain, { ...curtain, ndc: [0, 0.36] }] } });
  assert.equal(rejected.premise, 'REJECTED');
  assert.match(rejected.painter, /HkCurtainWall/);
  assert.doesNotMatch(rejected.painter, /padding/);

  const dark = judgeDigit1Premise({
    page: {
      samples: [{
        ndc: [0, 0.22],
        baseline: {
          lit: { rgb: [33, 44, 62], pale: false },
          gpu: { miss: false, mesh: 'HkGltfBuilding', buildingId: HENDERSON_BUILDING_ID, source: 'landsd', material: '_001', map: true, class: 'photo' }
        }
      }, {
        ndc: [0, 0.36],
        baseline: {
          lit: { rgb: [40, 50, 62], pale: false },
          gpu: { miss: false, mesh: 'HkGltfBuilding', buildingId: HENDERSON_BUILDING_ID, source: 'landsd', material: '_001', map: true, class: 'photo' }
        }
      }]
    }
  });
  assert.equal(dark.premise, 'REJECTED');
  assert.equal(dark.paleCount, 0);
});

test('a failed readback is not a pale-pixel verdict', () => {
  const sample = paleHenderson([0, 0.22]);
  sample.baseline.lit = { rgb: null, pale: false };
  delete sample.baseline.presented;
  const unread = judgeDigit1Premise({ page: { samples: [sample] } });
  assert.equal(unread.premise, 'INCONCLUSIVE');
  assert.equal(unread.paleCount, 0);
  assert.match(unread.painter, /HkGltfBuilding/);
});

test('presented pixels outrank the pre-grade lit pass', () => {
  const graded = paleHenderson([0, 0.22]);
  graded.baseline.lit = { rgb: [33, 44, 62], pale: false };
  graded.baseline.presented = { rgb: [220, 220, 216], pale: true };
  assert.deepEqual(shownColor(graded.baseline).rgb, [220, 220, 216]);
  const confirmed = judgeDigit1Premise({ page: { samples: [graded] } });
  assert.equal(confirmed.premise, 'CONFIRMED');
  assert.equal(confirmed.paleCount, 1);

  const photo = paleHenderson([0, 0.22], 'photo');
  photo.baseline.lit = { rgb: [33, 44, 62], pale: false };
  photo.baseline.presented = { rgb: [220, 220, 216], pale: true };
  const rejected = judgeDigit1Premise({ page: { samples: [photo] } });
  assert.equal(rejected.premise, 'REJECTED');

  const onlyLit = paleHenderson([0, 0.22]);
  onlyLit.baseline.presented = { rgb: [40, 44, 50], pale: false };
  const darkScreen = judgeDigit1Premise({ page: { samples: [onlyLit] } });
  assert.equal(darkScreen.premise, 'REJECTED');
  assert.equal(darkScreen.paleCount, 0);
});

test('a screenshot png round-trips the centre pixel', () => {
  const width = 4;
  const height = 4;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      raw[i] = 10 * x;
      raw[i + 1] = 10 * y;
      raw[i + 2] = 7;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let c = 0xffffffff;
    for (const byte of body) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    return Buffer.concat([length, body, crc]);
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  const image = decodePng(png);
  assert.equal(image.width, 4);
  assert.equal(image.data[0], 0);
  assert.equal(image.data[(3 * 4 + 3) * 4], 30);
  assert.equal(image.data[(3 * 4 + 3) * 4 + 1], 30);
  const samples = screenshotSamples(png, 'top', [[1, -1]]);
  assert.deepEqual(samples[0].rgb, [30, 30, 7]);
});

test('the probe server root is the repo, so index.html is not jailed', () => {
  const repo = probeRepoRoot();
  assert.equal(repo, path.resolve(root));
  assert.equal(repo.endsWith(path.sep), false);
  assert.equal(existsSync(path.join(repo, 'index.html')), true);
});

test('boot keeps PlanD flags and wires the probe without a street-view bake', () => {
  const main = readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const gltf = readFileSync(path.join(root, 'js/hk-gltf.js'), 'utf8');
  const pland = readFileSync(path.join(root, 'js/hk-pland.js'), 'utf8');
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const tool = readFileSync(path.join(root, 'tools/digit1-pixel-probe.mjs'), 'utf8');
  const frame = readFileSync(path.join(root, 'js/hk-pland-frame.js'), 'utf8');
  assert.match(main, /parseDigit1ProbeRequest/);
  assert.match(main, /runDigit1Probe/);
  assert.match(main, /renderPipeline/);
  assert.match(main, /preparePlandCorridor/);
  assert.match(main, /mode === 'compare'/);
  assert.match(gltf, /hkBuildingId/);
  assert.match(gltf, /filterDigit1ProbeBuildings/);
  assert.match(gltf, /landsdNullFillTriangles/);
  assert.match(pland, /hkSource = 'pland'/);
  assert.match(html, /digit1-probe\.js/);
  assert.match(tool, /probe=digit1/);
  assert.match(tool, /at=-1\.4,29\.3,1\.29/);
  assert.match(frame, /donor/);
  assert.match(frame, /compare/);
  const sources = [main, gltf, pland, tool, readFileSync(path.join(root, 'js/digit1-probe.js'), 'utf8'), readFileSync(path.join(root, 'js/digit1-probe-frame.js'), 'utf8')].join('\n');
  assert.doesNotMatch(sources, /mapillary|kartaview|openstreetcam/i);
});
