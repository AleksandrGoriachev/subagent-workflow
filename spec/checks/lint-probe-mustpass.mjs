#!/usr/bin/env node
/*
 * 0157 (R3 письма structure--243): mustPass, красный уже на базе, останавливает
 * красный прогон. У structure это стоило 40 минут на задании 0355.
 *
 *   c1 — флаг --probe-mustpass: красный mustPass назван критерием и первой
 *        строкой вывода, код возврата lint остаётся 0;
 *   c2 (негатив) — без флага прогона нет и предупреждения нет; на зелёном
 *        mustPass под флагом предупреждения тоже нет.
 *
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
  const r = spawnSyncPipeFree(cmd, args, { cwd, encoding: 'utf8', timeout: 300000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

/* Фикстура: один mustPass с заданным поведением. */
function makeRepo({ command }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-probe-mustpass-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p@l']);
  git(repo, ['config', 'user.name', 'p']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', '0001');
  const meta = {
    id: '0001', version: 1, title: 'т', risk: 'low', created: '2026-11-26', owner: 'a',
    executor: 'subagent:executor', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 's', model: 'm' }, base: 'HEAD', criteria: 'criteria.json',
    allowedPaths: ['docs/tasks/0001/**'], protectedPaths: [],
    redAllowDirty: ['docs/tasks/0001/**'], hashExclude: [], decisions: [],
  };
  const body = ['# Задание 0001', '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '',
    '## Цель', '', 'x', '', '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '',
    '## Границы знания', '', '1. x.', '', '## Среда', '', 'node.', '',
    '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '', '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
    '| C1 | ' + command + ' | ok |', '<!-- CRITERIA:END -->', '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  const criteria = {
    task: '0001',
    setup: [],
    teardown: [],
    redExpect: { mustFail: [], mustPass: ['C1'], reasons: {}, noRed: { reason: 'фикстура LINT-PROBE: контракт без красного' } },
    criteria: [{ id: 'C1', title: 't', command, covers: ['docs/tasks/0001/**'], expect: { exitCode: 0 }, tags: ['fast'] }],
  };
  write(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2) + '\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'contract']);
  run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/0001', '--repo', repo, '--write'], repo);
  return repo;
}

function lint(repo, extra = []) {
  return run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-lint.mjs'), '--task', 'docs/tasks/0001', ...extra], repo);
}

const RED_COMMAND = 'node -e "console.log(\'PROBE-RED: этот страж уже красный на базе\'); process.exit(1)"';
const GREEN_COMMAND = 'node -e "process.exit(0)"';

if (mode === 'c1') {
  const repo = makeRepo({ command: RED_COMMAND });
  try {
    const r = lint(repo, ['--probe-mustpass']);
    if (r.code !== 0) fail('c1', 'lint отказал (exit ' + r.code + '): ' + r.out.trim().slice(-400));
    if (!/уже красн/iu.test(r.out)) fail('c1', 'WARN о красном mustPass не напечатан: ' + r.out.trim().slice(-400));
    if (!/C1/u.test(r.out)) fail('c1', 'WARN не называет критерий: ' + r.out.trim().slice(-400));
    if (!/PROBE-RED/u.test(r.out)) fail('c1', 'WARN не печатает первую строку вывода: ' + r.out.trim().slice(-400));
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  if (bad === 0) console.log('LINT-PROBE OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  /* Без флага прогона нет — и предупреждения нет. */
  const quiet = makeRepo({ command: RED_COMMAND });
  try {
    const r = lint(quiet);
    if (r.code !== 0) fail('c2', 'lint отказал без флага (exit ' + r.code + '): ' + r.out.trim().slice(-400));
    if (/уже красн/iu.test(r.out)) fail('c2', 'без флага lint прогонял mustPass и предупредил: ' + r.out.trim().slice(-400));
  } finally { fs.rmSync(quiet, { recursive: true, force: true }); }
  /* На зелёном mustPass под флагом предупреждения нет. */
  const green = makeRepo({ command: GREEN_COMMAND });
  try {
    const r = lint(green, ['--probe-mustpass']);
    if (r.code !== 0) fail('c2', 'lint отказал на зелёной фикстуре (exit ' + r.code + '): ' + r.out.trim().slice(-400));
    if (/уже красн/iu.test(r.out)) fail('c2', 'предупреждение на зелёном mustPass: ' + r.out.trim().slice(-400));
  } finally { fs.rmSync(green, { recursive: true, force: true }); }
  if (bad === 0) console.log('LINT-PROBE OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/lint-probe-mustpass.mjs c1|c2');
process.exit(2);
