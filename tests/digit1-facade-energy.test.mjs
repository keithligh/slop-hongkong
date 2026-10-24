import assert from 'node:assert/strict';
import test from 'node:test';
import { facadeEnergy } from '../tools/digit1-facade-energy.mjs';

function image(width, height, paint) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

test('facade mid-band energy rises when shop strokes are resolved', () => {
  const flat = image(64, 64, () => [90, 80, 70]);
  const sharp = image(64, 64, (x) => (x % 4 < 2 ? [20, 16, 12] : [220, 180, 40]));
  const muddy = image(64, 64, (x) => (Math.floor(x / 8) % 2 === 0 ? [40, 36, 30] : [150, 130, 50]));
  const flatEnergy = facadeEnergy(flat).energy;
  const sharpEnergy = facadeEnergy(sharp).energy;
  const muddyEnergy = facadeEnergy(muddy).energy;
  assert.ok(sharpEnergy > muddyEnergy);
  assert.ok(muddyEnergy > flatEnergy);
});
