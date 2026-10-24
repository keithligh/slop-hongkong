#!/usr/bin/env node
// Digit1 pixel→mesh probe. Serves this repo and opens the chase:
//   index.html?probe=digit1&at=-1.4,29.3,1.29
// The page raycasts the live scene and the harness screenshots the swapchain,
// then again with Henderson hidden, Henderson forced to magenta, and the
// LandsD group hidden. Canvas readback of this WebGPU present is not the
// colour; the screenshot is.
//
//   node tools/digit1-pixel-probe.mjs
//
// Writes tools/digit1-pixel-probe.json (gitignored). hk-3d/ must already be
// on disk. The probe mounts the three buildings the Digit1 rays hit so the
// GPU process can present.

import { createReadStream, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DIGIT1_PROBE_SAMPLES, isMagentaRgb, isPaleRgb, judgeDigit1Premise, ndcToReadPixel } from '../js/digit1-probe-frame.js';

// fileURLToPath keeps the trailing slash of `file:///workspace/`, and a
// startsWith check against that slash plus another separator 403s every file.
export function probeRepoRoot() {
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
}

const root = probeRepoRoot();
const CHROME = process.env.CHROME || 'google-chrome';
const DEFAULT_QUERY = 'probe=digit1&at=-1.4,29.3,1.29';

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

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return '';
  return process.argv[index + 1] || '';
}

function paeth(left, up, ul) {
  const p = left + up - ul;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - ul);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return ul;
}

// Chrome's screenshot is the canvas after the probe restores the page camera.
// It is a second read of the baseline, independent of the in-page render-target path.
export function decodePng(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const chunks = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    offset += 4;
    const type = buf.toString('ascii', offset, offset + 4);
    offset += 4;
    const data = buf.subarray(offset, offset + length);
    offset += length + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') break;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || !channels || !width || !height) {
    throw new Error(`unsupported png ${width}x${height} depth ${bitDepth} type ${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let index = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[index++];
    const row = Buffer.from(raw.subarray(index, index + stride));
    index += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x];
      const ul = x >= channels ? prev[x - channels] : 0;
      let value = row[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, ul);
      row[x] = value & 255;
    }
    prev = row;
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      pixels[dst] = row[src];
      pixels[dst + 1] = row[src + 1];
      pixels[dst + 2] = row[src + 2];
      pixels[dst + 3] = channels === 4 ? row[src + 3] : 255;
    }
  }
  return { width, height, data: pixels };
}

export function applyLiveShot(report, png) {
  const samples = screenshotSamples(png, report?.page?.origin || 'top');
  const varied = new Set(samples.map((sample) => sample.rgb.join(','))).size;
  const bright = samples.some((sample) => sample.rgb.some((channel) => channel > 30));
  report.screenshot = samples;
  report.screenshotVaried = varied;
  if (varied < 2 && !bright) return report;
  for (const sample of report.page?.samples || []) {
    const hit = samples.find((row) => row.ndc[0] === sample.ndc[0] && row.ndc[1] === sample.ndc[1]);
    if (!hit) continue;
    sample.baseline = sample.baseline || {};
    sample.baseline.presented = { rgb: hit.rgb, pale: hit.pale, source: 'screenshot' };
    sample.baseline.lit = { rgb: hit.rgb, pale: hit.pale };
  }
  const judged = judgeDigit1Premise(report);
  report.premise = judged.premise;
  report.painter = judged.painter;
  report.reason = judged.reason;
  report.paleCount = judged.paleCount;
  report.pixels = 'live-screenshot';
  return report;
}

const EXPERIMENT_BUCKET = {
  'hide-henderson': 'hideHenderson',
  'magenta-henderson': 'magentaHenderson',
  'hide-landsd': 'hideLandsd',
  'locked-hide-henderson': 'hideHenderson',
  'locked-magenta-henderson': 'magentaHenderson',
  'locked-hide-landsd': 'hideLandsd'
};

export function applyExperimentShot(report, stage, png) {
  const bucket = EXPERIMENT_BUCKET[stage];
  const view = stage.startsWith('locked-') ? report?.locked : report?.page;
  if (!bucket || !view?.samples) return report;
  const samples = screenshotSamples(png, view.origin || 'top');
  const varied = new Set(samples.map((sample) => sample.rgb.join(','))).size;
  const bright = samples.some((sample) => sample.rgb.some((channel) => channel > 30));
  if (varied < 2 && !bright) return report;
  for (const sample of view.samples) {
    const hit = samples.find((row) => row.ndc[0] === sample.ndc[0] && row.ndc[1] === sample.ndc[1]);
    if (!hit) continue;
    const slot = sample[bucket] || {};
    const magenta = isMagentaRgb(hit.rgb);
    slot.presented = { rgb: hit.rgb, pale: hit.pale, source: 'screenshot' };
    slot.lit = { ...(slot.lit || {}), rgb: hit.rgb, pale: hit.pale, magenta };
    if (bucket === 'magentaHenderson') slot.magenta = magenta;
    sample[bucket] = slot;
  }
  if (view === report.page) {
    const judged = judgeDigit1Premise(report);
    report.premise = judged.premise;
    report.painter = judged.painter;
    report.reason = judged.reason;
    report.paleCount = judged.paleCount;
    report.pixels = 'live-screenshot';
  }
  return report;
}

export function screenshotSamples(png, origin = 'top', samples = DIGIT1_PROBE_SAMPLES) {
  const image = decodePng(png);
  return samples.map(([ndcX, ndcY]) => {
    const pixel = ndcToReadPixel(ndcX, ndcY, image.width, image.height, origin);
    const i = (pixel.y * image.width + pixel.x) * 4;
    const rgb = [image.data[i], image.data[i + 1], image.data[i + 2]];
    return { ndc: [ndcX, ndcY], pixel, rgb, pale: isPaleRgb(rgb) };
  });
}

function contentType(file) {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const decoded = decodeURIComponent(url.pathname);
    const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    let stat;
    try {
      stat = statSync(file);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType(file),
      'Content-Length': stat.size,
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJson(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length) return list;
      }
    } catch {
      // Chrome is still binding the port.
    }
    await sleep(200);
  }
  throw new Error('Chrome DevTools did not open');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const consoleLines = [];
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error(`devtools socket failed ${wsUrl}`)));
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params?.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
      if (text) consoleLines.push(text);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const text = message.params?.exceptionDetails?.text || 'exception';
      consoleLines.push(`EXC ${text}`);
    }
  });
  function send(method, params = {}) {
    const msgId = ++id;
    return new Promise((resolve) => {
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }
  return { ws, opened, send, consoleLines };
}

async function readProbe(session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  let report = null;
  while (Date.now() < deadline && !report) {
    const stageMessage = await session.send('Runtime.evaluate', {
      expression: 'window.__digit1Stage || ""',
      returnByValue: true
    });
    const stage = stageMessage.result?.result?.value || '';
    if (stage && !seen.has(stage)) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const png = shot.result?.data;
      if (png) {
        const bytes = Buffer.from(png, 'base64');
        const shotPath = path.join(root, 'tools', `digit1-pixel-probe-${stage}.png`);
        writeFileSync(shotPath, bytes);
        if (stage === 'live') writeFileSync(path.join(root, 'tools', 'digit1-pixel-probe.png'), bytes);
        console.log(`[digit1-probe] shot ${stage} ${bytes.length} bytes`);
      }
      seen.add(stage);
      await session.send('Runtime.evaluate', {
        expression: `window.__digit1Shot = ${JSON.stringify(stage)}`,
        returnByValue: true
      });
    }
    const message = await session.send('Runtime.evaluate', {
      expression: 'window.__digit1Probe ? JSON.stringify(window.__digit1Probe) : ""',
      returnByValue: true
    });
    const value = message.result?.result?.value;
    if (value) report = JSON.parse(value);
    else await sleep(250);
  }
  if (!report) {
    const errors = await session.send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__digit1BootErrors || [])',
      returnByValue: true
    });
    const boot = errors.result?.result?.value || '[]';
    throw new Error(`probe timed out\nboot ${boot}\nconsole\n${session.consoleLines.slice(-40).join('\n')}`);
  }
  return report;
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
    '--enable-logging=stderr',
    '--log-level=0',
    '--force-device-scale-factor=1',
    '--window-size=1280,720',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=/tmp/digit1-chrome-profile',
    url
  ];
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('node tools/digit1-pixel-probe.mjs [--url URL] [--timeout-ms 720000]');
    return;
  }
  const timeoutMs = Number(argValue('--timeout-ms') || 720000);
  const external = argValue('--url');
  let server = null;
  let pageUrl = external;
  if (!pageUrl) {
    server = await startServer();
    const address = server.address();
    pageUrl = `http://127.0.0.1:${address.port}/index.html?${DEFAULT_QUERY}`;
  }
  const debugPort = 9222;
  console.log(`[digit1-probe] ${pageUrl}`);
  const chromeLog = openSync('/tmp/digit1-chrome.log', 'w');
  const chrome = spawn(CHROME, chromeArgs(debugPort, 'about:blank'), { stdio: ['ignore', 'ignore', chromeLog] });
  let report;
  try {
    const targets = await waitJson(debugPort, 20000);
    const blank = targets.find((target) => target.webSocketDebuggerUrl) || targets[0];
    const session = connect(blank.webSocketDebuggerUrl);
    await session.opened;
    await session.send('Runtime.enable');
    await session.send('Page.enable');
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__digit1BootErrors = [];
        window.addEventListener('error', (event) => window.__digit1BootErrors.push(String(event.message || event.error)));
        window.addEventListener('unhandledrejection', (event) => window.__digit1BootErrors.push(String(event.reason)));`
    });
    await session.send('Page.navigate', { url: pageUrl });
    report = await readProbe(session, timeoutMs);
    const livePath = path.join(root, 'tools', 'digit1-pixel-probe-live.png');
    const liveBytes = existsSync(livePath) ? readFileSync(livePath) : null;
    if (liveBytes) {
      try {
        applyLiveShot(report, liveBytes);
      } catch (err) {
        report.screenshotError = String(err.message || err);
      }
    }
    for (const stage of Object.keys(EXPERIMENT_BUCKET)) {
      const shotPath = path.join(root, 'tools', `digit1-pixel-probe-${stage}.png`);
      if (!existsSync(shotPath)) continue;
      try {
        applyExperimentShot(report, stage, readFileSync(shotPath));
      } catch (err) {
        report[`${stage}Error`] = String(err.message || err);
      }
    }
    if (session.consoleLines.length) {
      const notable = session.consoleLines.filter((line) => /digit1-probe|device lost|limits maxBuffer|createBuffer|Instance dropped/.test(line));
      const shown = notable.length ? notable.slice(-40) : session.consoleLines.slice(-30);
      console.log(`[digit1-probe] console\n${shown.join('\n')}`);
    }
    session.ws.close();
  } finally {
    chrome.kill('SIGKILL');
    if (server) server.close();
  }
  const out = path.join(root, 'tools', 'digit1-pixel-probe.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[digit1-probe] ${report.premise} ${report.painter}`);
  console.log(`[digit1-probe] ${report.reason || ''}`);
  console.log(`[digit1-probe] wrote ${out}`);
  if (!existsSync(path.join(root, 'hk-3d', '11-SW-9C', 'manifest.json'))) {
    console.log('[digit1-probe] hk-3d manifest missing; this run did not include LandsD meshes');
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
