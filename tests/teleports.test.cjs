const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
let TELEPORT_LOCATIONS, blockAt, getIslandBoundsAtZ, getLocationLabel;
test.before(async () => {
  ({ TELEPORT_LOCATIONS, blockAt, getIslandBoundsAtZ, getLocationLabel } = await import('../js/city-config.js'));
});

test('Hong Kong teleports are Central, Tsim Sha Tsui, and Admiralty', () => {
  const html = read('index.html');
  const buttons = [...html.matchAll(/data-teleport="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(buttons.sort(), ['admiralty', 'central', 'tst']);
  assert.deepEqual(Object.keys(TELEPORT_LOCATIONS).sort(), buttons.sort());
  assert.doesNotMatch(html, /data-teleport="empire"|data-teleport="owtc"|data-teleport="timessq"/);
  assert.match(html, /中環/);
  assert.match(html, /尖沙咀/);
  assert.match(html, /金鐘/);
  for (const [name, point] of Object.entries(TELEPORT_LOCATIONS)) {
    assert.ok(Number.isFinite(point.heading), `${name} has a heading`);
    assert.equal(blockAt(point.x, point.z), null, `${name} lands outside building blocks`);
    const shore = getIslandBoundsAtZ(point.z, point.x);
    assert.ok(point.x > shore.westX + 8 && point.x < shore.eastX - 8, `${name} stays on land`);
  }
  const { central, tst, admiralty } = TELEPORT_LOCATIONS;
  assert.ok(Math.hypot(central.x, central.z) < 30, 'Central is the Statue Square origin');
  assert.ok(Math.abs(central.heading - Math.PI) < 1e-9, 'Central faces north, toward the harbour');
  assert.equal(getLocationLabel(central.x, central.z).startsWith('中環'), true);
  assert.ok(tst.z < -1400, 'Tsim Sha Tsui is north of Hong Kong Island');
  assert.equal(tst.heading, 0, 'Tsim Sha Tsui faces south, toward the island');
  assert.equal(getLocationLabel(tst.x, tst.z).startsWith('尖沙咀'), true);
  const islandOnly = getIslandBoundsAtZ(tst.z);
  const onKowloon = getIslandBoundsAtZ(tst.z, tst.x);
  assert.ok(tst.x <= islandOnly.westX || tst.x >= islandOnly.eastX || onKowloon.westX !== islandOnly.westX, 'the clock tower is not clamped onto the island shore');
  assert.ok(onKowloon.westX !== islandOnly.westX || onKowloon.eastX !== islandOnly.eastX);
  assert.ok(admiralty.z > 0 && admiralty.x > 200, 'Admiralty is on the island, east of Central');
  assert.ok(Math.abs(admiralty.heading - Math.PI) < 1e-9);
  assert.equal(getLocationLabel(admiralty.x, admiralty.z).startsWith('金鐘'), true);
});

test('Hong Kong boot builds landmarks from the Hong Kong catalog', () => {
  const landmarks = read('js/landmarks.js');
  const boot = landmarks.indexOf('function buildLandmarks');
  assert.ok(boot > 0);
  assert.match(landmarks.slice(boot), /return buildHkLandmarks\(scene, gltfPlan\)/);
  assert.match(landmarks, /HongKongLandmarks/);
});

test('preset and map teleports share arrival resets and mark the resolved landing point', () => {
  const main = read('js/main.js');
  const start = main.indexOf('  function teleportTo(');
  const end = main.indexOf('  const openMapBtn', start);
  const handlers = new Map();
  const calls = [];
  const landed = { x: 0, z: 0 };
  let map;
  const environment = {
    TELEPORT_LOCATIONS,
    controllerManager: {
      teleportActiveTo: (...args) => { calls.push(['teleport', ...args]); return landed; }
    },
    touchControls: { reset: () => calls.push(['touch']) },
    gamepadControls: { reset: () => calls.push(['gamepad']) },
    cameraSystem: { resetForTeleport: () => calls.push(['camera']) },
    selectCamera: (...args) => calls.push(['selectCamera', ...args]),
    getLocationLabel: (x, z) => `${x}, ${z}`,
    cityBlocks: { allBlocks: [] },
    trafficSystem: {},
    HkMapSystem: class {
      constructor(options) { this.onTeleport = options.onTeleport; map = this; }
    },
    teleportButtons: Object.keys(TELEPORT_LOCATIONS).map((key) => ({
      getAttribute: () => key,
      addEventListener: (_event, handler) => handlers.set(key, handler)
    })),
    closePopovers: () => {}
  };
  vm.runInNewContext(main.slice(start, end), environment);
  for (const [name, point] of Object.entries(TELEPORT_LOCATIONS)) {
    calls.length = 0;
    handlers.get(name)();
    assert.deepEqual(calls, [
      ['teleport', point.x, point.z, point.heading], ['touch'], ['gamepad'], ['camera'], ['selectCamera', 'chase', true]
    ]);
    assert.equal(map.waypoint.x, landed.x);
    assert.equal(map.waypoint.z, landed.z);
  }
  map.waypoint = { x: 100, z: 200, name: 'inside a building' };
  map.onTeleport(100, 200);
  assert.equal(map.waypoint.x, landed.x, 'map marker follows the safe position returned by the controller');
  assert.equal(map.waypoint.z, landed.z);
  assert.equal(map.waypoint.name, `${landed.x}, ${landed.z}`);
});
