/**
 * 0136 (P0): тесты схемы фактов.
 *
 * c1: валидная цепь (генезис + факты) проходит;
 * c2: разрыв цепи (подмена строки) — отказ;
 * c3: неизвестный kind / недостающие поля — отказ схемы;
 * c4: appendFact строит цепь и отказывает без генезиса;
 * c5: normalizePath — регистр и слеши (C3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendFact, factFileOf, normalizePath, readFactFile, validateFact, verifyFactChain } from '../../spec/lib/facts.mjs';

function tempTask() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-facts-'));
  const file = factFileOf(ws, '0042');
  return { ws, file };
}

test('c1: цепь с генезисом и фактами проходит', () => {
  const { file } = tempTask();
  appendFact(file, { kind: 'genesis', task: '0042', contract_hash: 'h1', at: '2026-11-10T00:00:00Z', writer: 'workflow' });
  appendFact(file, { kind: 'task', id: '0042', contract_hash: 'h1', risk: 'normal', writer: 'workflow', at: '2026-11-10T00:00:01Z' });
  const read = readFactFile(file);
  assert.equal(read.ok, true, read.problems.join('; '));
  assert.equal(read.rows.length, 2);
});

test('c2: разрыв цепи — отказ', () => {
  const { file } = tempTask();
  appendFact(file, { kind: 'genesis', task: '0042', contract_hash: 'h1', at: '2026-11-10T00:00:00Z', writer: 'workflow' });
  appendFact(file, { kind: 'task', id: '0042', contract_hash: 'h1', risk: 'normal', writer: 'workflow', at: '2026-11-10T00:00:01Z' });
  /* Атака: переписали первую строку, не тронув prev у второй — цепь обязана заметить. */
  const rows = readFactFile(file).rows;
  rows[0] = { ...rows[0], line: JSON.stringify({ ...rows[0], at: 'подмена' }) };
  const chain = verifyFactChain(rows);
  assert.equal(chain.ok, false);
  assert.match(chain.problems.join(' '), /prev не сходится/u);
});

test('c3: схема отклоняет неизвестный вид и неполную запись', () => {
  assert.equal(validateFact({ kind: 'opinion' }).ok, false);
  assert.equal(validateFact({ kind: 'evidence', task: 'x' }).ok, false);
  assert.match(validateFact({ kind: 'evidence', task: 'x' }).problem, /нет полей/u);
});

test('c4: appendFact без генезиса отказывает', () => {
  const { file } = tempTask();
  assert.throws(() => appendFact(file, { kind: 'task', id: '0042', contract_hash: 'h1', risk: 'normal', writer: 'workflow', at: 'x' }), /genesis/u);
});

test('c5: нормализация путей для C3', () => {
  assert.equal(normalizePath('\\Plugin\\Lib\\API.JS'), 'plugin/lib/api.js');
  assert.equal(normalizePath('./Tools\\Release.mjs'), 'tools/release.mjs');
  assert.equal(normalizePath('Plugin\\LIB\\Api.js'), normalizePath('plugin/lib/api.js'));
});