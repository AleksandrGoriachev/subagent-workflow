/**
 * 0128: проектный слой якорей — валидация и пустой слой.
 *
 * c1: файла нет — не отказ, но сказано вслух;
 * c2: корректный проектный якорь проходит;
 * c3: layer/enforcedBy/check/status проверяются;
 * c4: дубль формулировки ловится нормализацией;
 * c5: proof обязателен, потолок 15, истёкший срок — предупреждение;
 * c6: файл без LF в конце — отказ (канон хеша).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateProjectAnchors, checkProject } from '../../spec/checks/anchor-freshness.mjs';

function anchor(overrides = {}) {
  return {
    id: 'P1',
    claim: 'Правка не ломает сборку',
    layer: 'project',
    enforcedBy: 'nodes',
    check: 'plugin-test',
    proof: { command: 'node --test', artifact: 'test.log' },
    status: 'auto',
    confirmed: { date: '2026-11-01' },
    ...overrides,
  };
}

function rootWith(list, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-proj-anchors-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const text = options.raw !== undefined ? options.raw : JSON.stringify({ version: 2, anchors: list });
  fs.writeFileSync(path.join(root, 'docs', 'anchors.json'), text);
  if (options.approval) fs.writeFileSync(path.join(root, 'docs', 'anchors.approval.json'), JSON.stringify(options.approval));
  return root;
}

test('c1: пустой слой — не отказ, но предупреждение', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-proj-empty-'));
  const result = checkProject(root);
  assert.equal(result.ok, true);
  assert.match(result.warnings.join(' '), /не заданы/u);
  fs.rmSync(root, { recursive: true, force: true });
});

test('c2: корректный проектный якорь проходит', () => {
  const result = evaluateProjectAnchors({ list: [anchor()], approval: null, sha: null, approvalHash: null, acceptors: null });
  assert.equal(result.ok, false, 'без подписи — отказ');
  assert.match(result.problems.join(' '), /approval/u);
  const signed = evaluateProjectAnchors({ list: [anchor()], approval: { hash: 'x' }, sha: 'x', approvalHash: 'x', acceptors: null });
  assert.equal(signed.ok, true, signed.problems.join('; '));
});

test('c3: layer, enforcedBy, check и статус проверяются', () => {
  const result = evaluateProjectAnchors({
    list: [anchor({ layer: 'contour', enforcedBy: 'engine', check: 'codegen', status: 'whatever' })],
    approval: { hash: 'x' }, sha: 'x', approvalHash: 'x', acceptors: null,
  });
  const text = result.problems.join(' ');
  assert.match(text, /layer должен быть project/u);
  assert.match(text, /enforcedBy/u);
  assert.match(text, /check должен быть/u);
  assert.match(text, /статус должен быть/u);
});

test('c4: дубль формулировки ловится нормализацией', () => {
  const result = evaluateProjectAnchors({
    list: [anchor(), anchor({ id: 'P2', claim: '  Правка НЕ ломает сборку!  ' })],
    approval: { hash: 'x' }, sha: 'x', approvalHash: 'x', acceptors: null,
  });
  assert.match(result.problems.join(' '), /дубль формулировки/u);
});

test('c5: proof, потолок и истёкший срок', () => {
  const list = Array.from({ length: 16 }, (_, index) => anchor({ id: 'P' + (index + 1), claim: 'Правило ' + index }));
  const many = evaluateProjectAnchors({ list, approval: { hash: 'x' }, sha: 'x', approvalHash: 'x', acceptors: null });
  assert.match(many.problems.join(' '), /больше 15/u);
  const noProof = evaluateProjectAnchors({ list: [anchor({ proof: null })], approval: { hash: 'x' }, sha: 'x', approvalHash: 'x', acceptors: null });
  assert.match(noProof.problems.join(' '), /proof/u);
  const expired = evaluateProjectAnchors({ list: [anchor({ expiresAt: '2020-01-01' })], approval: { hash: 'x' }, sha: 'x', approvalHash: 'x', acceptors: null });
  assert.match(expired.warnings.join(' '), /срок действия истёк/u);
});

test('c6: файл без LF в конце — отказ по канону', () => {
  const root = rootWith([anchor()], { raw: JSON.stringify({ version: 2, anchors: [anchor()] }) });
  const result = checkProject(root);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /переводом строки/u);
  fs.rmSync(root, { recursive: true, force: true });
});
