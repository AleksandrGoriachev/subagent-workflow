/**
 * 0111 (WC-77): утверждение якорей из панели DSH.
 *
 * c1: состояние без approval — «не утверждены», с причиной;
 * c2: подпись человеческим ключом пишет approval.json, статус становится approved;
 * c3: агентский ключ отклоняется (утверждает только человек);
 * c4: правка anchors.json после подписи ломает утверждение (хеш не сходится);
 * c5: нет ключа на диске — понятная ошибка, а не падение.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anchorsStatus, approveAnchors, hashFile } from '../lib/anchors.js';
import { generateKeyPair, signRecord } from '../../spec/scripts/sign.mjs';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-anchors-ui-'));
  const docs = path.join(root, 'subagent-workflow-v2', 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'anchors.json'), JSON.stringify({ version: 1, anchors: [{ id: 'A1', claim: 'x', scope: 'workflow', check: 'y', status: 'auto', confirmed: { version: '2.6.64', date: '2026-11-09' }, owner: 'user+coordinator' }] }));
  const keys = path.join(root, 'keys');
  fs.mkdirSync(keys, { recursive: true });
  const human = generateKeyPair();
  const agent = generateKeyPair();
  fs.writeFileSync(path.join(keys, 'human-user.key.pem'), human.privateKeyPem);
  fs.writeFileSync(path.join(keys, 'agent.key.pem'), agent.privateKeyPem);
  fs.mkdirSync(path.join(root, 'docs', 'subagent-workflow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'subagent-workflow', 'acceptors.json'), JSON.stringify({
    acceptors: [
      { keyId: 'human-user', kind: 'human', publicKeyPem: human.publicKeyPem },
      { keyId: 'agent-judge', kind: 'agent', publicKeyPem: agent.publicKeyPem },
    ],
  }));
  return { root, keys, human, agent };
}

function configOf(parts, overrides = {}) {
  return {
    anchors: {
      file: path.join(parts.root, 'subagent-workflow-v2', 'docs', 'anchors.json'),
      approval: path.join(parts.root, 'subagent-workflow-v2', 'docs', 'anchors.approval.json'),
      keyFile: path.join(parts.keys, 'human-user.key.pem'),
      keyId: 'human-user',
      acceptors: path.join(parts.root, 'docs', 'subagent-workflow', 'acceptors.json'),
      scope: 'project',
      ...overrides,
    },
  };
}

test('c1: без утверждения статус — не утверждены', () => {
  const parts = makeRoot();
  const status = anchorsStatus(parts.root, configOf(parts));
  assert.equal(status.ok, true);
  assert.equal(status.approved, false);
  assert.ok(status.problems[0].includes('не утверждены'));
});

test('c2: подпись человеческим ключом утверждает якоря', () => {
  const parts = makeRoot();
  const config = configOf(parts);
  const result = approveAnchors(parts.root, config);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const status = anchorsStatus(parts.root, config);
  assert.equal(status.approved, true);
  assert.equal(status.keyId, 'human-user');
  assert.equal(status.hash, hashFile(path.join(parts.root, 'subagent-workflow-v2', 'docs', 'anchors.json')));
});

test('c3: агентский ключ не может утвердить якоря', () => {
  const parts = makeRoot();
  const config = configOf(parts, { keyFile: path.join(parts.keys, 'agent.key.pem'), keyId: 'agent-judge' });
  const result = approveAnchors(parts.root, config);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /только человек/u);
});

test('c4: правка якорей после подписи ломает утверждение', () => {
  const parts = makeRoot();
  const config = configOf(parts);
  assert.equal(approveAnchors(parts.root, config).ok, true);
  const file = path.join(parts.root, 'subagent-workflow-v2', 'docs', 'anchors.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.anchors[0].claim = 'правка после утверждения';
  fs.writeFileSync(file, JSON.stringify(data));
  const status = anchorsStatus(parts.root, config);
  assert.equal(status.approved, false);
  assert.ok(status.problems.join(' ').includes('хеш'));
});

test('c6: подпись движка (sign.mjs) принимается панелью — один канон', () => {
  const parts = makeRoot();
  const config = configOf(parts);
  const file = path.join(parts.root, 'subagent-workflow-v2', 'docs', 'anchors.json');
  const body = {
    version: 1,
    anchors: 'docs/anchors.json',
    algo: 'sha256',
    hash: hashFile(file),
    bytes: fs.statSync(file).size,
    scope: 'project',
    by: ['пользователь'],
    at: '2026-11-09T16:00:00.000Z',
  };
  const signed = signRecord(body, { privateKeyPem: parts.human.privateKeyPem, keyId: 'human-user' });
  fs.writeFileSync(path.join(parts.root, 'subagent-workflow-v2', 'docs', 'anchors.approval.json'), JSON.stringify(signed, null, 2));
  const status = anchorsStatus(parts.root, config);
  assert.equal(status.approved, true, JSON.stringify(status.problems));
});

test('c5: без ключа — понятная ошибка', () => {
  const parts = makeRoot();
  const config = configOf(parts, { keyFile: path.join(parts.keys, 'нет-такого.pem') });
  const result = approveAnchors(parts.root, config);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /нет человеческого ключа/u);
});
