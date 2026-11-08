/**
 * 0104 (WC-67): статическая проверка исходящих заголовков.
 *
 * c1: в нашем plugin/lib нет ни одного вызова fetch/fetchWithRetry без headers;
 * c2: синтетический вызов без headers ловится;
 * c3: комментарии и объявления функций не считаются нарушениями;
 * c4: проверка видит сетевые файлы, а не пустой список.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scanSource, scanRepo, libFiles } from '../../spec/checks/outgoing-headers.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('c1: репозиторий чист — все исходящие запросы несут headers', () => {
  const problems = scanRepo(repoRoot);
  assert.deepEqual(problems, [], JSON.stringify(problems, null, 2));
});

test('c2: вызов без headers ловится с номером строки', () => {
  const source = 'export async function go(url) {\n  return fetch(url);\n}\n';
  const problems = scanSource(source);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 2);
});

test('c3: комментарии и объявления не нарушения', () => {
  const source = [
    '/* пример: fetch(url) без пайпов */',
    '// fetch(url) в комментарии',
    'export async function fetchWithRetry(fetchImpl, url, options = {}) {',
    '  return fetchImpl(url, { headers: { Accept: "x" } });',
    '}',
  ].join('\n');
  assert.deepEqual(scanSource(source), []);
});

test('c4: проверка видит сетевые файлы', () => {
  const files = libFiles(repoRoot).map((file) => path.basename(file));
  assert.ok(files.includes('fetch-retry.mjs'));
  assert.ok(files.includes('release-source.mjs'));
  assert.ok(files.includes('release-check.mjs'));
});
