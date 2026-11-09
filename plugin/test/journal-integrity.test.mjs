/**
 * 0109 (WC-75): журнал ворот с хеш-цепочкой и запрет обхода на защищённых путях.
 *
 * c1: цепочка валидна для новых записей (appendGateRecord ставит prev);
 * c2: удаление строки из середины ломает цепочку — проверка это видит;
 * c3: правка вердикта в строке ломает цепочку;
 * c4: журнал без единой записи с prev — история (legacy), не нарушение;
 * c5: метка обхода не действует на защищённые пути (lib/, checks/, spec/, tools/, structure/);
 * c6: метка обхода на документации допустима.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendGateRecord, verifyChain, chainTip } from '../../spec/scripts/lib/common.mjs';
import { bypassDecision, touchesProtected, checkJournals } from '../../spec/checks/journal-integrity.mjs';
import { bypassViolation } from '../../spec/scripts/task-guard.mjs';

function tempJournal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-journal-'));
  return path.join(dir, 'gates.jsonl');
}

test('c1: новые записи образуют цепочку', () => {
  const file = tempJournal();
  appendGateRecord(file, { kind: 'red', task: '0001', verdict: 'red-proven' });
  appendGateRecord(file, { kind: 'verify', task: '0001', verdict: 'passed' });
  appendGateRecord(file, { kind: 'accept', task: '0001', verdict: 'accepted' });
  const result = verifyChain(file);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.lines, 3);
  assert.equal(chainTip(file).length, 64);
});

test('c2: удаление строки ломает цепочку', () => {
  const file = tempJournal();
  appendGateRecord(file, { kind: 'red', task: '0001', verdict: 'red-proven' });
  appendGateRecord(file, { kind: 'verify', task: '0001', verdict: 'passed' });
  appendGateRecord(file, { kind: 'accept', task: '0001', verdict: 'accepted' });
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(file, [lines[0], lines[2]].join('\n') + '\n');
  const result = verifyChain(file);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /разорвана|нет prev/u.test(p)));
});

test('c3: правка вердикта ломает цепочку', () => {
  const file = tempJournal();
  appendGateRecord(file, { kind: 'red', task: '0001', verdict: 'red-proven' });
  appendGateRecord(file, { kind: 'accept', task: '0001', verdict: 'accepted' });
  const text = fs.readFileSync(file, 'utf8').replace('"accepted"', '"rejected"');
  fs.writeFileSync(file, text);
  const result = verifyChain(file);
  assert.equal(result.ok, false);
});

test('c4: журнал без prev — история', () => {
  const file = tempJournal();
  fs.writeFileSync(file, JSON.stringify({ at: '2026-11-01T00:00:00Z', kind: 'red', task: '0001', verdict: 'x' }) + '\n');
  const result = verifyChain(file);
  assert.equal(result.ok, true);
  assert.equal(result.legacy, true);
  const dir = path.dirname(path.dirname(path.dirname(file)));
  fs.mkdirSync(path.join(dir, 'docs', 'tasks', '0001'), { recursive: true });
  fs.copyFileSync(file, path.join(dir, 'docs', 'tasks', '0001', 'gates.jsonl'));
  const repo = checkJournals(dir);
  assert.equal(repo.ok, true);
  assert.equal(repo.legacy, 1);
});

test('c5: метка обхода не действует на защищённые пути', () => {
  const decision = bypassDecision('release: 2.6.60 [workflow-bypass: выпуск версии]', ['lib/api.js', 'docs/README.md']);
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /защищённые пути/u);
  assert.deepEqual(touchesProtected(['spec/checks/x.mjs', 'docs/note.md']), ['spec/checks/x.mjs']);
});

test('c6: метка обхода на документации допустима', () => {
  const decision = bypassDecision('docs: заметка [workflow-bypass: документация]', ['docs/note.md', 'plugin/BACKLOG.md']);
  assert.equal(decision.ok, true);
  assert.equal(decision.bypass, true);
});

test('c7: guard отвергает метку обхода на защищённых путях', () => {
  assert.equal(bypassViolation(['lib/a.js']).ok, false);
  assert.equal(bypassViolation(['spec/checks/x.mjs']).ok, false);
  assert.equal(bypassViolation(['plugin/test/a.test.mjs']).ok, false);
  assert.equal(bypassViolation(['docs/note.md', 'plugin/BACKLOG.md']).ok, true);
});
