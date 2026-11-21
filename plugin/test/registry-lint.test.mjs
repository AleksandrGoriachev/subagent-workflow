/**
 * 0092 / 2.6.90: реестр задач (docs/tasks/REGISTRY.json).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { checkRegistry } = await import('../../spec/scripts/lib/registry.mjs');

function registryFile(tasks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-registry-'));
  const file = path.join(dir, 'REGISTRY.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, tasks }, null, 2) + '\n');
  return file;
}

test('реестр: номер не зарегистрирован — ошибка', () => {
  const file = registryFile([{ id: '0191', subject: 'Другое', status: 'open' }]);
  const result = checkRegistry({ repo: '.', id: '9899', title: 'Работа', registryPath: file });
  assert.equal(result.applicable, true);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /не зарегистрирован/u);
  assert.match(result.problems.join(' '), /REGISTRY/u);
});

test('реестр: чужой subject — ошибка', () => {
  const file = registryFile([{ id: '9899', subject: 'Совсем другой предмет', status: 'open' }]);
  const result = checkRegistry({ repo: '.', id: '9899', title: 'Работа', registryPath: file });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /subject/u);
  assert.match(result.problems.join(' '), /TASK-META\.title/u);
});

test('реестр: совпадающий subject проходит', () => {
  const file = registryFile([{ id: '9899', subject: 'Работа', status: 'open' }]);
  const result = checkRegistry({ repo: '.', id: '9899', title: 'Работа', registryPath: file });
  assert.equal(result.ok, true);
  assert.equal(result.applicable, true);
});

test('реестр: файла нет — проверка не применяется', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-noreg-'));
  const result = checkRegistry({ repo: dir, id: '9899', title: 'Работа' });
  assert.equal(result.applicable, false);
  assert.equal(result.ok, true);
});
