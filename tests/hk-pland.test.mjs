import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BLOCKS, HK_RETAIL_BELT, HK_STREET_EYE, HK_STREET_NEAR, ISLAND_BOUNDS } from '../js/city-config.js';
import { HK_CURB_W, HK_WALK_W } from '../js/hk-road-deck.js';
import { boxClosestDistance, hk80ToWorld } from '../js/hk-gltf-frame.js';
import {
  PLAND_ATTRIBUTION,
  PLAND_DATASET,
  PLAND_LANDSD_SKIRT,
  PLAND_PAGE_TEX_EDGE,
  PLAND_PODIUM_ABOVE_BELT,
  PLAND_PODIUM_FACE,
  PLAND_BOC_PLATE_PEAK,
  PLAND_BOC_PLATE_PROUD,
  PLAND_FLANK_FACE,
  PLAND_FLANK_PROUD,
  PLAND_FLANK_TOP,
  DIGIT1_MIDBAND_PLATES,
  digit1BocTowerPlate,
  digit1LookFrame,
  digit1MidbandWallSpec,
  plandOmitsDigit1BocPlate,
  plandOmitsDigit1FlankChart,
  plandOmitsDigit1MidbandPlate,
  plandOmitsPodiumInsideLandsd,
  plandYieldsToLandsd,
  PLAND_DIGIT1_LOOK_ALONG_MAX,
  PLAND_DIGIT1_LOOK_ALONG_MIN,
  PLAND_DIGIT1_LOOK_HALF,
  PLAND_DIGIT1_LOOK_Y_CLEAR,
  PLAND_STREET_SHELL_APRON,
  PLAND_STREET_SHELL_TOP,
  desVoeuxCarriageSegments,
  plandCarriageDistance,
  plandOmitsCarriageShell,
  plandOmitsDigit1LookGround,
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
  omitPlandCorridorGlass,
  planPlandManifest,
  resolvePlandRequest,
  withPlandCorridorHidden,
  worldToHk80
} from '../js/hk-pland-frame.js';
import { digit1InvaderGate } from '../tools/digit1-invader-gate.mjs';

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

test('the Digit1 page mounts PlanD as a donor unless the query turns it off', () => {
  assert.deepEqual(resolvePlandRequest('https://x/index.html'), { mode: 'donor' });
  assert.deepEqual(resolvePlandRequest('https://x/index.html?at=-1.4,29.3,1.29'), { mode: 'donor' });
  assert.equal(resolvePlandRequest('https://x/index.html?pland=0'), null);
  assert.equal(resolvePlandRequest('https://x/index.html?pland=off'), null);
  assert.equal(resolvePlandRequest('https://x/index.html?pland=false'), null);
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
  assert.equal(merged.podiumFillIds.size, 0);
  assert.equal(merged.podiumFillIds.has(7), false);
  const mtl = parsePlandMtl('newmtl mat_tex_0\nKd 1 1 1\nmap_Kd level_5_0_0_tex_0.jpg\n');
  assert.equal(mtl.mat_tex_0, 'level_5_0_0_tex_0.jpg');
});

test('PlanD drops the low Des Voeux carriageway shell and keeps a lot face', () => {
  const segments = desVoeuxCarriageSegments();
  assert.ok(segments.length > 8);
  assert.equal(PLAND_STREET_SHELL_TOP, 4.5);
  // Kerb plus sidewalk, short of the building line. 0.75 m left the walk scraps.
  assert.equal(PLAND_STREET_SHELL_APRON, HK_CURB_W + HK_WALK_W - 0.4);
  const eyeRoad = plandCarriageDistance(HK_STREET_EYE.x, HK_STREET_EYE.z, segments);
  assert.ok(eyeRoad.dist < 0.5, eyeRoad.dist);
  assert.ok(Math.abs(eyeRoad.half - 3.3) < 0.05, eyeRoad.half);
  assert.equal(plandOmitsCarriageShell(
    { x: HK_STREET_EYE.x, y: 1.4, z: HK_STREET_EYE.z },
    { x: HK_STREET_EYE.x + 0.8, y: 2.6, z: HK_STREET_EYE.z + 0.2 },
    { x: HK_STREET_EYE.x + 0.2, y: 3.1, z: HK_STREET_EYE.z + 0.7 },
    segments
  ), true);
  // A corner on the asphalt and a vertex up the shell is the jagged scrap #21 kept.
  assert.equal(plandOmitsCarriageShell(
    { x: HK_STREET_EYE.x, y: 2, z: HK_STREET_EYE.z },
    { x: HK_STREET_EYE.x + 0.8, y: 12, z: HK_STREET_EYE.z },
    { x: HK_STREET_EYE.x, y: 6, z: HK_STREET_EYE.z + 0.8 },
    segments
  ), true);
  const rx = -Math.cos(HK_STREET_EYE.heading);
  const rz = Math.sin(HK_STREET_EYE.heading);
  const walk = {
    x: HK_STREET_EYE.x + rx * (eyeRoad.half + 1.5),
    z: HK_STREET_EYE.z + rz * (eyeRoad.half + 1.5)
  };
  assert.equal(plandOmitsCarriageShell(
    { x: walk.x, y: 1.2, z: walk.z },
    { x: walk.x + 0.4, y: 7.5, z: walk.z },
    { x: walk.x, y: 3, z: walk.z + 0.4 },
    segments
  ), true);
  const lot = { x: HK_STREET_EYE.x + rx * 8, z: HK_STREET_EYE.z + rz * 8 };
  const lotRoad = plandCarriageDistance(lot.x, lot.z, segments);
  assert.ok(lotRoad.dist > eyeRoad.half + PLAND_STREET_SHELL_APRON + 2, lotRoad.dist);
  assert.equal(plandOmitsCarriageShell(
    { x: lot.x, y: 1.5, z: lot.z },
    { x: lot.x + 1, y: 3.2, z: lot.z },
    { x: lot.x, y: 2.4, z: lot.z + 1 },
    segments
  ), false);
  assert.equal(plandOmitsCarriageShell(
    { x: HK_STREET_EYE.x, y: 1.4, z: HK_STREET_EYE.z },
    { x: lot.x, y: 3.0, z: lot.z },
    { x: lot.x + 1, y: 2.2, z: lot.z },
    segments
  ), true);
  assert.equal(plandOmitsCarriageShell(
    { x: HK_STREET_EYE.x, y: 1.4, z: HK_STREET_EYE.z },
    { x: HK_STREET_EYE.x + 1, y: 2, z: HK_STREET_EYE.z },
    { x: HK_STREET_EYE.x, y: 2, z: HK_STREET_EYE.z + 1 },
    []
  ), false);
  const page = readFileSync(path.join(root, 'js/hk-pland.js'), 'utf8');
  assert.match(page, /plandOmitsCarriageShell/);
  assert.match(page, /desVoeuxCarriageSegments/);
});

function digit1LookPoint(along, side, y) {
  const fx = Math.sin(HK_STREET_EYE.heading);
  const fz = Math.cos(HK_STREET_EYE.heading);
  return {
    x: HK_STREET_EYE.x + fx * along - fz * side,
    y,
    z: HK_STREET_EYE.z + fz * along + fx * side
  };
}

test('PlanD yields the Digit1 mid-road look and keeps the Henderson shell', () => {
  assert.equal(PLAND_DIGIT1_LOOK_ALONG_MIN, 8);
  assert.equal(PLAND_DIGIT1_LOOK_ALONG_MAX, 216);
  assert.equal(PLAND_DIGIT1_LOOK_HALF, 16);
  assert.equal(PLAND_DIGIT1_LOOK_Y_CLEAR, 18);
  const segments = desVoeuxCarriageSegments();
  // MSI centre hit on tile_21_26 / mat_tex_1. Off the Des Voeux apron, on the look.
  const slime = { x: 80.35, y: 10.37, z: 53.23 };
  const road = plandCarriageDistance(slime.x, slime.z, segments);
  assert.ok(road.dist > 14, road.dist);
  assert.ok(road.dist > road.half + PLAND_STREET_SHELL_APRON, road.dist);
  assert.equal(plandOmitsCarriageShell(
    slime,
    { x: slime.x + 0.25, y: 10.4, z: slime.z },
    { x: slime.x, y: 10.2, z: slime.z + 0.25 },
    segments
  ), false);
  assert.equal(plandOmitsDigit1LookGround(slime), true);
  // centre_low, same station, y in the 6.4–11 band.
  assert.equal(plandOmitsDigit1LookGround({ x: 80.35, y: 6.4, z: 53.23 }), true);
  assert.equal(plandOmitsDigit1LookGround({ x: 80.35, y: 11, z: 53.23 }), true);
  // Next sheet on the centre ray after the melt. y 12 would keep this one.
  assert.equal(plandOmitsDigit1LookGround(digit1LookPoint(151.43, -0.02, 16.04)), true);
  assert.equal(plandOmitsDigit1LookGround(digit1LookPoint(209.39, 0.52, 12.23)), true);
  // Apron-only point is the shell test. The look starts at 8 m.
  assert.equal(plandOmitsDigit1LookGround(digit1LookPoint(2, 0, 1.4)), false);
  assert.equal(plandOmitsCarriageShell(
    { x: HK_STREET_EYE.x, y: 1.4, z: HK_STREET_EYE.z },
    { x: HK_STREET_EYE.x + 0.4, y: 2, z: HK_STREET_EYE.z },
    { x: HK_STREET_EYE.x, y: 2, z: HK_STREET_EYE.z + 0.4 },
    segments
  ), true);
  // Lot face outside the half-width, and the facade above the street band.
  assert.equal(plandOmitsDigit1LookGround(digit1LookPoint(90, 22, 8)), false);
  assert.equal(plandOmitsDigit1LookGround(digit1LookPoint(120, 0, 18)), false);
  assert.equal(plandOmitsDigit1LookGround(digit1LookPoint(120, 0, 24)), false);
  assert.equal(plandOmitsDigit1LookGround(digit1LookPoint(40, 0, 6)), true);
  // Henderson shell stays on the skirt test. The along cap does not eat it.
  const shell = digit1LookPoint(223.15, 0.06, 22.36);
  assert.equal(plandOmitsDigit1LookGround(shell), false);
  assert.equal(plandOmitsDigit1LookGround({ x: 212.8, y: 31.7, z: 91.1 }), false);
  assert.equal(plandYieldsToLandsd(shell, [{
    minX: 217.54, maxX: 263.57, minZ: 53.74, maxZ: 104.96, minH: 5.75, maxH: 195.21
  }]), true);
  assert.equal(plandOmitsDigit1LookGround(null), false);
  assert.equal(plandOmitsDigit1LookGround({ x: slime.x, y: Number.NaN, z: slime.z }), false);
  const page = readFileSync(path.join(root, 'js/hk-pland.js'), 'utf8');
  assert.match(page, /plandOmitsDigit1LookGround/);
  assert.match(page, /omitted \$\{look\} triangles on the Digit1 mid-road look/);
  assert.match(page, /omitted \$\{flank\} triangles proud of Digit1 LandsD flank charts/);
  assert.match(page, /omitted \$\{shell\} low triangles on the Des Voeux carriageway/);
  assert.match(page, /omitted \$\{podium\} podium triangles inside near LandsD boxes/);
});

test('PlanD yields a Digit1 flank chart and keeps the near-box interior', () => {
  assert.equal(PLAND_FLANK_PROUD, 4);
  assert.equal(PLAND_FLANK_FACE, 6);
  assert.equal(PLAND_FLANK_TOP, 64);
  const boc = { minX: 13.9, maxX: 56.1, minZ: 51.7, maxZ: 95.5, minH: 4, maxH: 73.7 };
  const proud = { x: 58.07, y: 10.59, z: 71.81 };
  assert.equal(plandYieldsToLandsd(proud, [boc]), false);
  assert.equal(plandOmitsPodiumInsideLandsd(proud, [boc]), false);
  assert.equal(plandOmitsDigit1LookGround(proud), false);
  assert.equal(plandOmitsDigit1FlankChart(proud, [boc]), true);
  assert.equal(plandOmitsDigit1FlankChart({ x: 54.1, y: 12, z: 72 }, [boc]), true);
  assert.equal(plandOmitsDigit1FlankChart({ x: 35, y: HK_RETAIL_BELT + 12, z: 73 }, [boc]), false);
  const streetWall = { minX: -66.9, maxX: 13.4, minZ: 29.2, maxZ: 102.1 };
  assert.equal(plandOmitsDigit1FlankChart(
    { x: 2, y: HK_RETAIL_BELT + 12, z: 40 },
    [streetWall]
  ), false);
  assert.equal(plandOmitsPodiumInsideLandsd(
    { x: 2, y: HK_RETAIL_BELT + 12, z: 40 },
    [streetWall]
  ), false);
  const ckc = { minX: 44.3, maxX: 109.8, minZ: 115.4, maxZ: 180.9, minH: 5, maxH: 281.5 };
  assert.ok(boxClosestDistance(ckc, HK_STREET_EYE) > HK_STREET_NEAR);
  assert.equal(plandOmitsDigit1FlankChart({ x: 70, y: 14, z: 140 }, [ckc]), true);
  assert.equal(plandOmitsPodiumInsideLandsd({ x: 70, y: 14, z: 140 }, [ckc]), false);
  assert.equal(plandOmitsDigit1FlankChart({ x: 70, y: 90, z: 140 }, [ckc]), false);
  const henderson = { minX: 217.54, maxX: 263.57, minZ: 53.74, maxZ: 104.96, minH: 5.75, maxH: 195.21 };
  assert.equal(plandOmitsDigit1FlankChart({ x: 230, y: 40, z: 80 }, [henderson]), false);
  assert.equal(plandYieldsToLandsd({ x: 212.8, y: 31.7, z: 91.1 }, [henderson]), true);
  assert.equal(plandOmitsDigit1FlankChart(null, [boc]), false);
  assert.equal(plandOmitsDigit1FlankChart(proud, []), false);
});

test('PlanD yields the chartless Bank of China Tower plate and keeps the mast', () => {
  assert.equal(PLAND_BOC_PLATE_PROUD, 2);
  assert.equal(PLAND_BOC_PLATE_PEAK, 11.7);
  const tower = digit1BocTowerPlate();
  assert.equal(tower.name, 'Bank of China Tower');
  assert.equal(tower.height, 303.3);
  const inside = { x: 164.3, y: 25, z: 146.7 };
  assert.equal(plandOmitsDigit1BocPlate(inside, tower), true);
  assert.equal(plandOmitsDigit1BocPlate({ x: tower.cx, y: 25, z: tower.cz }, tower), true);
  const roof = ISLAND_BOUNDS.sidewalkHeight + tower.height;
  assert.equal(plandOmitsDigit1BocPlate({ x: tower.cx, y: roof + 4, z: tower.cz }, tower), true);
  assert.equal(plandOmitsDigit1BocPlate({ x: tower.cx, y: roof + PLAND_BOC_PLATE_PEAK, z: tower.cz }, tower), false);
  assert.equal(plandOmitsDigit1BocPlate({ x: tower.cx, y: roof + 40, z: tower.cz }, tower), false);
  assert.equal(plandOmitsDigit1BocPlate({ x: 149.2, y: 25, z: 144.4 }, tower), false);
  assert.equal(plandOmitsDigit1BocPlate({ x: 278.49, y: 15.44, z: 110.37 }, tower), false);
  assert.equal(plandOmitsDigit1LookGround({ x: 278.49, y: 15.44, z: 110.37 }), false);
  assert.equal(plandOmitsDigit1BocPlate({ x: 230, y: 40, z: 80 }, tower), false);
  assert.equal(plandOmitsDigit1BocPlate({ x: 80.35, y: 10.37, z: 53.23 }, tower), false);
  assert.equal(plandOmitsDigit1BocPlate({ x: 2, y: HK_RETAIL_BELT + 12, z: 40 }, tower), false);
  assert.equal(plandOmitsDigit1BocPlate(inside, { ...tower, name: 'The Henderson' }), false);
  assert.equal(plandOmitsDigit1BocPlate(inside, null), false);
  assert.equal(plandOmitsDigit1BocPlate(null, tower), false);
  const poly = tower.poly;
  let bestLen = 0;
  let edge = [poly[0], poly[1]];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const len = Math.hypot(poly[i].x - poly[j].x, poly[i].z - poly[j].z);
    if (len > bestLen) {
      bestLen = len;
      edge = [poly[j], poly[i]];
    }
  }
  const mx = (edge[0].x + edge[1].x) / 2;
  const mz = (edge[0].z + edge[1].z) / 2;
  let nx = edge[1].z - edge[0].z;
  let nz = -(edge[1].x - edge[0].x);
  const nlen = Math.hypot(nx, nz) || 1;
  nx /= nlen;
  nz /= nlen;
  if ((tower.cx - mx) * nx + (tower.cz - mz) * nz > 0) {
    nx = -nx;
    nz = -nz;
  }
  assert.equal(plandOmitsDigit1BocPlate({ x: mx + nx * 1.2, y: 25, z: mz + nz * 1.2 }, tower), true);
  assert.equal(plandOmitsDigit1BocPlate({ x: mx + nx * 8, y: 25, z: mz + nz * 8 }, tower), false);
  assert.equal(plandOmitsDigit1FlankChart({ x: tower.cx, y: 25, z: tower.cz }, [{
    minX: 44.3, maxX: 109.8, minZ: 115.4, maxZ: 180.9, minH: 5, maxH: 281.5
  }]), false);
  const page = readFileSync(path.join(root, 'js/hk-pland.js'), 'utf8');
  assert.match(page, /omitted \$\{boc\} triangles on the Digit1 BoC Tower LandsD plate/);
  assert.match(page, /boxes\?\.length \? digit1BocTowerPlate\(\) : null/);
  const landmarks = readFileSync(path.join(root, 'js/landmarks.js'), 'utf8');
  assert.match(landmarks, /const peak = 11\.7/);
});

test('PlanD yields on the street side of Henderson and keeps the mid-street photo point', () => {
  const henderson = { minX: 217.54, maxX: 263.57, minZ: 53.74, maxZ: 104.96, minH: 5.75, maxH: 195.21 };
  const west = { minX: 29.4, maxX: 86.2, minZ: -43, maxZ: 35.4, minH: 4.4, maxH: 44.6 };
  const queen = { minX: 12.9, maxX: 55.4, minZ: 49.8, maxZ: 95.7, minH: 4.6, maxH: 87 };
  const boxes = [henderson, west, queen];
  assert.equal(PLAND_LANDSD_SKIRT, 16);
  assert.equal(plandYieldsToLandsd({ x: 212.8, y: 31.7, z: 91.1 }, boxes), true);
  assert.equal(plandYieldsToLandsd({ x: 80.2, y: 10, z: 52.8 }, boxes), false);
  assert.equal(plandYieldsToLandsd({ x: 230, y: 40, z: 80 }, boxes), false);
  assert.equal(plandYieldsToLandsd({ x: 212.8, y: 210, z: 91.1 }, boxes), false);
  assert.equal(plandYieldsToLandsd({ x: 190, y: 31.7, z: 91.1 }, boxes), false);
});

test('PlanD omits a near LandsD podium only in the retail band and keeps the roof', () => {
  assert.equal(HK_STREET_NEAR, 80);
  assert.equal(PLAND_PODIUM_FACE, 0.5);
  assert.equal(PLAND_PODIUM_ABOVE_BELT, 1);
  assert.ok(Math.abs(HK_RETAIL_BELT - 8.02) < 1e-9, HK_RETAIL_BELT);
  // 11-SW-8D street wall. The Des Voeux eye sits on its north face.
  const b34475 = { minX: -66.9, maxX: 13.4, minZ: 29.2, maxZ: 102.1 };
  assert.equal(boxClosestDistance(b34475, HK_STREET_EYE), 0);
  const southPodium = { x: 2, y: 4, z: 40 };
  assert.equal(plandOmitsPodiumInsideLandsd(southPodium, [b34475]), true);
  assert.equal(plandYieldsToLandsd(southPodium, [b34475]), false);
  assert.equal(plandOmitsPodiumInsideLandsd(
    { x: HK_STREET_EYE.x, y: 5, z: 29.25 },
    [b34475]
  ), true);
  const aboveBelt = { x: 2, y: HK_RETAIL_BELT + 12, z: 40 };
  assert.equal(plandOmitsPodiumInsideLandsd(aboveBelt, [b34475]), false);
  const roof = { x: 2, y: HK_RETAIL_BELT + 40, z: 40 };
  assert.equal(plandOmitsPodiumInsideLandsd(roof, [b34475]), false);
  const atCap = { x: 2, y: HK_RETAIL_BELT + PLAND_PODIUM_ABOVE_BELT, z: 40 };
  assert.equal(plandOmitsPodiumInsideLandsd(atCap, [b34475]), false);
  assert.equal(plandOmitsPodiumInsideLandsd({ ...southPodium, y: HK_RETAIL_BELT + 0.99 }, [b34475]), true);
  // Half a metre of lot face is the same omit while it is still in the belt.
  assert.equal(plandOmitsPodiumInsideLandsd(
    { x: HK_STREET_EYE.x, y: 4, z: b34475.minZ - 0.4 },
    [b34475]
  ), true);
  assert.equal(plandOmitsPodiumInsideLandsd(
    { x: HK_STREET_EYE.x, y: 4, z: b34475.minZ - 0.6 },
    [b34475]
  ), false);
  assert.equal(plandOmitsPodiumInsideLandsd(
    { x: HK_STREET_EYE.x, y: HK_RETAIL_BELT + 12, z: b34475.minZ - 0.4 },
    [b34475]
  ), false);
  assert.equal(plandOmitsPodiumInsideLandsd(
    { x: HK_STREET_EYE.x, y: HK_RETAIL_BELT + 12, z: b34475.minZ - 0.6 },
    [b34475]
  ), false);
  const nearLot = { minX: 20, maxX: 40, minZ: 20, maxZ: 50, minH: 4, maxH: 40 };
  const streetSide = { x: 16, y: 4, z: 35 };
  assert.ok(boxClosestDistance(nearLot, HK_STREET_EYE) < HK_STREET_NEAR);
  assert.equal(plandOmitsPodiumInsideLandsd(streetSide, [nearLot]), false);
  assert.equal(plandYieldsToLandsd(streetSide, [nearLot]), true);
  assert.equal(plandOmitsPodiumInsideLandsd({ x: 30, y: 4, z: 35 }, [nearLot]), true);
  assert.equal(plandOmitsPodiumInsideLandsd({ x: 30, y: HK_RETAIL_BELT + 20, z: 35 }, [nearLot]), false);
  const atDisc = { minX: HK_STREET_EYE.x + HK_STREET_NEAR, maxX: 120, minZ: HK_STREET_EYE.z, maxZ: 50 };
  assert.equal(boxClosestDistance(atDisc, HK_STREET_EYE), HK_STREET_NEAR);
  assert.equal(plandOmitsPodiumInsideLandsd({ x: 90, y: 4, z: 35 }, [atDisc]), true);
  assert.equal(plandOmitsPodiumInsideLandsd({ x: 90, y: HK_RETAIL_BELT + 20, z: 35 }, [atDisc]), false);
  const pastDisc = { minX: HK_STREET_EYE.x + HK_STREET_NEAR + 0.1, maxX: 160, minZ: HK_STREET_EYE.z, maxZ: 50 };
  assert.ok(boxClosestDistance(pastDisc, HK_STREET_EYE) > HK_STREET_NEAR);
  assert.equal(plandOmitsPodiumInsideLandsd({ x: 100, y: 4, z: 35 }, [pastDisc]), false);
  assert.equal(plandOmitsPodiumInsideLandsd({ x: 100, y: HK_RETAIL_BELT + 20, z: 35 }, [pastDisc]), false);
  const henderson = { minX: 217.54, maxX: 263.57, minZ: 53.74, maxZ: 104.96, minH: 5.75, maxH: 195.21 };
  assert.ok(boxClosestDistance(henderson, HK_STREET_EYE) > HK_STREET_NEAR);
  assert.equal(plandOmitsPodiumInsideLandsd({ x: 230, y: 4, z: 80 }, [henderson]), false);
  assert.equal(plandOmitsPodiumInsideLandsd({ x: 230, y: HK_RETAIL_BELT + 40, z: 80 }, [henderson]), false);
  assert.equal(plandOmitsPodiumInsideLandsd({ x: 212.8, y: 31.7, z: 91.1 }, [henderson]), false);
  assert.equal(plandYieldsToLandsd({ x: 212.8, y: 31.7, z: 91.1 }, [henderson]), true);
  assert.equal(plandOmitsPodiumInsideLandsd(null, [b34475]), false);
  assert.equal(plandOmitsPodiumInsideLandsd(southPodium, []), false);
  assert.equal(plandOmitsPodiumInsideLandsd(southPodium, [null, { minX: 1 }]), false);
  const page = readFileSync(path.join(root, 'js/hk-pland.js'), 'utf8');
  const gltf = readFileSync(path.join(root, 'js/hk-gltf.js'), 'utf8');
  const grid = readFileSync(path.join(root, 'js/city-grid.js'), 'utf8');
  const streets = readFileSync(path.join(root, 'js/street-details.js'), 'utf8');
  assert.match(page, /plandOmitsPodiumInsideLandsd/);
  assert.match(page, /omitted \$\{podium\} podium triangles inside near LandsD boxes/);
  assert.doesNotMatch(page, /omitted \$\{podium\} triangles inside near LandsD boxes/);
  assert.match(page, /const boxes = donor \? landsdBoxes : \[\]/);
  assert.doesNotMatch(page, /hkShopfrontAlbedo/);
  assert.match(gltf, /omitLandsdNullFill/);
  assert.match(grid, /omitPlandCorridorGlass\(walls/);
  assert.match(streets, /omitPlandCorridorGlass\(walls/);
});

test('Digit1 donor mounts no corridor ashlar and keeps the belt-only omit', () => {
  const hsbc = BLOCKS.find((block) => block.name === 'HSBC Main Building');
  const boc = BLOCKS.find((block) => block.name === 'Bank of China Building');
  const cfa = BLOCKS.find((block) => block.name === 'The Court of Final Appeal');
  const henderson = BLOCKS.find((block) => block.name === 'The Henderson');
  const chase = plandCorridorExtrudeIds(BLOCKS);
  assert.ok(chase.includes(hsbc.id));
  assert.ok(chase.includes(boc.id));
  assert.ok(chase.includes(henderson.id));
  const donor = withPlandCorridorHidden({ hiddenIds: new Set([3]) }, BLOCKS);
  assert.ok(donor.hiddenIds.has(hsbc.id));
  assert.ok(donor.hiddenIds.has(boc.id));
  assert.ok(donor.hiddenIds.has(henderson.id));
  assert.equal(donor.podiumFillIds.size, 0);
  assert.equal(donor.podiumFillIds.has(hsbc.id), false);
  assert.equal(donor.podiumFillIds.has(boc.id), false);
  assert.equal(donor.podiumFillIds.has(cfa.id), false);
  assert.equal(donor.podiumFillIds.has(henderson.id), false);
  const compare = withPlandCorridorHidden({ hiddenIds: new Set() }, BLOCKS);
  assert.equal(compare.podiumFillIds.size, 0);
  assert.ok(compare.hiddenIds.has(hsbc.id));
  assert.ok(compare.hiddenIds.has(henderson.id));
  const buildings = readFileSync(path.join(root, 'js/buildings.js'), 'utf8');
  assert.doesNotMatch(buildings, /podiumFillIds|hkCorridorPodiumFill|HkCorridorPodiumFill|createCorridorPodiumFillMaterial|corridor podium/);
  assert.doesNotMatch(buildings, /hkShopfrontAlbedo/);
  const materials = readFileSync(path.join(root, 'js/tsl-materials.js'), 'utf8');
  assert.doesNotMatch(materials, /hkCorridorPodiumFill|corridorPodiumFillColor|createCorridorPodiumFillMaterial|0x8a847c/);
  const retail = materials.slice(
    materials.indexOf('function createRetailPodiumMaterial'),
    materials.indexOf('function createPodiumMasonryMaterial')
  );
  assert.match(retail, /podiumStreetColor\(\)/);
  const main = readFileSync(path.join(root, 'js/main.js'), 'utf8');
  assert.doesNotMatch(main, /podium:\s*plandPlan\.mode === 'donor'/);
  assert.match(main, /hidePlandCorridorExtrudes\(gltfPlan\)/);
  const gate = digit1InvaderGate(root);
  assert.equal(gate.eye, '?at=-1.4,29.3,1.29');
  assert.equal(gate.noAshlarInvaderSlabs, true);
  assert.equal(gate.noZombieSkyHoles, true);
  assert.ok(gate.nullFillEdge >= 1024);
  assert.equal(gate.nullFillEdge, 1024);
  assert.equal(gate.orangeCanyonGone, true);
  assert.equal(gate.hendersonInFront, true);
  assert.equal(gate.ndcCentreNotPland, true);
  assert.equal(gate.midRoadSlimeGone, true);
  assert.equal(gate.digit1GroundLifeVisible, true);
  assert.equal(gate.digit1SidewalkAuthentic, true);
  assert.equal(gate.digit1FlankMeltGone, true);
  assert.equal(gate.digit1CanyonDensity, true);
  assert.equal(gate.digit1FarFlankFidelity, true);
  assert.equal(gate.digit1BocPlateOwned, true);
  assert.equal(gate.digit1BocPrismFidelity, true);
  assert.equal(gate.digit1MidbandCanyonFidelity, true);
  assert.equal(gate.pass, true);
});

test('PlanD yields the Digit1 mid-band chartless plates and keeps the holds', () => {
  const right = { x: 84.93, y: 14.7, z: 77.32 };
  const up = { x: 80.89, y: 18.31, z: 71.08 };
  const left = { x: 141.18, y: 21.64, z: 44.13 };
  assert.equal(DIGIT1_MIDBAND_PLATES.length, 2);
  assert.equal(plandOmitsDigit1MidbandPlate(right), true);
  assert.equal(plandOmitsDigit1MidbandPlate(up), true);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: 88.57, y: 15.18, z: 79.25 }), true);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: 89.23, y: 19.8, z: 75.12 }), true);
  assert.equal(plandOmitsDigit1MidbandPlate(left), true);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: 146.84, y: 22.37, z: 44.76 }), true);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: right.x, y: PLAND_FLANK_TOP, z: right.z }), false);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: 278.49, y: 15.44, z: 110.37 }), false);
  assert.equal(plandOmitsDigit1LookGround({ x: 278.49, y: 15.44, z: 110.37 }), false);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: 139.11, y: 12.52, z: 129.12 }), false);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: 80.35, y: 10.37, z: 53.23 }), false);
  assert.equal(plandOmitsDigit1LookGround({ x: 80.35, y: 10.37, z: 53.23 }), true);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: 58.07, y: 10.59, z: 71.81 }), false);
  assert.equal(plandOmitsDigit1FlankChart({ x: 58.07, y: 10.59, z: 71.81 }, [{
    minX: 13.9, maxX: 56.1, minZ: 51.7, maxZ: 95.5, minH: 4, maxH: 73.7
  }]), true);
  const tower = digit1BocTowerPlate();
  assert.equal(plandOmitsDigit1BocPlate({ x: tower.cx, y: 25, z: tower.cz }, tower), true);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: tower.cx, y: 25, z: tower.cz }), false);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: 161.94, y: 24.67, z: 145.11 }), false);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: 217.99, y: 22.78, z: 92.93 }), false);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: 212.8, y: 31.7, z: 91.1 }), false);
  assert.equal(plandYieldsToLandsd({ x: 212.8, y: 31.7, z: 91.1 }, [{
    minX: 217.54, maxX: 263.57, minZ: 53.74, maxZ: 104.96, minH: 5.75, maxH: 195.21
  }]), true);
  assert.equal(plandOmitsDigit1MidbandPlate({ x: 2, y: HK_RETAIL_BELT + 12, z: 40 }), false);
  assert.equal(plandOmitsDigit1MidbandPlate(null), false);
  for (const target of [
    { x: 161.94, y: 24.67, z: 145.11 },
    { x: 217.99, y: 22.78, z: 92.93 }
  ]) {
    for (let step = 1; step <= 8; step++) {
      const t = step / 8;
      assert.equal(plandOmitsDigit1MidbandPlate({
        x: HK_STREET_EYE.x + (target.x - HK_STREET_EYE.x) * t,
        y: 2 + (target.y - 2) * t,
        z: HK_STREET_EYE.z + (target.z - HK_STREET_EYE.z) * t
      }), false);
    }
  }
  const wall = digit1MidbandWallSpec(DIGIT1_MIDBAND_PLATES[0]);
  const frame = digit1LookFrame(wall.position);
  const plate = DIGIT1_MIDBAND_PLATES[0];
  assert.ok(Math.abs(frame.along - (plate.alongMin + plate.alongMax) * 0.5) < 1e-6);
  assert.ok(Math.abs(frame.side - (plate.sideMin + plate.sideMax) * 0.5) < 1e-6);
  assert.ok(Math.abs(Math.cos(wall.rotationY) - Math.sin(HK_STREET_EYE.heading)) < 1e-9);
  assert.ok(Math.abs(-Math.sin(wall.rotationY) - Math.cos(HK_STREET_EYE.heading)) < 1e-9);
  assert.ok(wall.size.height > 40 && wall.size.height < 70);
  const page = readFileSync(path.join(root, 'js/hk-pland.js'), 'utf8');
  assert.match(page, /omitted \$\{midband\} triangles on the Digit1 mid-band chartless plate/);
  assert.match(page, /boxes\?\.length && plandOmitsDigit1MidbandPlate/);
  const buildings = readFileSync(path.join(root, 'js/buildings.js'), 'utf8');
  assert.match(buildings, /HkMidbandCanyon/);
  assert.match(buildings, /plandMode === 'compare'/);
  assert.doesNotMatch(buildings, /hkShopfrontAlbedo|hkCorridorPodiumFill/);
});

test('corridor glass and the Digit1 shopfront ribbon both yield to PlanD', () => {
  const eye = HK_STREET_EYE;
  const forward = Math.sin(eye.heading);
  const ahead = Math.cos(eye.heading);
  const curtain = {
    x: eye.x + forward * 40,
    z: eye.z + ahead * 40,
    yaw: 0,
    depth: 12,
    len: 8,
    side: 1,
    rx: 0,
    rz: 1,
    dx: ahead,
    dz: -forward
  };
  assert.equal(omitPlandCorridorGlass([curtain], { enabled: false }).length, 1);
  assert.equal(omitPlandCorridorGlass([curtain], { enabled: true }).length, 0);
  const beside = {
    ...curtain,
    x: eye.x + ahead * 200,
    z: eye.z - forward * 200
  };
  assert.equal(omitPlandCorridorGlass([beside], { enabled: true }).length, 1);
  const gap = {
    x: 77.2,
    z: 49.9,
    yaw: 0,
    depth: 12,
    len: 6.5,
    side: 1,
    rx: 0,
    rz: 1,
    dx: -0.253,
    dz: 0.967
  };
  assert.equal(omitPlandCorridorGlass([gap], { enabled: true }).length, 0);
  assert.equal(omitPlandCorridorGlass([gap], { enabled: false }).length, 1);
  const grid = readFileSync(path.join(root, 'js/city-grid.js'), 'utf8');
  assert.match(grid, /omitPlandCorridorGlass\(glass/);
  assert.match(grid, /omitPlandCorridorGlass\(walls/);
  assert.match(grid, /retailMat, ribbons/);
  const streets = readFileSync(path.join(root, 'js/street-details.js'), 'utf8');
  assert.match(streets, /omitPlandCorridorGlass\(walls/);
  assert.match(streets, /planHkCanyonNeon\(shown\)/);
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
  assert.match(main, /plandMode/);
  assert.match(main, /hud-pland-credit/);
  assert.match(main, /mode === 'compare'/);
  assert.match(main, /正在載入規劃署三維實景（中環街廊）/);
  assert.match(main, /mountHkGltfBuildings/);
  assert.match(html, /hud-pland-credit/);
  assert.match(html, /hk-pland-frame\.js/);
  assert.match(html, /hk-pland\.js/);
  assert.match(page, /GLTFLoader/);
  assert.match(page, /polygonOffset/);
  assert.match(page, /metalness = 0/);
  assert.match(page, /capPlandMap/);
  assert.equal(PLAND_PAGE_TEX_EDGE, 2048);
  assert.match(tool, /PLAND_PAGE_TEX_EDGE/);
  assert.match(tool, /ffmpeg/);
  assert.match(frame, /https:\/\/pdmap\.pland\.gov\.hk\/plandapi\/Tiles/);
  assert.match(tool, /plandTilesUrl/);
  assert.match(tool, /plandModelTransform/);
  assert.match(tool, /digit1CorridorSamples/);
  assert.match(frame, /836974\.635391304153/);
  const sources = `${main}\n${page}\n${tool}\n${frame}`;
  assert.doesNotMatch(sources, /mapillary|kartaview|openstreetcam/i);
  assert.doesNotMatch(page, /generative|dall-e|stable-diffusion/i);
});
