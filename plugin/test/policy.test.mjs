/**
 * 0137 (P1): тесты политики гейтов (C5).
 *
 * c1: low/medium — red+verify обязательны, attack/modelFamily нет;
 * c2: high при policy.attack=fail и modelFamily=fail — добавляются оба;
 * c3: high при attack=off — attack не обязателен (инвариант: явное понижение);
 * c4: evaluateGates — недостающий гейт краснеет, покрытый проходит;
 * c5: нет ruleset — not-applicable, а не поддельный pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mandatoryGates, evaluateGates } from '../../spec/lib/policy.mjs';

test('c1: low и medium — база red+verify', () => {
  assert.deepEqual(mandatoryGates(null, 'low'), ['red', 'verify']);
  assert.deepEqual(mandatoryGates({}, 'medium'), ['red', 'verify']);
});

test('c2: high при fail — attack и modelFamily добавляются', () => {
  const ruleset = { policy: { attack: 'fail', roles: { modelFamily: 'fail' } } };
  const gates = mandatoryGates(ruleset, 'high');
  assert.ok(gates.includes('red'));
  assert.ok(gates.includes('verify'));
  assert.ok(gates.includes('attack'));
  assert.ok(gates.includes('modelFamily'));
});

test('c3: high при attack=off — attack не обязателен', () => {
  const ruleset = { policy: { attack: 'off', roles: { modelFamily: 'warn' } } };
  const gates = mandatoryGates(ruleset, 'high');
  assert.ok(!gates.includes('attack'));
  assert.ok(!gates.includes('modelFamily'));
  assert.deepEqual(gates, ['red', 'verify']);
});

test('c4: evaluateGates — недостающий гейт fail, покрытый pass', () => {
  const evidence = [
    { gate: 'red', exit: 0 },
    { gate: 'verify', exit: 0 },
  ];
  const good = evaluateGates(evidence, ['red', 'verify'], true);
  assert.equal(good.status, 'pass');
  const bad = evaluateGates(evidence, ['red', 'verify', 'attack'], true);
  assert.equal(bad.status, 'fail');
  assert.deepEqual(bad.missing, ['attack']);
  const failedGate = evaluateGates([{ gate: 'red', exit: 1 }], ['red', 'verify'], true);
  assert.equal(failedGate.status, 'fail');
  assert.deepEqual(failedGate.missing, ['red', 'verify']);
});

test('c5: нет ruleset — not-applicable', () => {
  const result = evaluateGates([], ['red', 'verify'], false);
  assert.equal(result.status, 'not-applicable');
});