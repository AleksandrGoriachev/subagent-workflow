/**
 * 0112 (WC-78): один вход для выпуска и безопасная уборка черновиков.
 *
 * c1: preflight ловит несовпадение VERSION и отсутствие ассетов;
 * c2: preflight проходит на согласованной версии;
 * c3: cleanup по умолчанию ничего не удаляет (dry-run);
 * c4: cleanup отказывается удалять черновик с ассетами без --force;
 * c5: cleanup отказывается удалять опубликованный релиз;
 * c6: cleanup требует --id, если по тегу несколько релизов.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { preflight, expectedNames, cleanupDraft } from '../../tools/release.mjs';

function fakeRepo(version, withAssets = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rel-'));
  fs.writeFileSync(path.join(root, 'VERSION'), version + '\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version, dshPanelVersion: '0.9.27' }));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  if (withAssets) {
    for (const name of expectedNames(version, '0.9.27')) fs.writeFileSync(path.join(root, 'dist', name), 'x');
  }
  return root;
}

function fakeFetch(list) {
  return async () => ({ ok: true, status: 200, json: async () => list, arrayBuffer: async () => Buffer.from('[]') });
}

test('c1: preflight ловит чужую версию и отсутствие ассетов', () => {
  const root = fakeRepo('2.6.60');
  const result = preflight('2.6.61', { root });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /VERSION/u.test(p)));
  assert.ok(result.missing.includes('subagent-workflow-2.6.61.tar.gz'));
});

test('c2: preflight проходит на согласованных ассетах', () => {
  const root = fakeRepo('2.6.66', true);
  const result = preflight('2.6.66', { root });
  assert.equal(result.ok, true);
  assert.equal(result.missing.length, 0);
});

test('c3: cleanup по умолчанию только сообщает о плане', async () => {
  const result = await cleanupDraft({ tag: 'v1', fetchImpl: fakeFetch([{ id: 7, tag_name: 'v1', draft: true, assets: [] }]) });
  assert.equal(result.ok, true);
  assert.equal(result.action, 'would-delete');
});

test('c4: черновик с ассетами без --force не удаляется', async () => {
  const result = await cleanupDraft({ tag: 'v1', apply: true, fetchImpl: fakeFetch([{ id: 7, tag_name: 'v1', draft: true, assets: [{ name: 'a' }] }]) });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /--force/u);
});

test('c5: опубликованный релиз уборка не трогает', async () => {
  const result = await cleanupDraft({ tag: 'v1', apply: true, force: true, fetchImpl: fakeFetch([{ id: 7, tag_name: 'v1', draft: false, assets: [] }]) });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /опубликован/u);
});

test('c6: несколько релизов по тегу — нужен --id', async () => {
  const list = [{ id: 1, tag_name: 'v1', draft: true, assets: [] }, { id: 2, tag_name: 'v1', draft: true, assets: [] }];
  const result = await cleanupDraft({ tag: 'v1', fetchImpl: fakeFetch(list) });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /--id/u);
});

/*
 * 0230: c2 проходил только потому, что в фейковом корне нет spec/. Проверка
 * квитанций там пропускается — но не должна пропускаться молча везде: если
 * инструмент в корне есть и отказывает, preflight обязан упасть. Иначе фикс
 * «нет скрипта — не проверяем» стал бы способом выключить гейт.
 */
test('c7: preflight проверяет квитанции, когда инструмент есть в корне', () => {
  const root = fakeRepo('2.6.66', true);
  fs.mkdirSync(path.join(root, 'spec', 'checks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'spec', 'checks', 'release-receipt.mjs'),
    "console.error('RELEASE-RECEIPT ERROR: релиз без SMOKE'); process.exit(1);\n",
  );
  const result = preflight('2.6.66', { root });
  assert.equal(result.ok, false);
  assert.equal(result.receipts, 'checked');
  assert.ok(result.problems.some((problem) => /release-receipt/u.test(problem)));
});

test('c8: preflight без инструмента квитанций не выдумывает проверку', () => {
  const root = fakeRepo('2.6.66', true);
  const result = preflight('2.6.66', { root });
  assert.equal(result.receipts, 'skipped');
  assert.equal(result.ok, true);
});
