/**
 * 0077 (WC-60): регистрация сторожа не зависит от сервиса tools.
 *
 * Дефект, который эти проверки закрывают: в хосте, где ctx.tools бросает
 * (сервис не инжектирован в контекст плагина), прежний порядок обрывал
 * регистрацию ДО tools/pre-execute — политика fail молчала, вызов проходил.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.WF_WAITS_DIR = path.join(os.tmpdir(), 'wf-wait-guard-test-' + process.pid);

const { registerWaitGuard } = await import('../lib/wait-guard.js');

const ROOT = path.join(os.tmpdir(), 'wf-wait-guard-root-' + process.pid);
const LONG_EXEC = {
  name: 'pwsh',
  arguments: { command: 'Start-Sleep -Seconds 61' },
  cwd: ROOT,
};

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

test('обычный ctx: подписки есть, долгий сон отклоняется до исполнения', async () => {
  const { ctx, registered } = listeners();
  const result = registerWaitGuard(ctx, { roots: [ROOT] });

  assert.equal(result.registration.preExecute, true);
  assert.equal(result.registration.guard, true);
  assert.equal(result.registration.postExecute, true);
  assert.equal(result.registration.guardError, null);
  assert.deepEqual(
    registered.map((entry) => entry.event),
    ['session/event', 'tools/pre-execute', 'guard', 'tools/post-execute'],
  );

  const pre = registered.find((entry) => entry.event === 'tools/pre-execute');
  let downstream = false;
  const decision = await pre.handler(LONG_EXEC, async () => { downstream = true; return { kind: 'allow' }; });
  assert.equal(decision.kind, 'deny');
  assert.match(decision.reason, /enforcement\.waitPolicy=fail/u);
  assert.equal(downstream, false, 'downstream не вызывается при отказе');
});

test('ctx.tools бросает: pre-execute всё равно подписан и отклоняет', async () => {
  const registered = [];
  const ctx = {
    on(event, handler) { registered.push({ event, handler }); },
    get tools() { throw new Error('service tools is not available'); },
  };
  const result = registerWaitGuard(ctx, { roots: [ROOT] });

  assert.equal(result.registration.preExecute, true, 'отказ не должен зависеть от ctx.tools');
  assert.equal(result.registration.guard, false);
  assert.match(String(result.registration.guardError), /tools is not available/u);
  assert.deepEqual(registered.map((entry) => entry.event), ['session/event', 'tools/pre-execute', 'tools/post-execute']);

  const pre = registered.find((entry) => entry.event === 'tools/pre-execute');
  const decision = await pre.handler(LONG_EXEC, async () => ({ kind: 'allow' }));
  assert.equal(decision.kind, 'deny');
});

test('короткий вызов проходит в next() без отказа', async () => {
  const { ctx, registered } = listeners();
  registerWaitGuard(ctx, { roots: [ROOT] });
  const pre = registered.find((entry) => entry.event === 'tools/pre-execute');
  const decision = await pre.handler({ name: 'pwsh', arguments: { command: 'Write-Output ok' }, cwd: ROOT }, async () => ({ kind: 'allow' }));
  assert.deepEqual(decision, { kind: 'allow' });
});

test('второй слой guard возвращает причину для долгого сна', () => {
  const { ctx, registered } = listeners();
  registerWaitGuard(ctx, { roots: [ROOT] });
  const guard = registered.find((entry) => entry.event === 'guard');
  const reason = guard.handler(LONG_EXEC);
  assert.equal(typeof reason, 'string');
  assert.match(reason, /долгое ожидание/u);
});

test('0078: корень вложенного вызова берётся из cwd сессии по callId', async () => {
  const { ctx, registered } = listeners();
  registerWaitGuard(ctx, { roots: [ROOT] });
  const sessionEvent = registered.find((entry) => entry.event === 'session/event');
  assert.ok(sessionEvent, 'подписка на session/event');
  sessionEvent.handler({ cwd: ROOT }, { type: 'tool/call', data: { callId: 'call-1' } });

  const pre = registered.find((entry) => entry.event === 'tools/pre-execute');
  const decision = await pre.handler(
    { name: 'pwsh', arguments: { command: 'Start-Sleep -Seconds 61' }, rootCallId: 'call-1' },
    async () => ({ kind: 'allow' }),
  );
  assert.equal(decision.kind, 'deny');

  const crypto = await import('node:crypto');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const key = crypto.createHash('sha256').update(ROOT).digest('hex').slice(0, 12);
  const journal = path.join(process.env.WF_WAITS_DIR, key + '.jsonl');
  assert.ok(fs.existsSync(journal), 'журнал корня создан');
  const line = JSON.parse(fs.readFileSync(journal, 'utf8').trim().split('\n').pop());
  assert.equal(line.root, ROOT);
  assert.equal(line.attribution, 'call');
  assert.equal(line.denied, true);
});
