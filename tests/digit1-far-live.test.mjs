import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIGIT1_FAR_LIVE_GRAIN_FLOOR,
  DIGIT1_FAR_LIVE_MAD_FLOOR,
  digit1FarFrameFidelity,
  digit1FarLiveFloors,
  measureDigit1FarFrame
} from '../js/digit1-far-frame.js';

function paint(buf, width, x, y, rgb) {
  const o = (y * width + x) * 4;
  buf[o] = rgb[0];
  buf[o + 1] = rgb[1];
  buf[o + 2] = rgb[2];
  buf[o + 3] = 255;
}

function liveCrop() {
  const width = 16;
  const height = 12;
  const before = new Uint8ClampedArray(width * height * 4);
  const after = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      paint(before, width, x, y, [92, 148, 168]);
      const grit = ((x * 3 + y * 5) % 7) * 18;
      paint(after, width, x, y, [28 + grit, 36 + (grit >> 1), 48]);
    }
  }
  return { before, after, width, height };
}

function nearFlatCrop() {
  const { before, width, height } = liveCrop();
  const after = new Uint8ClampedArray(before);
  after[0] = before[0] + 3;
  return { before, after, width, height };
}

test('far39 live deltas miss the Soft floors', () => {
  assert.equal(DIGIT1_FAR_LIVE_MAD_FLOOR, 2);
  assert.equal(DIGIT1_FAR_LIVE_GRAIN_FLOOR, 0.5);
  assert.equal(digit1FarLiveFloors({ mad: 0.425, grainDelta: -0.005 }), false);
  assert.equal(digit1FarLiveFloors({ mad: 0.045, grainDelta: -0.013 }), false);
  assert.equal(digit1FarLiveFloors({ mad: 0.069, grainDelta: -0.012 }), false);
  assert.equal(digit1FarLiveFloors({ mad: 2, grainDelta: -0.5 }), true);
  assert.equal(digit1FarLiveFloors({ mad: 1.99, grainDelta: -0.5 }), false);
  assert.equal(digit1FarLiveFloors({ mad: 2, grainDelta: -0.49 }), false);
});

test('digit1FarFrameFidelity passes only on a live far crop', () => {
  const policy = measureDigit1FarFrame();
  assert.equal(policy.policy, true);
  assert.equal(policy.source, 'measureDigit1FarFrame');
  assert.ok(policy.curtainMad >= 4);
  assert.ok(policy.grainDelta < -0.5);
  const painted = digit1FarFrameFidelity(policy);
  assert.equal(painted.pass, false);
  assert.equal(painted.reason, 'live-msi-required');
  const tagged = digit1FarFrameFidelity({ ...policy, live: true });
  assert.equal(tagged.pass, false);
  assert.equal(tagged.reason, 'synthetic-paint');
  const { before, after, width, height } = liveCrop();
  const synthetic = digit1FarFrameFidelity({
    live: true,
    synthetic: true,
    source: 'msi',
    crop: 'midfar',
    before,
    after,
    width,
    height
  });
  assert.equal(synthetic.pass, false);
  assert.equal(synthetic.reason, 'synthetic-paint');
  const staticPath = digit1FarFrameFidelity({
    live: true,
    source: 'static',
    crop: 'midfar',
    before,
    after,
    width,
    height
  });
  assert.equal(staticPath.pass, false);
  assert.equal(staticPath.reason, 'source-not-live');
  const paintAsMsi = digit1FarFrameFidelity({
    live: true,
    source: 'msi',
    crop: 'midfar',
    before: policy.before,
    after: policy.after,
    width: policy.width,
    height: policy.height
  });
  assert.equal(paintAsMsi.pass, false);
  assert.equal(paintAsMsi.reason, 'synthetic-paint');
  const flat = nearFlatCrop();
  const far39 = digit1FarFrameFidelity({
    live: true,
    source: 'msi',
    crops: { midfar: flat, farframe: flat, henderson_far: flat }
  });
  assert.equal(far39.pass, false);
  assert.equal(far39.reason, 'below-floor');
  assert.equal(digit1FarLiveFloors(far39.crops.midfar), false);
  const holdOnly = digit1FarFrameFidelity({
    live: true,
    source: 'msi',
    crops: { bocplate: { before, after, width, height }, rightmid: { before, after, width, height } }
  });
  assert.equal(holdOnly.pass, false);
  assert.equal(holdOnly.reason, 'crop-not-far');
  const midfar = digit1FarFrameFidelity({
    live: true,
    source: 'msi',
    crop: 'midfar',
    before,
    after,
    width,
    height
  });
  assert.equal(midfar.pass, true);
  assert.equal(midfar.reason, 'live-far');
  assert.equal(midfar.crops.midfar.pass, true);
  const rendered = digit1FarFrameFidelity({
    live: true,
    source: 'rendered-eye',
    crops: { henderson_far: { before, after, width, height } }
  });
  assert.equal(rendered.pass, true);
  assert.equal(rendered.crops.henderson_far.pass, true);
  const farframe = digit1FarFrameFidelity({
    live: true,
    source: 'msi',
    crops: { farframe: { before, after, width, height } }
  });
  assert.equal(farframe.pass, true);
});
