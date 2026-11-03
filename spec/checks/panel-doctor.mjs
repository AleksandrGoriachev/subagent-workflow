#!/usr/bin/env node
/*
 * 2.6.16 (0042): doctor, запущенный из панели, не краснеет из-за отсутствия сессии.
 *
 * Панель спавнит проверку в процессе DSH-хоста, где нет DSH_SESSION_ID. Доктор
 * честно видел «актора нет» и валил две проверки — на любом воркспейсе, всегда.
 * Теперь панель помечает контекст (WF_CHECK_CONTEXT=panel), и доктор переводит
 * эти две проверки в WARN с прямой формулировкой; вне панели вердикт прежний.
 *
 * Проверяется исполнением: настоящий runCheck панели и доктор без маркера.
 * Вне пакета — SKIP (конвенция deployed-copy).
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

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-panel-doctor-'));

function truthy(value, label) { if (!value) throw new Error(label); }
function contains(text, needle, label) {
  if (!String(text).includes(needle)) throw new Error(label + ': нет «' + needle + '» в выводе: ' + String(text).slice(-800));
}

/** Развёрнутый движок: init из пакета, как в жизни. */
function deployedRepo() {
  const repo = fs.mkdtempSync(path.join(ROOT, 'repo-'));
  const git = spawnSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
  truthy(git.status === 0, 'git init фикстуры');
  const init = spawnSync(process.execPath, [
    path.join(PKG, 'spec', 'scripts', 'init.mjs'),
    '--repo', repo, '--key-id', 'agent-judge', '--key-out', path.join(repo, '.wf-keys'),
  ], { cwd: PKG, stdio: 'ignore', env: { ...process.env } });
  truthy(init.status === 0, 'init развернул движок в фикстуре (exit ' + init.status + ')');
  return repo;
}

async function c1() {
  const repo = deployedRepo();
  const checks = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'checks.js')).href);

  /*
   * Как в панели: сессии агента нет (в хосте DSH её нет), маркер контекста
   * ставит сама панель. Переменные убираем на время вызова и возвращаем назад:
   * иначе проверка унаследует сессию того, кто её запустил, и ничего не докажет.
   */
  const saved = { DSH_SESSION_ID: process.env.DSH_SESSION_ID, WF_ACTOR_SESSION: process.env.WF_ACTOR_SESSION };
  delete process.env.DSH_SESSION_ID;
  delete process.env.WF_ACTOR_SESSION;
  const spec = checks.buildCheck('doctor', {
    root: repo,
    tasksDir: 'docs/tasks',
    keysFile: path.join(repo, 'docs', 'subagent-workflow', 'acceptors.json'),
  });
  let result;
  try {
    result = await checks.runCheck(spec, { timeoutMs: 300000 });
  } finally {
    if (saved.DSH_SESSION_ID !== undefined) process.env.DSH_SESSION_ID = saved.DSH_SESSION_ID;
    if (saved.WF_ACTOR_SESSION !== undefined) process.env.WF_ACTOR_SESSION = saved.WF_ACTOR_SESSION;
  }
  truthy(result.exitCode === 0, 'доктор из панели: exit ' + result.exitCode + '; вывод: ' + String(result.log).slice(-1200));
  contains(result.log, 'проверка запущена из панели', 'доктор из панели');
  contains(result.log, 'WARN  актор виден окружению', 'доктор из панели');
  truthy(!/FAIL  актор виден окружению/u.test(String(result.log)), 'доктор из панели: актор не должен быть FAIL');
  truthy(!/FAIL  medium возможен/u.test(String(result.log)), 'доктор из панели: medium не должен быть FAIL');

  /* Без маркера тот же воркспейс остаётся честно красным: проверка не ослепла. */
  const manual = spawnSync(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'doctor.mjs')], {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: (() => { const env = { ...process.env }; delete env.WF_CHECK_CONTEXT; delete env.DSH_SESSION_ID; delete env.WF_ACTOR_SESSION; return env; })(),
  });
  truthy(manual.status === 1, 'доктор без маркера: exit ' + manual.status + ' (ожидался 1)');
  contains(manual.stdout, 'FAIL  актор виден окружению', 'доктор без маркера');
  contains(manual.stdout, 'DOCTOR: ', 'доктор без маркера');

  /* С сессией агента и без маркера — зелёный, как раньше. */
  const withSession = spawnSync(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'doctor.mjs')], {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: (() => { const env = { ...process.env }; delete env.WF_CHECK_CONTEXT; env.DSH_SESSION_ID = 'session-check-fixture'; return env; })(),
  });
  truthy(withSession.status === 0, 'доктор с сессией: exit ' + withSession.status + '; вывод: ' + String(withSession.stdout).slice(-800));
  contains(withSession.stdout, 'DOCTOR OK', 'доктор с сессией');
}

const cases = { c1 };
const id = String(process.argv[2] || 'c1').toLowerCase();
try {
  if (!Object.hasOwn(cases, id)) {
    console.log('PANEL-DOCTOR FAIL usage: node spec/checks/panel-doctor.mjs c1');
    process.exit(2);
  }
  await cases[id]();
  console.log('PANEL-DOCTOR OK ' + id);
} catch (error) {
  console.log('PANEL-DOCTOR FAIL ' + id + ': ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
}
