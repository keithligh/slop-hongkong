import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ROADS } from '../js/city-config.js';
import { HK_PEDESTRIAN } from '../js/hk-pedestrian-data.js';
import {
  HK_BUS_SHELTER,
  HK_FOOTWAY_WIDTH,
  HK_SIDEWALK_WIDTH,
  collectHkPedestrian,
  crossingPaint,
  pavementWidth,
  planHkStreetGround
} from '../js/hk-pedestrian.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const project = (lon, lat) => [lon * 100, lat * 100];

test('pavement width keeps a real tag and uses a class floor only when the tag is missing', () => {
  assert.equal(pavementWidth({ width: '3.4 m', footway: 'sidewalk' }), 3.4);
  assert.equal(pavementWidth({ width: '1.5', highway: 'footway' }), 1.5);
  assert.equal(pavementWidth({ width: '40' }), HK_FOOTWAY_WIDTH);
  assert.equal(pavementWidth({ footway: 'sidewalk' }), HK_SIDEWALK_WIDTH);
  assert.equal(pavementWidth({ highway: 'footway' }), HK_FOOTWAY_WIDTH);
  assert.equal(pavementWidth({ footway: 'alley' }), 1.5);
  assert.equal(crossingPaint({ crossing: 'unmarked', 'crossing:markings': 'no' }), null);
  assert.equal(crossingPaint({ crossing: 'informal' }), null);
  assert.equal(crossingPaint({ crossing: 'traffic_signals' }), 'zebra');
  assert.equal(crossingPaint({ 'crossing:markings': 'zebra' }), 'zebra');
  assert.equal(crossingPaint({ crossing: 'uncontrolled' }), 'zebra');
});

test('a sidewalk is paved beside the carriageway and a way in the lane is not', () => {
  const roads = [{ w: 10, lanes: 3, pts: [{ x: 0, z: 0 }, { x: 0, z: 40 }] }];
  const features = collectHkPedestrian([
    {
      type: 'way',
      tags: { highway: 'footway', footway: 'sidewalk', surface: 'paving_stones', name: '德輔道中' },
      geometry: [{ lon: 0.08, lat: 0 }, { lon: 0.08, lat: 0.3 }]
    },
    {
      type: 'way',
      tags: { highway: 'footway' },
      geometry: [{ lon: 0, lat: 0.05 }, { lon: 0, lat: 0.2 }]
    },
    {
      type: 'node',
      lat: 0.1,
      lon: 0.09,
      tags: { highway: 'crossing', crossing: 'uncontrolled' }
    },
    {
      type: 'node',
      lat: 0.12,
      lon: 0.09,
      tags: { highway: 'crossing', crossing: 'unmarked', 'crossing:markings': 'no' }
    },
    {
      type: 'node',
      lat: 0.05,
      lon: 0.1,
      tags: { highway: 'bus_stop', 'name:zh': '皇后像廣場', shelter: 'yes' }
    },
    {
      type: 'node',
      lat: 0.052,
      lon: 0.1,
      tags: { highway: 'bus_stop', name: 'duplicate', shelter: 'no' }
    },
    {
      type: 'node',
      lat: 0.2,
      lon: 0.12,
      tags: { amenity: 'bench' }
    },
    {
      type: 'way',
      tags: { highway: 'steps' },
      geometry: [{ lon: 0.2, lat: 0 }, { lon: 0.3, lat: 0 }]
    },
    {
      type: 'way',
      tags: { highway: 'footway', bridge: 'yes' },
      geometry: [{ lon: 0.2, lat: 0.2 }, { lon: 0.3, lat: 0.2 }]
    }
  ], project);
  assert.equal(features.walks.length, 2);
  assert.ok(features.walks.some((walk) => walk.w === HK_SIDEWALK_WIDTH));
  assert.equal(features.stops.length, 1);
  assert.equal(features.stops[0].name, '皇后像廣場');
  assert.equal(features.stops[0].shelter, true);
  assert.equal(features.crossings.length, 1);
  assert.equal(features.furniture.length, 1);
  const plan = planHkStreetGround(features, roads);
  assert.ok(plan.walks.length >= 1);
  assert.ok(plan.walks.every((walk) => Math.abs(walk.x) > 4), 'the lane centre is not paved');
  assert.ok(plan.walks.some((walk) => walk.w === HK_SIDEWALK_WIDTH));
  assert.equal(plan.crossingSites, 1);
  assert.equal(plan.crossings.length, 6);
  assert.equal(plan.stops.length, 1);
  assert.equal(plan.stops[0].shelter, true);
  assert.equal(plan.stops[0].inRoad, false);
  assert.equal(plan.furniture.length, 1);
  assert.equal(plan.furniture[0].kind, 'bench');
});

test('a walk that crosses the kerb keeps its outer edge and stops at the stone', () => {
  const roads = [{ w: 10, lanes: 3, pts: [{ x: 0, z: 0 }, { x: 0, z: 40 }] }];
  const plan = planHkStreetGround({
    walks: [{ w: 3.4, pts: [6, 0, 6, 20] }],
    areas: [],
    crossings: [],
    stops: [],
    furniture: []
  }, roads);
  assert.equal(plan.walks.length, 1);
  const walk = plan.walks[0];
  const inner = Math.abs(walk.x) - walk.w / 2;
  const outer = Math.abs(walk.x) + walk.w / 2;
  assert.ok(Math.abs(inner - 5.18) < 1e-6);
  assert.ok(Math.abs(outer - 7.7) < 1e-6);
  assert.ok(walk.w < HK_SIDEWALK_WIDTH);
});

test('an empty extract adds no pavement and no bus stop', () => {
  const plan = planHkStreetGround({ walks: [], areas: [], crossings: [], stops: [], furniture: [] }, ROADS);
  assert.equal(plan.walks.length, 0);
  assert.equal(plan.stops.length, 0);
  assert.equal(plan.crossingSites, 0);
});

test('Des Voeux eye height has mapped pavement, a zebra, and the Statue Square stop', () => {
  const plan = planHkStreetGround(HK_PEDESTRIAN, ROADS);
  const eye = { x: -1.4, z: 29.3 };
  const along = { x: 22.6, z: 36.2 };
  const south = { x: -1.4, z: 35.3 };
  const near = (p, cam, r) => Math.hypot(p.x - cam.x, p.z - cam.z) <= r;
  assert.ok(plan.walks.some((walk) => walk.w === HK_SIDEWALK_WIDTH && near(walk, south, 12)));
  assert.ok(plan.walks.some((walk) => walk.w === HK_SIDEWALK_WIDTH && near(walk, eye, 16)));
  assert.ok(plan.walks.some((walk) => near(walk, along, 12)));
  assert.ok(plan.crossings.some((bar) => near(bar, along, 25)));
  const stop = plan.stops
    .filter((item) => item.name === '皇后像廣場')
    .sort((a, b) => Math.hypot(a.x - eye.x, a.z - eye.z) - Math.hypot(b.x - eye.x, b.z - eye.z))[0];
  assert.ok(stop);
  assert.equal(stop.shelter, true);
  assert.ok(Math.hypot(stop.x - eye.x, stop.z - eye.z) <= 20);
  assert.ok(HK_BUS_SHELTER.signH >= 0.6);
  assert.ok(HK_BUS_SHELTER.roofLen >= 4.5);
  assert.ok(HK_BUS_SHELTER.signY > 1.6 && HK_BUS_SHELTER.signY < HK_BUS_SHELTER.roofY);
  assert.ok(HK_PEDESTRIAN.attribution.includes('OpenStreetMap'));
  assert.deepEqual(HK_PEDESTRIAN.bbox, [22.276, 114.150, 22.288, 114.170]);
  const grid = readFileSync(path.join(root, 'js/city-grid.js'), 'utf8');
  assert.match(grid, /HK_BUS_SHELTER/);
  assert.match(grid, /DoubleSide/);
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(grid, /planHkStreetGround\(HK_PEDESTRIAN, ROADS\)/);
  assert.match(grid, /HkOsmPavement/);
  assert.match(grid, /hkSpan/);
  assert.match(grid, /HkCrossings/);
  assert.match(grid, /HkBusStopSign/);
  assert.match(html, /hk-pedestrian-data\.js/);
  const query = readFileSync(path.join(root, 'tools/data/q_hk_pedestrian.overpassql'), 'utf8');
  assert.match(query, /bus_stop/);
  assert.match(query, /footway/);
  assert.match(query, /22\.276,114\.150,22\.288,114\.170/);
});
