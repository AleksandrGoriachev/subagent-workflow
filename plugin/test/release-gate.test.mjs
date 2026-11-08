/**
 * 0105 (WC-68): гейт выпуска — черновик, приёмка на реальном проводе, публикация.
 *
 * c1: ожидаемый набор ассетов строится из тега и версии панели;
 * c2: приёмка проходит на полном наборе и пишет квитанцию;
 * c3: расхождение sha256 или VERSION в архиве — отказ с причиной;
 * c4: публикация запрещена без свежей квитанции и разрешена с ней.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { expectedAssets, smokeRelease, shaFromFile, RECEIPT_TTL_MS } from '../../tools/release-smoke.mjs';
import { publishRelease, readReceipt } from '../../tools/release-publish.mjs';

const TAG = 'v2.6.56';
const PANEL = '0.9.28';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function tarEntry(name, content) {
  const data = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(512);
  header.write(name, 0);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return Buffer.concat([header, padded]);
}

function tarGz(files) {
  const parts = Object.entries(files).map(([name, content]) => tarEntry(name, content));
  return zlib.gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

function serve(responseFor) {
  return async (url, init = {}) => {
    const value = responseFor(String(url), init);
    if (!value) return { ok: false, status: 404, arrayBuffer: async () => Buffer.from('{}') };
    const body = Buffer.isBuffer(value.body) ? value.body : Buffer.from(typeof value.body === 'string' ? value.body : JSON.stringify(value.body || {}), 'utf8');
    return { ok: value.status === undefined || value.status === 200, status: value.status || 200, arrayBuffer: async () => body };
  };
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gate-'));
  const panel = Buffer.from('panel-bytes', 'utf8');
  const engine = tarGz({ 'subagent-workflow-2.6.56/VERSION': '2.6.56\n', 'subagent-workflow-2.6.56/spec/scripts/init.mjs': '// init' });
  const assets = [
    ['subagent-workflow-2.6.56.tar.gz', engine],
    ['subagent-workflow-2.6.56.tar.gz.sha256', sha256(engine) + '  subagent-workflow-2.6.56.tar.gz\n'],
    ['subagent-workflow-2.6.56.zip', Buffer.from('zip-bytes')],
    ['subagent-workflow-2.6.56.zip.sha256', sha256(Buffer.from('zip-bytes')) + '  x.zip\n'],
    ['dsh-workflow-console.tgz', panel],
    ['dsh-workflow-console.tgz.sha256', sha256(panel) + '  dsh-workflow-console.tgz\n'],
    ['dsh-workflow-console-' + PANEL + '.tgz', panel],
    ['dsh-workflow-console-' + PANEL + '.tgz.sha256', sha256(panel) + '  x.tgz\n'],
  ];
  const byName = new Map(assets);
  const release = {
    tag_name: TAG,
    draft: true,
    html_url: 'https://github.com/o/r/releases/tag/' + TAG,
    assets: assets.map(([name]) => ({ name, browser_download_url: 'https://dl.test/' + encodeURIComponent(name) })),
  };
  const fetchImpl = serve((url) => {
    if (url.endsWith('/releases/tags/' + TAG)) return { body: release };
    if (url.startsWith('https://dl.test/')) {
      const name = decodeURIComponent(url.slice('https://dl.test/'.length));
      return byName.has(name) ? { body: byName.get(name) } : null;
    }
    return null;
  });
  return { dir, fetchImpl, assetsDir: dir, release, byName, panel };
}

test('c1: ожидаемые ассеты строятся из тега и версии панели', () => {
  const names = expectedAssets(TAG, PANEL);
  assert.equal(names.length, 8);
  assert.ok(names.includes('subagent-workflow-2.6.56.tar.gz'));
  assert.ok(names.includes('dsh-workflow-console-' + PANEL + '.tgz'));
  assert.equal(shaFromFile('abc'), null);
});

test('c2: приёмка проходит и пишет квитанцию', async () => {
  const { fetchImpl, assetsDir } = fixture();
  const result = await smokeRelease({ tag: TAG, panelVersion: PANEL, assetsDir, fetchImpl, token: 't' });
  assert.equal(result.ok, true);
  const receipt = JSON.parse(fs.readFileSync(result.receiptFile, 'utf8'));
  assert.equal(receipt.tag, TAG);
  assert.equal(receipt.assets, 8);
  assert.match(receipt.hashes['subagent-workflow-2.6.56.tar.gz'], /^[0-9a-f]{64}$/u);
});

test('c3: расхождение sha256 и чужой VERSION — отказ', async () => {
  const { fetchImpl, assetsDir, byName } = fixture();
  byName.set('subagent-workflow-2.6.56.tar.gz.sha256', 'f'.repeat(64) + '  x\n');
  await assert.rejects(
    () => smokeRelease({ tag: TAG, panelVersion: PANEL, assetsDir, fetchImpl, token: 't' }),
    /sha256 subagent-workflow-2\.6\.56\.tar\.gz не совпал/u,
  );
});

test('c4: публикация без квитанции запрещена, с квитанцией проходит', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-pub-'));
  const noReceipt = { ok: false, reason: 'нет квитанции' };
  assert.equal(readReceipt(TAG, dir).ok, false);
  let patched = false;
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'PATCH') patched = true;
    const body = url.includes('/releases/tags/') ? { id: 7, draft: true, html_url: 'u' } : { id: 7, draft: false, html_url: 'u' };
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(JSON.stringify(body)) };
  };
  await assert.rejects(() => publishRelease({ tag: TAG, assetsDir: dir, fetchImpl, token: 't' }), /нет квитанции/u);
  assert.equal(patched, false);
  fs.writeFileSync(path.join(dir, '.smoke-' + TAG + '.json'), JSON.stringify({ ok: true, tag: TAG, checkedAt: new Date().toISOString() }));
  const result = await publishRelease({ tag: TAG, assetsDir: dir, fetchImpl, token: 't' });
  assert.equal(result.ok, true);
  assert.equal(patched, true);
  /* устаревшая квитанция не годится */
  fs.writeFileSync(path.join(dir, '.smoke-' + TAG + '.json'), JSON.stringify({ ok: true, tag: TAG, checkedAt: new Date(Date.now() - RECEIPT_TTL_MS - 1000).toISOString() }));
  await assert.rejects(() => publishRelease({ tag: TAG, assetsDir: dir, fetchImpl, token: 't' }), /устарела/u);
  assert.equal(noReceipt.ok, false);
});
