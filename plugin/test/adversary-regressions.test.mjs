/**
 * 0143: регрессии по ревью адвоката (10.11).
 *
 * c1: обход через traversal и абсолютный путь — C3/C8 краснеют;
 * c2: смешанные run (доказательства от другого прогона) — C10 fail, вердикт rejected;
 * c3: конфликтные доказательства гейта — C5 fail;
 * c4: пустой объявленный план запрещает любые действия;
 * c5: C9 требует криптографически проверенной подписи (verified), а не префикса ключа.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendFact, factFileOf, readFactFile, pathForbidden, pathMatches, sha256Text } from '../../spec/lib/facts.mjs';
import { evaluateTask } from '../../spec/engine.mjs';

test('c1: traversal и абсолютный путь не проходят', () => {
  assert.equal(pathForbidden('src/../tests/pwn.mjs', ['tests/**']), true);
  assert.equal(pathForbidden('C:/abs/tests/x.mjs', ['tests/**']), true);
  assert.equal(pathForbidden('../../etc/passwd', ['tests/**']), true);
  assert.equal(pathMatches('C:/abs/src/a.js', ['src/**']), false);
  assert.equal(pathMatches('tests/../src/a.js', ['src/**']), true);
});

function facts(ws, options = {}) {
  const file = factFileOf(ws, '0050');
  const run = '0050:1';
  appendFact(file, { kind: 'genesis', task: '0050', contract_hash: 'h', at: 't', writer: 'w' });
  appendFact(file, { kind: 'task', id: '0050', contract_hash: 'h', risk: 'medium', writer: 'w', at: 't' });
  appendFact(file, { kind: 'contract', task: '0050', hash: 'h', criteria: 'c', forbidden: options.forbidden || ['tests/**'], planned: options.planned === undefined ? ['src/**'] : options.planned, plannedDeclared: options.plannedDeclared === undefined ? true : options.plannedDeclared, seal: null, writer: 'w', at: 't' });
  appendFact(file, { kind: 'run', id: run, task: '0050', commit: 'h', ruleset_hash: 'u', command: 'x', writer: 'a' });
  appendFact(file, { kind: 'diff', task: '0050', run, commit: 'h', paths: options.diffPaths || ['src/a.js'], diff_hash: 'd', writer: 'a' });
  if (options.extraRun) appendFact(file, { kind: 'evidence', task: '0050', run: '0050:0', gate: 'verify', artifact_hash: 'old', exit: 0, writer: 'a' });
  appendFact(file, { kind: 'evidence', task: '0050', run, gate: 'red', artifact_hash: 'e1', exit: 0, writer: 'a' });
  const evidenceHashes = ['e1', 'e2'];
  if (options.extraRun) evidenceHashes.push('old');
  if (options.verifyConflict) evidenceHashes.push('e3');
  const manifest = sha256Text([...evidenceHashes].sort().join(','));
  appendFact(file, { kind: 'evidence', task: '0050', run, gate: 'verify', artifact_hash: 'e2', exit: options.verifyExit === undefined ? 0 : options.verifyExit, writer: 'a' });
  if (options.verifyConflict) appendFact(file, { kind: 'evidence', task: '0050', run, gate: 'verify', artifact_hash: 'e3', exit: 1, writer: 'a' });
  if (options.ruleset) {
    appendFact(file, { kind: 'ruleset', version: 1, anchors_hash: 'ah', presets_hash: 'p', seal: 's', policy: {}, signature: { keyId: 'human-user', covers: 'hash+by+at', hash: options.sigHash || 'ah', verified: options.sigVerified === true, reason: 'x' } });
  }
  appendFact(file, { kind: 'judgment', task: '0050', run, artifact_hash: 'd', by: 'j', role: 'judge', model: 'x', verdict: 'accepted', writer: 'a' });
  appendFact(file, { kind: 'accept', task: '0050', run, contract_hash: 'h', diff_hash: 'd', ruleset_hash: 'u', evidence_manifest_hash: manifest, by: 'j', at: 't' });
  return file;
}

test('c2: факты другого run — C10 fail', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-run-'));
  facts(ws, { extraRun: true });
  const result = evaluateTask(readFactFile(factFileOf(ws, '0050')), { signatures: false });
  assert.equal(result.report.find((i) => i.id === 'C10').status, 'fail');
  assert.equal(result.verdict, 'rejected');
});

test('c3: конфликтные доказательства гейта — C5 fail', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-run-'));
  /* ruleset нужен: без политики обязательных гейтов нет, и сравнивать нечего. */
  facts(ws, { verifyConflict: true, ruleset: true, sigVerified: true });
  const result = evaluateTask(readFactFile(factFileOf(ws, '0050')), { signatures: false });
  assert.equal(result.report.find((i) => i.id === 'C5').status, 'fail');
});

test('c4: пустой объявленный план запрещает действия', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-run-'));
  facts(ws, { planned: [] });
  const result = evaluateTask(readFactFile(factFileOf(ws, '0050')), { signatures: false });
  assert.equal(result.report.find((i) => i.id === 'C8').status, 'fail');
  const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-run-'));
  facts(ws2, { plannedDeclared: false });
  const na = evaluateTask(readFactFile(factFileOf(ws2, '0050')), { signatures: false });
  assert.equal(na.report.find((i) => i.id === 'C8').status, 'not-applicable');
});

test('c5: C9 требует проверенной подписи', () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-run-'));
  facts(bad, { ruleset: true, sigVerified: false });
  assert.equal(evaluateTask(readFactFile(factFileOf(bad, '0050')), { signatures: false }).report.find((i) => i.id === 'C9').status, 'fail');
  const good = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-run-'));
  facts(good, { ruleset: true, sigVerified: true });
  assert.equal(evaluateTask(readFactFile(factFileOf(good, '0050')), { signatures: false }).report.find((i) => i.id === 'C9').status, 'pass');
});