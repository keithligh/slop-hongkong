#!/usr/bin/env node
// Cut #46 live A-B on the Digit1 LOD seam. Four screenshots of the running page:
//   BEFORE is the #45 mount (?groundPriority=off) and AFTER the default, each as a
//   ?groundTint=gsd frame (finds the seam) and a photograph frame (scores it).
//
//   node tools/digit1-eye-shot.mjs b-tint.png --hide-hud --query 'at=-1.4,29.3,1.29&groundTint=gsd&groundPriority=off'
//   node tools/digit1-eye-shot.mjs b.png      --hide-hud --query 'at=-1.4,29.3,1.29&groundPriority=off'
//   node tools/digit1-eye-shot.mjs a-tint.png --hide-hud --query 'at=-1.4,29.3,1.29&groundTint=gsd'
//   node tools/digit1-eye-shot.mjs a.png      --hide-hud
//   node tools/digit1-ground-seam.mjs b-tint.png b.png a-tint.png a.png [--ownership tiles]
//
// Painted buffers are not screenshots of the page. Soft is not SD.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digit1GroundSeams, groundSeamLines } from '../js/hk-ground-tiles-frame.js';
import { decodePng } from './digit1-pixel-probe.mjs';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? '' : process.argv[index + 1] || '';
}

export function scoreGroundSeam([beforeTint, before, afterTint, after], ownership = 'tiles') {
  const frames = [beforeTint, before, afterTint, after].map((png) => decodePng(png));
  const { width, height } = frames[0];
  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height) throw new Error('frame sizes differ');
  }
  return {
    result: digit1GroundSeams({
      live: true,
      ownership,
      width,
      height,
      beforeTint: frames[0].data,
      before: frames[1].data,
      afterTint: frames[2].data,
      after: frames[3].data
    }),
    seams: {
      before: groundSeamLines(frames[0].data, frames[1].data, width, height),
      after: groundSeamLines(frames[2].data, frames[3].data, width, height)
    }
  };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const files = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith('--') && all[i - 1] !== '--ownership');
  if (files.length !== 4) {
    console.error('usage: digit1-ground-seam.mjs beforeTint.png before.png afterTint.png after.png [--ownership tiles]');
    process.exit(2);
  }
  const { result, seams } = scoreGroundSeam(files.map((file) => readFileSync(file)), argValue('--ownership') || 'tiles');
  for (const [name, list] of Object.entries(seams)) {
    for (const seam of list) {
      console.log(`${name.padEnd(6)} seam ${seam.key} rows ${seam.rows} rms ${seam.rmsPx.toFixed(2)} px teeth ${seam.teeth.toFixed(2)}`);
    }
  }
  if (result.seam) {
    const row = result.seam;
    console.log(`seam ${row.key}: ragged ${row.raggedBefore.toFixed(2)} -> ${row.raggedAfter.toFixed(2)} px, teeth ${row.teethBefore.toFixed(2)} -> ${row.teethAfter.toFixed(2)}, band MAD ${row.bandMad.toFixed(2)}, band grain ${row.bandGrainBefore.toFixed(3)} -> ${row.bandGrainAfter.toFixed(3)}`);
  }
  console.log(`seam ${result.pass ? 'PASS' : 'FAIL'} ${result.reason}`);
  process.exit(result.pass ? 0 : 1);
}
