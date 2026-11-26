#!/usr/bin/env node
/*
 * 0171: один контракт — два слоя. Аудит отвечает «для запуска …», «для приёмки …».
 *   c1 — недостающее названо раздельно: у обычной задачи без красного просится red.json,
 *        у лёгкой приёмка уже ok;
 *   c2 — INSTALL описывает таблицу слоёв и оба вопроса;
 *   c3 — --json отдаёт {run,accept} без лишнего текста в stdout.
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }

function run(cmd, args, cwd) {
  const r = spawnSyncPipeFree(cmd, args, { cwd, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

function meta(id, extra = {}) {
  return {
    id, version: 1, title: 'Проверка', risk: 'low', created: '2026-11-26', owner: 'координатор',
    executor: 'subagent:coordinator', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 's', model: 'm' }, base: 'HEAD',
    allowedPaths: ['tools/**'], redAllowDirty: ['docs/tasks/' + id + '/**'],
    decisions: [{ id: 'D1', class: 'mechanical', question: 'q', chosen: 'c', options: ['o'], impact: 'internal', evidence: { kind: 'criterion', ref: 'C1' }, reversible: true }],
    resultShape: { artifact: 'a', format: 'f', criterion: 'C1' },
    securityReview: false, humanSignoff: false, followUps: [],
    ...extra,
  };
}

function makeTask(root, id, { criteria = true, lock = true, light = false, extra = {} } = {}) {
  const dir = path.join(root, 'docs', 'tasks', id);
  fs.mkdirSync(dir, { recursive: true });
  const m = meta(id, extra);
  if (light) { m.mode = 'light'; m.checks = [{ id: 'C1', title: 't', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 } }]; }
  const text = [
    '# Задание ' + id + '. Проверка', '', '<!-- TASK-META', JSON.stringify(m, null, 2), '-->', '',
    '## Цель', '', 'Проверить.', '',
    '## Что не входит', '', '1. Ничего.', '',
    '## Инварианты', '', '1. Наблюдаемо.', '',
    '## Границы знания', '', '1. Только allowedPaths.', '',
    '## Среда', '', 'node 25.', '',
    '## Критерии приёмки', '', '<!-- CRITERIA:BEGIN -->',
    '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
    '| C1 | `node -e "process.exit(0)"` | `exit 0` |', '', '<!-- CRITERIA:END -->', '',
    '## Отчёт', '', 'Отчёт.', '', '## Коммит', '', 'По правилам.', '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'task.md'), text);
  if (criteria) fs.writeFileSync(path.join(dir, 'criteria.json'), JSON.stringify({ task: id, criteria: [{ id: 'C1', title: 't', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 }, covers: ['tools/a.mjs'] }] }, null, 2) + '\n');
  if (lock) fs.writeFileSync(path.join(dir, 'criteria.lock'), '{}\n');
  return dir;
}

function audit(root, taskDir, extra = []) {
  return run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-preflight.mjs'), '--contract', '--audit', '--task', taskDir, '--repo', root, ...extra], PKG);
}

if (mode === 'c1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-pfaudit-c1-'));
  try {
    const normal = makeTask(root, '1001', {});
    const r = audit(root, normal);
    if (r.code !== 0) fail('c1', 'аудит вернул ' + r.code + ' вместо 0: ' + r.out.trim().slice(-400));
    if (!/для запуска: ok/u.test(r.out)) fail('c1', 'запуск не признан готовым: ' + r.out.trim().slice(-400));
    if (!/для приёмки: не хватает/u.test(r.out)) fail('c1', 'приёмка не назвала недостающее: ' + r.out.trim().slice(-400));
    if (!/red\.json/u.test(r.out)) fail('c1', 'red.json не назван: ' + r.out.trim().slice(-400));

    const lightDir = makeTask(root, '1002', { light: true, criteria: false, lock: false, extra: { deviation: 'проверка: приёмщик объяснён отклонением' } });
    const l = audit(root, lightDir);
    if (!/для приёмки: ok/u.test(l.out)) fail('c1', 'лёгкая задача: приёмка не ok: ' + l.out.trim().slice(-400));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  if (bad === 0) console.log('PREFLIGHT-AUDIT OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const text = fs.readFileSync(path.join(PKG, 'INSTALL.md'), 'utf8');
  if (!/Контракт задания и два слоя/u.test(text)) fail('c2', 'в INSTALL нет раздела «Контракт задания и два слоя»');
  if (!/для запуска/u.test(text)) fail('c2', 'в INSTALL нет вопроса «для запуска»');
  if (!/для приёмки/u.test(text)) fail('c2', 'в INSTALL нет вопроса «для приёмки»');
  if (!/allowedPaths/u.test(text) || !/acceptorNode/u.test(text) || !/criteria\.json/u.test(text)) fail('c2', 'таблица не называет поля слоёв');
  if (bad === 0) console.log('PREFLIGHT-AUDIT OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c3') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-pfaudit-c3-'));
  try {
    const taskDir = makeTask(root, '1003', {});
    const r = audit(root, taskDir, ['--json']);
    if (r.code !== 0) fail('c3', 'аудит --json вернул ' + r.code);
    let data = null;
    try { data = JSON.parse(r.out.trim()); } catch (error) { fail('c3', 'вывод не JSON: ' + String(error.message) + ': ' + r.out.trim().slice(0, 200)); }
    if (data) {
      if (!data.run || typeof data.run.ok !== 'boolean' || !Array.isArray(data.run.missing)) fail('c3', 'нет блока run');
      if (!data.accept || typeof data.accept.ok !== 'boolean' || !Array.isArray(data.accept.missing)) fail('c3', 'нет блока accept');
      if (data.run.ok !== true) fail('c3', 'run.ok не true на годном контракте');
      if (data.accept.ok !== false || data.accept.missing.length === 0) fail('c3', 'accept не назвал недостающее');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  if (bad === 0) console.log('PREFLIGHT-AUDIT OK c3');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/preflight-audit.mjs c1|c2|c3');
process.exit(2);
