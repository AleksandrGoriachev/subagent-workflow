#!/usr/bin/env node
/*
 * 2.6.32 (0073, WC-55): обязательность регламента — сторож вместо таймера.
 *
 * Правило императива (docs/IMPERATIVE-workspaces.md, W1): ожидание тяжёлого
 * прогона идёт через spec/scripts/job.mjs (start/wait), а не сном внутри
 * инструмента. Проверяются три антипаттерна:
 *
 *   - pwsh: Start-Sleep -Seconds/-Milliseconds >= порога, либо timeoutMs >= 240000;
 *   - job_output: wait: true и timeout_ms > порога ожидания (120000);
 *   - project_graph_run: timeoutMs >= 240000.
 *
 * Обязательства:
 *  - c1: детектор видит ровно эти случаи и не срабатывает на короткие/чужие вызовы;
 *  - c2: при политике fail ctx.tools.guard() отклоняет вызов строкой-причиной со
 *        ссылкой на job.mjs, при warn — не отклоняет, но post-execute добавляет
 *        notice полной формы v4 (id, role, source.kind) и не ломает результат;
 *  - c3: шаблон workflow.config.json несёт enforcement.waitPolicy=fail,
 *        и init добавляет блок в конфиг воркспейса, где его нет.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const GUARD = path.join(PKG, 'plugin', 'lib', 'wait-guard.js');
const truthy = (value, label) => { if (!value) throw new Error(label); };
const load = () => import(pathToFileURL(GUARD).href);

function c1() {
  truthy(fs.existsSync(GUARD), 'нет plugin/lib/wait-guard.js');
  return load().then((mod) => {
    const detect = mod.detectLongWait || mod.isLongWait;
    truthy(typeof detect === 'function', 'нет экспорта detectLongWait');
    const budget = 120000;
    const hit = (exec) => detect(exec, budget);
    const cases = [
      [{ name: 'pwsh', arguments: { command: 'Start-Sleep -Seconds 300' } }, true, 'pwsh sleep 300'],
      [{ name: 'pwsh', arguments: { command: "Start-Sleep -Milliseconds 90000" } }, true, 'pwsh sleep ms'],
      [{ name: 'pwsh', arguments: { command: 'echo hi' }, }, false, 'обычная команда'],
      [{ name: 'pwsh', arguments: { command: 'Start-Sleep -Seconds 5' } }, false, 'короткий сон'],
      [{ name: 'job_output', arguments: { job_id: 'x', wait: true, timeout_ms: 300000 } }, true, 'job_output wait 300с'],
      [{ name: 'job_output', arguments: { job_id: 'x', wait: true, timeout_ms: 60000 } }, false, 'job_output wait 60с'],
      [{ name: 'project_graph_run', arguments: { node: 'worker', timeoutMs: 540000 } }, true, 'graph run 540с'],
      [{ name: 'project_graph_run', arguments: { node: 'worker', timeoutMs: 120000 } }, false, 'graph run 120с'],
      [{ name: 'read', arguments: { file_path: 'x' } }, false, 'чужой инструмент'],
    ];
    for (const [exec, expected, label] of cases) {
      const found = hit(exec);
      truthy(Boolean(found) === expected, 'детектор ошибся на «' + label + '»: ' + JSON.stringify(found));
    }
    console.log('WAITGUARD OK c1');
  });
}

function c2() {
  return load().then((mod) => {
    truthy(typeof mod.registerWaitGuard === 'function', 'нет экспорта registerWaitGuard');
    const makeCtx = () => {
      const guards = [];
      const listeners = new Map();
      return {
        guards,
        listeners,
        ctx: {
          tools: { guard: (fn) => guards.push(fn) },
          on: (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
        },
      };
    };
    const slow = { name: 'pwsh', arguments: { command: 'Start-Sleep -Seconds 600' } };
    const fast = { name: 'pwsh', arguments: { command: 'echo ok' } };

    const failBox = makeCtx();
    mod.registerWaitGuard(failBox.ctx, { waitPolicy: 'fail', waitBudgetMs: 120000, jobScript: true });
    truthy(failBox.guards.length === 1, 'fail: guard не подписан');
    const reason = failBox.guards[0](slow);
    truthy(typeof reason === 'string' && /job/.test(reason), 'fail: guard не отклонил долгий сон строкой со ссылкой на job: ' + JSON.stringify(reason));
    truthy(failBox.guards[0](fast) === undefined, 'fail: guard отклонил обычный вызов');

    const warnBox = makeCtx();
    mod.registerWaitGuard(warnBox.ctx, { waitPolicy: 'warn', waitBudgetMs: 120000, jobScript: true });
    if (warnBox.guards.length === 1) truthy(warnBox.guards[0](slow) === undefined, 'warn: guard не должен отклонять');
    const post = warnBox.listeners.get('tools/post-execute') || [];
    truthy(post.length === 1, 'warn: нет подписки tools/post-execute');
    return post[0](slow, undefined, async () => ({ ok: true, additionalContexts: [] })).then((result) => {
      truthy(result && result.ok === true, 'warn: результат downstream потерян');
      const notice = (result.additionalContexts || [])[0];
      truthy(notice, 'warn: notice не добавлен');
      truthy(typeof notice.id === 'string' && notice.id.length > 0, 'warn: notice без id');
      truthy(notice.role === 'user', 'warn: notice без role user');
      truthy(notice.source && notice.source.kind === 'plugin:dsh-workflow-console', 'warn: notice без producer-owned kind: ' + JSON.stringify(notice.source));
      truthy(Array.isArray(notice.content) && notice.content.length > 0, 'warn: notice без content');
      console.log('WAITGUARD OK c2');
    });
  });
}

function c3() {
  const template = path.join(PKG, 'spec', 'workflow.config.json');
  truthy(fs.existsSync(template), 'нет шаблона spec/workflow.config.json в пакете');
  const config = JSON.parse(fs.readFileSync(template, 'utf8'));
  const enforcement = config.enforcement || {};
  truthy(enforcement.waitPolicy === 'fail', 'шаблон: enforcement.waitPolicy должен быть fail, сейчас ' + JSON.stringify(enforcement.waitPolicy));
  truthy(Number(enforcement.waitBudgetMs) === 120000, 'шаблон: enforcement.waitBudgetMs должен быть 120000');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-imperative-'));
  try {
    return import(pathToFileURL(path.join(PKG, 'spec', 'scripts', 'lib', 'common.mjs')).href).then((common) => {
      const init = common.spawnSyncPipeFree(process.execPath, [path.join(PKG, 'spec', 'scripts', 'init.mjs'), '--repo', repo], { cwd: PKG, encoding: 'utf8', timeout: 300000 });
      truthy(init.status === 0, 'init упал: ' + String(init.stdout || '').slice(-400) + String(init.stderr || '').slice(-200));
      const created = JSON.parse(fs.readFileSync(path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json'), 'utf8'));
      truthy(created.enforcement && created.enforcement.waitPolicy === 'fail', 'init: конфиг без enforcement.waitPolicy=fail: ' + JSON.stringify(created.enforcement));
      console.log('WAITGUARD OK c3');
    });
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}


function c4() {
  return load().then((mod) => {
    truthy(typeof mod.registerWaitGuard === 'function', 'нет экспорта registerWaitGuard');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-waits-'));
    const previous = process.env.WF_WAITS_DIR;
    process.env.WF_WAITS_DIR = dir;
    const cleanup = () => {
      if (previous === undefined) delete process.env.WF_WAITS_DIR; else process.env.WF_WAITS_DIR = previous;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    };
    const readJournal = () => {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      truthy(files.length === 1, 'журнал не создан или создан не один файл: ' + JSON.stringify(files));
      const line = fs.readFileSync(path.join(dir, files[0]), 'utf8').trim().split('\n')[0];
      const row = JSON.parse(line);
      for (const key of ['at', 'tool', 'mode', 'denied', 'reason', 'waitMs', 'budgetMs']) {
        truthy(Object.prototype.hasOwnProperty.call(row, key), 'в строке журнала нет поля ' + key + ': ' + line.slice(0, 200));
      }
      truthy(row.tool === 'pwsh', 'журнал: tool = ' + row.tool);
      truthy(row.mode === 'warn', 'журнал: mode = ' + row.mode);
      truthy(row.denied === false, 'журнал: denied должен быть false для warn');
      truthy(Number(row.waitMs) === 300000, 'журнал: waitMs = ' + row.waitMs + ', ожидалось 300000');
      truthy(Number(row.budgetMs) === 120000, 'журнал: budgetMs = ' + row.budgetMs);
    };
    const box = { guards: [], listeners: new Map() };
    const ctx = {
      tools: { guard: (fn) => box.guards.push(fn) },
      on: (name, fn) => { if (!box.listeners.has(name)) box.listeners.set(name, []); box.listeners.get(name).push(fn); },
    };
    mod.registerWaitGuard(ctx, { waitPolicy: 'warn', waitBudgetMs: 120000, jobScript: true, root: PKG });
    const slow = { name: 'pwsh', arguments: { command: 'Start-Sleep -Seconds 300' } };
    const post = (box.listeners.get('tools/post-execute') || [])[0];
    truthy(post, 'warn: нет подписки tools/post-execute');
    return Promise.resolve(post(slow, undefined, async () => ({ ok: true })))
      .then(() => readJournal())
      .then(() => console.log('WAITGUARD OK c4'))
      .finally(cleanup);
  });
}

const table = { c1, c2, c3, c4 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/wait-guard.mjs c1|c2|c3|c4');
  process.exit(2);
}
Promise.resolve()
  .then(() => table[which]())
  .catch((error) => {
    console.log('WAITGUARD FAIL ' + which + ': ' + (error && error.message ? error.message : error));
    process.exit(1);
  });
