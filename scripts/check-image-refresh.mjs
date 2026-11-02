// 使用真实 Rust 服务和 libvips，保留两端浏览器缓存验证同尺寸替图。
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, unlink, utimes } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { createOriginals } from './create-e2e-originals.mjs';

const engine = process.argv[2] || 'chromium';
assert(['chromium', 'webkit'].includes(engine), '浏览器仅支持 chromium 或 webkit');
const binary = process.env.E2E_NATIVE_BINARY;
assert(binary, '缺少 E2E_NATIVE_BINARY');
const vips = process.env.VIPS_BIN || 'vips';
const base = resolve('tmp/image-refresh-check', engine);
await mkdir(base, { recursive: true });
const root = await mkdtemp(join(base, 'originals-'));
const logs = [], errors = [], requests = [];
const report = { browser: engine, checks: {}, pixels: {}, versions: [] };
let native, preview, browser;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
function launch(command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', error => logs.push(String(error)));
  child.stdout.on('data', bytes => logs.push(String(bytes)));
  child.stderr.on('data', bytes => logs.push(String(bytes)));
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill(); await exited;
}
async function until(check, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  let detail = '';
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch (error) { detail = String(error); }
    await pause(100);
  }
  throw Error(`${label}超时${detail ? `：${detail}` : ''}\n${logs.slice(-8).join('')}`);
}
async function start() {
  native = launch(resolve(binary), [root, vips, '127.0.0.1:1421', '8787']);
  return until(async () => {
    if (native.exitCode !== null) throw Error(`原生服务已退出：${native.exitCode}`);
    const response = await fetch('http://127.0.0.1:1421/catalog');
    return response.ok ? response.json() : false;
  }, '等待原生目录');
}
function colorImage(file, width, height, color) {
  const blank = join(root, '.color-blank.v'), tinted = join(root, '.color-tinted.v');
  execFileSync(vips, ['black', blank, String(width), String(height), '--bands', '3']);
  execFileSync(vips, ['linear', blank, tinted, '1', color.join(' ')]);
  execFileSync(vips, ['cast', tinted, file, 'uchar']);
}
async function original(file, width, height, color, time) {
  colorImage(file, width, height, color);
  const bytes = await readFile(file);
  // 固定字节数和时间，避免尺寸或文件长度变化掩盖版本键遗漏。
  assert(bytes.length < 65536);
  const padded = Buffer.alloc(65536); bytes.copy(padded);
  await writeFile(file, padded); await utimes(file, time, time);
  return hash(file);
}
async function painted(page, pageId, color) {
  return until(async () => {
    const pixel = await page.locator(`.map-stage[data-page="${pageId}"] canvas`).evaluateAll((canvases, pageId) => {
      const canvas = canvases[pageId === 'comparison' ? 1 : 0];
      if (!canvas || !canvas.width || !canvas.height) return null;
      const context = canvas.getContext('2d');
      return context ? Array.from(context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data) : null;
    }, pageId);
    return pixel && pixel[3] >= 250 && color.every((value, index) => Math.abs(value - pixel[index]) < 12) ? pixel : false;
  }, `验证 ${pageId} 的原图颜色 ${color.join(',')}`);
}
try {
  const untouched = await createOriginals(root, vips);
  const oldTime = new Date('2026-10-01T00:00:00Z'), newTime = new Date('2026-10-02T00:00:00Z');
  const comparison = join(root, '左屏', '2.png'), map = join(root, '图1.jpg');
  let comparisonHash = await original(comparison, 800, 440, [220, 30, 30], oldTime);
  let mapHash = await original(map, 1600, 1000, [220, 30, 30], oldTime);
  const before = await start(); report.versions.push(before.locations[0].images[1].version);
  preview = launch(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '1440', '--strictPort']);
  await until(async () => (await fetch('http://127.0.0.1:1440')).ok, '启动浏览器预览');
  browser = await (engine === 'webkit' ? webkit : chromium).launch(engine === 'chromium' && process.env.E2E_CHROMIUM_EXECUTABLE ? { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE } : {});
  const display = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const ipad = await browser.newPage({ viewport: { width: 1194, height: 834 }, isMobile: true, hasTouch: true });
  const pages = [['display', display], ['ipad', ipad]];
  for (const [name, page] of pages) {
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    page.on('request', request => { if (request.url().includes('/zoomify/')) requests.push({ name, url: request.url() }); });
  }
  await ipad.addInitScript(() => localStorage.setItem('exhibition-connection-v2', JSON.stringify({ ip: '127.0.0.1' })));
  await display.goto('http://127.0.0.1:1440/?role=display');
  await ipad.goto('http://127.0.0.1:1440/?role=controller');
  const colors = async (step, pageId, color) => {
    report.pixels[step] = {};
    for (const [name, page] of pages) {
      report.pixels[step][name] = await painted(page, pageId, color);
      await page.screenshot({ path: join(base, `${step}-${name}.png`) });
    }
  };
  await colors('initial-comparison', 'comparison', [220, 30, 30]);
  await ipad.getByRole('button', { name: '图1', exact: true }).click();
  await colors('initial-map', 'map-1', [220, 30, 30]);
  assert.equal(await hash(comparison), comparisonHash); assert.equal(await hash(map), mapHash);

  await stop(native);
  comparisonHash = await original(comparison, 800, 440, [30, 30, 220], newTime);
  mapHash = await original(map, 1600, 1000, [30, 30, 220], newTime);
  const changed = await start(); report.versions.push(changed.locations[0].images[1].version);
  assert.notEqual(before.maps[0].version, changed.maps[0].version);
  assert.notEqual(before.locations[0].images[1].version, changed.locations[0].images[1].version);
  await colors('same-name-map', 'map-1', [30, 30, 220]);
  await ipad.getByRole('region', { name: '地图操作面板' }).getByRole('button', { name: '返回', exact: true }).click();
  await colors('same-name-comparison', 'comparison', [30, 30, 220]);
  report.checks.sameNameSameSizeReplacement = true;

  await stop(native); await unlink(comparison);
  const renamed = join(root, '左屏', '2.jpg');
  comparisonHash = await original(renamed, 800, 440, [30, 210, 60], newTime);
  const extended = await start(); report.versions.push(extended.locations[0].images[1].version);
  assert.notEqual(changed.locations[0].images[1].version, extended.locations[0].images[1].version, '更换扩展名时客户端版本也必须变化');
  await colors('changed-extension-comparison', 'comparison', [30, 210, 60]);
  report.checks.changedExtensionWithSameSizeAndTime = true;
  assert.equal(await hash(renamed), comparisonHash); assert.equal(await hash(map), mapHash);
  for (const source of untouched.filter(item => item.file !== comparison && item.file !== map)) assert.equal(await hash(source.file), source.sha256);
  report.checks.originalsUnchanged = true;
  for (const [name] of pages) {
    assert(requests.some(request => request.name === name && new URL(request.url).searchParams.get('v') === extended.locations[0].images[1].version), `${name} 未请求最新版本瓦片`);
  }
  assert.deepEqual(errors, []);
  report.checks.sameBrowserAndCacheKept = true; report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.error = String(error.stack || error); throw error; }
finally {
  if (browser) await browser.close();
  await stop(native); await stop(preview);
  await writeFile(join(base, 'result.json'), JSON.stringify({ ...report, errors, requests }, null, 2));
  await writeFile(join(base, 'server.log'), logs.join(''));
}
