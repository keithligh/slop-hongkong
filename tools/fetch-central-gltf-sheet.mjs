#!/usr/bin/env node
// Download Open3Dhk individualised glTF into hk-3d/ (gitignored).
// Default: 11-SW-9B, then 11-SW-9A when that sheet has no BUILDING model on Central.
// --street subsets 11-SW-9C and 11-SW-8D down to BUILDING glTF that meet the Central box,
// and 11-SW-14A down to the Bank of China Tower photograph.
// Cut #36 did not add a mid-band sheet. Hits inside 11-SW-9C stay outside every
// BUILDING mesh on 9C, 8D, 14A and 13B. Do not pin 13B for that miss.
// No API key is sent unless the zip answers 401.
//
//   node tools/fetch-central-gltf-sheet.mjs
//   node tools/fetch-central-gltf-sheet.mjs --sheet 11-SW-9A
//   node tools/fetch-central-gltf-sheet.mjs --street
//   node tools/fetch-central-gltf-sheet.mjs --out hk-3d

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HK_CORE_WORLD } from '../js/city-config.js';
import {
  assertSheetAllowed,
  boundsFromGltf,
  chooseCentralSheet,
  filterPinSheetBuildings,
  isBuildingGltf,
  isGltfPinSheet
} from '../js/hk-gltf-frame.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const ZIP_URL = 'https://download.map.gov.hk/api/3d-zip/GLTF';
// 9C: Statue Square and Des Voeux looking east. 8D: the dense sheet on the west side of that corner.
const STREET_SHEETS = ['11-SW-9C', '11-SW-8D', '11-SW-14A'];
const STREET_MIN_SPAN = 8;

function parseArgs(argv) {
  const opts = { sheet: '', out: path.join(root, 'hk-3d'), help: false, street: false, keepZip: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--street') opts.street = true;
    else if (arg === '--keep-zip') opts.keepZip = true;
    else if (arg === '--sheet') opts.sheet = argv[++i] || '';
    else if (arg === '--out') opts.out = path.resolve(argv[++i] || opts.out);
    else throw new Error(`Unknown argument ${arg}`);
  }
  return opts;
}

function downloadZip(url, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const result = spawnSync('curl', [
    '-sS', '-L', '--retry', '5', '--retry-all-errors', '--retry-delay', '2',
    '-C', '-', '-o', dest, '-w', '%{http_code}', url
  ], { encoding: 'utf8' });
  if (result.error) throw result.error;
  const code = Number(String(result.stdout || '').trim());
  if (code === 416 && existsSync(dest)) return 200;
  if ((result.status !== 0 || (code !== 200 && code !== 206)) && code !== 401) {
    throw new Error(`curl ${url} exit ${result.status} http ${code}\n${result.stderr || ''}`);
  }
  return code;
}

async function publicDownloadKey() {
  const pages = ['https://3d.map.gov.hk/download-api?l=zh-HK', 'https://3d.map.gov.hk/download-api'];
  for (const page of pages) {
    try {
      const res = await fetch(page);
      const html = await res.text();
      const found = html.match(/[?&]key=([A-Za-z0-9_-]{8,})/);
      if (found) return found[1];
    } catch {
      // The next page, or a clear 401 below.
    }
  }
  return '';
}

async function fetchSheetZip(sheet, dest) {
  const plain = `${ZIP_URL}/${sheet}.zip`;
  let code = downloadZip(plain, dest);
  if (code === 401) {
    const key = await publicDownloadKey();
    if (!key) throw new Error(`${sheet} returned 401 and no public key was on the download-api page`);
    code = downloadZip(`${plain}?key=${encodeURIComponent(key)}`, dest);
  }
  if (code !== 200 && code !== 206) throw new Error(`${sheet} HTTP ${code}`);
  return plain;
}

function unzip(zipPath, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const result = spawnSync('unzip', ['-q', '-o', zipPath, '-d', dest], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `unzip failed for ${zipPath}`);
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function overlapsCore(box) {
  return box.maxX >= HK_CORE_WORLD.minX && box.minX <= HK_CORE_WORLD.maxX
    && box.maxZ >= HK_CORE_WORLD.minZ && box.minZ <= HK_CORE_WORLD.maxZ;
}

function surveySheet(dir) {
  const buildings = [];
  let overlap = 0;
  for (const file of walk(dir)) {
    if (!isBuildingGltf(file)) continue;
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const box = boundsFromGltf(doc);
    const rel = path.relative(dir, file).split(path.sep).join('/');
    const entry = { file: rel, ...box };
    buildings.push(entry);
    if (overlapsCore(box)) overlap++;
  }
  return { buildingFiles: buildings.length, overlap, buildings };
}

function listZip(zipPath) {
  const result = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `unzip -Z1 failed for ${zipPath}`);
  return result.stdout.split(/\r?\n/).filter(Boolean).map((name) => name.replace(/\\/g, '/'));
}

function extractEntries(zipPath, dest, entries) {
  if (!entries.length) return;
  mkdirSync(dest, { recursive: true });
  for (let i = 0; i < entries.length; i += 120) {
    const batch = entries.slice(i, i + 120);
    const result = spawnSync('unzip', ['-q', '-o', '-d', dest, zipPath, ...batch], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.status !== 0) throw new Error(result.stderr || `unzip failed on ${batch[0]}`);
  }
}

function parentDir(rel) {
  const norm = String(rel).replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i < 0 ? '' : norm.slice(0, i + 1);
}

function removeUnkept(dir, kept) {
  const prefixes = new Set(kept.map((box) => parentDir(box.file)).filter(Boolean));
  const buildingRoot = path.join(dir, 'BUILDING');
  if (!existsSync(buildingRoot)) return;
  for (const name of readdirSync(buildingRoot)) {
    const prefix = `BUILDING/${name}/`;
    if (!prefixes.has(prefix)) rmSync(path.join(buildingRoot, name), { recursive: true, force: true });
  }
}

async function subsetStreetSheet(sheet, opts) {
  const zipPath = path.join(opts.out, `${sheet}.zip`);
  const dir = path.join(opts.out, sheet);
  console.log(`[gltf] download ${sheet}`);
  await fetchSheetZip(sheet, zipPath);
  const names = listZip(zipPath);
  const gltfs = names.filter((name) => isBuildingGltf(name));
  console.log(`[gltf] ${sheet} zip BUILDING glTF ${gltfs.length}`);
  rmSync(dir, { recursive: true, force: true });
  extractEntries(zipPath, dir, gltfs);
  const survey = surveySheet(dir);
  const overlapBoxes = survey.buildings.filter((box) => overlapsCore(box));
  const spanned = overlapBoxes.filter((box) => box.span >= STREET_MIN_SPAN);
  // 11-SW-14A is the Bank of China photograph. The rest of that sheet is not the Des Voeux chase.
  const kept = isGltfPinSheet(sheet) ? filterPinSheetBuildings(spanned) : spanned;
  const prefixes = new Set(kept.map((box) => parentDir(box.file)).filter(Boolean));
  const extras = names.filter((name) => {
    if (name.toLowerCase().endsWith('.gltf')) return false;
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) return true;
    }
    return false;
  });
  extractEntries(zipPath, dir, extras);
  removeUnkept(dir, kept);
  if (!opts.keepZip) rmSync(zipPath, { force: true });
  console.log(`[gltf] ${sheet} BUILDING files ${survey.buildingFiles} core ${overlapBoxes.length} kept ${kept.length}`);
  return {
    sheet,
    buildingFiles: survey.buildingFiles,
    overlap: overlapBoxes.length,
    kept: kept.length,
    buildings: kept
  };
}

function help() {
  return `Usage: node tools/fetch-central-gltf-sheet.mjs [--sheet 11-SW-9B] [--street] [--out hk-3d]

Downloads https://download.map.gov.hk/api/3d-zip/GLTF/{SHEET}.zip into hk-3d/.
With no --sheet, 11-SW-9B is fetched first. If it has no BUILDING glTF overlapping Central,
11-SW-9A is fetched and becomes the sheet.
--street downloads 11-SW-9C and 11-SW-8D, keeps BUILDING glTF intersecting the Central box
(span at least ${STREET_MIN_SPAN} m), and drops the rest of each zip.
It also downloads 11-SW-14A and keeps only the BUILDING mesh that covers the Bank of China Tower plate.
The page loads those sheets when hk-3d/<sheet>/manifest.json is present.
No further Central sheet is pinned for the Digit1 mid-band. A bounds pass of BUILDING glTF
on 11-SW-9C, 11-SW-8D, 11-SW-14A and 11-SW-13B leaves those hits outside every mesh.`;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(help());
    return;
  }
  if (opts.street) {
    mkdirSync(opts.out, { recursive: true });
    const wanted = opts.sheet ? [assertSheetAllowed(opts.sheet)] : STREET_SHEETS.map((id) => assertSheetAllowed(id));
    const reports = [];
    for (const sheet of wanted) {
      const survey = await subsetStreetSheet(sheet, opts);
      const manifest = {
        sheet: survey.sheet,
        source: `${ZIP_URL}/${survey.sheet}.zip`,
        crs: 'EPSG:2326',
        attribution: '© Government of the Hong Kong SAR (Lands Department) / Open3Dhk (https://3d.map.gov.hk/)',
        reason: `${survey.sheet}: ${survey.buildingFiles} BUILDING glTF in the sheet, ${survey.overlap} intersect Central, ${survey.kept} kept (span ≥ ${STREET_MIN_SPAN} m)`,
        counts: {
          buildingFiles: survey.buildingFiles,
          overlap: survey.overlap,
          kept: survey.kept,
          minSpan: STREET_MIN_SPAN
        },
        buildings: survey.buildings
      };
      writeFileSync(path.join(opts.out, survey.sheet, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      reports.push(survey);
    }
    writeFileSync(path.join(opts.out, 'sheet.json'), `${JSON.stringify({
      sheets: reports.map(({ sheet, buildingFiles, overlap, kept }) => ({ sheet, buildingFiles, overlap, kept })),
      reason: 'Central street faces: 11-SW-9C (Statue Square / Des Voeux east), 11-SW-8D (dense sheet west of that corner), and 11-SW-14A (Bank of China Tower photograph only)'
    }, null, 2)}\n`);
    for (const survey of reports) {
      console.log(`[gltf] ${survey.sheet} kept ${survey.kept} / sheet ${survey.buildingFiles} / core ${survey.overlap}`);
    }
    return;
  }
  const queue = [opts.sheet ? assertSheetAllowed(opts.sheet) : '11-SW-9B'];
  const reports = [];
  for (const sheet of queue) {
    const zipPath = path.join(opts.out, `${sheet}.zip`);
    const dir = path.join(opts.out, sheet);
    console.log(`[gltf] download ${sheet}`);
    await fetchSheetZip(sheet, zipPath);
    unzip(zipPath, dir);
    const survey = surveySheet(dir);
    console.log(`[gltf] ${sheet} BUILDING files ${survey.buildingFiles} overlapping Central ${survey.overlap}`);
    reports.push({ sheet, buildingFiles: survey.buildingFiles, overlap: survey.overlap, buildings: survey.buildings });
    if (survey.overlap > 0) break;
    if (!opts.sheet && sheet === '11-SW-9B') queue.push('11-SW-9A');
  }
  const choice = chooseCentralSheet(reports);
  const used = reports.find((report) => report.sheet === choice.sheet) || reports[reports.length - 1];
  const manifest = {
    sheet: used.sheet,
    source: `${ZIP_URL}/${used.sheet}.zip`,
    crs: 'EPSG:2326',
    attribution: '© Government of the Hong Kong SAR (Lands Department) / Open3Dhk (https://3d.map.gov.hk/)',
    reason: choice.reason,
    buildings: used.buildings
  };
  writeFileSync(path.join(opts.out, used.sheet, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(opts.out, 'sheet.json'), `${JSON.stringify({
    sheet: used.sheet,
    reason: choice.reason,
    reports: reports.map(({ sheet, buildingFiles, overlap }) => ({ sheet, buildingFiles, overlap }))
  }, null, 2)}\n`);
  console.log(`[gltf] using ${used.sheet}`);
  console.log(`[gltf] ${choice.reason}`);
  console.log(`[gltf] open index.html?gltf=${used.sheet}`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
