/**
 * 0108 (WC-74): квитанция приёмки в релизе, один путь публикации.
 *
 * c1: статическая часть пропускает release-publish.mjs и ловит любой другой
 *     скрипт с draft:false;
 * c2: hasReceipt видит SMOKE-<tag>.json и не видит обычные ассеты;
 * c3: онлайн-часть отмечает релиз без квитанции как обход;
 * c4: draft-релизы в проверке не считаются (они ещё не опубликованы).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanPublishers, hasReceipt, checkReleases } from '../../spec/checks/release-receipt.mjs';

test('c1: только release-publish.mjs вправе публиковать', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-receipt-'));
  fs.writeFileSync(path.join(dir, 'release-publish.mjs'), 'const x = { draft: false };');
  fs.writeFileSync(path.join(dir, 'release-draft.mjs'), 'const y = { draft: true };');
  fs.writeFileSync(path.join(dir, 'legacy-publish.mjs'), 'const z = { draft: false };');
  const problems = scanPublishers(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0].file, /legacy-publish/u);
});

test('c2: hasReceipt видит квитанцию и не путается с обычными ассетами', () => {
  assert.equal(hasReceipt({ assets: [{ name: 'dsh-workflow-console.tgz' }] }), false);
  assert.equal(hasReceipt({ assets: [{ name: 'SMOKE-v2.6.61.json' }] }), true);
  assert.equal(hasReceipt({}), false);
});

function fakeFetch(releases) {
  return async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Buffer.from(JSON.stringify(releases), 'utf8'),
  });
}

test('c3: релиз без квитанции — обход; с квитанцией — ок', async () => {
  const bad = await checkReleases({ fetchImpl: fakeFetch([{ tag_name: 'v1', draft: false, assets: [{ name: 'a.tgz' }] }]), token: 't' });
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0], /без SMOKE-/u);
  const good = await checkReleases({ fetchImpl: fakeFetch([{ tag_name: 'v2', draft: false, assets: [{ name: 'SMOKE-v2.json' }] }]), token: 't' });
  assert.equal(good.ok, true);
});

test('c5: релиз до появления квитанции — история (warn), а не нарушение', async () => {
  const result = await checkReleases({
    fetchImpl: fakeFetch([
      { tag_name: 'v2.6.60', draft: false, assets: [{ name: 'a.tgz' }] },
      { tag_name: 'v2.6.61', draft: false, assets: [{ name: 'SMOKE-v2.6.61.json' }] },
      { tag_name: 'v2.6.62', draft: false, assets: [{ name: 'a.tgz' }] },
    ]),
    token: 't',
  });
  assert.equal(result.ok, false);
  assert.equal(result.cutoff, 'v2.6.61');
  assert.ok(result.warnings.some((w) => /v2.6.60/u.test(w)));
  assert.ok(result.problems.some((p) => /v2.6.62/u.test(p)));
});

test('c4: черновики не считаются опубликованными', async () => {
  const result = await checkReleases({ fetchImpl: fakeFetch([{ tag_name: 'v3', draft: true, assets: [] }]), token: 't' });
  assert.equal(result.ok, true);
  assert.equal(result.checked.length, 0);
});