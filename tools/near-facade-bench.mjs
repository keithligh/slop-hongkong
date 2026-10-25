#!/usr/bin/env node
// Oblique shop-chart bench for the Digit1 near-field sampler.
//   node tools/near-facade-bench.mjs
// Writes tools/near-facade-bench-*.png and prints mid-band energy.
// linear = a one-tap sample. near = the retired two-level chain.
// full = a generated mip chain. The shipped chase sampler is the chart pack in hk-gltf.js.

import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng } from './digit1-pixel-probe.mjs';
import { facadeEnergy } from './digit1-facade-energy.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHROME = process.env.CHROME || 'google-chrome';
const MODES = ['linear', 'near', 'full'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png'
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'tools/near-facade-bench.html';
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const stat = statSync(file);
      if (!stat.isFile()) throw new Error('dir');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function chromeArgs(port, url) {
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
    '--force-device-scale-factor=1',
    '--window-size=960,540',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=/tmp/near-facade-chrome',
    url
  ];
}

async function waitJson(port) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length) return list;
      }
    } catch {
      // Chrome is still binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Chrome DevTools did not open');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error(`devtools ${wsUrl}`)));
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  function send(method, params = {}) {
    const msgId = ++id;
    return new Promise((resolve) => {
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }
  return { opened, send };
}

async function shot(session, pageUrl) {
  await session.send('Page.navigate', { url: pageUrl });
  const deadline = Date.now() + 90000;
  let info = null;
  while (Date.now() < deadline && !info) {
    const message = await session.send('Runtime.evaluate', {
      expression: 'window.__benchReady ? JSON.stringify(window.__benchReady) : ""',
      returnByValue: true
    });
    const value = message.result?.result?.value;
    if (value) info = JSON.parse(value);
    else await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!info) throw new Error(`bench timed out ${pageUrl}`);
  const shot = await session.send('Page.captureScreenshot', { format: 'png' });
  return { info, png: Buffer.from(shot.result.data, 'base64') };
}

async function main() {
  const server = await startServer();
  const address = server.address();
  const port = 9333;
  const chrome = spawn(CHROME, chromeArgs(port, 'about:blank'), { stdio: 'ignore' });
  const outDir = path.join(root, 'artifacts');
  mkdirSync(outDir, { recursive: true });
  try {
    const targets = await waitJson(port);
    const blank = targets.find((target) => target.webSocketDebuggerUrl) || targets[0];
    const session = connect(blank.webSocketDebuggerUrl);
    await session.opened;
    await session.send('Runtime.enable');
    await session.send('Page.enable');
    const rows = [];
    for (const mode of MODES) {
      const pageUrl = `http://127.0.0.1:${address.port}/tools/near-facade-bench.html?mode=${mode}`;
      const { info, png } = await shot(session, pageUrl);
      const file = path.join(outDir, `near-facade-${mode}.png`);
      writeFileSync(file, png);
      const image = decodePng(png);
      const energy = facadeEnergy(image, {
        x0: Math.round(image.width * 0.08),
        y0: Math.round(image.height * 0.12),
        x1: Math.round(image.width * 0.92),
        y1: Math.round(image.height * 0.88)
      });
      rows.push({ mode, file, info, ...energy });
      console.log(`[bench] ${mode} energy ${energy.energy.toFixed(2)} mean ${energy.mean.toFixed(1)} aniso ${info.anisotropy} levels ${info.levels} chain ${info.nearChain} limit ${info.limit}`);
    }
    writeFileSync(path.join(outDir, 'near-facade-energy.json'), `${JSON.stringify(rows, null, 2)}\n`);
  } finally {
    chrome.kill();
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
