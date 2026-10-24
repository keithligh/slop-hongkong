import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPaleRgb } from '../js/digit1-probe-frame.js';
import { HK_SHOP_BAY, HK_SHOP_BAYS, shopfrontAlbedo, shopfrontImage } from '../js/hk-shopfront.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const BELT = 8.02;

function luma(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

test('the Digit1 pale podium samples land on a shopfront texel, not flat stone', () => {
  // NDC 0,−0.08 hits the Des Voeux gap ribbon at about y = 5.97, x = 70.5.
  // The next ribbon on that ray is about y = 6.61, x = 84.3. Both used to be
  // the unmapped stone band above the old fascia.
  for (const [along, y] of [[70.5, 5.97], [84.3, 6.61], [50, 5.97], [54, 6.61]]) {
    const rgb = shopfrontAlbedo(along, y, BELT);
    assert.equal(isPaleRgb(rgb), false, `${along},${y} ${rgb.join(',')}`);
    assert.ok(luma(rgb) < 140, `${along},${y} luma ${luma(rgb)}`);
  }
  const mouth = shopfrontAlbedo(1 / HK_SHOP_BAY * 0.5, 2.2, BELT);
  const pier = shopfrontAlbedo(0, 2.2, BELT);
  assert.ok(luma(mouth) < luma(pier), 'the shop mouth is darker than the pier');
  assert.ok(mouth[2] < 80 && mouth[0] < 80, 'the mouth is not a curtain pane');
});

test('every shopfront texel stays under the pale gate and off the pavement glass', () => {
  const width = 128;
  const height = 64;
  const image = shopfrontImage(width, height, BELT);
  assert.equal(image.length, width * height * 4);
  let pale = 0;
  let glass = 0;
  for (let i = 0; i < image.length; i += 4) {
    const rgb = [image[i], image[i + 1], image[i + 2]];
    if (isPaleRgb(rgb)) pale++;
    if (rgb[2] > 150 && rgb[2] > rgb[0] + 30) glass++;
    assert.equal(image[i + 3], 255);
  }
  assert.equal(pale, 0);
  assert.equal(glass, 0);
  const materials = readFileSync(path.join(root, 'js/tsl-materials.js'), 'utf8');
  assert.match(materials, /hkShopfrontAlbedo/);
  assert.match(materials, /shopfrontImage/);
  assert.match(materials, /HK_SHOP_BAYS/);
  assert.equal(HK_SHOP_BAYS, 4);
});
