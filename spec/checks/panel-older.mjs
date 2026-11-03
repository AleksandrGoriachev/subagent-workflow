#!/usr/bin/env node
/*
 * 2.6.15 (0040): сборка панели старше движка — понижение запрещено.
 *
 * Панель 0.9.0 с вложенной спекой 2.6.11, установленная поверх движка 2.6.12,
 * предлагала «Обновить движок» и по подтверждению действительно понижала
 * движок: prepareUpdate отказывал только при равенстве версий. Здесь
 * проверяется отказ, числовое сравнение версий и тексты панели.
 *
 * Конвенция пакета: вне пакета печатаем SKIP (иначе deployed-copy краснеет).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-panel-older-'));

/* Слова панели: «доступна v2.6.11» над движком 2.6.12 — именно та путаница. */
const CARD_WORDS = ['сборка панели старше', 'понижение движка запрещено'];
/* Поведенческий тест панели, который обязан написать исполнитель (без версий). */
const CARD_TEST = 'карточка panel-older: понижение не предлагается';

function eq(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ': ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual));
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(ROOT, prefix));
}

function makeResponse() {
  return {
    statusCode: 200, headers: {}, writableEnded: false, body: '',
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(body) { this.body = body === undefined ? '' : String(body); this.writableEnded = true; },
  };
}

async function postUpdate(handler, body) {
  const request = {
    method: 'POST', url: '/workflow/api/update',
    headers: { 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, fn) {
      if (event === 'data') queueMicrotask(() => fn(Buffer.from(JSON.stringify(body))));
      if (event === 'end') queueMicrotask(fn);
      return request;
    },
  };
  const res = makeResponse();
  await handler(request, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { json = null; }
  return { status: res.statusCode, json, text: res.body };
}

/** Развёрнутый движок заданной версии в git-репозитории. */
function deployedRepo(version) {
  const repo = tempDir('repo-');
  const engineDir = path.join(repo, 'docs', 'subagent-workflow');
  fs.mkdirSync(engineDir, { recursive: true });
  fs.writeFileSync(path.join(engineDir, 'VERSION'), version + '\n');
  fs.writeFileSync(path.join(engineDir, 'workflow.config.json'), JSON.stringify({ version: 1, tasksDir: 'docs/tasks', logs: 'local' }));
  fs.mkdirSync(path.join(repo, 'docs', 'tasks'), { recursive: true });
  const git = spawnSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
  truthy(git.status === 0, 'git init в фикстуре');
  return repo;
}

function versionOf(repo) {
  return fs.readFileSync(path.join(repo, 'docs', 'subagent-workflow', 'VERSION'), 'utf8').trim();
}

/* --- c1: маршрут обновления отказывает понижение ------------------- */

async function c1() {
  const deploy = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'deploy.js')).href);
  const api = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'api.js')).href);
  truthy(typeof deploy.compareVersions === 'function', 'deploy.js: нет экспорта compareVersions(a, b)');

  /* Числовое сравнение, а не строковое: 2.6.10 новее 2.6.9. */
  eq(deploy.compareVersions('2.6.10', '2.6.9'), 1, 'compareVersions: 2.6.10 > 2.6.9');
  eq(deploy.compareVersions('2.6.9', '2.6.10'), -1, 'compareVersions: 2.6.9 < 2.6.10');
  eq(deploy.compareVersions('2.6.9', '2.6.9'), 0, 'compareVersions: 2.6.9 = 2.6.9');
  eq(deploy.compareVersions('', '2.6.9'), 0, 'compareVersions: пустая строка не падает');

  const target = String(deploy.targetVersion() || '').trim();
  truthy(/^\d+\.\d+\.\d+$/.test(target), 'targetVersion(): сборка без VERSION');

  /* Движок новее сборки панели: обновление обязано отказать и не трогать VERSION. */
  const newer = deployedRepo('99.0.0');
  const handler = api.createWebHandler(api.createWorkflowRuntime({ roots: [newer] }));
  let res = await postUpdate(handler, { root: newer, confirm: true });
  eq(res.status, 409, 'понижение: статус');
  eq(res.json && res.json.code, 'panel-older', 'понижение: код');
  eq(res.json && res.json.version, '99.0.0', 'понижение: from в ответе');
  eq(res.json && res.json.targetVersion, target, 'понижение: targetVersion в ответе');
  truthy(typeof (res.json && res.json.hint) === 'string' && res.json.hint.length > 0, 'понижение: подсказка, что делать');
  eq(versionOf(newer), '99.0.0', 'понижение: VERSION не изменился');

  /* Равенство версий по-прежнему up-to-date, а не понижение. */
  const same = deployedRepo(target);
  const handler2 = api.createWebHandler(api.createWorkflowRuntime({ roots: [same] }));
  res = await postUpdate(handler2, { root: same, confirm: true });
  eq(res.status, 409, 'равные версии: статус');
  eq(res.json && res.json.code, 'up-to-date', 'равные версии: код');

  /* Без confirm понижение тоже не выполняется. */
  res = await postUpdate(handler, { root: newer });
  eq(res.status, 400, 'понижение без confirm: статус');
  eq(versionOf(newer), '99.0.0', 'понижение без confirm: VERSION не изменился');
}

/* --- c2: панель не предлагает понижение ---------------------------- */

async function c2() {
  const client = fs.readFileSync(path.join(PKG, 'plugin', 'lib', 'client.js'), 'utf8');
  for (const word of CARD_WORDS) truthy(client.includes(word), 'client.js: нет текста «' + word + '»');
  const tests = fs.readFileSync(path.join(PKG, 'plugin', 'test', 'client.test.mjs'), 'utf8');
  truthy(tests.includes(CARD_TEST), 'client.test.mjs: нет теста «' + CARD_TEST + '»');

  const run = spawnSync(process.execPath, [path.join(PKG, 'plugin', 'tools', 'test.mjs')], {
    cwd: PKG, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 1800000,
  });
  if (run.status !== 0) throw new Error('тесты панели не зелёные: ' + String(run.stdout || '').slice(-1200) + String(run.stderr || '').slice(-600));
}

const cases = { c1, c2 };
const id = String(process.argv[2] || 'c1').toLowerCase();
try {
  if (!Object.hasOwn(cases, id)) {
    console.log('PANEL-OLDER FAIL usage: node spec/checks/panel-older.mjs c1|c2');
    process.exit(2);
  }
  await cases[id]();
  console.log('PANEL-OLDER OK ' + id);
} catch (error) {
  console.log('PANEL-OLDER FAIL ' + id + ': ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
}
