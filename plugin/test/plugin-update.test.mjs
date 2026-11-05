/**
 * 0079 (WC-52): обновление самого плагина из релиза.
 *
 * Проверяем исполнением: выбор ассетов релиза, разбор tarball, отказ для
 * link-установки, замену каталога с бэкапом и живой маршрут
 * POST /workflow/api/plugin-update на временном каталоге пакета.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createWorkflowRuntime, createWebHandler } from '../lib/api.js';
import {
  selectPluginAssets,
  readPluginFiles,
  pluginInstallMode,
  installPluginFiles,
} from '../lib/plugin-update.mjs';

/* Минимальный ustar-архив: без процессов и пайпов, как в archive.mjs. */
function tarEntry(name, text) {
  const data = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8');
  header.write('0000000\0', 108, 8, 'utf8');
  header.write('0000000\0', 116, 8, 'utf8');
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf8');
  header.write('00000000000\0', 136, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8');
  header.write('0', 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

function makeTgz(files) {
  const parts = [];
  for (const [name, text] of Object.entries(files)) parts.push(tarEntry(name, text));
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeInstalledPlugin(dir, version) {
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-workflow-console', version }) + '\n');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export const marker = "old";\n');
}

test('selectPluginAssets: стабильный tarball и его .sha256', () => {
  const release = {
    tag_name: 'v0.9.99',
    assets: [
      { name: 'dsh-workflow-console.tgz', browser_download_url: 'https://x/tgz' },
      { name: 'dsh-workflow-console.tgz.sha256', browser_download_url: 'https://x/sha' },
    ],
  };
  assert.deepEqual(selectPluginAssets(release), {
    version: '0.9.99',
    tag: 'v0.9.99',
    tarballUrl: 'https://x/tgz',
    sha256Url: 'https://x/sha',
  });
  assert.throws(() => selectPluginAssets({ tag_name: 'v1.0.0', assets: [] }), /нет ассета/u);
});

test('readPluginFiles: срезает верхний каталог и читает версию', () => {
  const tgz = makeTgz({
    'package/package.json': JSON.stringify({ name: 'dsh-workflow-console', version: '0.9.99' }),
    'package/lib/index.js': 'export {};\n',
  });
  const { files, version } = readPluginFiles(tgz);
  assert.equal(version, '0.9.99');
  assert.ok(files.has('package.json'));
  assert.ok(files.has('lib/index.js'));
});

test('installPluginFiles: заменяет каталог и сохраняет прежний', () => {
  const parent = tempDir('wf-plugin-install-');
  const root = path.join(parent, 'dsh-workflow-console');
  writeInstalledPlugin(root, '0.9.0');
  const tgz = makeTgz({
    'package/package.json': JSON.stringify({ name: 'dsh-workflow-console', version: '0.9.99' }),
    'package/lib/index.js': 'export const marker = "new";\n',
  });
  const { files, version } = readPluginFiles(tgz);
  const { backupDir } = installPluginFiles({ files, packageRoot: root, version, now: 1 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, '0.9.99');
  assert.match(fs.readFileSync(path.join(root, 'lib', 'index.js'), 'utf8'), /new/u);
  assert.ok(fs.existsSync(path.join(backupDir, 'lib', 'index.js')), 'бэкап содержит прежний файл');
  assert.match(fs.readFileSync(path.join(backupDir, 'package.json'), 'utf8'), /0\.9\.0/u);
  fs.rmSync(parent, { recursive: true, force: true });
});

test('pluginInstallMode: каталог — dir, ссылка — linked, пусто — missing', () => {
  const parent = tempDir('wf-plugin-mode-');
  const real = path.join(parent, 'real');
  writeInstalledPlugin(real, '0.9.0');
  assert.equal(pluginInstallMode(real).mode, 'dir');
  assert.equal(pluginInstallMode(path.join(parent, 'absent')).mode, 'missing');
  const link = path.join(parent, 'linked');
  fs.symlinkSync(real, link, 'junction');
  const linked = pluginInstallMode(link);
  assert.equal(linked.mode, 'linked');
  assert.match(linked.hint, /рабочим деревом/u);
  fs.rmSync(parent, { recursive: true, force: true });
});

async function call(handler, url, options = {}) {
  const listeners = { data: [], end: [], error: [] };
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  const request = {
    method: options.method || 'GET',
    url,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return request;
    },
  };
  const response = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(value) { this.body = value === undefined ? '' : String(value); this.writableEnded = true; },
  };
  queueMicrotask(() => {
    if (body !== null) for (const fn of listeners.data) fn(Buffer.from(body, 'utf8'));
    for (const fn of listeners.end) fn();
  });
  await handler(request, response);
  let json = null;
  try { json = JSON.parse(response.body); } catch { json = null; }
  return { status: response.statusCode, json };
}

test('POST /api/plugin-update: ставит пакет из локального tarball', async () => {
  const parent = tempDir('wf-plugin-route-');
  const root = path.join(parent, 'dsh-workflow-console');
  writeInstalledPlugin(root, '0.9.0');
  const tgzPath = path.join(parent, 'dsh-workflow-console.tgz');
  fs.writeFileSync(tgzPath, makeTgz({
    'package/package.json': JSON.stringify({ name: 'dsh-workflow-console', version: '0.9.99' }),
    'package/lib/index.js': 'export const marker = "new";\n',
  }));
  const runtime = createWorkflowRuntime(
    { roots: [parent], pluginUpdateFile: tgzPath },
    { pluginRoot: root },
  );
  const handler = createWebHandler(runtime);

  const noConfirm = await call(handler, '/workflow/api/plugin-update', { method: 'POST', body: {} });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.json.code, 'confirm-required');

  const ok = await call(handler, '/workflow/api/plugin-update', { method: 'POST', body: { confirm: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.to, '0.9.99');
  assert.equal(ok.json.restartRequired, true);
  assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /0\.9\.99/u);
  fs.rmSync(parent, { recursive: true, force: true });
});

test('POST /api/plugin-update: link-установка отклоняется', async () => {
  const parent = tempDir('wf-plugin-link-');
  const real = path.join(parent, 'real');
  writeInstalledPlugin(real, '0.9.0');
  const link = path.join(parent, 'linked');
  fs.symlinkSync(real, link, 'junction');
  const runtime = createWorkflowRuntime({ roots: [parent] }, { pluginRoot: link });
  const handler = createWebHandler(runtime);
  const response = await call(handler, '/workflow/api/plugin-update', { method: 'POST', body: { confirm: true } });
  assert.equal(response.status, 409);
  assert.equal(response.json.code, 'plugin-dev-install');
  assert.match(response.json.hint, /рабочим деревом/u);
  fs.rmSync(parent, { recursive: true, force: true });
});
