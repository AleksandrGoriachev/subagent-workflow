#!/usr/bin/env node
/*
 * 0165: отказ гейта называет причину, а не только «изменение вне активного задания».
 *   c1 — нет блока TASK-META; TASK-META не разбирается как JSON;
 *   c2 — задание принято (acceptance.json) и контракт не заперт (нет criteria.lock),
 *        плюс режим --diagnose без попытки коммита;
 *   c3 — путь не покрыт allowedPaths активного задания (шаблоны названы), покрытый проходит.
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

function git(dir, args) {
  const r = spawnSyncPipeFree('git', ['-c', 'core.hooksPath=.git/empty-hooks', ...args], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-guard-causes-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'check@example.invalid']);
  git(dir, ['config', 'user.name', 'check']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(dir, ['add', 'README.md']);
  const commit = git(dir, ['commit', '-q', '-m', 'base']);
  if (commit.code !== 0) throw new Error('не удалось создать базовый коммит: ' + commit.out);
  return dir;
}

function meta(id, allowedPaths = ['tools/**']) {
  return { id, version: 1, risk: 'low', owner: 'координатор', allowedPaths };
}

function addTask(dir, id, { taskText, lock = true, acceptance = false, closure = false, allowedPaths } = {}) {
  const taskDir = path.join(dir, 'docs', 'tasks', id);
  fs.mkdirSync(taskDir, { recursive: true });
  const text = taskText !== undefined
    ? taskText
    : '# Задание\n\n<!-- TASK-META\n' + JSON.stringify(meta(id, allowedPaths), null, 2) + '\n-->\n\n## Цель\n\nПроверка.\n';
  fs.writeFileSync(path.join(taskDir, 'task.md'), text);
  if (lock) fs.writeFileSync(path.join(taskDir, 'criteria.lock'), '{}\n');
  if (acceptance) fs.writeFileSync(path.join(taskDir, 'acceptance.json'), '{}\n');
  if (closure) fs.writeFileSync(path.join(taskDir, 'closure.json'), '{}\n');
  return taskDir;
}

function stage(dir, rel) {
  const file = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x\n');
  git(dir, ['add', rel]);
}

function guard(dir, extra = []) {
  const r = spawnSyncPipeFree(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-guard.mjs'), '--repo', dir, ...extra], { cwd: PKG, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

function withRepo(fn) {
  const dir = makeRepo();
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (mode === 'c1') {
  withRepo((dir) => {
    addTask(dir, '0601', { taskText: '# Задание без метаданных\n' });
    stage(dir, 'tools/a.mjs');
    const r = guard(dir, ['--staged']);
    if (r.code !== 1) fail('c1', 'нет META: код ' + r.code + ' вместо 1: ' + r.out.trim().slice(-400));
    if (!/не покрыт: tools\/a\.mjs/u.test(r.out)) fail('c1', 'путь не назван: ' + r.out.trim().slice(-400));
    if (!/ПРИЧИНА docs\/tasks\/0601: нет блока TASK-META/u.test(r.out)) fail('c1', 'причина «нет TASK-META» не названа: ' + r.out.trim().slice(-400));
  });

  withRepo((dir) => {
    addTask(dir, '0602', { taskText: '# Задание\n\n<!-- TASK-META\n{ "id": "0602",\n-->\n' });
    stage(dir, 'tools/a.mjs');
    const r = guard(dir, ['--staged']);
    if (r.code !== 1) fail('c1', 'битый JSON: код ' + r.code + ' вместо 1');
    if (!/TASK-META не разбирается как JSON/u.test(r.out)) fail('c1', 'битый JSON не назван: ' + r.out.trim().slice(-400));
  });

  if (bad === 0) console.log('GUARD-CAUSES OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  withRepo((dir) => {
    addTask(dir, '0603', { acceptance: true });
    stage(dir, 'tools/a.mjs');
    const r = guard(dir, ['--staged']);
    if (r.code !== 1) fail('c2', 'принятое задание: код ' + r.code + ' вместо 1');
    if (!/задание принято \(acceptance\.json\)/u.test(r.out)) fail('c2', '«принято» не названо: ' + r.out.trim().slice(-400));
    if (!/новым заданием/u.test(r.out)) fail('c2', 'рецепт «новым заданием» не назван: ' + r.out.trim().slice(-400));
  });

  withRepo((dir) => {
    addTask(dir, '0604', { lock: false });
    stage(dir, 'tools/a.mjs');
    const r = guard(dir, ['--staged']);
    if (r.code !== 1) fail('c2', 'незапертый контракт: код ' + r.code + ' вместо 1');
    if (!/нет criteria\.lock/u.test(r.out)) fail('c2', 'причина «нет criteria.lock» не названа: ' + r.out.trim().slice(-400));
    if (!/task-hash\.mjs --task docs\/tasks\/0604 --repo \. --write/u.test(r.out)) fail('c2', 'рецепт task-hash не назван: ' + r.out.trim().slice(-400));

    /* --diagnose: те же причины без попытки коммита. */
    const d = guard(dir, ['--diagnose', '--paths', 'tools/a.mjs']);
    if (d.code !== 0) fail('c2', '--diagnose дал код ' + d.code + ' вместо 0');
    if (!/ПРИЧИНА docs\/tasks\/0604/u.test(d.out)) fail('c2', '--diagnose не назвал задание: ' + d.out.trim().slice(-400));
    if (!/диагностика/u.test(d.out)) fail('c2', '--diagnose не напечатал итог');
  });

  if (bad === 0) console.log('GUARD-CAUSES OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c3') {
  withRepo((dir) => {
    addTask(dir, '0605', { allowedPaths: ['plugins/**'] });
    stage(dir, 'tools/a.mjs');
    const r = guard(dir, ['--staged']);
    if (r.code !== 1) fail('c3', 'непокрытый путь: код ' + r.code + ' вместо 1');
    if (!/не покрыт: tools\/a\.mjs/u.test(r.out)) fail('c3', 'путь не назван: ' + r.out.trim().slice(-400));
    if (!/allowedPaths не покрывает: tools\/a\.mjs/u.test(r.out)) fail('c3', 'шаблоны задания не объяснены: ' + r.out.trim().slice(-400));
    if (!/plugins\/\*\*/u.test(r.out)) fail('c3', 'список allowedPaths не напечатан: ' + r.out.trim().slice(-400));
  });

  /* Контроль: покрытый путь проходит без отказа. */
  withRepo((dir) => {
    addTask(dir, '0606', { allowedPaths: ['plugins/**'] });
    stage(dir, 'plugins/b.mjs');
    const r = guard(dir, ['--staged']);
    if (r.code !== 0) fail('c3', 'покрытый путь дал код ' + r.code + ': ' + r.out.trim().slice(-400));
  });

  if (bad === 0) console.log('GUARD-CAUSES OK c3');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/guard-causes.mjs c1|c2|c3');
process.exit(2);
