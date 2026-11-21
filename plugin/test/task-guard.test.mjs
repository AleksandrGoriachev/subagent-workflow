#!/usr/bin/env node
/**
 * 0086 / 2.6.87: обязательность задания не зависит от guard.enabled.
 *
 * Дефект: при guard.enabled=false task-guard выходил 0 без единого слова, и
 * tools/commit.ps1 коммитил любые пути без задания — структура обходилась флагом,
 * который задумывался как «выключить аудит». Проверяется поведение CLI на живом
 * git-репозитории: выключенный флаг отключает аудит и --range, но индекс по-прежнему
 * требует задание, а метка обхода не прикрывает защищённые пути.
 *
 * Формат: самостоятельный скрипт проверок (не node:test). Критерий 0086-C10
 * запускает его как `node --test <файл>` и сверяет машинную строку итога
 * «# fail 0»; скрипт печатает её только когда все сценарии прошли. Ошибка — exit 1.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(PKG, 'spec', 'scripts');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function git(repo, args) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function makeRepo({ enabled = false, task = true } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-tg-'));
  const engine = path.join(repo, 'docs', 'subagent-workflow');
  write(path.join(engine, 'scripts', 'lib', 'common.mjs'), fs.readFileSync(path.join(SRC, 'lib', 'common.mjs'), 'utf8'));
  write(path.join(engine, 'scripts', 'task-guard.mjs'), fs.readFileSync(path.join(SRC, 'task-guard.mjs'), 'utf8'));
  write(path.join(engine, 'workflow.config.json'), JSON.stringify({
    version: 1,
    tasksDir: 'docs/tasks',
    keysFile: 'docs/subagent-workflow/acceptors.json',
    logs: 'local',
    policy: { decisions: 'fail', coverage: 'fail', attack: 'off', roles: { modelFamily: 'warn' } },
    models: {},
    roles: {},
    guard: { enabled, mode: 'fail', allow: [], bypassMarker: 'workflow-bypass' },
  }, null, 2) + '\n');
  if (task) {
    const dir = path.join(repo, 'docs', 'tasks', '0001');
    write(path.join(dir, 'task.md'), ['# Задание 0001. Активное', '', '<!-- TASK-META', JSON.stringify({
      id: '0001', version: 1, title: 'активное', risk: 'low', created: '2026-11-21',
      owner: 'тест', executor: 'subagent:executor', acceptor: 'subagent:judge',
      base: 'HEAD', criteria: 'criteria.json', allowedPaths: ['src/**'], hashExclude: [], decisions: [],
    }, null, 2), '-->', ''].join('\n'));
    write(path.join(dir, 'criteria.lock'), JSON.stringify({
      version: 3, task: '0001', contractCommit: '0'.repeat(40), protected: [],
    }, null, 2) + '\n');
  }
  write(path.join(repo, 'README.md'), '# проба\n');
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@local']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}

function stage(repo, rel, text = 'x\n') {
  write(path.join(repo, rel), text);
  git(repo, ['add', rel]);
}

function guard(repo, args) {
  const script = path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-guard.mjs');
  const result = spawnSync(process.execPath, [script, '--repo', repo, ...args], { cwd: repo, encoding: 'utf8' });
  return { code: result.status, out: (result.stdout || '') + (result.stderr || '') };
}

const scenarios = [];
function scenario(name, fn) {
  scenarios.push({ name, fn });
}
function withRepo(options, fn) {
  const repo = makeRepo(options);
  try { fn(repo); } finally { fs.rmSync(repo, { recursive: true, force: true }); }
}

scenario('enabled=false: путь вне задания отклоняется с причиной', () => withRepo({}, (repo) => {
  stage(repo, 'notes.txt');
  const result = guard(repo, ['--staged']);
  assert.equal(result.code, 1);
  assert.match(result.out, /не покрыт/u);
  assert.match(result.out, /notes\.txt/u);
}));

scenario('enabled=false: путь под активным заданием проходит', () => withRepo({}, (repo) => {
  stage(repo, 'src/a.js');
  assert.equal(guard(repo, ['--staged']).code, 0);
}));

scenario('enabled=false: метка обхода разрешает незащищённый путь', () => withRepo({}, (repo) => {
  stage(repo, 'notes.txt');
  assert.equal(guard(repo, ['--staged', '--message', 'hotfix [workflow-bypass: срочно]']).code, 0);
}));

scenario('enabled=false: метка обхода не прикрывает защищённый путь', () => withRepo({}, (repo) => {
  stage(repo, 'tools/x.mjs', 'export const x = 1;\n');
  const result = guard(repo, ['--staged', '--message', 'hotfix [workflow-bypass: срочно]']);
  assert.equal(result.code, 1);
  assert.match(result.out, /tools\/x\.mjs/u);
}));

scenario('enabled=false: --audit и --range не блокируют', () => withRepo({}, (repo) => {
  stage(repo, 'notes.txt');
  git(repo, ['commit', '-q', '--no-verify', '-m', 'notes: вне задания']);
  assert.equal(guard(repo, ['--audit', '--range', 'HEAD~1..HEAD']).code, 0);
  assert.equal(guard(repo, ['--staged']).code, 0);
}));

scenario('enabled=true: прежние коды — покрыто 0, не покрыто 1', () => withRepo({ enabled: true }, (repo) => {
  stage(repo, 'src/a.js');
  assert.equal(guard(repo, ['--staged']).code, 0);
  stage(repo, 'notes.txt');
  assert.equal(guard(repo, ['--staged']).code, 1);
}));

let failed = 0;
for (const { name, fn } of scenarios) {
  try {
    fn();
    console.log('ok ' + name);
  } catch (error) {
    failed += 1;
    console.error('not ok ' + name + ': ' + (error && error.message ? error.message : error));
  }
}
console.log('# tests ' + scenarios.length);
console.log('# fail ' + failed);
process.exit(failed === 0 ? 0 : 1);
