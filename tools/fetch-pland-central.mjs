#!/usr/bin/env node
// Download PlanD 3D Photo-realistic Model tiles for the Des Voeux Digit1 corridor.
// OBJ is the page path: each zip is one continuous Altizure mesh. The clip keeps
// triangles on the person-chase corridor and drops the road carpet. OSGB and CESIUM
// are the same capture; this tool can download those zips, and the page does not load them.
//
//   node tools/fetch-pland-central.mjs
//   node tools/fetch-pland-central.mjs --tiles tile_21_26,tile_22_26
//   node tools/fetch-pland-central.mjs --format CESIUM --keep-zip

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ISLAND_BOUNDS } from '../js/city-config.js';
import {
  PLAND_ATTRIBUTION,
  PLAND_CAPTURE,
  PLAND_DATASET,
  PLAND_TILES_API,
  assertPlandFileType,
  createPlandObjClipper,
  digit1CorridorSamples,
  parsePlandMtl,
  parsePlandTiles,
  plandModelTransform,
  plandTilesUrl
} from '../js/hk-pland-frame.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function parseArgs(argv) {
  const opts = {
    out: path.join(root, 'hk-3d', 'pland'),
    format: 'OBJ',
    tiles: [],
    help: false,
    keepZip: false
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--keep-zip') opts.keepZip = true;
    else if (arg === '--format') opts.format = assertPlandFileType(argv[++i] || '');
    else if (arg === '--tiles') opts.tiles = String(argv[++i] || '').split(',').map((id) => id.trim()).filter(Boolean);
    else if (arg === '--out') opts.out = path.resolve(argv[++i] || opts.out);
    else throw new Error(`Unknown argument ${arg}`);
  }
  opts.format = assertPlandFileType(opts.format);
  for (const grid of opts.tiles) {
    if (!/^tile_\d+_\d+$/.test(grid)) throw new Error(`bad tile ${grid}`);
  }
  return opts;
}

function help() {
  return `Usage: node tools/fetch-pland-central.mjs [--format OBJ|OSGB|CESIUM] [--tiles tile_21_26,tile_22_26] [--out hk-3d/pland]

Queries ${PLAND_TILES_API} at the Digit1 corridor (Des Voeux eye, then every 125 m along heading 1.29).
OBJ zips are clipped to that corridor and written as glTF the page loads by default. ?pland=off leaves it unmounted. ?pland=compare is the A-B.
OSGB and CESIUM zips are downloaded only. The page does not load them.
hk-3d/ is gitignored. A missing manifest leaves LandsD individualised meshes as they are.`;
}

function downloadZip(url, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const result = spawnSync('curl', [
    '-fL', '--retry', '5', '--retry-all-errors', '--retry-delay', '2',
    '-C', '-', '-o', dest, url
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `curl failed for ${url}`);
}

function listZip(zipPath) {
  const result = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `unzip -Z1 failed for ${zipPath}`);
  return result.stdout.split(/\r?\n/).filter(Boolean).map((name) => name.replace(/\\/g, '/'));
}

function readZipText(zipPath, entry) {
  const result = spawnSync('unzip', ['-p', zipPath, entry], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `unzip -p failed for ${entry}`);
  return result.stdout;
}

function extractEntry(zipPath, entry, dest) {
  mkdirSync(dest, { recursive: true });
  const result = spawnSync('unzip', ['-q', '-o', '-j', '-d', dest, zipPath, entry], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `unzip failed for ${entry}`);
}

function directTile(grid, fileType) {
  const type = assertPlandFileType(fileType);
  return {
    grid,
    fid: null,
    locEn: '',
    locTc: '',
    modiDate: '',
    fileUrl: `https://pdmap.pland.gov.hk/PLANDWEB/public/3d_photo_realistic_models/${type}/${grid}_${type}.zip`
  };
}

async function resolveTiles(fileType, only) {
  const samples = digit1CorridorSamples();
  const byGrid = new Map();
  for (const sample of samples) {
    const url = plandTilesUrl(sample.easting, sample.northing, fileType);
    console.log(`[pland] GET ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    const parsed = parsePlandTiles(await res.json());
    if (!parsed.ok) throw new Error(`${url} ${parsed.message}`);
    for (const tile of parsed.tiles) {
      if (!byGrid.has(tile.grid)) byGrid.set(tile.grid, tile);
    }
  }
  if (!only.length) return [...byGrid.values()];
  const chosen = [];
  for (const grid of only) {
    chosen.push(byGrid.get(grid) || directTile(grid, fileType));
  }
  return chosen;
}

async function streamClip(zipPath, entry, options) {
  const child = spawn('unzip', ['-p', zipPath, entry], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const clipper = createPlandObjClipper({
    ...options,
    onProgress: (status) => {
      console.log(
        `[pland] ${entry} lines ${status.lines} verts ${status.vertCount} kept ${status.kept} ` +
        `ground ${status.dropped.ground} outside ${status.dropped.outside}`
      );
    }
  });
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) clipper.pushLine(line);
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (code !== 0) throw new Error(stderr || `unzip failed for ${entry}`);
  return clipper.finish();
}

async function probeDatum(zipPath, entry, transform) {
  const child = spawn('unzip', ['-p', zipPath, entry], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', () => {});
  child.stdout.on('error', () => {});
  const clipper = createPlandObjClipper({ transform });
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      clipper.pushLine(line);
      if (String(line).trim().startsWith('f ')) break;
    }
  } catch {
    // The probe stops at the first face. Closing unzip ends the pipe.
  } finally {
    rl.close();
    if (!child.killed) child.kill('SIGTERM');
  }
  const result = clipper.finish();
  return { streetHkpd: result.streetHkpd, datumSamples: result.datumSamples };
}

function writeCorridorGltf(dir, clip, imageByMaterial) {
  const names = Object.keys(clip.materials).filter((name) => imageByMaterial[name] && clip.materials[name].local.length);
  if (!names.length) return null;
  const parts = [];
  const bufferViews = [];
  const accessors = [];
  const images = [];
  const textures = [];
  const materials = [];
  const primitives = [];
  let byteOffset = 0;

  function align() {
    const pad = (4 - (byteOffset % 4)) % 4;
    if (!pad) return;
    parts.push(Buffer.alloc(pad));
    byteOffset += pad;
  }

  for (const name of names) {
    const part = clip.materials[name];
    const count = part.local.length / 3;
    align();
    const position = Buffer.from(part.local.buffer, part.local.byteOffset, part.local.byteLength);
    parts.push(position);
    const positionView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: position.length, target: 34962 });
    byteOffset += position.length;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < part.local.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const value = part.local[i + k];
        if (value < min[k]) min[k] = value;
        if (value > max[k]) max[k] = value;
      }
    }
    align();
    const uv = new Float32Array(part.uv);
    for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];
    const uvBytes = Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength);
    parts.push(uvBytes);
    const uvView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: uvBytes.length, target: 34962 });
    byteOffset += uvBytes.length;
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count,
      type: 'VEC3',
      min,
      max
    });
    const uvAccessor = accessors.length;
    accessors.push({ bufferView: uvView, componentType: 5126, count, type: 'VEC2' });
    const imageIndex = images.length;
    images.push({ uri: imageByMaterial[name] });
    textures.push({ sampler: 0, source: imageIndex });
    const materialIndex = materials.length;
    materials.push({
      name,
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorTexture: { index: textures.length - 1 },
        metallicFactor: 0,
        roughnessFactor: 1
      }
    });
    primitives.push({
      attributes: { POSITION: positionAccessor, TEXCOORD_0: uvAccessor },
      material: materialIndex
    });
  }

  const bin = Buffer.concat(parts);
  const gltf = {
    asset: { version: '2.0', generator: 'fetch-pland-central' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'PlanDCorridor' }],
    meshes: [{ primitives }],
    materials,
    textures,
    images,
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors,
    bufferViews,
    buffers: [{ uri: 'corridor.bin', byteLength: bin.length }]
  };
  writeFileSync(path.join(dir, 'corridor.gltf'), `${JSON.stringify(gltf)}\n`);
  writeFileSync(path.join(dir, 'corridor.bin'), bin);
  return names.length;
}

async function clipTile(tile, zipPath, streetHkpd, outDir) {
  const entries = listZip(zipPath);
  const configEntry = entries.find((name) => name.endsWith('config.json'));
  const objEntry = entries.find((name) => name.endsWith('.obj'));
  const mtlEntry = entries.find((name) => name.endsWith('.mtl'));
  if (!configEntry || !objEntry || !mtlEntry) throw new Error(`${tile.grid} zip is missing config.json, obj, or mtl`);
  const transform = plandModelTransform(JSON.parse(readZipText(zipPath, configEntry)));
  const maps = parsePlandMtl(readZipText(zipPath, mtlEntry));
  console.log(`[pland] clip ${tile.grid} street HKPD ${streetHkpd}`);
  const clip = await streamClip(zipPath, objEntry, { transform, streetHkpd });
  const tileDir = path.join(outDir, tile.grid);
  mkdirSync(tileDir, { recursive: true });
  const imageByMaterial = {};
  for (const [name, file] of Object.entries(maps)) {
    if (!clip.materials[name]) continue;
    const entry = entries.find((item) => item.endsWith(`/${file}`) || item.endsWith(file));
    if (!entry) throw new Error(`${tile.grid} missing texture ${file}`);
    extractEntry(zipPath, entry, tileDir);
    imageByMaterial[name] = path.basename(file);
  }
  const primitives = writeCorridorGltf(tileDir, clip, imageByMaterial);
  return {
    grid: tile.grid,
    gltf: `${tile.grid}/corridor.gltf`,
    modelTransform: transform,
    locTc: tile.locTc,
    locEn: tile.locEn,
    modiDate: tile.modiDate,
    fileUrl: tile.fileUrl,
    triangles: clip.triangles,
    dropped: clip.dropped,
    box: clip.box,
    primitives: primitives || 0,
    datumSamples: clip.datumSamples
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(help());
    return;
  }
  mkdirSync(opts.out, { recursive: true });
  const tiles = await resolveTiles(opts.format, opts.tiles);
  if (!tiles.length) throw new Error('PlanD returned no tiles for the Digit1 corridor');
  console.log(`[pland] tiles ${tiles.map((tile) => tile.grid).join(', ')}`);
  const zips = [];
  for (const tile of tiles) {
    const zipPath = path.join(opts.out, `${tile.grid}_${opts.format}.zip`);
    console.log(`[pland] download ${tile.fileUrl}`);
    downloadZip(tile.fileUrl, zipPath);
    zips.push({ tile, zipPath });
  }
  if (opts.format !== 'OBJ') {
    console.log(`[pland] ${opts.format} saved. The page loads the OBJ corridor clip, not this format.`);
    return;
  }
  const probes = [];
  for (const item of zips) {
    const entries = listZip(item.zipPath);
    const configEntry = entries.find((name) => name.endsWith('config.json'));
    const objEntry = entries.find((name) => name.endsWith('.obj'));
    const transform = plandModelTransform(JSON.parse(readZipText(item.zipPath, configEntry)));
    const probe = await probeDatum(item.zipPath, objEntry, transform);
    console.log(`[pland] ${item.tile.grid} pavement samples ${probe.datumSamples} HKPD ${probe.streetHkpd}`);
    probes.push(probe);
  }
  const best = probes.reduce((pick, probe) => {
    if (!pick || (probe.datumSamples || 0) > (pick.datumSamples || 0)) return probe;
    return pick;
  }, null);
  if (!best || !Number.isFinite(best.streetHkpd)) {
    throw new Error('No PlanD pavement vertices within 18 m of the Des Voeux eye. Refusing to invent a vertical datum.');
  }
  const clipped = [];
  for (const item of zips) {
    const report = await clipTile(item.tile, item.zipPath, best.streetHkpd, opts.out);
    console.log(
      `[pland] ${report.grid} kept ${report.triangles} ground ${report.dropped.ground} outside ${report.dropped.outside}` +
      (report.box ? ` box x ${report.box.minX.toFixed(1)}..${report.box.maxX.toFixed(1)} z ${report.box.minZ.toFixed(1)}..${report.box.maxZ.toFixed(1)}` : '')
    );
    if (report.triangles > 0) clipped.push(report);
  }
  if (!clipped.length) throw new Error('Digit1 corridor clip kept no triangles');
  const manifest = {
    source: 'Planning Department 3D Photo-realistic Model',
    attribution: PLAND_ATTRIBUTION,
    dataset: PLAND_DATASET,
    api: PLAND_TILES_API,
    capture: PLAND_CAPTURE,
    fileType: 'OBJ',
    streetHkpd: best.streetHkpd,
    sidewalk: ISLAND_BOUNDS.sidewalkHeight,
    corridor: { eye: [-1.4, 29.3], heading: 1.29, reach: 500, half: 72, groundClearance: 1.2 },
    tiles: clipped.map(({ dropped, box, primitives, datumSamples, locEn, ...tile }) => ({
      ...tile,
      triangles: tile.triangles,
      box,
      dropped
    }))
  };
  writeFileSync(path.join(opts.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[pland] wrote ${path.join(opts.out, 'manifest.json')}`);
  console.log('[pland] open index.html?at=-1.4,29.3,1.29');
  console.log('[pland] A-B the same cameras with index.html?pland=compare&at=-1.4,29.3,1.29');
  if (!opts.keepZip) {
    for (const item of zips) rmSync(item.zipPath, { force: true });
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
