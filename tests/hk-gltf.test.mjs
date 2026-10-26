import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HK_CORE_WORLD, HK_GLTF_CAP, HK_GLTF_SHEET, HK_GLTF_SHEETS, HK_STREET_EYE, ISLAND_BOUNDS, hkResolveLandmarks } from '../js/city-config.js';
import {
  HK_BOC_PHOTO_CHART,
  HK_DIGIT1_MIDBAND_GRID_ELIMINATED,
  HK_DIGIT1_MIDBAND_HITS,
  HK_DIGIT1_MIDBAND_HUNT,
  HK_DIGIT1_MIDBAND_NOT_BUILDING,
  HK_MIDBAND_PHOTO_CHARTS,
  assertSheetAllowed,
  boundsFromGltf,
  chooseCentralSheet,
  digit1MidbandChartsCover,
  filterPinSheetBuildings,
  hkGltfBoxContains,
  footprintOverlapRatio,
  formatGltfLog,
  gltfCoversFootprint,
  bakeGltfWorldTriangles,
  clampLandsdAnisotropy,
  gltfAlbedoSampler,
  gltfInStreetChase,
  gltfStreetPhoto,
  gltfTextureMaxEdge,
  hiddenExtrudeIds,
  isLandsdAtlasGutter,
  isLandsdNullTexel,
  landsdAlbedoRow,
  groupLandsdOnEyeCharts,
  isLandsdOnEyeChart,
  LANDSD_ON_EYE_HITS,
  LANDSD_ON_EYE_PAD,
  landsdChartPixels,
  landsdChartRect,
  landsdChartWrap,
  landsdDilateGutter,
  landsdGutterMip,
  packLandsdChartBins,
  landsdFarChaseMesh,
  landsdNullFillTriangles,
  landsdSealFarNullTriangles,
  remapLandsdChartUv,
  NULL_FILL_EDGE,
  nullFillSampleSize,
  hk80GridToHk80Geog,
  hk80GridToWgs84,
  hk80ToWorld,
  hkpdToSidewalkY,
  isBuildingGltf,
  planGltfManifest,
  resolveHkGltfRequest
} from '../js/hk-gltf-frame.js';

const root = fileURLToPath(new URL('..', import.meta.url));

// LandsD worked example, explanatory notes page C9: HK1980 grid → HK1980 geographic.
const WORKED_E = 836055;
const WORKED_N = 832699;
const WORKED_LAT = 22 + 26 / 60 + 6.76 / 3600;
const WORKED_LON = 114 + 10 / 60 + 20.45 / 3600;

// Official API, 2026-10-24: https://www.geodetic.gov.hk/transform/v2/?inSys=hkgrid&outSys=wgsgeog
// Sheet 11-SW-9B terrain centre from the glTF node matrix.
const SHEET_9B_E = 835625.5625;
const SHEET_9B_N = 816500;
const SHEET_9B_WGS = { lat: 22.28739549, lon: 114.170640292 };

// 11-SW-9A BUILDING/B346721638201063A1 node matrix (local origin).
const NINE_A_MATRIX = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 834672.5625, 4.715000152587891, -816382.6875, 1];

function metresBetween(lat, lon, lat2, lon2) {
  const phi = (22.28088 * Math.PI) / 180;
  const a = 6378137;
  const e2 = 6.69437999014e-3;
  const sin = Math.sin(phi);
  const nrad = a / Math.sqrt(1 - e2 * sin * sin);
  const mrad = (a * (1 - e2)) / (1 - e2 * sin * sin) ** 1.5;
  const kx = (Math.PI / 180) * nrad * Math.cos(phi);
  const ky = (Math.PI / 180) * mrad;
  return Math.hypot((lon - lon2) * kx, (lat - lat2) * ky);
}

test('HK1980 grid matches the LandsD worked example and the geodetic API within a metre', () => {
  const hk = hk80GridToHk80Geog(WORKED_E, WORKED_N);
  assert.ok(Math.abs(hk.lat - WORKED_LAT) < 0.02 / 3600, `lat ${hk.lat}`);
  assert.ok(Math.abs(hk.lon - WORKED_LON) < 0.02 / 3600, `lon ${hk.lon}`);
  const wgs = hk80GridToWgs84(SHEET_9B_E, SHEET_9B_N);
  const miss = metresBetween(wgs.lat, wgs.lon, SHEET_9B_WGS.lat, SHEET_9B_WGS.lon);
  assert.ok(miss < 1.2, `9B centre is ${miss.toFixed(2)} m from the LandsD API`);
});

test('a 11-SW-9A building node lands in the Central core, east and up', () => {
  const gltf = {
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'B346721638201063A1', matrix: NINE_A_MATRIX, children: [1] },
      { mesh: 0 }
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{
      type: 'VEC3',
      min: [-64.75, -35.375, 0],
      max: [64.75, 35.375, 25.29199981689453]
    }]
  };
  const box = boundsFromGltf(gltf);
  assert.equal(box.name, 'B346721638201063A1');
  assert.ok(box.minX < 164.35 && box.maxX > 164.35);
  assert.ok(box.minZ < -604.44 && box.maxZ > -604.44);
  assert.ok(box.minX >= HK_CORE_WORLD.minX && box.maxX <= HK_CORE_WORLD.maxX);
  assert.ok(box.minZ >= HK_CORE_WORLD.minZ && box.maxZ <= HK_CORE_WORLD.maxZ);
  assert.ok(box.span >= 100, `span ${box.span}`);
  assert.ok(box.minH < 5 && box.maxH > 25);
  const origin = hk80ToWorld(834672.5625, 816382.6875, 4.715);
  assert.ok(Math.abs(origin[0] - 164.344) < 0.05);
  assert.ok(Math.abs(origin[2] - -604.443) < 0.05);
  assert.equal(hkpdToSidewalkY(4.715, 4.715), ISLAND_BOUNDS.sidewalkHeight);
  assert.ok(Math.abs(hkpdToSidewalkY(4.715 + 25.292, 4.715) - (ISLAND_BOUNDS.sidewalkHeight + 25.292)) < 1e-9);
});

test('11-SW-9B with no overlapping BUILDING models falls back only to 11-SW-9A', () => {
  const kept = chooseCentralSheet([{ sheet: '11-SW-9B', buildingFiles: 4, overlap: 2 }]);
  assert.equal(kept.sheet, '11-SW-9B');
  const fallback = chooseCentralSheet([
    { sheet: '11-SW-9B', buildingFiles: 0, overlap: 0 },
    { sheet: '11-SW-9A', buildingFiles: 15, overlap: 5 }
  ]);
  assert.equal(fallback.sheet, '11-SW-9A');
  assert.match(fallback.reason, /11-SW-9B/);
  assert.match(fallback.reason, /11-SW-9A/);
  assert.doesNotMatch(fallback.reason, /8D/);
  assert.equal(assertSheetAllowed('11-SW-8D'), '11-SW-8D');
  assert.equal(assertSheetAllowed('11-SW-9C'), '11-SW-9C');
  assert.equal(assertSheetAllowed('11-SW-9A'), '11-SW-9A');
  assert.throws(() => assertSheetAllowed('manhattan'), /bad sheet/);
});

test('BUILDING glTF paths are the individualised models, not terrain or generic', () => {
  assert.equal(isBuildingGltf('BUILDING/B346721638201063A1/B346721638201063A1.gltf'), true);
  assert.equal(isBuildingGltf('BUILDING_block.gltf'), true);
  assert.equal(isBuildingGltf('GENERIC/G352501620001062A1/G352501620001062A1.gltf'), false);
  assert.equal(isBuildingGltf('TERRAIN(TB)/T35250162000106E12/T35250162000106E12.gltf'), false);
  assert.equal(isBuildingGltf('VEGETATION(TB)/V352501620001062A1/V352501620001062A1.gltf'), false);
  assert.equal(isBuildingGltf('BUILDING/B1/B1.bin'), false);
});

test('the manifest keeps Central masses up to the street cap and hides overlapping extrudes', () => {
  assert.equal(HK_GLTF_SHEET, '11-SW-9C');
  assert.deepEqual(HK_GLTF_SHEETS, ['11-SW-9C', '11-SW-8D', '11-SW-14A']);
  assert.equal(HK_GLTF_CAP, 200);
  const manifest = {
    sheet: '11-SW-9A',
    buildings: [
      { file: 'BUILDING/speck.gltf', name: 'speck', minX: 10, maxX: 12, minZ: -10, maxZ: -8, minH: 4, maxH: 6, span: 2 },
      { file: 'BUILDING/near.gltf', name: 'near', minX: 100, maxX: 160, minZ: -640, maxZ: -560, minH: 4, maxH: 30, span: 60 },
      { file: 'BUILDING/also.gltf', name: 'also', minX: 40, maxX: 90, minZ: -700, maxZ: -640, minH: 4, maxH: 20, span: 50 },
      { file: 'BUILDING/far.gltf', name: 'far', minX: 5000, maxX: 5060, minZ: 5000, maxZ: 5060, minH: 4, maxH: 20, span: 60 }
    ]
  };
  const plan = planGltfManifest(manifest, { cap: 1 });
  assert.equal(plan.sheet, '11-SW-9A');
  assert.equal(plan.selected.length, 1);
  assert.equal(plan.selected[0].name, 'near');
  assert.equal(plan.skippedSpeck, 1);
  assert.equal(plan.skippedOutside, 1);
  assert.equal(plan.skippedCap, 1);
  const hidden = hiddenExtrudeIds([
    { id: 1, height: 20, minX: 110, maxX: 140, minZ: -620, maxZ: -580, cx: 125, cz: -600 },
    { id: 2, height: 20, minX: 0, maxX: 10, minZ: 0, maxZ: 10, cx: 5, cz: 5 },
    { id: 3, height: null, minX: 110, maxX: 140, minZ: -620, maxZ: -580, cx: 125, cz: -600 }
  ], plan.selected);
  assert.deepEqual(hidden, [1]);
  const line = formatGltfLog({
    sheet: '11-SW-9A',
    loaded: 1,
    skipped: 3,
    skippedSpeck: 1,
    skippedOutside: 1,
    skippedCap: 1,
    hidden: hidden.length,
    sidewalk: ISLAND_BOUNDS.sidewalkHeight
  });
  assert.match(line, /sheet 11-SW-9A/);
  assert.match(line, /loaded 1/);
  assert.match(line, /skipped 3/);
  assert.match(line, /EPSG:2326|HK1980/);
  assert.match(line, /sidewalk/);
});

test('the page loads the Central street sheets unless a query names one', () => {
  const street = resolveHkGltfRequest('https://x/index.html');
  assert.deepEqual(street.sheets, ['11-SW-9C', '11-SW-8D', '11-SW-14A']);
  assert.equal(street.cap, 200);
  assert.equal(resolveHkGltfRequest('https://x/index.html', { configured: '', sheets: [] }), null);
  assert.equal(resolveHkGltfRequest('https://x/index.html?gltf=11-SW-9A').sheet, '11-SW-9A');
  assert.deepEqual(resolveHkGltfRequest('https://x/index.html?gltf=11-SW-9A').sheets, ['11-SW-9A']);
  assert.equal(resolveHkGltfRequest('https://x/index.html?gltf=11-SW-9A').cap, 200);
  assert.equal(resolveHkGltfRequest('https://x/index.html?gltf=11-SW-9A&gltfCap=2').cap, 2);
  assert.equal(resolveHkGltfRequest('https://x/index.html?gltf=manhattan'), null);
  assert.equal(resolveHkGltfRequest('https://x/index.html', { configured: '11-SW-9B', sheets: [] }).sheet, '11-SW-9B');
  assert.equal(resolveHkGltfRequest('https://x/index.html?gltf=11-SW-9A', { configured: '11-SW-9B' }).sheet, '11-SW-9A');
});

test('boot wires the sheet ahead of the extrude and preloads the frame', () => {
  const main = readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const buildings = readFileSync(path.join(root, 'js/buildings.js'), 'utf8');
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const script = readFileSync(path.join(root, 'tools/fetch-central-gltf-sheet.mjs'), 'utf8');
  assert.match(main, /prepareHkGltfSheet/);
  assert.match(main, /mountHkGltfBuildings/);
  assert.match(main, /buildCityBlocks\(scene, gltfPlan\)/);
  assert.match(buildings, /hiddenIds/);
  assert.match(html, /hk-gltf-frame\.js/);
  assert.match(html, /hk-gltf\.js/);
  assert.match(script, /download\.map\.gov\.hk\/api\/3d-zip\/GLTF/);
  assert.match(script, /chooseCentralSheet/);
  assert.match(script, /11-SW-9B/);
  assert.match(script, /11-SW-9A/);
  assert.match(script, /STREET_SHEETS/);
  assert.match(script, /11-SW-9C/);
  assert.match(script, /11-SW-8D/);
  assert.match(script, /11-SW-14A/);
  assert.match(script, /filterPinSheetBuildings/);
  assert.match(script, /subsetStreetSheet/);
  const gltfJs = readFileSync(path.join(root, 'js/hk-gltf.js'), 'utf8');
  assert.match(gltfJs, /gltfAlbedoSampler/);
  assert.match(gltfJs, /generateMipmaps = false/);
  assert.match(gltfJs, /LinearFilter/);
  assert.match(gltfJs, /metalness = 0/);
  assert.match(gltfJs, /packLandsdChart/);
  assert.match(gltfJs, /landsdGutterMip/);
  assert.match(gltfJs, /ClampToEdgeWrapping/);
  assert.match(gltfJs, /chartMips/);
  assert.match(gltfJs, /clampLandsdAnisotropy\(sampler\.anisotropy/);
  assert.match(main, /setLandsdAnisotropyLimit/);
  assert.match(main, /landsdAniso/);
  assert.doesNotMatch(gltfJs, /\.bias\(/);
  assert.doesNotMatch(gltfJs, /colorNode/);
  assert.doesNotMatch(gltfJs, /limitPhoto\(mat\.map\)/);
  assert.match(gltfJs, /landsdNullFillTriangles/);
});

test('LandsD null-fill triangles drop and a photographed corner stays', () => {
  assert.equal(isLandsdNullTexel(136, 138, 137), true);
  assert.equal(isLandsdNullTexel(140, 140, 140), true);
  assert.equal(isLandsdNullTexel(128, 128, 128), true);
  assert.equal(isLandsdNullTexel(0, 0, 0), true);
  assert.equal(isLandsdNullTexel(90, 82, 64), false);
  assert.equal(isLandsdNullTexel(180, 170, 160), false);
  const colors = [
    [136, 138, 137],
    [136, 138, 137],
    [137, 138, 136],
    [80, 90, 70],
    [136, 138, 137],
    [40, 50, 60]
  ];
  const dropped = landsdNullFillTriangles([0, 1, 2, 3, 4, 5], (i) => colors[i]);
  assert.equal(dropped.dropped, 1);
  assert.deepEqual(dropped.index, [3, 4, 5]);
  const kept = landsdNullFillTriangles([0, 1, 2], () => null);
  assert.equal(kept.dropped, 0);
  assert.deepEqual(kept.index, [0, 1, 2]);
  const photo = landsdNullFillTriangles([0, 1, 2], (i) => colors[i + 3]);
  assert.equal(photo.dropped, 0);
  assert.deepEqual(photo.index, [0, 1, 2]);
  // A face whose centre is padding is a hole even when one corner touches a chart.
  const centre = landsdNullFillTriangles(
    [0, 1, 2, 3, 4, 5],
    (i) => (i < 3 ? [180, 170, 160] : [90, 82, 64]),
    (a) => (a === 0 ? [136, 138, 137] : [90, 82, 64])
  );
  assert.equal(centre.dropped, 1);
  assert.deepEqual(centre.index, [3, 4, 5]);
  // v = 0 is the first image row. The opposite row is the padding this chase was sampling.
  assert.equal(landsdAlbedoRow(0, 4096), 0);
  assert.equal(landsdAlbedoRow(0.727, 4096), 2977);
  assert.ok(landsdAlbedoRow(0.727, 4096) > 2048);
});

test('a far chase null triangle seals to a photograph UV; a chartless mesh still drops', () => {
  const henderson = { minX: 217.54, maxX: 263.57, minZ: 53.74, maxZ: 104.96 };
  assert.equal(landsdFarChaseMesh(henderson), true);
  assert.equal(landsdFarChaseMesh(HK_BOC_PHOTO_CHART), false);
  const colors = [
    [136, 138, 137],
    [136, 138, 137],
    [137, 138, 136],
    [32, 44, 62],
    [28, 40, 56],
    [36, 48, 66]
  ];
  const uvs = [
    [0.04, 0.06],
    [0.08, 0.05],
    [0.06, 0.1],
    [0.72, 0.64],
    [0.78, 0.66],
    [0.74, 0.7]
  ];
  const sealed = landsdSealFarNullTriangles(
    [0, 1, 2, 3, 4, 5],
    (vertex) => colors[vertex],
    null,
    (vertex) => uvs[vertex],
    6
  );
  assert.equal(sealed.sealed, 1);
  assert.equal(sealed.dropped, 0);
  assert.equal(sealed.copies.length, 3);
  assert.deepEqual(sealed.index.slice(0, 3), [3, 4, 5]);
  assert.deepEqual(sealed.index.slice(3), [6, 7, 8]);
  assert.ok(sealed.copies.every((copy) => copy.u > 0.5 && copy.v > 0.5));
  const empty = landsdSealFarNullTriangles(
    [0, 1, 2],
    () => [136, 138, 137],
    null,
    () => [0.1, 0.1],
    3
  );
  assert.equal(empty.sealed, 0);
  assert.equal(empty.dropped, 1);
  assert.deepEqual(empty.index, []);
  const page = readFileSync(path.join(root, 'js/hk-gltf.js'), 'utf8');
  assert.match(page, /sealLandsdFarNullFill\(geo, obj\.material\)/);
  assert.match(page, /landsdFarChaseMesh\(entry\)/);
});

test('null-fill samples a 4096 atlas at 1024 so a chart-grey edge stays a chart', () => {
  assert.equal(NULL_FILL_EDGE, 1024);
  assert.deepEqual(nullFillSampleSize(4096, 4096), { w: 1024, h: 1024 });
  assert.deepEqual(nullFillSampleSize(4096, 2048), { w: 1024, h: 512 });
  assert.deepEqual(nullFillSampleSize(512, 256), { w: 512, h: 256 });
  assert.deepEqual(nullFillSampleSize(0, 4096), { w: 0, h: 0 });
  // Sixteen native texels were one sample at edge 256. Two stone texels in
  // that bin average into LandsD padding grey. The same two texels fill a
  // 1024 sample (four native texels) and stay the chart. Pure padding stays a hole.
  const chart = [120, 122, 118];
  const pad = [136, 138, 137];
  const avg = (nChart, nPad) => {
    const n = nChart + nPad;
    return [
      Math.round((chart[0] * nChart + pad[0] * nPad) / n),
      Math.round((chart[1] * nChart + pad[1] * nPad) / n),
      Math.round((chart[2] * nChart + pad[2] * nPad) / n)
    ];
  };
  const smear256 = avg(2, 14);
  const keep1024 = avg(4, 0);
  const mixed1024 = avg(3, 1);
  assert.equal(isLandsdNullTexel(smear256[0], smear256[1], smear256[2]), true);
  assert.equal(isLandsdNullTexel(keep1024[0], keep1024[1], keep1024[2]), false);
  assert.equal(isLandsdNullTexel(mixed1024[0], mixed1024[1], mixed1024[2]), false);
  assert.equal(isLandsdNullTexel(pad[0], pad[1], pad[2]), true);
  const gltfJs = readFileSync(path.join(root, 'js/hk-gltf.js'), 'utf8');
  assert.match(gltfJs, /nullFillSampleSize/);
  assert.doesNotMatch(gltfJs, /NULL_FILL_EDGE = 256/);
});

test('Des Voeux chase photographs pack the chart past 80 m, and off-look sheets stay downscaled', () => {
  const plan = planGltfManifest({
    sheet: '11-SW-9C',
    buildings: [
      { file: 'origin.gltf', name: 'origin', minX: -8, maxX: 8, minZ: -16, maxZ: 4, minH: 4, maxH: 80, span: 20 },
      { file: 'street.gltf', name: 'street', minX: -12, maxX: 10, minZ: 18, maxZ: 40, minH: 4, maxH: 40, span: 22 }
    ]
  }, { cap: 1, pins: [] });
  assert.equal(plan.selected[0].name, 'street');
  assert.equal(plan.skippedCap, 1);
  assert.equal(gltfTextureMaxEdge({ minX: -2, maxX: 2, minZ: 28, maxZ: 32 }), 0);
  // North of the look ray at ~400 m. Not a Des Voeux facade.
  assert.equal(gltfTextureMaxEdge({ minX: 400, maxX: 430, minZ: 20, maxZ: 40 }), 2048);
  const nearPhoto = gltfAlbedoSampler({ minX: -66.9, maxX: 13.4, minZ: 29.2, maxZ: 102.1 });
  assert.equal(nearPhoto.maxEdge, 0);
  assert.equal(nearPhoto.mipmaps, true);
  assert.equal(nearPhoto.chartMips, true);
  assert.equal(nearPhoto.wrap, 'clamp');
  assert.equal(nearPhoto.mipLevels, undefined);
  assert.equal(nearPhoto.anisotropy, 16);
  assert.equal(nearPhoto.minFilter, 'mipmap');
  assert.equal(clampLandsdAnisotropy(16, 16), 16);
  assert.equal(clampLandsdAnisotropy(16, 1), 1);
  const fx = Math.sin(HK_STREET_EYE.heading);
  const fz = Math.cos(HK_STREET_EYE.heading);
  const pointBox = (dist) => {
    const x = HK_STREET_EYE.x + dist * fx;
    const z = HK_STREET_EYE.z + dist * fz;
    return { minX: x, maxX: x, minZ: z, maxZ: z };
  };
  const at80 = gltfAlbedoSampler(pointBox(80));
  assert.equal(at80.chartMips, true);
  assert.equal(at80.wrap, 'clamp');
  assert.equal(at80.anisotropy, 16);
  const past80 = gltfAlbedoSampler(pointBox(96));
  assert.equal(gltfInStreetChase(pointBox(96)), true);
  assert.equal(past80.maxEdge, 0);
  assert.equal(past80.mipmaps, true);
  assert.equal(past80.chartMips, true);
  assert.equal(past80.mipLevels, undefined);
  assert.equal(past80.anisotropy, 16);
  assert.equal(past80.minFilter, 'mipmap');
  const midFar = gltfAlbedoSampler(pointBox(220));
  assert.equal(midFar.chartMips, true);
  assert.equal(midFar.wrap, 'clamp');
  assert.equal(midFar.anisotropy, 16);
  const farPhoto = gltfAlbedoSampler({ minX: 400, maxX: 430, minZ: 20, maxZ: 40 });
  assert.equal(farPhoto.maxEdge, 2048);
  assert.equal(farPhoto.mipmaps, true);
  assert.equal(farPhoto.chartMips, undefined);
  assert.equal(farPhoto.mipLevels, undefined);
  assert.equal(farPhoto.anisotropy, 16);
  assert.equal(farPhoto.minFilter, 'mipmap');
  // The Henderson, 11-SW-9C B347491569901063A0, about 220 m down the chase.
  const henderson = { minX: 218, maxX: 264, minZ: 54, maxZ: 105 };
  assert.equal(gltfInStreetChase(henderson), true);
  assert.equal(gltfStreetPhoto(henderson), true);
  const hendersonPhoto = gltfAlbedoSampler(henderson);
  assert.equal(gltfTextureMaxEdge(henderson), 0);
  assert.equal(hendersonPhoto.maxEdge, 0);
  assert.equal(hendersonPhoto.mipmaps, true);
  assert.equal(hendersonPhoto.chartMips, true);
  assert.equal(hendersonPhoto.wrap, 'clamp');
  assert.equal(hendersonPhoto.mipLevels, undefined);
  assert.equal(hendersonPhoto.anisotropy, 16);
  assert.equal(hendersonPhoto.minFilter, 'mipmap');
  const fairmont = { minX: 278, maxX: 316, minZ: 86, maxZ: 121 };
  const lippo = { minX: 341, maxX: 384, minZ: 135, maxZ: 178 };
  assert.equal(gltfAlbedoSampler(fairmont).mipmaps, true);
  assert.equal(gltfAlbedoSampler(fairmont).chartMips, true);
  assert.equal(gltfAlbedoSampler(fairmont).minFilter, 'mipmap');
  assert.equal(gltfAlbedoSampler(fairmont).anisotropy, 16);
  assert.equal(gltfAlbedoSampler(lippo).mipmaps, true);
  assert.equal(gltfAlbedoSampler(lippo).chartMips, true);
  const behind = { minX: -220, maxX: -160, minZ: 0, maxZ: 50 };
  assert.equal(gltfInStreetChase(behind), false);
  assert.equal(gltfAlbedoSampler(behind).mipmaps, true);
  assert.equal(gltfAlbedoSampler(behind).mipLevels, undefined);
  assert.equal(gltfAlbedoSampler(behind).maxEdge, 2048);
  assert.equal(HK_STREET_EYE.x, -1.4);
  assert.equal(HK_STREET_EYE.z, 29.3);
});

test('a LandsD sub-rectangle chart crops, and a gutter mip keeps the photograph', () => {
  const tower = landsdChartRect(0.0005000000237487257, 0, 0.12449999898672104, 0.4932631254196167);
  assert.ok(tower);
  assert.ok(tower.u1 - tower.u0 < 0.2);
  const flank = landsdChartRect(0, 0, 0.5, 0.9488099813461304);
  assert.ok(flank);
  assert.equal(flank.u1, 0.5);
  assert.equal(landsdChartRect(0, 0, 1, 1), null);
  assert.equal(landsdChartWrap(-4.07, 0, 5.8, 1), 'repeat');
  assert.equal(landsdChartRect(-4.07, 0, 5.8, 1), null);
  const [u0, v0] = remapLandsdChartUv(tower.u0, tower.v0, tower);
  const [u1, v1] = remapLandsdChartUv(tower.u1, tower.v1, tower);
  assert.deepEqual([u0, v0, u1, v1], [0, 0, 1, 1]);
  const px = landsdChartPixels(tower, 4096, 4096);
  assert.ok(px.width > 400 && px.width < 600);
  assert.ok(px.height > 1800 && px.height < 2200);
  assert.equal(isLandsdAtlasGutter(60, 60, 60), true);
  assert.equal(isLandsdNullTexel(60, 60, 60), false);
  assert.equal(isLandsdAtlasGutter(0, 0, 0), false);
  assert.equal(isLandsdAtlasGutter(90, 82, 64), false);
  const src = new Uint8Array([
    200, 30, 20, 255, 60, 60, 60, 255,
    180, 40, 25, 255, 136, 138, 137, 255
  ]);
  const mip = landsdGutterMip(src, 2, 2);
  assert.equal(mip.width, 1);
  assert.equal(mip.height, 1);
  assert.equal(mip.data[0], 190);
  assert.equal(mip.data[1], 35);
  assert.equal(mip.data[2], 23);
  const shore = landsdDilateGutter(new Uint8Array([10, 20, 30, 255, 60, 60, 60, 255]), 2, 1, 1);
  assert.equal(shore[4], 10);
  assert.equal(shore[5], 20);
  assert.equal(shore[0], 10);
});

test('Digit1 on-eye faces crop inside the full-bleed atlas, and the fixture strip does not', () => {
  const names = Object.keys(LANDSD_ON_EYE_HITS);
  assert.deepEqual(names, [
    'B346831557701063A0_002',
    'B346831557701063A0_003',
    'B345471572201063A0_001'
  ]);
  const faces = names.map((name) => {
    const hit = LANDSD_ON_EYE_HITS[name];
    assert.equal(isLandsdOnEyeChart(name), true);
    assert.equal(landsdChartRect(hit.primitive.minU, hit.primitive.minV, hit.primitive.maxU, hit.primitive.maxV), null);
    const face = landsdChartRect(hit.face.minU, hit.face.minV, hit.face.maxU, hit.face.maxV);
    assert.ok(face);
    return hit.face;
  });
  assert.equal(isLandsdOnEyeChart('B346831557701063A0_001'), false);
  assert.equal(isLandsdOnEyeChart('B345471572201063A0_002'), false);
  const grouped = groupLandsdOnEyeCharts(0, 0, 1, 1, faces);
  assert.equal(grouped.groups.length, 3);
  assert.equal(grouped.rest.length, 0);
  const flank = grouped.groups.find((group) => group.rect.u0 > 0.756 && group.rect.u1 < 0.8);
  assert.ok(flank);
  assert.ok(flank.rect.u1 - flank.rect.u0 < 0.05);
  assert.equal(groupLandsdOnEyeCharts(-4.07, 0, 5.8, 1, faces), null);
  assert.equal(groupLandsdOnEyeCharts(0, 0, 0.5, 0.9488099813461304, faces), null);
  const mixed = groupLandsdOnEyeCharts(0, 0, 1, 1, [
    faces[0],
    { minU: 0.2, minV: 0.2, maxU: 0.205, maxV: 0.205 }
  ]);
  assert.equal(mixed.groups.length, 1);
  assert.deepEqual(mixed.rest, [1]);
  assert.equal(groupLandsdOnEyeCharts(0, 0, 1, 1, [{ minU: 0.2, minV: 0.2, maxU: 0.205, maxV: 0.205 }]), null);
  const slots = packLandsdChartBins([
    { width: 70, height: 400 },
    { width: 80, height: 200 }
  ]);
  assert.equal(slots[0].atlas, 0);
  assert.equal(slots[1].atlas, 0);
  assert.equal(slots[0].pad, LANDSD_ON_EYE_PAD);
  assert.equal(slots[0].contentX, slots[0].x + 16);
  const overlap = slots[0].x < slots[1].x + slots[1].width
    && slots[1].x < slots[0].x + slots[0].width
    && slots[0].y < slots[1].y + slots[1].height
    && slots[1].y < slots[0].y + slots[0].height;
  assert.equal(overlap, false);
  assert.equal(packLandsdChartBins([{ width: 4080, height: 8 }])[0], null);
});

test('a baked LandsD triangle sits on the sidewalk and the boot passes it to the look ray', () => {
  const positions = new Float32Array([0, 0, 0, 4, 0, 0, 0, 12, 1]);
  const doc = {
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      min: [0, 0, 0],
      max: [4, 12, 1]
    }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    buffers: [{ byteLength: positions.byteLength }]
  };
  const solid = bakeGltfWorldTriangles(doc, [new Uint8Array(positions.buffer)]);
  assert.equal(solid.triangles.length, 9);
  assert.ok(Math.abs(solid.minY - ISLAND_BOUNDS.sidewalkHeight) < 1e-4);
  assert.ok(Math.abs(solid.maxY - (ISLAND_BOUNDS.sidewalkHeight + 12)) < 1e-4);
  const grid = readFileSync(path.join(root, 'js/city-grid.js'), 'utf8');
  const gltf = readFileSync(path.join(root, 'js/hk-gltf.js'), 'utf8');
  assert.match(grid, /lookSolids/);
  assert.match(grid, /solids: lookSolids/);
  assert.match(gltf, /loadLookSolids/);
  assert.match(gltf, /bakeGltfWorldTriangles/);
});

test('a Des Voeux facade keeps its cap slot ahead of a closer block behind the camera', () => {
  const plan = planGltfManifest({
    sheet: '11-SW-9C',
    buildings: [
      { file: 'behind.gltf', name: 'behind', minX: -220, maxX: -160, minZ: 0, maxZ: 50, minH: 4, maxH: 40, span: 60 },
      { file: 'henderson.gltf', name: 'henderson', minX: 218, maxX: 264, minZ: 54, maxZ: 105, minH: 6, maxH: 195, span: 51 }
    ]
  }, { cap: 1, pins: [] });
  assert.equal(plan.selected[0].name, 'henderson');
  assert.equal(plan.skippedCap, 1);
});

test('a LandsD mesh inside 80 m hides every procedural footprint in that disc', () => {
  const mesh = { minX: -6, maxX: 8, minZ: 22, maxZ: 38, span: 16 };
  const hidden = hiddenExtrudeIds([
    { id: 10, height: 30, minX: 30, maxX: 42, minZ: 22, maxZ: 34, cx: 36, cz: 28 },
    { id: 11, height: 30, minX: 190, maxX: 210, minZ: 10, maxZ: 30, cx: 200, cz: 20 }
  ], [mesh]);
  assert.deepEqual(hidden, [10]);
});

test('the Bank of China Tower mesh is pinned ahead of a nearer street face', () => {
  const boc = hkResolveLandmarks().placed.find((site) => site.id === 'boc').block;
  const span = Math.max(boc.maxX - boc.minX, boc.maxZ - boc.minZ);
  const plan = planGltfManifest({
    sheet: '11-SW-9C',
    buildings: [
      { file: 'street.gltf', name: 'street', minX: -12, maxX: 10, minZ: 18, maxZ: 40, minH: 4, maxH: 40, span: 22 },
      {
        file: 'boc.gltf',
        name: 'boc-mesh',
        minX: boc.minX - 1,
        maxX: boc.maxX + 1,
        minZ: boc.minZ - 1,
        maxZ: boc.maxZ + 1,
        minH: 5,
        maxH: 300,
        span
      }
    ]
  }, { cap: 1 });
  assert.equal(plan.selected[0].name, 'boc-mesh');
  assert.ok(plan.selected[0].minX < boc.cx && plan.selected[0].maxX > boc.cx);
});

test('the 11-SW-14A pin sheet keeps the Bank of China photograph and drops a stray mass', () => {
  const boc = hkResolveLandmarks().placed.find((site) => site.id === 'boc').block;
  assert.equal(HK_BOC_PHOTO_CHART.sheet, '11-SW-14A');
  assert.equal(HK_BOC_PHOTO_CHART.id, 'B346831557701063A0');
  assert.equal(gltfCoversFootprint(boc, [HK_BOC_PHOTO_CHART]), true);
  assert.ok(footprintOverlapRatio(boc, HK_BOC_PHOTO_CHART, 2) >= 0.9);
  const stray = { id: 'stray', minX: 10, maxX: 30, minZ: 10, maxZ: 30, span: 20 };
  const kept = filterPinSheetBuildings([stray, HK_BOC_PHOTO_CHART]);
  assert.deepEqual(kept.map((entry) => entry.id), [HK_BOC_PHOTO_CHART.id]);
  const sampler = gltfAlbedoSampler(HK_BOC_PHOTO_CHART);
  assert.equal(sampler.chartMips, true);
  assert.equal(sampler.wrap, 'clamp');
  assert.equal(sampler.mipLevels, undefined);
  assert.equal(sampler.anisotropy, 16);
  assert.equal(sampler.maxEdge, 0);
  for (const hit of [{ x: 84.93, z: 77.32 }, { x: 80.89, z: 71.08 }, { x: 141.18, z: 44.13 }]) {
    const inside = hit.x >= HK_BOC_PHOTO_CHART.minX && hit.x <= HK_BOC_PHOTO_CHART.maxX
      && hit.z >= HK_BOC_PHOTO_CHART.minZ && hit.z <= HK_BOC_PHOTO_CHART.maxZ;
    assert.equal(inside, false);
  }
});

test('Digit1 mid-band hits stay outside every hunted BUILDING mesh', () => {
  assert.equal(HK_MIDBAND_PHOTO_CHARTS.length, 0);
  assert.equal(digit1MidbandChartsCover(), false);
  assert.equal(HK_DIGIT1_MIDBAND_HITS.length, 3);
  const sheets = HK_DIGIT1_MIDBAND_HUNT.map((row) => row.sheet);
  assert.deepEqual(sheets, ['11-SW-9C', '11-SW-8D', '11-SW-14A', '11-SW-13B']);
  for (const row of HK_DIGIT1_MIDBAND_HUNT) {
    assert.ok(row.closestM > 0);
    assert.equal(assertSheetAllowed(row.sheet), row.sheet);
    for (const hit of HK_DIGIT1_MIDBAND_HITS) {
      assert.equal(hkGltfBoxContains(row, hit.x, hit.z), false);
    }
  }
  for (const hit of HK_DIGIT1_MIDBAND_HITS) {
    assert.equal(hkGltfBoxContains(HK_DIGIT1_MIDBAND_NOT_BUILDING, hit.x, hit.z), false);
    assert.equal(hkGltfBoxContains(HK_BOC_PHOTO_CHART, hit.x, hit.z), false);
  }
  assert.ok(HK_DIGIT1_MIDBAND_NOT_BUILDING.closestM > 0);
  for (const row of HK_DIGIT1_MIDBAND_GRID_ELIMINATED) {
    assert.ok(row.minM >= 400);
    assert.equal(assertSheetAllowed(row.sheet), row.sheet);
  }
  const nineC = HK_DIGIT1_MIDBAND_HUNT[0];
  assert.equal(nineC.closestId, 'B345471572201063A0');
  assert.equal(nineC.closestM, 25.5);
});
