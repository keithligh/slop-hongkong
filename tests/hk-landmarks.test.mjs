import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HK_CORE_BBOX,
  HK_LANDMARK_CATALOG,
  blockInHkCore,
  hkCoreProject,
  hkCoreUnproject,
  hkLandmarkOwnsShaft,
  hkLonLatInCore,
  hkPlanCorners,
  hkResolveLandmarks
} from '../js/city-config.js';

const root = fileURLToPath(new URL('..', import.meta.url));

const PLACED = {
  'two-ifc': { lat: 22.285298, lon: 114.159277 },
  'one-ifc': { lat: 22.285114, lon: 114.156951 },
  boc: { lat: 22.279278, lon: 114.161571 },
  'one-exchange': { lat: 22.283442, lon: 114.158358 },
  'two-exchange': { lat: 22.283893, lon: 114.15824 },
  'three-exchange': { lat: 22.284527, lon: 114.157315 },
  jardine: { lat: 22.283004, lon: 114.159154 },
  cfa: { lat: 22.280911, lon: 114.160358 },
  'star-ferry': { lat: 22.287064, lon: 114.161201 },
  'peak-tram': { lat: 22.277694, lon: 114.159173 }
};

test('Central landmark anchors round-trip through the geodata frame and stay inside the box', () => {
  const { placed, deferred } = hkResolveLandmarks();
  assert.deepEqual(placed.map((site) => site.id), Object.keys(PLACED));
  assert.deepEqual(deferred.map((site) => site.id), ['victoria-peak', 'peak-terminus', 'tst-clock']);
  for (const site of deferred) {
    assert.equal(site.inside, false, site.id);
    assert.equal(hkLonLatInCore(site.lon, site.lat), false, site.id);
    assert.equal(Object.hasOwn(PLACED, site.id), false);
  }
  const peak = deferred.find((site) => site.id === 'victoria-peak');
  const clock = deferred.find((site) => site.id === 'tst-clock');
  assert.ok(peak.lat < HK_CORE_BBOX.south && peak.lon < HK_CORE_BBOX.west);
  assert.ok(clock.lat > HK_CORE_BBOX.north);
  for (const site of placed) {
    assert.equal(hkLonLatInCore(site.lon, site.lat), true, site.id);
    assert.ok(site.lat >= HK_CORE_BBOX.south && site.lat <= HK_CORE_BBOX.north, site.id);
    assert.ok(site.lon >= HK_CORE_BBOX.west && site.lon <= HK_CORE_BBOX.east, site.id);
    const expected = PLACED[site.id];
    assert.ok(Math.abs(site.lat - expected.lat) < 2e-5, `${site.id} lat ${site.lat}`);
    assert.ok(Math.abs(site.lon - expected.lon) < 2e-5, `${site.id} lon ${site.lon}`);
    const [x, z] = hkCoreProject(site.lon, site.lat);
    assert.ok(Math.hypot(x - site.x, z - site.z) < 0.05, site.id);
    const back = hkCoreUnproject(site.x, site.z);
    assert.ok(Math.abs(back.lat - site.lat) < 1e-8 && Math.abs(back.lon - site.lon) < 1e-8);
    if (site.block) {
      assert.equal(blockInHkCore(site.block), true, site.id);
      assert.ok(Math.hypot(site.x - site.block.cx, site.z - site.block.cz) < 0.05);
      assert.notEqual(site.x, 0);
      assert.notEqual(site.z, 0);
    }
    if (site.pinWithin != null) {
      assert.ok(site.pinMetres <= site.pinWithin, `${site.id} pin ${site.pinMetres}m`);
    }
  }
  const two = placed.find((site) => site.id === 'two-ifc');
  const one = placed.find((site) => site.id === 'one-ifc');
  const apart = Math.hypot(two.x - one.x, two.z - one.z);
  assert.ok(apart > 220 && apart < 260, `One IFC is ${apart.toFixed(1)} m from Two IFC`);
  const ferry = placed.find((site) => site.id === 'star-ferry');
  assert.equal(ferry.pier.name, '中環天星碼頭 Central Star Ferry Pier');
  assert.equal(hkLonLatInCore(114.1613889, 22.2905556), false);
  const tram = placed.find((site) => site.id === 'peak-tram');
  assert.equal(tram.block.name, "St. John's Building");
  assert.ok(tram.pinMetres < 5, `Garden Road terminus is ${tram.pinMetres} m from the station`);
});

test('Bank of China corners stay on its LandsD footprint and only that shaft is landmark-owned', () => {
  const { placed } = hkResolveLandmarks();
  const boc = placed.find((site) => site.id === 'boc');
  const corners = hkPlanCorners(boc.block.poly, boc.block.cx, boc.block.cz);
  assert.equal(corners.length, 4);
  for (const corner of corners) {
    assert.ok(corner.x >= boc.block.minX - 0.5 && corner.x <= boc.block.maxX + 0.5);
    assert.ok(corner.z >= boc.block.minZ - 0.5 && corner.z <= boc.block.maxZ + 0.5);
    assert.ok(Math.hypot(corner.x - boc.block.cx, corner.z - boc.block.cz) > 15);
  }
  assert.equal(hkLandmarkOwnsShaft(boc.block), true);
  assert.equal(hkLandmarkOwnsShaft({ name: 'Bank of China Tower', height: null }), false);
  assert.equal(hkLandmarkOwnsShaft({ name: 'HSBC Main Building', height: 177.2 }), false);
  assert.equal(HK_LANDMARK_CATALOG.filter((spec) => spec.ownsShaft).length, 1);
  const landmarks = readFileSync(path.join(root, 'js/landmarks.js'), 'utf8');
  const bocSrc = landmarks.slice(landmarks.indexOf('function addBankOfChina'), landmarks.indexOf('function addJardine'));
  assert.match(bocSrc, /const ySkirt = HK_RETAIL_BELT/);
  assert.match(bocSrc, /createRetailPodiumMaterial\(\)/);
  assert.match(bocSrc, /createCurtainWallMaterial\(/);
  assert.match(bocSrc, /glassTint: 0x7aa3c2/);
  assert.match(bocSrc, /glassMetalness: 0/);
  assert.match(bocSrc, /glassRoughness: 0\.48/);
  assert.match(bocSrc, /reflectionFloor: 0\.04/);
  assert.match(bocSrc, /reflectivity: 0\.22/);
  assert.doesNotMatch(bocSrc, /reflectivity: 0\.96/);
  assert.match(bocSrc, /Math\.max\(2, Math\.round\(rise \/ 52\)\)/);
  assert.match(bocSrc, /emissiveIntensity: 0\.7/);
  assert.match(bocSrc, /metalness: 0\.04/);
  assert.match(bocSrc, /addPrism\(group, skirt, a, b, center, ground, ground, ground, ySkirt, ySkirt, ySkirt\)/);
  assert.match(bocSrc, /addPrism\(group, face, a, b, center, ySkirt, ySkirt, ySkirt, yOuter, yOuter, yCenter\)/);
  assert.doesNotMatch(bocSrc, /const y0 = ground/);
  assert.doesNotMatch(bocSrc, /0xc5d5e4/);
  assert.doesNotMatch(bocSrc, /metalness: 0\.64/);
  const jardine = landmarks.slice(landmarks.indexOf('function addJardine'), landmarks.indexOf('function addCourtDome'));
  assert.match(jardine, /HK_RETAIL_BELT \+ 1\.2/);
});

test('boot builds Hong Kong landmarks and does not call the NYC landmark builder', () => {
  const landmarks = readFileSync(path.join(root, 'js/landmarks.js'), 'utf8');
  const boot = landmarks.slice(landmarks.indexOf('function buildLandmarks'));
  const hk = landmarks.slice(landmarks.indexOf('function buildHkLandmarks'), landmarks.indexOf('function buildLandmarks'));
  assert.match(boot, /return buildHkLandmarks\(scene, gltfPlan\)/);
  assert.match(hk, /HongKongLandmarks/);
  assert.match(hk, /gltfCoversFootprint/);
  const main = readFileSync(path.join(root, 'js/main.js'), 'utf8');
  assert.match(main, /buildLandmarks\(scene, gltfPlan\)/);
  const buildings = readFileSync(path.join(root, 'js/buildings.js'), 'utf8');
  const body = buildings.slice(buildings.indexOf('function buildHkFootprintBlocks'), buildings.indexOf('function buildCityBlocks'));
  assert.match(body, /hkLandmarkOwnsShaft/);
  assert.match(buildings, /ExtrudeGeometry/);
});
