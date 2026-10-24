const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
const importMap = html.match(/<script type="importmap">([^]*?)<\/script>/);
const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"\s*\/>/g)];
const entries = [...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)];

test('city module preloads start after the import map and before stylesheets', () => {
  assert.ok(importMap);
  assert.ok(preloads.length > 0);
  const stylesheetIndex = html.indexOf('rel="stylesheet"');
  for (const preload of preloads) {
    assert.ok(importMap.index < preload.index);
    assert.ok(preload.index < stylesheetIndex);
  }
  assert.equal(entries.length, 1);
  assert.ok(importMap.index < entries[0].index);
  assert.ok(entries[0].index < stylesheetIndex, 'the module graph starts loading early too');
  assert.match(html, /<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net" crossorigin\s*\/>/);
  const { imports } = JSON.parse(importMap[1]);
  assert.equal(imports.three, imports['three/webgpu'], 'Three.js aliases share one module instance');
});

test('Hong Kong boot builders stay on the harbour, landmark, and Central footprint path', () => {
  const root = join(__dirname, '..');
  const read = (rel) => readFileSync(join(root, rel), 'utf8');
  const boroughsSrc = read('js/boroughs.js');
  assert.match(boroughsSrc, /function buildBoroughs\(scene\) \{\n  return buildHkHarbourLand\(scene\);\n\}/);
  assert.match(boroughsSrc, /function ridgeHeightAt\(\) \{\n  return 0;\n\}/);
  assert.match(boroughsSrc, /group\.name = 'Boroughs'/);
  const landmarks = read('js/landmarks.js');
  assert.match(landmarks, /function buildLandmarks\(scene, gltfPlan = null\) \{\n  return buildHkLandmarks\(scene, gltfPlan\);\n\}/);
  assert.match(landmarks, /HongKongLandmarks/);
  const blocks = read('js/buildings.js');
  assert.match(blocks, /function buildCityBlocks\(scene, gltfPlan = null\) \{\n  return buildHkFootprintBlocks\(scene, gltfPlan\);\n\}/);
  assert.match(blocks, /createCurtainWallMaterial/);
  assert.match(blocks, /blockInHkCore/);
  const details = read('js/street-details.js');
  assert.match(details, /return \{ group, footprints: \[\], signalClock/);
  assert.match(details, /hkCentralSignSites/);
  assert.match(details, /HongKongStreetDetails/);
  const grid = read('js/city-grid.js');
  assert.match(grid, /function buildCityGrid\(scene, gltfPlan = null\) \{\n  return buildHkCityGrid\(scene, gltfPlan\);/);
  assert.match(grid, /buildHkRoadRibbons\(group, roadMat, sidewalkMat\)/);
  assert.match(grid, /planHkRoadDeck\(ROADS, HK_CORE_WORLD\)/);
  assert.match(grid, /HkCurbs/);
  assert.match(grid, /planHkStreetCanyon/);
  assert.match(grid, /HkCentralStreetWalls/);
  assert.match(grid, /HK_CANYON_HEIGHT/);
  assert.match(grid, /HongKongCoastGround/);
  assert.match(grid, /VictoriaHarbourWater/);
  const map = read('js/hk-map.js');
  const layers = map.slice(map.indexOf('function mapLayers'), map.indexOf('const ROAD_LABELS'));
  assert.match(layers, /GEO\.hongKongIsland/);
  assert.match(layers, /GEO\.kowloon/);
  assert.match(layers, /GEO\.harbour/);
  assert.match(layers, /L\.streets/);
  assert.match(layers, /L\.arterials/);
  assert.doesNotMatch(layers, /for \(const b of BLOCKS\)|L\.blocks|L\.highways/);
  assert.match(map, /Number\.isFinite\(GEO\.frame\.bearingDeg\)/);
  assert.match(map, /class HkMapSystem/);
  assert.doesNotMatch(map, /29\.02/);
  const draw = map.slice(map.indexOf('drawWorld(ctx, v, isMinimap)'), map.indexOf('drawRoadLabels'));
  assert.match(draw, /L\.harbour/);
  assert.match(draw, /L\.land/);
  assert.match(draw, /L\.streets/);
  assert.doesNotMatch(draw, /L\.blocks|MAP\.highway|footprintLayers/);
  const config = read('js/city-config.js');
  assert.match(config, /from '\.\/geo-source\.js'/);
  assert.match(config, /PLACES/);
  const geodataHead = read('js/hk-geodata.js').slice(0, 2500);
  assert.match(geodataHead, /hongKongIsland/);
  assert.match(geodataHead, /"city":"hk"/);
});

test('native module entry and imports share canonical preloaded URLs on GitHub Pages', () => {
  const links = preloads.map((match) => match[1]);
  assert.equal(links.length, 42);
  assert.equal(new Set(links).size, links.length, 'each module is preloaded once');
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1], './js/main.js');
  assert.ok(links.includes(entries[0][1]));
  assert.equal(links[0], './js/hk-geodata.js');
  assert.equal(links.some((href) => href.includes('nyc-')), false);
  assert.ok(links.indexOf('./js/geo-source.js') < links.indexOf('./js/city-config.js'), 'geo-source preloads before city-config');
  assert.ok(links.indexOf('./js/geo-source.js') > links.indexOf('./js/hk-geodata.js'));
  assert.equal([...html.matchAll(/<script\b/g)].length, 2, 'only the import map and native entry are needed');
  const base = 'https://example.test/slop-hongkong/';
  const urls = new Set(links.map((src) => new URL(src, base).href));
  for (const src of links) {
    assert.match(src, /^\.\/js\/[\w-]+\.js$/, 'preloads use the same unversioned paths as native imports');
    const source = readFileSync(join(__dirname, '..', src), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
      const url = new URL(specifier, new URL(src, base));
      assert.ok(urls.has(url.href), `${src} imports an unpreloaded or mismatched URL: ${specifier}`);
    }
  }
});
