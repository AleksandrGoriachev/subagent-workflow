/**
 * 0090 (WC-4): первая запись из панели — замок контракта и новое задание.
 *
 * Проверяем исполнением: валидация аргументов, сборка argv и живой маршрут
 * POST /api/task-hash | /api/new-task на временном воркспейсе со скриптом-заглушкой
 * (панель обязана звать штатный скрипт движка, а не писать файлы сама).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createWorkflowRuntime, createWebHandler } from '../lib/api.js';
import {
  validateTaskId,
  validateTitle,
  validateRisk,
  validateRole,
  taskHashArgs,
  newTaskArgs,
  taskDirOf,
} from '../lib/tasks-write.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function workspace(scriptBody) {
  const root = tempDir('wf-tasks-');
  const engine = path.join(root, 'docs', 'subagent-workflow');
  fs.mkdirSync(path.join(engine, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(engine, 'VERSION'), '2.6.43\n');
  fs.writeFileSync(path.join(engine, 'workflow.config.json'), JSON.stringify({ tasksDir: 'docs/tasks' }) + '\n');
  fs.writeFileSync(path.join(engine, 'scripts', 'task-hash.mjs'), scriptBody);
  fs.writeFileSync(path.join(engine, 'scripts', 'new-task.mjs'), scriptBody);
  fs.mkdirSync(path.join(root, 'docs', 'tasks', '0110'), { recursive: true });
  return root;
}

async function call(handler, url, body) {
  const listeners = { data: [], end: [], error: [] };
  const payload = JSON.stringify(body);
  const request = {
    method: 'POST',
    url,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return request;
    },
  };
  const response = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(value) { this.body = value === undefined ? '' : String(value); this.writableEnded = true; },
  };
  queueMicrotask(() => {
    for (const fn of listeners.data) fn(Buffer.from(payload, 'utf8'));
    for (const fn of listeners.end) fn();
  });
  await handler(request, response);
  let json = null;
  try { json = JSON.parse(response.body); } catch { json = null; }
  return { status: response.statusCode, json };
}

test('валидация аргументов: id, заголовок, риск, роль', () => {
  assert.equal(validateTaskId('0110'), '0110');
  assert.throws(() => validateTaskId('110'), /четыре цифры/u);
  assert.throws(() => validateTaskId('11a0'), /четыре цифры/u);
  assert.equal(validateTitle('  окно расписания  '), 'окно расписания');
  assert.throws(() => validateTitle('а\nб'), /перевод строки/u);
  assert.throws(() => validateTitle('abc'), /короче 5/u);
  assert.equal(validateRisk('MEDIUM'), 'medium');
  assert.throws(() => validateRisk('critical'), /low, medium или high/u);
  assert.equal(validateRole('subagent:judge', 'accept'), 'subagent:judge');
  assert.throws(() => validateRole('rm -rf /', 'executor'), /недопустимые символы/u);
});

test('taskHashArgs: --write и --relock с причиной', () => {
  const write = taskHashArgs({ taskDir: 'docs/tasks/0110', root: '.', mode: 'write' });
  assert.ok(write.includes('--write'));
  assert.deepEqual(write.slice(0, 2), ['--task', path.resolve('docs/tasks/0110')]);
  const relock = taskHashArgs({ taskDir: 'docs/tasks/0110', root: '.', mode: 'relock', reason: 'границы уточнены' });
  assert.ok(relock.includes('--relock'));
  assert.deepEqual(relock.slice(-2), ['--reason', 'границы уточнены']);
  assert.throws(() => taskHashArgs({ taskDir: 'x', root: '.', mode: 'relock', reason: 'мало' }), /от 10 символов/u);
});

test('newTaskArgs: id, тема, риск и роли', () => {
  const args = newTaskArgs({ id: '0111', title: 'новая тема', risk: 'low', root: '.', executor: 'subagent:worker', acceptor: 'subagent:judge' });
  assert.deepEqual(args.slice(0, 6), ['--id', '0111', '--title', 'новая тема', '--risk', 'low']);
  assert.ok(args.includes('--executor'));
  assert.ok(args.includes('--acceptor'));
});

test('POST /api/task-hash: зовёт штатный скрипт с --write', async () => {
  const root = workspace('console.log(JSON.stringify({ argv: process.argv.slice(2) }));\n');
  const handler = createWebHandler(createWorkflowRuntime({ roots: [root] }));
  const response = await call(handler, '/workflow/api/task-hash', { root, confirm: true, task: '0110' });
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  const echoed = JSON.parse(response.json.stdout);
  assert.ok(echoed.argv.includes('--write'));
  assert.ok(echoed.argv.includes(path.join(root, 'docs', 'tasks', '0110')) || echoed.argv.includes(path.resolve(root, 'docs', 'tasks', '0110')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('POST /api/task-hash: неизвестное задание — 404, плохой id — 400', async () => {
  const root = workspace('console.log("ok");\n');
  const handler = createWebHandler(createWorkflowRuntime({ roots: [root] }));
  const missing = await call(handler, '/workflow/api/task-hash', { root, confirm: true, task: '9999' });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.code, 'task-not-found');
  const bad = await call(handler, '/workflow/api/task-hash', { root, confirm: true, task: 'ab' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'invalid-arguments');
  fs.rmSync(root, { recursive: true, force: true });
});

test('POST /api/new-task: зовёт new-task.mjs с валидированными аргументами', async () => {
  const root = workspace('console.log(JSON.stringify({ argv: process.argv.slice(2) }));\n');
  const handler = createWebHandler(createWorkflowRuntime({ roots: [root] }));
  const response = await call(handler, '/workflow/api/new-task', {
    root, confirm: true, id: '0111', title: 'новая тема', risk: 'low',
  });
  assert.equal(response.status, 200);
  const echoed = JSON.parse(response.json.stdout);
  assert.ok(echoed.argv.includes('--id'));
  assert.ok(echoed.argv.includes('0111'));
  fs.rmSync(root, { recursive: true, force: true });
});
