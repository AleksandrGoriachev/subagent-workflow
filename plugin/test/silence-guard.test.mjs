/**
 * 0090 / 2.6.89: стоп по тишине вместо часового бюджета.
 *
 * Работающий узел не режется по длительности. Признак зависания — отсутствие
 * событий: если между вызовами прошло больше enforcement.silenceMs, следующее
 * долгое ожидание отклоняется с требованием промежуточной сдачи. Короткие
 * вызовы проходят даже после тишины.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.WF_WAITS_DIR = path.join(os.tmpdir(), 'wf-silence-waits-' + process.pid);

const { registerWaitGuard, resetGuardMemory, DEFAULT_SILENCE_MS } = await import('../lib/wait-guard.js');

const ROOT = path.join(os.tmpdir(), 'wf-silence-root-' + process.pid);
const SESSION = { id: 'session-silence-test' };
const LONG = 'Start-Sleep -Seconds 61';

function listeners() {
  const registered = [];
  return {
    registered,
    ctx: { on(event, handler) { registered.push({ event, handler }); } },
  };
}
const pre = (registered) => registered.find((entry) => entry.event === 'tools/pre-execute').handler;
const call = (command) => ({ name: 'pwsh', arguments: { command }, agent: { session: SESSION } });

test('тишина: после разрыва долгое ожидание отклоняется с требованием сдачи', async () => {
  resetGuardMemory();
  const { ctx, registered } = listeners();
  const start = 2_000_000;
  let now = start;
  registerWaitGuard(ctx, { roots: [ROOT] }, { now: () => now });
  const handler = pre(registered);

  const first = await handler(call('Start-Sleep -Seconds 61'), async () => ({ kind: 'allow' }));
  assert.equal(first.kind, 'deny', 'первый долгий вызов — обычная политика W1');

  now = start + 11 * 60 * 1000;
  const silent = await handler(call('Start-Sleep -Seconds 62'), async () => ({ kind: 'allow' }));
  assert.equal(silent.kind, 'deny');
  assert.match(silent.reason, /тишина/u);
  assert.match(silent.reason, /промежуточн/u);
});

test('тишина: короткий вызов после разрыва проходит', async () => {
  resetGuardMemory();
  const { ctx, registered } = listeners();
  const start = 3_000_000;
  let now = start;
  registerWaitGuard(ctx, { roots: [ROOT] }, { now: () => now });
  const handler = pre(registered);

  await handler(call('Write-Output ok'), async () => ({ kind: 'allow' }));
  now = start + 30 * 60 * 1000;
  const short = await handler(call('Write-Output again'), async () => ({ kind: 'allow' }));
  assert.deepEqual(short, { kind: 'allow' });
});

test('тишина: silenceMs=0 отключает проверку', async () => {
  resetGuardMemory();
  const { ctx, registered } = listeners();
  const start = 4_000_000;
  let now = start;
  registerWaitGuard(ctx, { roots: [ROOT], enforcement: { silenceMs: 0 } }, { now: () => now });
  const handler = pre(registered);

  await handler(call(LONG), async () => ({ kind: 'allow' }));
  now = start + 60 * 60 * 1000;
  const later = await handler(call('Start-Sleep -Seconds 63'), async () => ({ kind: 'allow' }));
  assert.equal(later.kind, 'deny');
  assert.doesNotMatch(later.reason, /тишина/u);
});

test('тишина: профильный дефолт — 10 минут', () => {
  assert.equal(DEFAULT_SILENCE_MS, 600000);
});
