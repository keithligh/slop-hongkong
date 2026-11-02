#!/usr/bin/env node
// Live A-B score of two Digit1 eye frames on the ground crops.
//   node tools/digit1-eye-shot.mjs /tmp/before.png --root /path/to/BEFORE --hide-hud
//   node tools/digit1-eye-shot.mjs /tmp/after.png --hide-hud
//   node tools/digit1-ground-ab.mjs /tmp/before.png /tmp/after.png [--ownership tiles]
// Both PNGs must be screenshots of the running page. A painted buffer is not one.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DIGIT1_GROUND_CROPS, HK_GROUND_RESIDUAL_CROPS, cropRgba, digit1GroundOwnership } from '../js/hk-ground-tiles-frame.js';
import { decodePng } from './digit1-pixel-probe.mjs';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? '' : process.argv[index + 1] || '';
}

export function scoreGroundAb(beforePng, afterPng, ownership = 'tiles') {
  const before = decodePng(beforePng);
  const after = decodePng(afterPng);
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`frame size differs ${before.width}x${before.height} vs ${after.width}x${after.height}`);
  }
  const rows = {};
  for (const [name, rect] of Object.entries(DIGIT1_GROUND_CROPS)) {
    const a = cropRgba(before.data, before.width, before.height, rect);
    const b = cropRgba(after.data, after.width, after.height, rect);
    rows[name] = digit1GroundOwnership({
      live: true,
      ownership,
      width: a.width,
      height: a.height,
      before: a.data,
      after: b.data
    });
  }
  return rows;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [beforeFile, afterFile] = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith('--') && all[i - 1] !== '--ownership');
  const rows = scoreGroundAb(readFileSync(beforeFile), readFileSync(afterFile), argValue('--ownership') || 'tiles');
  for (const [name, row] of Object.entries(rows)) {
    console.log(`${name.padEnd(11)} ${row.pass ? 'PASS' : 'FAIL'} mad ${row.mad.toFixed(2)} grain ${row.grainBefore.toFixed(3)} -> ${row.grainAfter.toFixed(3)} d ${row.grainDelta.toFixed(3)} ${row.reason}`);
  }
  const both = HK_GROUND_RESIDUAL_CROPS.every((name) => rows[name].pass);
  console.log(`right-kerb + underfoot ${both ? 'PASS' : 'FAIL'}`);
}
