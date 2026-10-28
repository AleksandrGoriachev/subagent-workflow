import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createWorkflowRuntime,
  createWebHandler,
} from '../lib/api.js';
import { makeRepo, snapshotFiles, git } from './fixture.mjs';

function makeRequest(url, options = {}) {
  const request = {
    method: options.method || 'GET',
    url,
    socket: { remoteAddress: options.remote === undefined ? '127.0.0.1' : options.remote },
  };
  if (options.body !== undefined) {
    const text = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    const listeners = { data: [], end: [], error: [] };
    request.on = (event, fn) => {
      (listeners[event] || listeners.data).push(fn);
      return request;
    };
    queueMicrotask(() => {
      for (const fn of listeners.data) fn(Buffer.from(text, 'utf8'));
      for (const fn of listeners.end) fn();
    });
  }
  return request;
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    writableEnded: false,
    body: '',
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    end(body) {
      this.body = body === undefined ? '' : String(body);
      this.writableEnded = true;
    },
  };
}

async function call(handler, url, options = {}) {
  const res = makeResponse();
  await handler(makeRequest(url, options), res);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.statusCode, headers: res.headers, json, text: res.body };
}

function setup(stage = 'remarks') {
  const fixture = makeRepo({ stage });
  const runtime = createWorkflowRuntime({ roots: [fixture.repo] });
  const handler = createWebHandler(runtime);
  return { fixture, runtime, handler };
}

test('GET /workflow/api/status reports the repository and policy', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/status');
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json.plugin.name, 'dsh-workflow-console');
    assert.equal(response.json.roots.length, 1);
    assert.equal(response.json.roots[0].exists, true);
    assert.equal(response.json.root, fixture.repo);
    assert.equal(response.json.repo.configLoaded, true);
    assert.equal(response.json.repo.packageVersion, '2.2.1');
    assert.equal(response.json.repo.policy.line, 'decisions=fail, coverage=fail, attack=fail, modelFamily=warn');
    assert.equal(response.json.rootConfigured, true);
    assert.match(response.json.repo.compat.pluginVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(response.json.repo.compat.summary.limited, false);
  } finally {
    fixture.cleanup();
  }
});

test('GET /workflow/api/tasks returns the board with stages and skipped files', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/tasks');
    assert.equal(response.status, 200);
    assert.equal(response.json.tasks.length, 1);
    const task = response.json.tasks[0];
    assert.equal(task.id, '0001');
    assert.equal(task.stage, 'remarks');
    assert.equal(task.stageLabel, 'замечания');
    /*
     * 0.4.0: панель читает effect. Фикстура — решение с impact user-visible и
     * без объявленного criteria.effect, то есть ровно то, что ворота при
     * policy.decisions=fail считают ошибкой. Раньше панель об этом молчала.
     */
    assert.equal(task.errors, 1);
    assert.ok(task.flags.some((flag) => flag.code === 'effect-problem'));
    assert.equal(task.effects.status, 'missing');
    assert.equal(task.effects.required, true);
    assert.ok(task.warnings >= 2);
    assert.equal(response.json.counts.remarks, 1);
    assert.equal(response.json.skipped.length, 1);
    assert.match(response.json.skipped[0].path, /0001-old\.md$/);
    assert.match(response.json.head, /^[0-9a-f]{40}$/);
  } finally {
    fixture.cleanup();
  }
});

test('GET /workflow/api/task/:id returns decisions, attack, coverage and record', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/task/0001');
    assert.equal(response.status, 200);
    const task = response.json.task;
    assert.equal(task.id, '0001');
    assert.equal(task.stage, 'remarks');
    assert.deepEqual(task.decisions.assumed, ['D2']);
    assert.equal(task.criteria[0].covers[0], 'src/**');
    assert.equal(task.attack.summary.blocking, 1);
    assert.equal(task.attack.summary.unresolved, 0);
    assert.equal(task.coverage.uncovered.length, 0);
    assert.equal(task.record.version, 6);
    assert.equal(task.record.releaseReady, false);
    assert.equal(task.lock.inSync, true);
    assert.ok(task.git.log.length >= 1);
  } finally {
    fixture.cleanup();
  }
});

test('GET /workflow/api/policy matches the doctor policy line', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/policy');
    assert.equal(response.status, 200);
    assert.equal(response.json.line, 'decisions=fail, coverage=fail, attack=fail, modelFamily=warn');
    assert.equal(response.json.policy.decisions, 'fail');
    assert.equal(response.json.policy.coverage, 'fail');
    assert.equal(response.json.policy.attack, 'fail');
    assert.equal(response.json.policy.roles.modelFamily, 'warn');
    assert.equal(response.json.roles.find((role) => role.name === 'critic').family, 'family-b');
    assert.deepEqual(response.json.models, { 'model-a': 'family-a', 'model-b': 'family-b' });
    assert.equal(response.json.configPath.endsWith('workflow.config.json'), true);
  } finally {
    fixture.cleanup();
  }
});

test('GET /workflow/api/compat reports versions and recommendations', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/compat');
    assert.equal(response.status, 200);
    assert.match(response.json.pluginVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(response.json.supported, '2.0.0 – 2.6.x');
    assert.equal(response.json.workflowVersion, '2.2.1');
    assert.equal(response.json.summary.limited, false);
    assert.ok(Array.isArray(response.json.checks));
    assert.ok(response.json.checks.some((item) => item.id === 'package-spec'));
    assert.equal(response.json.configPath.endsWith('workflow.config.json'), true);
  } finally {
    fixture.cleanup();
  }
});

const MISSING_ROOT = process.platform === 'win32' ? 'C:\\not-a-real-workflow-root' : '/not-a-real-workflow-root';
const FOREIGN_ROOT = process.platform === 'win32' ? 'C:\\Windows' : '/etc';

test('a registered workspace is readable even when it is not a configured root', async () => {
  const fixture = makeRepo({ stage: 'accepted' });
  try {
    const runtime = createWorkflowRuntime(
      { roots: [MISSING_ROOT] },
      { getWorkspaceRegistry: () => ({ list: () => [{ path: fixture.repo, title: 'fixture' }] }) },
    );
    const handler = createWebHandler(runtime);
    const status = await call(handler, '/workflow/api/status?root=' + encodeURIComponent(fixture.repo));
    assert.equal(status.status, 200);
    assert.equal(status.json.rootConfigured, false);
    assert.equal(status.json.repo.configLoaded, true);
    const tasks = await call(handler, '/workflow/api/tasks?root=' + encodeURIComponent(fixture.repo));
    assert.equal(tasks.status, 200);
    assert.equal(tasks.json.tasks.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('non-GET methods answer 405 with Allow: GET', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/tasks', { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, 'GET');
  } finally {
    fixture.cleanup();
  }
});

test('unknown routes answer 404 and a foreign root answers 400', async () => {
  const { fixture, handler } = setup();
  try {
    const missing = await call(handler, '/workflow/api/nope');
    assert.equal(missing.status, 404);
    const foreign = await call(handler, '/workflow/api/tasks?root=' + encodeURIComponent(FOREIGN_ROOT));
    assert.equal(foreign.status, 400);
    assert.match(foreign.json.error, /не входит/);
    const status = await call(handler, '/workflow/api/status?root=' + encodeURIComponent(FOREIGN_ROOT));
    assert.equal(status.status, 200);
    assert.equal(status.json.repo, null);
    assert.match(status.json.error, /не входит/);
  } finally {
    fixture.cleanup();
  }
});

test('a non-loopback peer is rejected', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/tasks', { remote: '10.1.2.3' });
    assert.equal(response.status, 403);
  } finally {
    fixture.cleanup();
  }
});

test('a traversal-shaped task id is rejected', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/task/..%2F..%2Fetc');
    assert.equal(response.status, 400);
  } finally {
    fixture.cleanup();
  }
});

function writeFakeLint(repo, source) {
  const dir = path.join(repo, 'docs', 'subagent-workflow', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'task-lint.mjs');
  fs.writeFileSync(file, source, 'utf8');
  return file;
}

test('GET /workflow/api/checks lists the read-only checks', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/checks');
    assert.equal(response.status, 200);
    assert.deepEqual(response.json.checks.map((item) => item.id), ['doctor', 'lint', 'check-acceptance']);
    assert.equal(response.json.checks[0].scope, 'repo');
    assert.equal(response.json.checks[1].scope, 'task');
    assert.ok(response.json.checks.every((item) => item.writeFree === true));
    assert.match(response.json.checks[1].title, /задание и критерии/u);
  } finally {
    fixture.cleanup();
  }
});

test('POST /workflow/api/run returns the log of a passing check and writes nothing', async () => {
  const { fixture, handler } = setup();
  try {
    writeFakeLint(fixture.repo, "console.log('fake lint: 0001 — ок');\n");
    const before = snapshotFiles(fixture.repo);
    const response = await call(handler, '/workflow/api/run', {
      method: 'POST',
      body: { check: 'lint', root: fixture.repo, task: '0001' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.check, 'lint');
    assert.equal(response.json.exitCode, 0);
    assert.equal(response.json.ok, true);
    assert.equal(response.json.writeFree, true);
    assert.equal(response.json.task, '0001');
    assert.match(response.json.log, /fake lint: 0001 — ок/u);
    assert.match(response.json.command, /task-lint\.mjs --task docs\/tasks\/0001/u);
    assert.ok(fs.existsSync(response.json.logPath), 'лог сохраняется в файл, а не в pipe');
    assert.deepEqual(snapshotFiles(fixture.repo), before, 'проверка не пишет в репозиторий');
  } finally {
    fixture.cleanup();
  }
});

test('a failing check is a result, not an error', async () => {
  const { fixture, handler } = setup();
  try {
    writeFakeLint(fixture.repo, "console.error('ERROR: критерий без команды');\nprocess.exit(2);\n");
    const response = await call(handler, '/workflow/api/run', {
      method: 'POST',
      body: { check: 'lint', root: fixture.repo, task: '0001' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.ok, false);
    assert.equal(response.json.exitCode, 2);
    assert.match(response.json.log, /ERROR: критерий без команды/u);
  } finally {
    fixture.cleanup();
  }
});

test('run rejects unknown checks, missing tasks and absent scripts', async () => {
  const { fixture, handler } = setup();
  try {
    const unknown = await call(handler, '/workflow/api/run', {
      method: 'POST',
      body: { check: 'accept', root: fixture.repo, task: '0001' },
    });
    assert.equal(unknown.status, 400);
    assert.match(unknown.json.error, /неизвестная проверка/u);

    const noTask = await call(handler, '/workflow/api/run', {
      method: 'POST',
      body: { check: 'lint', root: fixture.repo },
    });
    assert.equal(noTask.status, 400);
    assert.match(noTask.json.error, /не передан id/u);

    const noScript = await call(handler, '/workflow/api/run', {
      method: 'POST',
      body: { check: 'doctor', root: fixture.repo },
    });
    assert.equal(noScript.status, 400);
    assert.match(noScript.json.error, /скрипт не найден/u);

    const outside = await call(handler, '/workflow/api/run', {
      method: 'POST',
      body: { check: 'lint', root: 'C:\\definitely\\not\\allowed', task: '0001' },
    });
    assert.equal(outside.status, 400);

    const foreign = await call(handler, '/workflow/api/run', {
      method: 'POST',
      remote: '10.1.2.3',
      body: { check: 'lint', root: fixture.repo, task: '0001' },
    });
    assert.equal(foreign.status, 403);
  } finally {
    fixture.cleanup();
  }
});

test('run is POST-only and other routes stay GET-only', async () => {
  const { fixture, handler } = setup();
  try {
    const get = await call(handler, '/workflow/api/run');
    assert.equal(get.status, 405);
    assert.equal(get.headers.allow, 'POST');

    const post = await call(handler, '/workflow/api/status', { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET');
  } finally {
    fixture.cleanup();
  }
});

test('POST /workflow/api/guard flips only guard.enabled and logs it', async () => {
  const { fixture, handler } = setup();
  try {
    const configPath = path.join(fixture.repo, 'docs', 'subagent-workflow', 'workflow.config.json');
    const before = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const on = await call(handler, '/workflow/api/guard', {
      method: 'POST',
      body: { root: fixture.repo, enabled: true },
    });
    assert.equal(on.status, 200);
    assert.equal(on.json.enabled, true);
    assert.match(on.json.note, /только guard\.enabled/u);
    const after = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(after.guard.enabled, true);
    for (const key of Object.keys(before)) {
      assert.deepEqual(after[key], before[key], 'ключ ' + key + ' не менялся');
    }
    assert.deepEqual(Object.keys(after).filter((key) => !(key in before)), ['guard']);
    const logText = fs.readFileSync(path.join(fixture.repo, 'docs', 'subagent-workflow', 'guard.log'), 'utf8');
    assert.match(logText, /enabled=true/u);
    assert.match(logText, /actor=/u);

    const policy = await call(handler, '/workflow/api/policy');
    assert.equal(policy.json.guard.enabled, true);
    assert.equal(policy.json.guard.bypassMarker, 'workflow-bypass');

    const off = await call(handler, '/workflow/api/guard', {
      method: 'POST',
      body: { root: fixture.repo, enabled: false },
    });
    assert.equal(off.status, 200);
    assert.equal(off.json.changed, true);
    const afterOff = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(afterOff.guard.enabled, false);
  } finally {
    fixture.cleanup();
  }
});

test('guard route is POST-only and validates its body and root', async () => {
  const { fixture, handler } = setup();
  try {
    const get = await call(handler, '/workflow/api/guard');
    assert.equal(get.status, 405);
    assert.equal(get.headers.allow, 'POST');

    const bad = await call(handler, '/workflow/api/guard', { method: 'POST', body: { root: fixture.repo } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /true или false/u);

    const foreign = await call(handler, '/workflow/api/guard', {
      method: 'POST',
      body: { root: 'C:\\definitely\\not\\allowed', enabled: true },
    });
    assert.equal(foreign.status, 400);
  } finally {
    fixture.cleanup();
  }
});

test('a full request sweep does not change files or git status', async () => {
  const { fixture, handler } = setup();
  try {
    const before = snapshotFiles(fixture.repo);
    const statusBefore = git(fixture.repo, ['status', '--porcelain']);
    await call(handler, '/workflow/api/status');
    await call(handler, '/workflow/api/tasks');
    await call(handler, '/workflow/api/task/0001');
    await call(handler, '/workflow/api/policy');
    const after = snapshotFiles(fixture.repo);
    assert.deepEqual(after, before);
    assert.equal(git(fixture.repo, ['status', '--porcelain']), statusBefore);
  } finally {
    fixture.cleanup();
  }
});

/*
 * 0.7.0: развёртывание движка из панели.
 *
 * Корень — только из runtime.roots, запись — только с confirm: true. Тесты
 * работают в одноразовом git-репозитории без workflow: init запускается по-
 * настоящему, поэтому проверяется и версия, и хуки, и повтор.
 */
const REPO_VERSION = fs.readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();

function makeEmptyRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-deploy-api-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'deploy@local']);
  git(repo, ['config', 'user.name', 'deploy']);
  return repo;
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
  } catch {
    /* утечка временного каталога не отменяет уже проверенное поведение */
  }
}

test('POST /workflow/api/deploy разворачивает движок в корень workspace (0.7.0)', async () => {
  const repo = makeEmptyRepo();
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [repo] }));
    const response = await call(handler, '/workflow/api/deploy', {
      method: 'POST',
      body: { root: repo, confirm: true },
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.ok, true);
    assert.equal(response.json.root, repo);
    assert.equal(response.json.version, REPO_VERSION, 'версия движка равна версии сборки');
    assert.match(response.json.log, /init:/u, 'лог init уезжает в ответ');

    const versionFile = path.join(repo, 'docs', 'subagent-workflow', 'VERSION');
    assert.equal(fs.readFileSync(versionFile, 'utf8').trim(), REPO_VERSION);
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'tasks')), 'каталог заданий создан');
    assert.equal(git(repo, ['config', '--get', 'core.hooksPath']), 'docs/subagent-workflow/hooks');

    /* Состояние действительно перечитано: конфиг движка теперь загружается. */
    const status = await call(handler, '/workflow/api/status');
    assert.equal(status.json.repo.configLoaded, true);

    /* Повтор безопасен: обновления кнопкой нет, код already-deployed. */
    const again = await call(handler, '/workflow/api/deploy', {
      method: 'POST',
      body: { root: repo, confirm: true },
    });
    assert.equal(again.status, 400);
    assert.equal(again.json.code, 'already-deployed');
    assert.equal(again.json.version, REPO_VERSION, 'в отказе видно, какая версия уже стоит');
  } finally {
    removeDir(repo);
  }
});

test('deploy без confirm ничего не пишет, POST-only и проверяет корень', async () => {
  const repo = makeEmptyRepo();
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-deploy-plain-'));
  const missing = path.join(os.tmpdir(), 'wf-deploy-missing-' + Date.now().toString(36));
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [repo] }));
    const before = fs.readdirSync(repo).sort();

    const noConfirm = await call(handler, '/workflow/api/deploy', {
      method: 'POST',
      body: { root: repo },
    });
    assert.equal(noConfirm.status, 400);
    assert.match(noConfirm.json.error, /confirm/u);
    assert.deepEqual(fs.readdirSync(repo).sort(), before, 'без подтверждения не создаётся ничего');
    assert.equal(fs.existsSync(path.join(repo, 'docs')), false);

    /* Неверный confirm — тоже отказ: булево true, а не «истинноподобное». */
    const truthy = await call(handler, '/workflow/api/deploy', {
      method: 'POST',
      body: { root: repo, confirm: 'yes' },
    });
    assert.equal(truthy.status, 400);

    const get = await call(handler, '/workflow/api/deploy');
    assert.equal(get.status, 405);
    assert.equal(get.headers.allow, 'POST');

    const foreign = await call(handler, '/workflow/api/deploy', {
      method: 'POST',
      body: { root: process.platform === 'win32' ? 'C:\\definitely\\not\\allowed' : '/definitely/not/allowed', confirm: true },
    });
    assert.equal(foreign.status, 400, 'корень вне runtime.roots не принимается');
    assert.match(foreign.json.error, /не входит/u);

    /* Не-git: отказ до любой записи, ни docs, ни хуков. */
    const plainHandler = createWebHandler(createWorkflowRuntime({ roots: [plain] }));
    const nonGit = await call(plainHandler, '/workflow/api/deploy', {
      method: 'POST',
      body: { root: plain, confirm: true },
    });
    assert.equal(nonGit.status, 400);
    assert.equal(nonGit.json.code, 'not-a-repo');
    assert.equal(fs.existsSync(path.join(plain, 'docs')), false);

    /* Корень в списке, но каталога нет: 404, а не «развернули в никуда». */
    const missingHandler = createWebHandler(createWorkflowRuntime({ roots: [missing] }));
    const absent = await call(missingHandler, '/workflow/api/deploy', {
      method: 'POST',
      body: { root: missing, confirm: true },
    });
    assert.equal(absent.status, 404);

    assert.equal(fs.existsSync(path.join(repo, 'docs')), false, 'ни один отказ не пишет в репозиторий');
  } finally {
    removeDir(repo);
    removeDir(plain);
  }
});
