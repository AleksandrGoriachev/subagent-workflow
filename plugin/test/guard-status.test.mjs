/**
 * 0194: причина отсутствия tools.guard называется машиной.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { guardStatusOf } = await import('../lib/index.js');

test('guard зарегистрирован — cause registered', () => {
  const status = guardStatusOf({ policy: 'fail', registration: { guard: true, guardError: null, preExecute: true } });
  assert.deepEqual(status, { registered: true, cause: 'registered', error: null });
});

test('ошибка inject — cause inject-missing, причина сохранена', () => {
  const status = guardStatusOf({
    policy: 'fail',
    registration: { guard: false, guardError: 'cannot get property "tools" without inject', preExecute: true },
  });
  assert.equal(status.registered, false);
  assert.equal(status.cause, 'inject-missing');
  assert.match(status.error, /without inject/u);
});

test('политика off — cause policy-off, а не inject', () => {
  const status = guardStatusOf({ policy: 'off', registration: { guard: false, guardError: null, preExecute: false } });
  assert.deepEqual(status, { registered: false, cause: 'policy-off', error: null });
});

test('другая ошибка — cause error', () => {
  const status = guardStatusOf({ policy: 'fail', registration: { guard: false, guardError: 'guard is not a function', preExecute: true } });
  assert.equal(status.cause, 'error');
});

test('не пытались и не off — cause not-registered', () => {
  const status = guardStatusOf({ policy: 'warn', registration: { guard: false, guardError: null } });
  assert.equal(status.cause, 'not-registered');
});
