/*
 * 0112 (2.6.99): решение об отборе проверки.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { decide } = await import('../../tools/check-tests.mjs');

test('check-tests: изменения плагина — полный набор', () => {
  const result = decide(['plugin/lib/api.js']);
  assert.equal(result.mode, 'full');
});

test('check-tests: изменение теста плагина — полный набор', () => {
  assert.equal(decide(['plugin/test/task-monitor.test.mjs']).mode, 'full');
});

test('check-tests: движок — affected', () => {
  assert.equal(decide(['spec/scripts/task-verify.mjs', 'docs/tasks/0001/task.md']).mode, 'affected');
});

test('check-tests: только документация — selftest', () => {
  const result = decide(['docs/tasks/0001/verify.json', '.dsh/workflow/tasks.json']);
  assert.equal(result.mode, 'selftest');
});

test('check-tests: инструмент — affected, файл плагина сильнее', () => {
  assert.equal(decide(['tools/check-tests.mjs']).mode, 'affected');
  assert.equal(decide(['tools/check-tests.mjs', 'plugin/lib/client.js']).mode, 'full');
});
