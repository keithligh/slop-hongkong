#!/usr/bin/env node
// Cut #47 digit1GameGround score of a live pair of Digit1 eye frames.
//   node tools/digit1-eye-shot.mjs /tmp/before.png --root /path/to/03d4ab0 --hide-hud
//   node tools/digit1-eye-shot.mjs /tmp/after.png --hide-hud --owner-json /tmp/owner.json
//   node tools/digit1-game-ground.mjs /tmp/before.png /tmp/after.png /tmp/owner.json
// BEFORE is the #46 tip with the LandsD tiles mounted. AFTER is the default page.
// Both PNGs must be screenshots of the running page. A painted buffer is not one.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HK_CORE_WORLD, HK_STREET_EYE, ROADS } from '../js/city-config.js';
import { HK_PEDESTRIAN } from '../js/hk-pedestrian-data.js';
import { planHkStreetGround } from '../js/hk-pedestrian.js';
import { planHkRoadDeck } from '../js/hk-road-deck.js';
import { digit1GameGround, digit1StreetLife } from '../js/hk-game-ground-frame.js';
import { decodePng } from './digit1-pixel-probe.mjs';

export function scoreGameGround(beforePng, afterPng, owner) {
  const before = decodePng(beforePng);
  const after = decodePng(afterPng);
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`frame size differs ${before.width}x${before.height} vs ${after.width}x${after.height}`);
  }
  const life = digit1StreetLife(
    planHkStreetGround(HK_PEDESTRIAN, ROADS),
    planHkRoadDeck(ROADS, HK_CORE_WORLD),
    HK_STREET_EYE
  );
  const result = digit1GameGround({
    live: true,
    width: before.width,
    height: before.height,
    before: before.data,
    after: after.data,
    hits: owner?.rows || [],
    tilesMounted: owner?.tilesMounted,
    life
  });
  return { result, life };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [beforeFile, afterFile, ownerFile] = process.argv.slice(2);
  const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
  const { result, life } = scoreGameGround(readFileSync(beforeFile), readFileSync(afterFile), owner);
  console.log(`life ${JSON.stringify(life)}`);
  for (const [name, row] of Object.entries(result.crops)) console.log(`${name.padEnd(11)} mad ${row.mad.toFixed(2)}`);
  console.log(`digit1GameGround ${result.pass ? 'PASS' : 'FAIL'} ${result.reason} owner ${result.owner}`);
  process.exit(result.pass ? 0 : 1);
}
