#!/usr/bin/env node
/*
 * 2.6.105 (0124): сбой чтения дерева git — не «файл не закоммичен».
 *
 * Наблюдено на 0123: task-verify упал 354 строками «контракт: файл контракта не
 * закоммичен: spec/scripts/…» при закоммиченных файлах; повтор той же команды
 * прошёл. checkContractCommitted получал пустой filesAtCommit (транзиентный ответ
 * git ls-tree), headFiles становился [], и проверка объявляла незакоммиченным всё.
 *
 * c1: HEAD без файлов при непустом рабочем дереве — отказ «git не ответил»
 *     (gitReadFailed), а не список незакоммиченных файлов.
 * c2: действительно незакоммиченный защищённый файл — прежнее сообщение
 *     «файл контракта не закоммичен» с именем файла.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkContractCommitted } from '../scripts/lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gitread-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, { cwd, timeout: 120000, windowsHide: true, stdio: ['ignore', ofd, efd] });
  } finally {
    try { fs.closeSync(ofd); } catch { /* ignore */ }
    try { fs.closeSync(efd); } catch { /* ignore */ }
  }
  let out = '';
  try { out = fs.readFileSync(outFile, 'utf8') + fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: res.status, out };
}
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gitread-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p@l']);
  git(repo, ['config', 'user.name', 'p']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  return repo;
}

function c1() {
  const repo = makeRepo();
  try {
    /* HEAD есть, но файлов в нём нет; в рабочем дереве файлы есть. */
    const empty = git(repo, ['commit', '-q', '--allow-empty', '-m', 'empty']);
    truthy(empty.code === 0, 'фикстура: пустой коммит не создан: ' + empty.out.trim().slice(-200));
    write(path.join(repo, 'docs', 'tasks', '0001', 'task.md'), '# x\n');
    const meta = { id: '0001', protectedPaths: [] };
    const result = checkContractCommitted(repo, path.join(repo, 'docs', 'tasks', '0001'), meta);
    truthy(result.ok === false, 'пустое дерево HEAD принято как валидный контракт');
    truthy(result.gitReadFailed === true, 'сбой чтения не помечен gitReadFailed: ' + JSON.stringify(result.errors));
    truthy(/git не ответил/u.test(result.errors.join(' ')), 'отказ не говорит про сбой чтения: ' + JSON.stringify(result.errors));
    truthy(!/файл контракта не закоммичен/u.test(result.errors.join(' ')), 'сбой чтения выдан за незакоммиченный файл');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  console.log('GITREAD OK c1');
}

function c2() {
  const repo = makeRepo();
  try {
    write(path.join(repo, 'docs', 'tasks', '0001', 'task.md'), '# x\n');
    write(path.join(repo, 'docs', 'tasks', '0001', 'criteria.json'), '{}\n');
    const commit = git(repo, ['add', '-A']);
    truthy(commit.code === 0, 'фикстура: git add не прошёл');
    const committed = git(repo, ['commit', '-q', '-m', 'contract']);
    truthy(committed.code === 0, 'фикстура: коммит не создан');
    /* Защищённый файл есть только в рабочем дереве — это настоящий «не закоммичен». */
    write(path.join(repo, 'checks', 'probe.mjs'), 'export const x = 1;\n');
    const meta = { id: '0001', protectedPaths: ['checks/**'] };
    const result = checkContractCommitted(repo, path.join(repo, 'docs', 'tasks', '0001'), meta);
    truthy(result.ok === false, 'незакоммиченный защищённый файл не пойман');
    const text = result.errors.join(' ');
    truthy(/файл контракта не закоммичен: checks\/probe\.mjs/u.test(text), 'отказ не называет файл: ' + text);
    truthy(!result.gitReadFailed, 'настоящий случай помечен как сбой чтения');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  console.log('GITREAD OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/verify-git-read.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('GITREAD FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
