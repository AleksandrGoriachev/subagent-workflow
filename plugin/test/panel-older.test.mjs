import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowRuntime, createWebHandler } from '../lib/api.js';
import { compareVersions, updateWorkflow, availableVersion } from '../lib/deploy.js';
import { git } from './fixture.mjs';

/*
 * 0.9.4 (0041): сборка панели старше движка. Обновление до версии сборки было
 * бы понижением движка, поэтому prepareUpdate отказывает кодом panel-older до
 * списка незавершённых заданий и до любых записей.
 */

function makeDeployedRepo(version) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-panel-older-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'panel-older@local']);
  git(repo, ['config', 'user.name', 'panel-older']);
  const engine = path.join(repo, 'docs', 'subagent-workflow');
  fs.mkdirSync(engine, { recursive: true });
  fs.writeFileSync(path.join(engine, 'VERSION'), version + '\n');
  fs.writeFileSync(
    path.join(engine, 'workflow.config.json'),
    JSON.stringify({ version: 1, tasksDir: 'docs/tasks', logs: 'local' }, null, 2) + '\n',
  );
  fs.mkdirSync(path.join(repo, 'docs', 'tasks'), { recursive: true });
  return repo;
}

function versionOf(repo) {
  return fs.readFileSync(path.join(repo, 'docs', 'subagent-workflow', 'VERSION'), 'utf8').trim();
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

async function postUpdate(handler, body) {
  const request = {
    method: 'POST',
    url: '/workflow/api/update',
    headers: { 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, fn) {
      if (event === 'data') queueMicrotask(() => fn(Buffer.from(JSON.stringify(body))));
      if (event === 'end') queueMicrotask(fn);
      return request;
    },
  };
  const response = makeResponse();
  await handler(request, response);
  let json = null;
  try {
    json = JSON.parse(response.body);
  } catch {
    json = null;
  }
  return { status: response.statusCode, json, text: response.body };
}

function cleanup(repo) {
  try {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
  } catch {
    /* утечка временного каталога не отменяет проверенное поведение */
  }
}

test('compareVersions сравнивает версии числом по сегментам (0041)', () => {
  assert.equal(compareVersions('2.6.10', '2.6.9'), 1);
  assert.equal(compareVersions('2.6.9', '2.6.10'), -1);
  assert.equal(compareVersions('2.6.9', '2.6.9'), 0);
  assert.equal(compareVersions('2.6', '2.6.0'), 0);
  assert.equal(compareVersions('', '2.6.9'), 0, 'пустая строка не падает');
  assert.equal(compareVersions('не-версия', 'не-версия'), 0, 'нечисловые строки равны');
  assert.ok(
    [-1, 0, 1].includes(compareVersions('не-версия', '2.6.9')),
    'нечисловая строка не бросает исключение',
  );
});

test('updateWorkflow отвергает понижение движка до списка задач и без записей (0041)', () => {
  const repo = makeDeployedRepo('99.0.0');
  try {
    const configBefore = fs.readFileSync(path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json'), 'utf8');
    /* Незавершённое задание не должно подменять отказ panel-older: порядок важен. */
    const taskDir = path.join(repo, 'docs', 'tasks', '0001');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'task.md'), '# T\n');
    fs.writeFileSync(path.join(taskDir, 'criteria.lock'), '{}\n');

    const result = updateWorkflow(repo, { allowInProgress: true });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'panel-older');
    assert.equal(result.version, '99.0.0', 'в отказе — установленная версия');
    assert.equal(result.targetVersion, availableVersion(), 'в отказе — версия сборки панели');
    assert.equal(typeof result.hint, 'string');
    assert.ok(result.hint.length > 0, 'подсказка не пуста');
    assert.match(result.hint, /обновите панель/iu);
    assert.match(result.hint, /tarball/u);
    assert.match(result.hint, /понижение движка запрещено/u);

    assert.equal(versionOf(repo), '99.0.0', 'VERSION не изменился');
    assert.equal(
      fs.readFileSync(path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json'), 'utf8'),
      configBefore,
      'workflow.config.json не изменился',
    );
    assert.equal(
      fs.existsSync(path.join(repo, 'docs', 'subagent-workflow', 'deploy.log')),
      false,
      'deploy.log не создан',
    );
  } finally {
    cleanup(repo);
  }
});

test('POST /workflow/api/update отдаёт 409 panel-older с подсказкой (0041)', async () => {
  const repo = makeDeployedRepo('99.0.0');
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [repo] }));

    const withoutConfirm = await postUpdate(handler, { root: repo });
    assert.equal(withoutConfirm.status, 400, 'без confirm — 400, а не отказ понижения');
    assert.equal(versionOf(repo), '99.0.0');

    const response = await postUpdate(handler, { root: repo, confirm: true });
    assert.equal(response.status, 409);
    assert.equal(response.json && response.json.code, 'panel-older');
    assert.equal(response.json && response.json.version, '99.0.0');
    assert.equal(response.json && response.json.targetVersion, availableVersion());
    assert.equal(typeof (response.json && response.json.hint), 'string');
    assert.ok(response.json.hint.length > 0, 'подсказка доходит до клиента');
    assert.match(response.json.hint, /понижение движка запрещено/u);
    assert.equal(versionOf(repo), '99.0.0', 'движок не понижен');
    assert.equal(
      fs.existsSync(path.join(repo, 'docs', 'subagent-workflow', 'deploy.log')),
      false,
      'отказ не пишет журнал',
    );
  } finally {
    cleanup(repo);
  }
});
