#!/usr/bin/env node
// One Des Voeux eye-east frame after the loading overlay drops.
//   node tools/digit1-eye-shot.mjs artifacts/eye-east.png
//   node tools/digit1-eye-shot.mjs artifacts/eye-east.png --query 'at=-1.4,29.3,1.29&landsdAniso=1'

import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHROME = process.env.CHROME || 'google-chrome';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return '';
  return process.argv[index + 1] || '';
}

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
    '--force-device-scale-factor=1',
    '--window-size=1280,720',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=/tmp/digit1-eye-chrome',
    'about:blank'
  ];
}

async function main() {
  const dest = path.resolve(root, process.argv[2] || 'artifacts/eye-east.png');
  const query = argValue('--query') || 'at=-1.4,29.3,1.29';
  const server = await startServer();
  const pageUrl = `http://127.0.0.1:${server.address().port}/index.html?${query}`;
  const chrome = spawn(CHROME, chromeArgs(9224), { stdio: 'ignore' });
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
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
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
    const deadline = Date.now() + 240000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      const message = await send('Runtime.evaluate', {
        expression: `(() => {
          const overlay = document.getElementById('loading-overlay');
          const gone = !overlay || overlay.classList.contains('hidden');
          return gone ? 'ready' : '';
        })()`,
        returnByValue: true
      });
      ready = message.result?.result?.value === 'ready';
      if (!ready) await sleep(400);
    }
    if (!ready) throw new Error('eye frame did not leave the loading overlay');
    await sleep(1500);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(shot.result.data, 'base64');
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, png);
    console.log(`[eye] ${png.length} bytes ${dest}`);
  } finally {
    chrome.kill('SIGKILL');
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
