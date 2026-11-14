import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HK_STREET_EYE, HK_STREET_NEAR, HK_WALK_RADIUS } from '../js/city-config.js';
import { isPaleRgb } from '../js/digit1-probe-frame.js';
import { digit1PlazaDisc } from '../js/hk-game-ground-frame.js';
import { shopfrontAlbedo } from '../js/hk-shopfront.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('the paved plate covers the walk fence and the overlay disc and fades outside it', () => {
  const plaza = digit1PlazaDisc();
  assert.equal(plaza.x, HK_STREET_EYE.x);
  assert.equal(plaza.z, HK_STREET_EYE.z);
  assert.equal(plaza.walk, HK_WALK_RADIUS);
  assert.ok(plaza.inner >= HK_STREET_NEAR, 'full paving reaches the overlay disc');
  assert.ok(plaza.inner > plaza.walk, 'the fence stands inside full paving');
  assert.ok(plaza.outer > plaza.inner, 'the fade has a width');
  assert.equal(HK_WALK_RADIUS, 50);
  assert.equal(HK_STREET_NEAR, 80);
});

test('the coast plate is the paved surface: no second layer that can lose a depth test to it', () => {
  const grid = read('js/city-grid.js');
  assert.match(grid, /createCoastLandMaterial\(digit1PlazaDisc\(\)\)/);
  assert.doesNotMatch(grid, /HkDiscPlaza/);
  const materials = read('js/tsl-materials.js');
  const body = materials.slice(
    materials.indexOf('function createCoastLandMaterial'),
    materials.indexOf('Victoria Harbour water: physically based')
  );
  assert.match(body, /createSidewalkMaterial\(\{ ribbon: false \}\)/);
  assert.match(body, /name = 'hkCoastLand'/);
  assert.match(body, /coastHex = 0x6a7264/);
  assert.match(body, /smoothstep\(float\(inner\), float\(outer\), reach\)/);
});

test('the debug ring is a Line: WebGPURenderer rejects LineLoop', () => {
  const main = read('js/main.js');
  assert.doesNotMatch(main, /THREE\.LineLoop/);
  assert.match(main, /new THREE\.Line\(/);
  assert.match(main, /length: 129/);
});

test('the gap shopfront is a muted stone band, still off the pale gate, with the mouth darker than the pier', () => {
  const belt = 8.02;
  for (const y of [0.6, 2.2, 3.9, 5.5, 7.6]) {
    for (const along of [0, 1, 2.2, 3.4]) {
      const rgb = shopfrontAlbedo(along, y, belt);
      assert.equal(isPaleRgb(rgb), false, `${along},${y} ${rgb.join(',')}`);
    }
  }
  const tile = shopfrontAlbedo(0.5, 3.9, belt);
  const coping = shopfrontAlbedo(0.5, 7.6, belt);
  for (const rgb of [tile, coping]) {
    assert.ok(Math.max(...rgb) - Math.min(...rgb) <= 52, `band stays stone, not orange: ${rgb.join(',')}`);
  }
});

test('podium openings are filtered pulses, not 0.35 m smoothstep ramps', () => {
  const materials = read('js/tsl-materials.js');
  const body = materials.slice(
    materials.indexOf('function podiumStreetColor'),
    materials.indexOf('function podiumShopGlow')
  );
  assert.match(body, /filteredPulse\(bay, 0\.28, 0\.72, fwBay\)/);
  assert.match(body, /filteredPulse\(storey, 0\.2, 0\.74, fwStorey\)/);
  assert.doesNotMatch(body, /smoothstep\(0\.28, 0\.36, bay\)/);
  assert.match(body, /HK_RETAIL_BELT/);
});

test('the disc review tools exist and name the locks', () => {
  const shots = read('tools/digit1-disc-shots.mjs');
  assert.match(shots, /gltfCap=10/);
  assert.match(shots, /debug=scene/);
  const inventory = read('tools/digit1-disc-inventory.mjs');
  assert.match(inventory, /HK_WALK_RADIUS/);
  assert.match(inventory, /hiddenExtrudeIds/);
  assert.match(inventory, /clipCanyonWalls/);
  const main = read('js/main.js');
  assert.match(main, /debug'\) === 'scene'\) window\.__hkScene = scene/);
  const doc = read('docs/HK_DISC_FIDELITY.md');
  assert.match(doc, /at=-1\.4,29\.3,1\.29&confine=on/);
  assert.match(doc, /SD NOT YET/);
  assert.match(doc, /Deferred/);
});
