/*
 * 0108 (2.6.97): redExpect.noRed — осознанный отказ от красного для low.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { evaluateRedExpectation } = await import('../../spec/scripts/lib/common.mjs');

const green = [{ id: 'C1', passed: true }];

test('noRed: пустой mustFail + причина + risk=low — ok и причина', () => {
  const result = evaluateRedExpectation({ mustFail: [], mustPass: ['C1'], noRed: { reason: 'e2e smoke существующего сценария' } }, green, { risk: 'low' });
  assert.equal(result.ok, true, String(result.errors));
  assert.equal(result.noRed && result.noRed.reason, 'e2e smoke существующего сценария');
});

test('noRed: risk=medium — отказ, подсказка про low', () => {
  const result = evaluateRedExpectation({ mustFail: [], mustPass: ['C1'], noRed: { reason: 'e2e smoke' } }, green, { risk: 'medium' });
  assert.equal(result.ok, false);
  assert.match(String(result.errors), /risk=low/u);
  assert.equal(result.noRed, null);
});

test('noRed: пустой mustFail без причины — прежний отказ', () => {
  const result = evaluateRedExpectation({ mustFail: [], mustPass: ['C1'] }, green, { risk: 'low' });
  assert.equal(result.ok, false);
  assert.match(String(result.errors), /mustFail пуст/u);
});

test('noRed: обычный красный не задет', () => {
  const failed = [{ id: 'C1', passed: false, stdout: 'boom', stderr: '' }];
  const result = evaluateRedExpectation({ mustFail: ['C1'], mustPass: [], reasons: { C1: 'boom' } }, failed, { risk: 'medium' });
  assert.equal(result.ok, true);
  assert.equal(result.noRed, null);
});
