/**
 * 0088 / 2.6.88: границы цикла узла.
 *
 * Закрывает три дефекта, видимые в журналах хоста: повтор одного и того же
 * вызова после отказа (до 80 раз в сессии), отсутствие бюджета узла (ход на
 * 2.5 часа) и отказ сторожа без готового маршрута (агент импровизирует).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.WF_WAITS_DIR = path.join(os.tmpdir(), 'wf-guard-router-waits-' + process.pid);

const { registerWaitGuard, resetGuardMemory } = await import('../lib/wait-guard.js');

const ROOT = path.join(os.tmpdir(), 'wf-guard-router-root-' + process.pid);
const SESSION = { id: 'session-router-test' };

function listeners() {
  const registered = [];
  return {
    registered,
    ctx: {
      on(event, handler) { registered.push({ event, handler }); },
      tools: { guard(handler) { registered.push({ event: 'guard', handler }); } },
    },
  };
}
function pre(registered) {
  return registered.find((entry) => entry.event === 'tools/pre-execute');
}
const call = (command, extra = {}) => ({ name: 'pwsh', arguments: { command }, agent: { session: SESSION }, ...extra });
const LONG = 'Start-Sleep -Seconds 61';

test('повтор: третий одинаковый вызов после отказа блокируется маршрутом', async () => {
  resetGuardMemory();
  const { ctx, registered } = listeners();
  registerWaitGuard(ctx, { roots: [ROOT] });
  const handler = pre(registered).handler;

  const first = await handler(call(LONG), async () => ({ kind: 'allow' }));
  const second = await handler(call(LONG), async () => ({ kind: 'allow' }));
  const third = await handler(call(LONG), async () => ({ kind: 'allow' }));

  assert.equal(first.kind, 'deny');
  assert.equal(second.kind, 'deny');
  assert.equal(third.kind, 'deny');
  assert.match(third.reason, /повтор/u);
  assert.match(third.reason, /job\.mjs start/u);
});

test('бюджет: остаток меньше запрошенного ожидания — требуется промежуточная сдача', async () => {
  resetGuardMemory();
  const { ctx, registered } = listeners();
  const start = 1_000_000;
  let now = start;
  registerWaitGuard(ctx, { roots: [ROOT], enforcement: { nodeBudgetMs: 60000 } }, { now: () => now });
  const handler = pre(registered).handler;

  /* Первый вызов задаёт начало узла и отклоняется обычной политикой W1. */
  const first = await handler(call('Start-Sleep -Seconds 61'), async () => ({ kind: 'allow' }));
  assert.equal(first.kind, 'deny');

  /* Прошло 90 с при бюджете 60 с — второй (другой) вызов требует сдачи. */
  now = start + 90000;
  const second = await handler(call(LONG), async () => ({ kind: 'allow' }));
  assert.equal(second.kind, 'deny');
  assert.match(second.reason, /промежуточн/u);
});

test('маршрут: отказ называет готовую команду сторожа', async () => {
  resetGuardMemory();
  const { ctx, registered } = listeners();
  registerWaitGuard(ctx, { roots: [ROOT] });
  const decision = await pre(registered).handler(call(LONG), async () => ({ kind: 'allow' }));
  assert.equal(decision.kind, 'deny');
  assert.match(decision.reason, /job\.mjs start/u);
  assert.match(decision.reason, /job\.mjs"\)? wait|job\.mjs.+wait/u);
});
