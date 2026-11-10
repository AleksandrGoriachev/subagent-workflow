/**
 * 0145: подпись фактов-решений.
 *
 * c1: подпись ставится и проверяется; правка после подписи ломается;
 * c2: перенос факта (другой prev) ломается;
 * c3: чужой ключ не проходит;
 * c4: движок отвергает неподписанное доказательство (C10).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendFact, factFileOf, readFactFile, signFact, verifyFactSignature, sha256Text } from '../../spec/lib/facts.mjs';
import { evaluateTask } from '../../spec/engine.mjs';

const KEY = path.join(os.homedir(), '.wf-keys', 'subagent-workflow-v2', 'agent-facts.key.pem');
const hasKey = fs.existsSync(KEY);

test('c1: подпись ставится, правка ломает', { skip: !hasKey }, () => {
  const pem = fs.readFileSync(KEY, 'utf8');
  const publicKeyPem = crypto.createPublicKey(crypto.createPrivateKey(pem)).export({ type: 'spki', format: 'pem' });
  const row = { kind: 'evidence', task: 't', run: 't:1', gate: 'red', artifact_hash: 'h', exit: 0, prev: 'p' };
  const signed = signFact(row, 'agent-facts', pem);
  assert.equal(verifyFactSignature(signed, publicKeyPem), true);
  assert.equal(verifyFactSignature({ ...signed, exit: 1 }, publicKeyPem), false);
});

test('c2: другой prev ломает подпись', { skip: !hasKey }, () => {
  const pem = fs.readFileSync(KEY, 'utf8');
  const publicKeyPem = crypto.createPublicKey(crypto.createPrivateKey(pem)).export({ type: 'spki', format: 'pem' });
  const signed = signFact({ kind: 'evidence', task: 't', run: 't:1', gate: 'red', artifact_hash: 'h', exit: 0, prev: 'p' }, 'agent-facts', pem);
  assert.equal(verifyFactSignature({ ...signed, prev: 'other' }, publicKeyPem), false);
});

test('c3: чужой ключ не проходит', { skip: !hasKey }, () => {
  const pem = fs.readFileSync(KEY, 'utf8');
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  const signed = signFact({ kind: 'evidence', task: 't', run: 't:1', gate: 'red', artifact_hash: 'h', exit: 0, prev: 'p' }, 'agent-facts', pem);
  assert.equal(verifyFactSignature(signed, other), false);
});

function facts(ws, sign) {
  const file = factFileOf(ws, '0050');
  const run = '0050:1';
  const pem = sign ? fs.readFileSync(KEY, 'utf8') : null;
  const request = pem ? { keyId: 'agent-facts', privateKeyPem: pem } : null;
  const runRow = (row) => (request ? { ...row, signRequest: request } : row);
  appendFact(file, { kind: 'genesis', task: '0050', contract_hash: 'h', at: 't', writer: 'w' });
  appendFact(file, { kind: 'task', id: '0050', contract_hash: 'h', risk: 'medium', writer: 'w', at: 't' });
  appendFact(file, { kind: 'contract', task: '0050', hash: 'h', criteria: 'c', forbidden: [], planned: ['src/**'], plannedDeclared: true, seal: null, writer: 'w', at: 't' });
  appendFact(file, { kind: 'run', id: run, task: '0050', commit: 'h', ruleset_hash: 'u', command: 'x', writer: 'a' });
  appendFact(file, { kind: 'diff', task: '0050', run, commit: 'h', paths: ['src/a.js'], diff_hash: 'd', writer: 'a' });
  appendFact(file, runRow({ kind: 'evidence', task: '0050', run, gate: 'red', artifact_hash: 'e1', exit: 0, writer: 'a' }));
  appendFact(file, runRow({ kind: 'evidence', task: '0050', run, gate: 'verify', artifact_hash: 'e2', exit: 0, writer: 'a' }));
  appendFact(file, runRow({ kind: 'judgment', task: '0050', run, artifact_hash: 'd', by: 'j', role: 'judge', model: 'x', verdict: 'accepted', writer: 'a' }));
  appendFact(file, runRow({ kind: 'accept', task: '0050', run, contract_hash: 'h', diff_hash: 'd', ruleset_hash: 'u', evidence_manifest_hash: sha256Text(['e1', 'e2'].sort().join(',')), by: 'j', at: 't' }));
  return file;
}

test('c4: движок отвергает неподписанное доказательство', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-sign-'));
  facts(ws, false);
  const read = readFactFile(factFileOf(ws, '0050'));
  const result = evaluateTask(read, { acceptors: [] });
  assert.equal(result.report.find((i) => i.id === 'C10').status, 'fail');
  assert.equal(result.verdict, 'rejected');
});