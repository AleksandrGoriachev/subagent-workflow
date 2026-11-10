/**
 * 0156: сводка теневых прогонов.
 *
 * c1: собирает отчёты и считает совпадения;
 * c2: расхождение видно и код выхода ненулевой (через summarize);
 * c3: битый отчёт не валит сводку, а помечается ошибкой.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectShadow, summarize } from '../../spec/scripts/engine-shadow-summary.mjs';

function fixture(rows) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-shadow-'));
  for (const [task, data] of Object.entries(rows)) {
    const dir = path.join(ws, 'docs', 'tasks', task);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'engine-shadow.json'), typeof data === 'string' ? data : JSON.stringify(data));
  }
  return ws;
}

test('c1: сводка собирает отчёты и считает совпадения', () => {
  const ws = fixture({
    '0001': { engineVerdict: 'accepted', acceptanceStatus: 'accepted', agree: true, report: [] },
    '0002': { engineVerdict: 'accepted', acceptanceStatus: 'accepted', agree: true, report: [] },
  });
  const collected = collectShadow(ws);
  const summary = summarize(collected.rows);
  assert.equal(summary.checked, 2);
  assert.equal(summary.agree, 2);
  assert.equal(summary.disagree.length, 0);
});

test('c2: расхождение видно и названо по ограничению', () => {
  const ws = fixture({
    '0001': { engineVerdict: 'rejected', acceptanceStatus: 'accepted', agree: false, report: [{ id: 'C5', status: 'fail' }] },
  });
  const summary = summarize(collectShadow(ws).rows);
  assert.equal(summary.disagree.length, 1);
  assert.deepEqual(summary.byConstraint, [['C5', 1]]);
});

test('c3: битый отчёт помечается ошибкой, сводка не падает', () => {
  const ws = fixture({ '0001': '{не json' });
  const collected = collectShadow(ws);
  assert.equal(collected.ok, true);
  assert.ok(collected.rows[0].error);
});