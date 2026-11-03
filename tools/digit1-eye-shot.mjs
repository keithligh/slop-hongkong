#!/usr/bin/env node
// One Des Voeux eye-east frame after the loading overlay drops.
//   node tools/digit1-eye-shot.mjs artifacts/eye-east.png
//   node tools/digit1-eye-shot.mjs artifacts/eye-east.png --query 'at=-1.4,29.3,1.29&landsdAniso=1'
//   node tools/digit1-eye-shot.mjs before.png --root /tmp/before --hide-hud
//   node tools/digit1-eye-shot.mjs seams.png --page tools/digit1-ground-seams.html --query 'ppm=40'
// --owner-json FILE saves window.__digit1GameGround (first-hit mesh at the eye, Cut #47).
// --root serves another checkout (the BEFORE tip of a live A-B). --hide-hud
// drops the DOM panels so a ground crop scores the scene, not the HUD.

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHROME = process.env.CHROME || 'google-chrome';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return '';
  return process.argv[index + 1] || '';
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

function chromeArgs(port) {
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
    '--enable-logging=stderr',
    '--log-level=0',
    // data.map.gov.hk sits behind a cache that sometimes answers with another
    // origin's Access-Control-Allow-Origin (AllowOriginMismatch). The harness
    // serves from a random localhost port, so it cannot rely on that header.
    '--disable-web-security',
    '--force-device-scale-factor=1',
    '--window-size=1280,720',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=/tmp/digit1-eye-chrome',
    'about:blank'
  ];
}

async function main() {
  const dest = path.resolve(repoRoot, process.argv[2] || 'artifacts/eye-east.png');
  const query = argValue('--query') || 'at=-1.4,29.3,1.29';
  const server = await startServer();
  const page = argValue('--page') || 'index.html';
  const pageUrl = `http://127.0.0.1:${server.address().port}/${page}?${query}`;
  const chrome = spawn(CHROME, chromeArgs(9224), { stdio: 'ignore', detached: true });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    let list = null;
    for (let i = 0; i < 50 && !list; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9224/json/list');
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
    let groundMounted = false;
    const urls = new Map();
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
        if (/\[(ground-tiles|gltf|pland)\]/.test(text)) console.log(`[page] ${text}`);
        if (/\[ground-tiles\] mounted/.test(text)) groundMounted = true;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        console.log(`[page] exception ${message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text}`);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        console.log(`[page] error ${(message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 300)}`);
      }
      if (message.method === 'Network.requestWillBeSent') urls.set(message.params.requestId, message.params.request.url);
      if (message.method === 'Network.loadingFailed' && /map\.gov\.hk/.test(urls.get(message.params.requestId) || '')) {
        console.log(`[net] ${JSON.stringify(message.params)} ${(urls.get(message.params.requestId) || '').slice(0, 90)}`);
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
    await send('Network.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: pageUrl });
    const deadline = Date.now() + 240000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      const message = await send('Runtime.evaluate', {
        expression: `(() => {
          if (window.__seams) return window.__seams.stage === 'ready' ? 'ready' : '';
          const overlay = document.getElementById('loading-overlay');
          const gone = !!overlay && overlay.classList.contains('hidden');
          return gone ? 'ready' : '';
        })()`,
        returnByValue: true
      });
      ready = message.result?.result?.value === 'ready';
      if (!ready) await sleep(400);
    }
    if (!ready) throw new Error('eye frame did not leave the loading overlay');
    if (process.argv.includes('--hide-hud')) {
      await send('Runtime.evaluate', {
        expression: `(() => {
          const style = document.createElement('style');
          style.textContent = 'body > *:not(main):not(script):not(style) { display: none !important; }';
          document.head.appendChild(style);
        })()`
      });
    }
    await sleep(1500);
    // Tiles are opt-in from Cut #47 (?groundTiles=on). A BEFORE checkout at 03d4ab0 mounts them by default.
    const hasGameGround = existsSync(path.join(root, 'js/hk-game-ground.js'));
    const tilesWanted = hasGameGround ? /groundTiles=(on|1|true)/.test(query) : !/groundTiles=(off|0)/.test(query);
    if (!groundMounted && tilesWanted && existsSync(path.join(root, 'js/hk-ground-tiles.js'))) {
      throw new Error('ground tiles did not mount (tileset fetch failed); this frame is not a ground crop');
    }
    if (groundMounted && hasGameGround && !tilesWanted) {
      throw new Error('ground tiles mounted without ?groundTiles=on; the default Digit1 eye must be the game deck');
    }
    if (hasGameGround) {
      const owner = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__digit1GameGround || null)', returnByValue: true });
      console.log(`[game-ground] ${owner.result?.result?.value}`);
      if (argValue('--owner-json')) writeFileSync(path.resolve(repoRoot, argValue('--owner-json')), owner.result?.result?.value || 'null');
    }
    if (page !== 'index.html') {
      const info = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__seams)', returnByValue: true });
      console.log(`[page] ${info.result?.result?.value}`);
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(shot.result.data, 'base64');
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, png);
    console.log(`[eye] ${png.length} bytes ${dest}`);
  } finally {
    try {
      process.kill(-chrome.pid, 'SIGKILL');
    } catch {
      chrome.kill('SIGKILL');
    }
    server.close();
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
