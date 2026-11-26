#!/usr/bin/env node
/*
 * 0153 (2.6.114): политика развёртывания видна панели.
 *
 * 0151 кладёт docs/subagent-workflow/deploy-notice.json: режим, политику
 * (gitignore|vendored), что стало машинным и что делать клону. Панель обязана
 * показать это решением, а не выводить из состояния дерева, — и обязана открыться,
 * если файла нет или он битый.
 *
 *   c1 — отметка есть: /api/status отдаёт deployNotice с политикой и ценой;
 *   c2 — отметки нет / файл битый / чужая версия: deployNotice null, статус 200.
 *
 * Отрисовка строки в карточке движка проверяется тестами панели
 * (plugin/test/client.test.mjs); здесь — контракт маршрута.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowRuntime, createWebHandler } from '../../plugin/lib/api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-panel-notice-'));
  fs.mkdirSync(path.join(dir, 'docs', 'subagent-workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'subagent-workflow', 'VERSION'), '2.6.114\n');
  fs.mkdirSync(path.join(dir, 'docs', 'tasks'), { recursive: true });
  return dir;
}

function writeNotice(dir, value) {
  const file = path.join(dir, 'docs', 'subagent-workflow', 'deploy-notice.json');
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  return dir;
}

function noticeRecord(overrides = {}) {
  return {
    version: 1,
    at: '2026-11-26T00:30:00.000Z',
    mode: 'local',
    policy: 'gitignore',
    engine: { version: '2.6.114', root: 'C:/engine' },
    workspace: 'C:/ws',
    ignored: ['docs/subagent-workflow/'],
    machineLocal: ['docs/subagent-workflow/workflow.config.json', 'docs/subagent-workflow/acceptors.json', 'docs/subagent-workflow/hooks'],
    coordinator: {
      notice: 'код движка не вендорится: каталог docs/subagent-workflow/ в .gitignore проекта',
      action: 'клон обязан выполнить init до ворот и до check-acceptance в CI',
    },
    ...overrides,
  };
}

/** GET /api/status напрямую через обработчик: сервер для этого не нужен. */
async function statusOf(ws) {
  const handler = createWebHandler(createWorkflowRuntime({ roots: [ws] }));
  const res = {
    statusCode: 0,
    headers: {},
    writableEnded: false,
    body: '',
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(body) { this.body = body === undefined ? '' : String(body); this.writableEnded = true; },
  };
  const req = { method: 'GET', url: '/workflow/api/status', headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { json = null; }
  return { status: res.statusCode, json };
}

if (mode === 'c1') {
  const ws = writeNotice(workspace(), noticeRecord());
  let result;
  try {
    result = await statusOf(ws);
  } catch (error) {
    fail('c1', 'status упал: ' + (error && error.message ? error.message : String(error)));
    process.exit(1);
  }
  if (result.status !== 200) fail('c1', 'статус ' + result.status + ' вместо 200');
  const notice = result.json && result.json.deployNotice;
  if (!notice) fail('c1', 'status не отдаёт deployNotice');
  else {
    if (notice.policy !== 'gitignore') fail('c1', 'политика ' + notice.policy);
    if (notice.mode !== 'local') fail('c1', 'режим ' + notice.mode);
    if (!Array.isArray(notice.ignored) || !notice.ignored.includes('docs/subagent-workflow/')) fail('c1', 'ignored не называет каталог движка');
    if (!Array.isArray(notice.machineLocal) || notice.machineLocal.length !== 3) fail('c1', 'machineLocal не называет конфиг, ключи и хуки');
    if (!/не вендорится/u.test(String(notice.notice || ''))) fail('c1', 'в уведомлении нет политики словами');
    if (!/клон/u.test(String(notice.action || ''))) fail('c1', 'в уведомлении нет цены для клона');
  }
  /* Второй режим: vendored политика не подменяется на gitignore. */
  const ws2 = writeNotice(workspace(), noticeRecord({ policy: 'vendored' }));
  const second = await statusOf(ws2);
  if (!second.json || !second.json.deployNotice || second.json.deployNotice.policy !== 'vendored') {
    fail('c1', 'vendored-политика не доехала до панели');
  }
  if (bad === 0) console.log('PANEL-NOTICE OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  /* Нет файла: панель открывается, отметки нет. */
  const empty = await statusOf(workspace());
  if (empty.status !== 200) fail('c2', 'без отметки статус ' + empty.status);
  if (empty.json && empty.json.deployNotice !== null && empty.json.deployNotice !== undefined) {
    fail('c2', 'без файла панель выдумала отметку: ' + JSON.stringify(empty.json.deployNotice).slice(0, 120));
  }
  /* Битый файл: это «нет отметки», а не падение панели. */
  const broken = await statusOf(writeNotice(workspace(), '{ не json'));
  if (broken.status !== 200) fail('c2', 'битый файл уронил статус: ' + broken.status);
  if (broken.json && broken.json.deployNotice) fail('c2', 'битый файл дал отметку');
  /* Чужая версия записи: читаем только version 1. */
  const alien = await statusOf(writeNotice(workspace(), noticeRecord({ version: 2 })));
  if (alien.json && alien.json.deployNotice) fail('c2', 'запись чужой версии принята');
  /* Пустое уведомление координатора — отметки нет: показывать нечего. */
  const silent = await statusOf(writeNotice(workspace(), noticeRecord({ coordinator: { notice: '  ', action: '' } })));
  if (silent.json && silent.json.deployNotice) fail('c2', 'пустое уведомление принято за отметку');
  if (bad === 0) console.log('PANEL-NOTICE OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/panel-deploy-notice.mjs c1|c2');
process.exit(2);
