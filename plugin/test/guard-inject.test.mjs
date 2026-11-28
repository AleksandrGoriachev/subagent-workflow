/**
 * 0194: guard подключается в инжектированном контексте tools.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.WF_WAITS_DIR = path.join(os.tmpdir(), 'wf-guard-inject-test-' + process.pid);

const { registerWaitGuard } = await import('../lib/wait-guard.js');

const ROOT = path.join(os.tmpdir(), 'wf-guard-inject-root-' + process.pid);

function makeRootCtx() {
  const events = [];
  const ctx = {
    on(event, handler) { events.push({ event, handler }); },
    get tools() { throw new Error('cannot get property "tools" without inject'); },
    inject(deps, callback) { ctx.injected = { deps, callback }; return true; },
  };
  return { ctx, events };
}

test('inject: guard дотягивается после появления сервиса tools', () => {
  const { ctx } = makeRootCtx();
  let attachedTo = null;
  const result = registerWaitGuard(ctx, { roots: [ROOT] }, { onGuardAttached: (state) => { attachedTo = state; } });

  assert.ok(ctx.injected, 'ctx.inject(tools) запрошен');
  assert.deepEqual(ctx.injected.deps, ['tools']);
  assert.equal(result.registration.preExecute, true, 'подписка остаётся на корневом ctx');
  assert.equal(result.registration.guard, false, 'до появления сервиса guard не стоит');
  assert.equal(attachedTo, null);

  let guardHandler = null;
  ctx.injected.callback({ tools: { guard(handler) { guardHandler = handler; } } });

  assert.equal(result.registration.guard, true);
  assert.equal(result.registration.guardError, null);
  assert.equal(typeof guardHandler, 'function');
  assert.equal(attachedTo, result, 'диагностика получает живое состояние');

  const reason = guardHandler({ name: 'pwsh', arguments: { command: 'Start-Sleep -Seconds 61' }, cwd: ROOT });
  assert.equal(typeof reason, 'string');
  assert.match(reason, /долгое ожидание/u);
});

test('без inject поведение прежнее: guard false, причина названа', () => {
  const ctx = {
    on() {},
    get tools() { throw new Error('service tools is not available'); },
  };
  const result = registerWaitGuard(ctx, { roots: [ROOT] });
  assert.equal(result.registration.guard, false);
  assert.match(String(result.registration.guardError), /tools is not available/u);
});

test('inject есть, но сервис не пришёл — guard не выдумывает себя', () => {
  const { ctx } = makeRootCtx();
  const result = registerWaitGuard(ctx, { roots: [ROOT] });
  assert.equal(result.registration.guard, false);
  assert.match(String(result.registration.guardError), /without inject/u);
});
