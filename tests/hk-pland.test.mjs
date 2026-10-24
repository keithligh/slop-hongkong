import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HK_STREET_EYE, ISLAND_BOUNDS } from '../js/city-config.js';
import { hk80ToWorld } from '../js/hk-gltf-frame.js';
import {
  PLAND_ATTRIBUTION,
  PLAND_DATASET,
  PLAND_DIGIT1_CAMERAS,
  PLAND_TILE_21_26_SAMPLE,
  PLAND_TILE_21_26_TRANSFORM,
  PLAND_TILE_21_27_SAMPLE,
  PLAND_TILES_API,
  assertPlandFileType,
  clipPlandObjText,
  digit1CorridorSamples,
  formatPlandLog,
  parsePlandMtl,
  parsePlandTiles,
  plandCorridorExtrudeIds,
  plandKeepTriangle,
  plandLocalToHk80,
  plandLocalToWorld,
  plandModelTransform,
  plandStreetHkpd,
  plandTilesUrl,
  planPlandManifest,
  resolvePlandRequest,
  withPlandCorridorHidden,
  worldToHk80
} from '../js/hk-pland-frame.js';

const root = fileURLToPath(new URL('..', import.meta.url));

// Live pdmap response, 2026-10-24, for the coordinate in the PlanD specification PDF.
const LIVE_TILE_20_26 = {
  respCd: 0,
  msg: 'Success',
  gridList: [{
    fid: 88,
    grid_name: 'tile_20_26',
    loc_en: '"Wan Chai, Admiralty and Central"',
    loc_tc: '灣仔、金鐘及中環',
    loc_sc: '湾仔、金钟及中环',
    file_url: 'https://pdmap.pland.gov.hk/PLANDWEB/public/3d_photo_realistic_models/CESIUM/tile_20_26_CESIUM.zip',
    modi_date: '21/02/2019 00:00'
  }]
};

function localFromGrid(easting, northing, hkpd, transform = PLAND_TILE_21_26_TRANSFORM) {
  return [
    easting - transform[0][3],
    northing - transform[1][3],
    hkpd
  ];
}

test('the Digit1 eye asks the live PlanD API for OBJ, and the PDF example is tile_20_26', () => {
  assert.equal(assertPlandFileType('obj'), 'OBJ');
  assert.equal(assertPlandFileType('CESIUM'), 'CESIUM');
  assert.throws(() => assertPlandFileType('gltf'), /bad fileType/);
  assert.throws(() => plandTilesUrl(1, 2, 'mapillary'), /bad fileType/);
  const eye = worldToHk80(HK_STREET_EYE.x, HK_STREET_EYE.z);
  const back = hk80ToWorld(eye.easting, eye.northing, 0);
  assert.ok(Math.abs(back[0] - HK_STREET_EYE.x) < 0.05, `x ${back[0]}`);
  assert.ok(Math.abs(back[2] - HK_STREET_EYE.z) < 0.05, `z ${back[2]}`);
  const url = plandTilesUrl(eye.easting, eye.northing, 'OBJ');
  assert.equal(url, `${PLAND_TILES_API}?e=834507&n=815749&fileType=OBJ`);
  const parsed = parsePlandTiles(LIVE_TILE_20_26);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tiles[0].grid, 'tile_20_26');
  assert.equal(parsed.tiles[0].locTc, '灣仔、金鐘及中環');
  assert.equal(parsed.tiles[0].locEn, 'Wan Chai, Admiralty and Central');
  assert.match(parsed.tiles[0].modiDate, /2019/);
  assert.equal(parsePlandTiles({ respCd: 1, msg: 'No available 3D Model for Location Specified' }).ok, false);
  assert.notEqual(parsed.tiles[0].grid, 'tile_21_26');
});

test('Altizure model_transform places the sampled OBJ vertices on the HK1980 grid', () => {
  const transform = plandModelTransform({ model_transform: PLAND_TILE_21_26_TRANSFORM });
  const south = plandLocalToHk80(...PLAND_TILE_21_26_SAMPLE.local, transform);
  assert.ok(Math.abs(south.easting - 834504.358) < 0.01, south.easting);
  assert.ok(Math.abs(south.northing - 815500) < 1e-4, south.northing);
  assert.ok(Math.abs(south.hkpd - 22.364851818) < 1e-6);
  const nearEye = plandLocalToWorld(
    ...PLAND_TILE_21_27_SAMPLE.local,
    transform,
    PLAND_TILE_21_27_SAMPLE.local[2]
  );
  assert.ok(Math.abs(nearEye.x - -2.33) < 0.05, nearEye.x);
  assert.equal(nearEye.y, ISLAND_BOUNDS.sidewalkHeight);
  assert.ok(Math.abs(nearEye.z - 20.84) < 0.05, nearEye.z);
  assert.equal(plandStreetHkpd([9, 4, 5, 4.2, 40]), 4);
  assert.equal(plandStreetHkpd([]), null);
});

test('the corridor clip keeps a Des Voeux facade and drops the road and the south of the tile', () => {
  const eye = worldToHk80(HK_STREET_EYE.x, HK_STREET_EYE.z);
  const street = 5;
  const samples = digit1CorridorSamples();
  assert.equal(samples[0].along, 0);
  assert.ok(samples.at(-1).easting > 834800, samples.at(-1).easting);
  assert.ok(samples.at(-1).easting > samples[0].easting);
  const facade = [
    localFromGrid(eye.easting, eye.northing, street + 6),
    localFromGrid(eye.easting + 1.5, eye.northing, street + 6),
    localFromGrid(eye.easting, eye.northing + 1.5, street + 6)
  ];
  const ground = [
    localFromGrid(eye.easting + 3, eye.northing, street),
    localFromGrid(eye.easting + 4, eye.northing, street),
    localFromGrid(eye.easting + 3, eye.northing + 1, street)
  ];
  const south = PLAND_TILE_21_26_SAMPLE.local;
  const lines = [
    '# 9 vertices',
    ...facade.map((v) => `v ${v.join(' ')}`),
    ...ground.map((v) => `v ${v.join(' ')}`),
    `v ${south[0]} ${south[1]} ${south[2]}`,
    `v ${south[0] + 1} ${south[1]} ${south[2]}`,
    `v ${south[0]} ${south[1] + 1} ${south[2]}`,
    'vt 0 0',
    'vt 1 0',
    'vt 0 1',
    'usemtl mat_tex_0',
    'f 1/1 2/2 3/3',
    'usemtl mat_tex_1',
    'f 4/1 5/2 6/3',
    'f 7/1 8/2 9/3'
  ];
  const clip = clipPlandObjText(lines.join('\n'), { transform: PLAND_TILE_21_26_TRANSFORM });
  assert.equal(clip.triangles, 1);
  assert.equal(clip.dropped.ground, 1);
  assert.equal(clip.dropped.outside, 1);
  assert.ok(clip.streetHkpd > 4 && clip.streetHkpd < 7, clip.streetHkpd);
  assert.ok(clip.materials.mat_tex_0);
  assert.equal(clip.materials.mat_tex_1, undefined);
  const kept = plandLocalToWorld(
    clip.materials.mat_tex_0.local[0],
    clip.materials.mat_tex_0.local[1],
    clip.materials.mat_tex_0.local[2],
    PLAND_TILE_21_26_TRANSFORM,
    clip.streetHkpd
  );
  assert.equal(plandKeepTriangle(
    { x: kept.x, y: kept.y, z: kept.z },
    { x: kept.x + 1, y: kept.y, z: kept.z },
    { x: kept.x, y: kept.y, z: kept.z + 1 }
  ), 'keep');
  assert.equal(plandKeepTriangle(
    { x: HK_STREET_EYE.x, y: 0.22, z: HK_STREET_EYE.z },
    { x: HK_STREET_EYE.x + 1, y: 0.3, z: HK_STREET_EYE.z },
    { x: HK_STREET_EYE.x, y: 0.4, z: HK_STREET_EYE.z + 1 }
  ), 'ground');
  const quad = clipPlandObjText([
    `v ${facade[0].join(' ')}`,
    `v ${facade[1].join(' ')}`,
    `v ${facade[2].join(' ')}`,
    `v ${facade[0][0] + 2} ${facade[0][1] + 2} ${facade[0][2]}`,
    'f 1 2 3 4'
  ].join('\n'), { transform: PLAND_TILE_21_26_TRANSFORM, streetHkpd: street });
  assert.equal(quad.triangles, 2);
});

test('PlanD stays off unless the page asks for a donor or an A-B compare', () => {
  assert.equal(resolvePlandRequest('https://x/index.html'), null);
  assert.equal(resolvePlandRequest('https://x/index.html?pland=0'), null);
  assert.equal(resolvePlandRequest('https://x/index.html?pland=off'), null);
  assert.equal(resolvePlandRequest('https://x/index.html?pland=mapillary'), null);
  assert.equal(resolvePlandRequest('https://x/index.html?pland=kartaview'), null);
  assert.deepEqual(resolvePlandRequest('https://x/index.html?pland=1'), { mode: 'donor' });
  assert.deepEqual(resolvePlandRequest('https://x/index.html?pland=donor'), { mode: 'donor' });
  assert.deepEqual(resolvePlandRequest('https://x/index.html?pland=compare'), { mode: 'compare' });
  assert.deepEqual(resolvePlandRequest('https://x/index.html?pland=ab'), { mode: 'compare' });
  const plan = planPlandManifest({
    streetHkpd: 4.2,
    attribution: PLAND_ATTRIBUTION,
    tiles: [{
      grid: 'tile_21_26',
      gltf: 'tile_21_26/corridor.gltf',
      modelTransform: PLAND_TILE_21_26_TRANSFORM,
      locTc: '灣仔、金鐘及中環',
      modiDate: '21/02/2019 00:00'
    }]
  }, { mode: 'donor' });
  assert.equal(plan.tiles[0].grid, 'tile_21_26');
  assert.equal(plan.mode, 'donor');
  assert.equal(planPlandManifest({ tiles: plan.tiles }, { mode: 'donor' }), null);
  assert.equal(planPlandManifest({ streetHkpd: 4.2, tiles: [] }, { mode: 'compare' }), null);
  const line = formatPlandLog(plan);
  assert.match(line, /規劃署/);
  assert.match(line, /March 2017/);
  assert.match(line, /tile_21_26/);
  assert.match(line, /-1\.4,29\.3,1\.29/);
  assert.match(line, /not a current Henderson shopfront and not Sleeping Dogs/);
  assert.match(PLAND_DATASET, /hk-pland-pland1-3d-photo-realistic-model/);
});

test('Digit1 cameras are the person chase, and a corridor extrude is hidden only while PlanD is loaded', () => {
  assert.equal(PLAND_DIGIT1_CAMERAS[0].x, HK_STREET_EYE.x);
  assert.equal(PLAND_DIGIT1_CAMERAS[0].z, HK_STREET_EYE.z);
  assert.equal(PLAND_DIGIT1_CAMERAS[0].heading, HK_STREET_EYE.heading);
  assert.deepEqual(PLAND_DIGIT1_CAMERAS.map((camera) => camera.query), [
    '-1.4,29.3,1.29',
    '22.6,36.2,1.29',
    '-1.4,35.3,1.29'
  ]);
  const blocks = [
    { id: 7, height: 20, cx: -1, cz: 30, minX: -6, maxX: 4, minZ: 24, maxZ: 36, park: 0 },
    { id: 8, height: 20, cx: 4000, cz: 4000, minX: 3990, maxX: 4010, minZ: 3990, maxZ: 4010, park: 0 },
    { id: 9, height: null, cx: -1, cz: 30, minX: -6, maxX: 4, minZ: 24, maxZ: 36, park: 0 },
    { id: 10, height: 5, cx: -1, cz: 30, minX: -6, maxX: 4, minZ: 24, maxZ: 36, park: 0.9 }
  ];
  assert.deepEqual(plandCorridorExtrudeIds(blocks), [7]);
  const merged = withPlandCorridorHidden({ hiddenIds: new Set([3]), selected: [{ name: 'landsd' }] }, blocks);
  assert.equal(merged.selected[0].name, 'landsd');
  assert.ok(merged.hiddenIds.has(3));
  assert.ok(merged.hiddenIds.has(7));
  const mtl = parsePlandMtl('newmtl mat_tex_0\nKd 1 1 1\nmap_Kd level_5_0_0_tex_0.jpg\n');
  assert.equal(mtl.mat_tex_0, 'level_5_0_0_tex_0.jpg');
});

test('boot wires the flag, the fetch tool, and no street-view atlas bake', () => {
  const main = readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const page = readFileSync(path.join(root, 'js/hk-pland.js'), 'utf8');
  const tool = readFileSync(path.join(root, 'tools/fetch-pland-central.mjs'), 'utf8');
  const frame = readFileSync(path.join(root, 'js/hk-pland-frame.js'), 'utf8');
  assert.match(main, /preparePlandCorridor/);
  assert.match(main, /mountPlandCorridor/);
  assert.match(main, /hidePlandCorridorExtrudes/);
  assert.match(main, /mode === 'compare'/);
  assert.match(main, /正在載入規劃署三維實景（中環街廊）/);
  assert.match(main, /mountHkGltfBuildings/);
  assert.match(html, /hk-pland-frame\.js/);
  assert.match(html, /hk-pland\.js/);
  assert.match(page, /GLTFLoader/);
  assert.match(page, /polygonOffset/);
  assert.match(page, /metalness = 0/);
  assert.match(frame, /https:\/\/pdmap\.pland\.gov\.hk\/plandapi\/Tiles/);
  assert.match(tool, /plandTilesUrl/);
  assert.match(tool, /plandModelTransform/);
  assert.match(tool, /digit1CorridorSamples/);
  assert.match(frame, /836974\.635391304153/);
  const sources = `${main}\n${page}\n${tool}\n${frame}`;
  assert.doesNotMatch(sources, /mapillary|kartaview|openstreetcam/i);
  assert.doesNotMatch(page, /generative|dall-e|stable-diffusion/i);
});
