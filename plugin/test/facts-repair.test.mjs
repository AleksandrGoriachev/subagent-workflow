/**
 * 0160: починка и пересборка фактов.
 *
 * c1: битый хвост отрезается в карантин;
 * c2: разрыв в середине файла не «чинится»;
 * c3: подписанная строка не уходит в карантин;
 * c4: пересборка отказывает, если есть подписанный sealed-факт.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendFact, factFileOf } from '../../spec/lib/facts.mjs';
import { repairFactsFile, rebuildAll } from '../../spec/scripts/facts-repair.mjs';

function base(ws, task) {
  const file = factFileOf(ws, task);
  appendFact(file, { kind: 'genesis', task, contract_hash: 'h', at: 't', writer: 'converter' });
  appendFact(file, { kind: 'task', id: task, contract_hash: 'h', risk: 'medium', writer: 'workflow', at: 't' });
  return file;
}

test('c1: битый хвост уходит в карантин', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rep-'));
  const file = base(ws, '0100');
  fs.appendFileSync(file, '{"битый":');
  const result = repairFactsFile(file);
  assert.equal(result.ok, true, (result.problems || []).join('; '));
  assert.equal(result.quarantined, 1);
  assert.ok(fs.existsSync(result.quarantineFile));
});

test('c2: разрыв в середине не чинится', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rep-'));
  const file = base(ws, '0101');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  lines.splice(1, 0, 'мусор в середине');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const result = repairFactsFile(file);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /середине/u);
});

test('c3: подписанная строка не уходит в карантин', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rep-'));
  const file = base(ws, '0102');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const fake = JSON.stringify({ kind: 'evidence', task: '0102', run: '0102:1', gate: 'sealed', artifact_hash: 'x', exit: 1, writer: 'acceptor', signature: { algo: 'ed25519', covers: 'fact', value: 'x' } });
  fs.writeFileSync(file, lines.join('\n') + '\n' + fake + '\n');
  const result = repairFactsFile(file);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /подписанная/u);
});

test('c4: пересборка отказывает при подписанном sealed', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rep-'));
  fs.mkdirSync(path.join(ws, 'docs', 'tasks', '0103'), { recursive: true });
  const file = base(ws, '0103');
  appendFact(file, { kind: 'evidence', task: '0103', run: '0103:1', gate: 'sealed', artifact_hash: 'x', exit: 0, writer: 'acceptor', signature: { algo: 'ed25519', covers: 'fact', value: 'x' } });
  const result = rebuildAll(ws, {});
  assert.equal(result.ok, false);
  assert.ok(result.failed.some((item) => /sealed/u.test((item.problems || []).join(' '))));
});