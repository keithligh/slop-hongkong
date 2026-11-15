#!/usr/bin/env node
// One boot, several frames inside the 50 m Digit1 walk disc (fidelity review).
//   node tools/digit1-disc-shots.mjs artifacts/disc --query 'at=-1.4,29.3,1.29&confine=on&gltfCap=10' \
//     --shots 'east:0:0,west:-480:0,south:240:0' [--hide-hud] [--root DIR]
// A shot is name:dragX:dragY[:HideA|HideB]. The optional fourth field hides every mesh with one of
// those names before the capture (needs ?debug=scene in the query); the hide persists for later shots. The drag is a pointer drag on the canvas that orbits the chase
// camera (0.0065 rad per px of X), cumulative from the previous shot. One boot is minutes under
// SwiftShader, so a series of angles costs one boot. gltfCap=10 keeps the near LandsD meshes and
// stays inside what SwiftShader can hold; the default cap of 200 loses the device there.
// --eval FILE runs that expression in the page after the overlay drops (needs ?debug=scene for window.__hkScene).
// Output: <dest>-<name>.png for each shot.

import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHROME = process.env.CHROME || 'google-chrome';
const PORT = 9225;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? '' : process.argv[index + 1] || '';
}

const root = argValue('--root') ? path.resolve(argValue('--root')) : repoRoot;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const stat = statSync(file);
      if (!stat.isFile()) throw new Error('dir');
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function chromeArgs() {
  return [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--disable-web-security',
    '--force-device-scale-factor=1',
    '--window-size=1280,720',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/digit1-disc-chrome',
    'about:blank'
  ];
}

function parseShots(spec) {
  return String(spec || 'east:0:0').split(',').map((part) => {
    const [name, dx, dy, hide] = part.split(':');
    return { name: name || 'shot', dx: Number(dx) || 0, dy: Number(dy) || 0, hide: hide ? hide.split('|') : [] };
  });
}

async function main() {
  const dest = path.resolve(repoRoot, process.argv[2] || 'artifacts/disc');
  const query = argValue('--query') || 'at=-1.4,29.3,1.29&confine=on&gltfCap=10';
  const shots = parseShots(argValue('--shots'));
  const server = await startServer();
  const pageUrl = `http://127.0.0.1:${server.address().port}/index.html?${query}`;
  const chrome = spawn(CHROME, chromeArgs(), { stdio: 'ignore', detached: true });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    let list = null;
    for (let i = 0; i < 50 && !list; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        if (res.ok) {
          const rows = await res.json();
          if (rows.length) list = rows;
        }
      } catch {
        // Chrome is still binding.
      }
      if (!list) await sleep(200);
    }
    if (!list) throw new Error('Chrome DevTools did not open');
    const ws = new WebSocket(list[0].webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error('devtools socket')));
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
        if (/\[(gltf|ground|roads)\] (overlay|sheet|manifest|Central)/.test(text)) console.log(`[page] ${text.slice(0, 240)}`);
        if (message.params.type === 'error') console.log(`[page] error ${text.slice(0, 200)}`);
      }
      if (message.method === 'Runtime.exceptionThrown') {
        console.log(`[page] exception ${message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text}`);
      }
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    });
    const send = (method, params = {}) => new Promise((resolve) => {
      const msgId = ++id;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: pageUrl });
    const deadline = Date.now() + 420000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      const message = await send('Runtime.evaluate', {
        expression: `(() => {
          const overlay = document.getElementById('loading-overlay');
          return !!overlay && overlay.classList.contains('hidden') ? 'ready' : '';
        })()`,
        returnByValue: true
      });
      ready = message.result?.result?.value === 'ready';
      if (!ready) await sleep(500);
    }
    if (!ready) throw new Error('frame did not leave the loading overlay');
    if (process.argv.includes('--hide-hud')) {
      await send('Runtime.evaluate', {
        expression: `(() => {
          const style = document.createElement('style');
          style.textContent = 'body > *:not(main):not(script):not(style) { display: none !important; }';
          document.head.appendChild(style);
        })()`
      });
    }
    await sleep(2500);
    if (argValue('--eval')) {
      const result = await send('Runtime.evaluate', { expression: readFileSync(path.resolve(argValue('--eval')), 'utf8'), returnByValue: true });
      console.log(`[eval] ${JSON.stringify(result.result?.result?.value ?? result.result)}`);
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    for (const shot of shots) {
      if (shot.dx || shot.dy) {
        const x0 = 640;
        const y0 = 300;
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
        const steps = 6;
        for (let s = 1; s <= steps; s++) {
          await send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: x0 + (shot.dx * s) / steps, y: y0 + (shot.dy * s) / steps, button: 'left', buttons: 1, pointerType: 'mouse'
          });
        }
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + shot.dx, y: y0 + shot.dy, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
        await sleep(2500);
      }
      if (shot.hide.length) {
        await send('Runtime.evaluate', {
          expression: `(() => { const names = new Set(${JSON.stringify(shot.hide)}); let n = 0; window.__hkScene.traverse((o) => { if (names.has(o.name)) { o.visible = false; n++; } }); return n; })()`
        });
        await sleep(2500);
      }
      const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
      const file = `${dest}-${shot.name}.png`;
      writeFileSync(file, png);
      console.log(`[disc] ${png.length} bytes ${file}`);
    }
  } finally {
    try {
      process.kill(-chrome.pid, 'SIGKILL');
    } catch {
      chrome.kill('SIGKILL');
    }
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
