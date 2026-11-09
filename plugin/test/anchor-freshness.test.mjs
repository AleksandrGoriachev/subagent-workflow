/**
 * 0107 (WC-70): свежесть и утверждение якорей.
 *
 * c1: без approval — отказ «якоря не утверждены»;
 * c2: hash approval не совпал с anchors.json — отказ (правка после утверждения);
 * c3: auto старше 14 дней — отказ; semi старше 30 — отказ;
 * c4: релизов после подтверждения больше порога — отказ;
 * c5: inWork в счёт не идёт, но виден в отчёте; валидный набор — OK;
 * c6: версии сравниваются числово (2.6.10 > 2.6.9).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateAnchors,
  compareVersions,
  releasesSince,
  sha256File,
  checkRepo,
  checkSignature,
} from '../../spec/checks/anchor-freshness.mjs';
import { generateKeyPair, signRecord } from '../../spec/scripts/sign.mjs';

const NOW = new Date('2026-11-09T12:00:00Z');

function anchor(id, status, version, date) {
  return { id, claim: 'x', scope: 'workflow', check: 'y', status, confirmed: { version, date }, owner: 'user+coordinator' };
}

function input(list, extra = {}) {
  return {
    anchors: { version: 1, freshness: { auto: { maxAgeDays: 14, maxReleases: 5 }, semi: { maxAgeDays: 30, maxReleases: 10 }, inWork: { maxAgeDays: null, maxReleases: null } }, anchors: list },
    approval: { hash: 'a'.repeat(64) },
    sha: 'a'.repeat(64),
    approvalHash: 'a'.repeat(64),
    now: NOW,
    tags: ['v2.6.58', 'v2.6.59'],
    ...extra,
  };
}

test('c1: без approval — отказ', () => {
  const result = evaluateAnchors(input([anchor('A1', 'auto', '2.6.58', '2026-11-08')], { approval: null, approvalHash: null }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /не утверждены/u.test(p)));
});

test('c2: hash не совпал — отказ', () => {
  const result = evaluateAnchors(input([anchor('A1', 'auto', '2.6.58', '2026-11-08')], { approvalHash: 'b'.repeat(64) }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /hash не совпадает/u.test(p)));
});

test('c3: auto старше 14 дней и semi старше 30 — отказ', () => {
  const result = evaluateAnchors(input([
    anchor('A1', 'auto', '2.6.58', '2026-10-01'),
    anchor('A2', 'semi', '2.6.58', '2026-09-01'),
  ]));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /A1: подтверждение старше 14/u.test(p)));
  assert.ok(result.problems.some((p) => /A2: подтверждение старше 30/u.test(p)));
});

test('c4: релизов после подтверждения больше порога — отказ', () => {
  const tags = ['v2.6.50', 'v2.6.51', 'v2.6.52', 'v2.6.53', 'v2.6.54', 'v2.6.55', 'v2.6.56'];
  const result = evaluateAnchors(input([anchor('A1', 'auto', '2.6.50', '2026-11-08')], { tags }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /A1: после подтверждения вышло 6 релизов/u.test(p)));
});

test('c5: inWork не в счёте, валидный набор — OK', () => {
  const result = evaluateAnchors(input([
    anchor('A1', 'auto', '2.6.58', '2026-11-08'),
    { id: 'A7', claim: 'x', scope: 'workflow', check: 'y', status: 'inWork', confirmed: { version: null, date: null }, owner: 'user+coordinator' },
  ]));
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.ok(result.notes.some((n) => /A7: в работе/u.test(n)));
});

test('c6: версии сравниваются числово, релизы считаются от подтверждения', () => {
  assert.equal(compareVersions('2.6.10', '2.6.9'), 1);
  assert.equal(compareVersions('v2.6.9', '2.6.9'), 0);
  assert.equal(releasesSince(['v2.6.9', 'v2.6.10', 'v2.7.0'], '2.6.9'), 2);
});

test('checkRepo без approval.json сообщает причину, а не падает', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-anchors-'));
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/anchors.json'), JSON.stringify({ version: 1, anchors: [anchor('A1', 'auto', '2.6.58', '2026-11-08')] }));
  const result = checkRepo(dir, { now: NOW, tags: [] });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /не утверждены/u.test(p)));
  assert.equal(sha256File(path.join(dir, 'docs/anchors.json')).length, 64);
});

test('c7: утверждение принимается только с подписью human-ключа', () => {
  const human = generateKeyPair();
  const agent = generateKeyPair();
  const body = { version: 1, anchors: 'docs/anchors.json', algo: 'sha256', hash: 'a'.repeat(64), scope: 'project', by: ['пользователь'], at: '2026-11-09T15:00:00+03:00' };
  const acceptors = [
    { keyId: 'human-user', kind: 'human', publicKeyPem: human.publicKeyPem },
    { keyId: 'agent-judge', kind: 'agent', publicKeyPem: agent.publicKeyPem },
  ];
  const signedHuman = signRecord(body, { privateKeyPem: human.privateKeyPem, keyId: 'human-user' });
  assert.equal(checkSignature(signedHuman, acceptors).ok, true);

  const signedAgent = signRecord(body, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-judge' });
  const byAgent = checkSignature(signedAgent, acceptors);
  assert.equal(byAgent.ok, false);
  assert.match(byAgent.reason, /kind=human/u);

  const forged = { ...signedHuman, hash: 'b'.repeat(64) };
  const result = checkSignature(forged, acceptors);
  assert.equal(result.ok, false);
  assert.match(result.reason, /подпись/u);
});

test('c8: правка anchors.json при старой подписи не проходит (хеш и подпись — оба)', () => {
  const result = evaluateAnchors(input(
    [anchor('A1', 'auto', '2.6.71', '2026-11-09')],
    { acceptors: [{ keyId: 'human-user', kind: 'human', publicKeyPem: 'x' }], approval: { keyId: 'human-user', hash: 'a'.repeat(64) }, sha: 'b'.repeat(64), approvalHash: 'a'.repeat(64) },
  ));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /hash не совпадает/u.test(p)));
});
