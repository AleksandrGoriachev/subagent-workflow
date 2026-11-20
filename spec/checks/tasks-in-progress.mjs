#!/usr/bin/env node
/*
 * Задание 0084: tasksInProgress обязан считать закрытые задания завершёнными.
 *
 * Дефект (письмо structure --217): задания, закрытые штатным task-close, остаются
 * «незавершёнными» навсегда — в списке блокировки обновления висят closed/superseded
 * задания, у которых приёмки нет по определению. Причина: tasksInProgress смотрел
 * только acceptance.json со status accepted и не читал closure.json.
 *
 * Проверка строит временный корень с каталогами заданий и зовёт настоящую функцию.
 *
 *   c1 — closed: не в списке, открытое рядом — в списке;
 *   c2 — superseded (с successor): не в списке;
 *   c3 — accepted не в списке, closure с незнакомым статусом считается незавершённым;
 *   c4 — принятое и закрытое одновременно не в списке, каталог без артефактов игнорируется.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const CASE = process.argv[2] || 'c1';

function task(root, id, files) {
  const dir = path.join(root, 'docs', 'tasks', id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
}
function closure(status, successor) {
  return { version: 1, task: 'x', status, reason: 'проверка', by: 'check', at: '2026-11-20T00:00:00.000Z', successor: successor || null, evidence: [] };
}
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-tasks-in-progress-'));
  const taskMd = '# Задание. Заглушка' + String.fromCharCode(10);
  task(root, '9001', { 'task.md': taskMd, 'closure.json': closure('closed', null) });
  task(root, '9002', { 'task.md': taskMd, 'closure.json': closure('superseded', '9003') });
  task(root, '9003', { 'task.md': taskMd, 'acceptance.json': { status: 'accepted' } });
  task(root, '9004', { 'task.md': taskMd });
  task(root, '9005', { 'task.md': taskMd, 'closure.json': closure('draft', null) });
  task(root, '9006', { 'task.md': taskMd, 'acceptance.json': { status: 'accepted' }, 'closure.json': closure('closed', null) });
  fs.mkdirSync(path.join(root, 'docs', 'tasks', '9007', '_superseded'), { recursive: true });
  return root;
}

async function load() {
  const module = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'deploy.js')).href);
  if (typeof module.tasksInProgress !== 'function') throw new Error('нет экспорта tasksInProgress');
  return module.tasksInProgress;
}

function expect(list, id, present, problems) {
  const found = list.includes(id);
  if (found !== present) problems.push(id + (present ? ' должен быть в списке' : ' не должен быть в списке'));
}
function fail(problems) {
  console.log('FAIL ' + CASE + ': ' + problems.join('; '));
  return 1;
}

const tasksInProgress = await load();
const root = makeRoot();
const list = tasksInProgress(root);
const problems = [];

if (CASE === 'c2') {
  expect(list, '9002', false, problems);
  expect(list, '9004', true, problems);
} else if (CASE === 'c3') {
  expect(list, '9003', false, problems);
  expect(list, '9005', true, problems);
} else if (CASE === 'c4') {
  expect(list, '9006', false, problems);
  expect(list, '9007', false, problems);
} else {
  expect(list, '9001', false, problems);
  expect(list, '9004', true, problems);
}

try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* уборка не влияет на вердикт */ }
if (problems.length > 0) process.exitCode = fail(problems);
else { console.log('TASKS IN PROGRESS OK ' + CASE); process.exitCode = 0; }
