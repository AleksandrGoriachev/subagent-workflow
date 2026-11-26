#!/usr/bin/env node
/*
 * 0169: лёгкая задача описана там, где контракт пишут, а отказ без criteria.json
 * называет оба пути.
 *   c1 — в шаблоне есть раздел «Лёгкая задача» с mode=light, checks и --allow-missing-red;
 *   c2 — линт без criteria.json отказывает списком, называет оба пути и шаблон (не стектрейс);
 *   c3 — лёгкая задача проходит линт без criteria.json и замка.
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

function contractText(id, { light }) {
  const meta = light
    ? { id, version: 1, title: 'Лёгкая', risk: 'low', created: '2026-11-26', owner: 'координатор', executor: 'subagent:coordinator', acceptor: 'subagent:judge', issuedBy: { kind: 'agent', session: 's', model: 'm' }, base: 'HEAD', mode: 'light', checks: [{ id: 'C1', title: 'Проверка', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 } }], allowedPaths: ['tools/**'], redAllowDirty: ['docs/tasks/' + id + '/**'], decisions: [{ id: 'D1', class: 'mechanical', question: 'q', chosen: 'c', options: ['o'], impact: 'internal', evidence: { kind: 'criterion', ref: 'C1' }, reversible: true }], resultShape: { artifact: 'a', format: 'f', criterion: 'C1' }, securityReview: false, humanSignoff: false, followUps: [] }
    : { id, version: 1, title: 'Обычная', risk: 'low', created: '2026-11-26', owner: 'координатор', executor: 'subagent:coordinator', acceptor: 'subagent:judge', issuedBy: { kind: 'agent', session: 's', model: 'm' }, base: 'HEAD', criteria: 'criteria.json', allowedPaths: ['tools/**'], redAllowDirty: ['docs/tasks/' + id + '/**'], decisions: [{ id: 'D1', class: 'mechanical', question: 'q', chosen: 'c', options: ['o'], impact: 'internal', evidence: { kind: 'criterion', ref: 'C1' }, reversible: true }], resultShape: { artifact: 'a', format: 'f', criterion: 'C1' }, securityReview: false, humanSignoff: false, followUps: [] };
  return [
    '# Задание ' + id + '. Проверка', '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '',
    '## Цель', '', 'Проверить.', '',
    '## Что не входит', '', '1. Ничего.', '',
    '## Инварианты', '', '1. Наблюдаемо.', '',
    '## Границы знания', '', '1. Только allowedPaths.', '',
    '## Среда', '', 'node 25.', '',
    '## Критерии приёмки', '', '<!-- CRITERIA:BEGIN -->',
    '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
    '| C1 | `node -e "process.exit(0)"` | `exit 0` |', '', '<!-- CRITERIA:END -->', '',
    '## Отчёт', '', 'Отчёт — критерии.', '',
    '## Коммит', '', 'По правилам движка.', '',
  ].join('\n');
}

function makeTask(root, id, opts) {
  const dir = path.join(root, 'docs', 'tasks', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.md'), contractText(id, opts));
  return dir;
}

if (mode === 'c1') {
  const tpl = fs.readFileSync(path.join(PKG, 'spec', 'templates', 'task.md'), 'utf8');
  if (!/Лёгкая задача/u.test(tpl)) fail('c1', 'в шаблоне нет раздела «Лёгкая задача»');
  if (!/"mode": "light"/u.test(tpl)) fail('c1', 'в шаблоне нет "mode": "light"');
  if (!/"checks"/u.test(tpl)) fail('c1', 'в шаблоне нет "checks"');
  if (!/allow-missing-red/u.test(tpl)) fail('c1', 'в шаблоне нет --allow-missing-red');
  if (!/criteria\.lock/u.test(tpl)) fail('c1', 'в шаблоне не сказано про отсутствие criteria.lock');
  if (bad === 0) console.log('TEMPLATE-LIGHT OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-tpl-c2-'));
  try {
    const dir = makeTask(root, '0801', { light: false });
    const r = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-lint.mjs'), '--task', dir, '--repo', root], PKG);
    if (r.code === 0) fail('c2', 'линт пропустил обычную задачу без criteria.json');
    if (!/criteria\.json/u.test(r.out)) fail('c2', 'файл критериев не назван: ' + r.out.trim().slice(-400));
    if (!/mode=light/u.test(r.out)) fail('c2', 'лёгкий путь не назван: ' + r.out.trim().slice(-400));
    if (!/templates\/task\.md/u.test(r.out)) fail('c2', 'шаблон не назван: ' + r.out.trim().slice(-400));
    if (/\n\s+at /u.test(r.out)) fail('c2', 'отказ напечатан стектрейсом: ' + r.out.trim().slice(-300));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  if (bad === 0) console.log('TEMPLATE-LIGHT OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c3') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-tpl-c3-'));
  try {
    const dir = makeTask(root, '0802', { light: true });
    const r = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-lint.mjs'), '--task', dir, '--repo', root], PKG);
    if (r.code !== 0) fail('c3', 'лёгкая задача не прошла линт: ' + r.out.trim().slice(-500));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  if (bad === 0) console.log('TEMPLATE-LIGHT OK c3');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/template-light.mjs c1|c2|c3');
process.exit(2);
