#!/usr/bin/env node
/*
 * Приёмочные проверки задания 0002 (запрет обхода workflow).
 *
 * Каждый кейс строит одноразовый git-репозиторий, разворачивает в нём копию
 * пакета (spec/ -> docs/subagent-workflow/), готовит состояние и сверяет
 * наблюдаемое поведение с ожиданием. Скрипт НЕ трогает ~/.wf-keys: init для
 * кейса hooks получает --key-out во временный каталог.
 *
 * Режимы: --case <имя> (один кейс, код возврата = его результат), --all.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const GUARD_REL = path.join('docs', 'subagent-workflow', 'scripts', 'task-guard.mjs');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { code: result.status, out: String(result.stdout || '') + String(result.stderr || '') };
}

function node(script, args, cwd) {
  return run(process.execPath, [script, ...args], cwd);
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
}

function guardConfig(enabled) {
  return {
    version: 1,
    tasksDir: 'docs/tasks',
    keysFile: 'docs/subagent-workflow/acceptors.json',
    logs: 'local',
    actor: { primaryEnv: 'DSH_SESSION_ID', fallbackEnv: 'TASK_ACTOR_SESSION', modelEnv: 'DSH_MODEL' },
    policy: { decisions: 'fail', coverage: 'fail', attack: 'off', roles: { modelFamily: 'warn' } },
    models: {},
    roles: {},
    verifyTimeoutMs: 1800000,
    guard: { enabled, mode: 'fail', allow: [], bypassMarker: 'workflow-bypass' },
  };
}

function git(repo, args) {
  return run('git', args, repo);
}

/** Свежий репозиторий с развёрнутой копией пакета и одним активным заданием. */
function makeRepo({ enabled = true, task = true } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-guard-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'guard@local']);
  git(repo, ['config', 'user.name', 'guard']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  write(path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json'), JSON.stringify(guardConfig(enabled), null, 2) + '\n');
  if (task) {
    const dir = path.join(repo, 'docs', 'tasks', '0001');
    write(path.join(dir, 'task.md'), ['# Задание 0001. Активное', '',
      '<!-- TASK-META',
      JSON.stringify({
        id: '0001', version: 1, title: 'активное', risk: 'low', created: '2026-10-28',
        owner: 'архитектор', executor: 'subagent:executor', acceptor: 'subagent:judge',
        base: 'HEAD', criteria: 'criteria.json', allowedPaths: ['src/**'], hashExclude: [], decisions: [],
      }, null, 2),
      '-->', '', '## Цель', '', 'Заглушка.', ''].join('\n'));
    write(path.join(dir, 'criteria.json'), JSON.stringify({ task: '0001', criteria: [{ id: 'C1', title: 'c', command: 'node -e "1"', expect: { exitCode: 0 } }] }, null, 2) + '\n');
    write(path.join(dir, 'criteria.lock'), JSON.stringify({ version: 3, task: '0001', contractCommit: '0'.repeat(40), protected: [] }, null, 2) + '\n');
  }
  write(path.join(repo, 'README.md'), '# проба\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}

function stage(repo, rel, text = 'x\n') {
  write(path.join(repo, rel), text);
  git(repo, ['add', rel]);
}

function cleanup(repo) {
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
}

function guard(repo, args) {
  return node(path.join(repo, GUARD_REL), ['--repo', repo, ...args], repo);
}

const CASES = {
  /* Активное задание покрывает src/** — изменение проходит. */
  allow() {
    const repo = makeRepo();
    try {
      stage(repo, 'src/a.js');
      const result = guard(repo, ['--staged']);
      return { ok: result.code === 0, detail: 'exit=' + result.code + ' ' + result.out.trim().slice(0, 200) };
    } finally { cleanup(repo); }
  },
  /* Путь вне заданий — отказ с названием пути. */
  deny() {
    const repo = makeRepo();
    try {
      stage(repo, 'notes.txt');
      const result = guard(repo, ['--staged']);
      const mentionsPath = result.out.includes('notes.txt');
      const explains = /не покрыт/i.test(result.out);
      return {
        ok: result.code === 1 && mentionsPath && explains,
        detail: 'exit=' + result.code + ' path=' + mentionsPath + ' explains=' + explains + ' ' + result.out.trim().slice(0, 240),
      };
    } finally { cleanup(repo); }
  },
  /* Явная метка обхода разрешает и попадает в аудит. */
  bypass() {
    const repo = makeRepo();
    try {
      stage(repo, 'notes.txt');
      const allowed = guard(repo, ['--staged', '--message', 'hotfix [workflow-bypass: срочно]']);
      git(repo, ['commit', '-q', '-m', 'hotfix [workflow-bypass: срочно]']);
      const audit = guard(repo, ['--audit', '--range', 'HEAD~1..HEAD']);
      const mentions = /workflow-bypass/.test(audit.out);
      return {
        ok: allowed.code === 0 && audit.code === 0 && mentions,
        detail: 'allow=' + allowed.code + ' audit=' + audit.code + ' mentions=' + mentions + ' ' + audit.out.trim().slice(0, 200),
      };
    } finally { cleanup(repo); }
  },
  /* Выключенный guard не мешает. */
  disabled() {
    const repo = makeRepo({ enabled: false });
    try {
      stage(repo, 'notes.txt');
      const result = guard(repo, ['--staged']);
      return { ok: result.code === 0, detail: 'exit=' + result.code + ' ' + result.out.trim().slice(0, 160) };
    } finally { cleanup(repo); }
  },
  /* init ставит хуки локально и только в этом репозитории. */
  hooks() {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-hooks-'));
    const keys = path.join(repo, '..', path.basename(repo) + '-keys');
    try {
      git(repo, ['init', '-q']);
      git(repo, ['config', 'user.email', 'guard@local']);
      git(repo, ['config', 'user.name', 'guard']);
      write(path.join(repo, 'README.md'), '# проба\n');
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', 'base']);
      const init = node(path.join(PKG, 'spec', 'scripts', 'init.mjs'), ['--repo', repo, '--force', '--key-out', keys], repo);
      const local = git(repo, ['config', '--get', 'core.hooksPath']);
      const global = run('git', ['config', '--global', '--get', 'core.hooksPath'], repo);
      const preCommit = fs.existsSync(path.join(repo, 'docs', 'subagent-workflow', 'hooks', 'pre-commit'));
      const prePush = fs.existsSync(path.join(repo, 'docs', 'subagent-workflow', 'hooks', 'pre-push'));
      const hooksPath = local.out.trim();
      const ok = init.code === 0
        && hooksPath === 'docs/subagent-workflow/hooks'
        && global.code !== 0
        && preCommit && prePush;
      return {
        ok,
        detail: 'init=' + init.code + ' hooksPath=' + JSON.stringify(hooksPath) + ' global=' + global.code
          + ' preCommit=' + preCommit + ' prePush=' + prePush,
      };
    } finally {
      cleanup(repo);
      cleanup(keys);
    }
  },
  /*
   * Пуш коммита, сделанного при открытом задании, ПОСЛЕ приёмки должен проходить:
   * порядок workflow — «коммит по кандидату, пуш после записи о приёмке». Проверка
   * покрытия обязана смотреть на состояние на момент коммита, а не на текущий
   * acceptance.json, иначе штатный порядок блокируется собственным хуком.
   */
  pushAfterAcceptance() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-push-'));
    const repo = path.join(base, 'repo');
    const bare = path.join(base, 'remote.git');
    fs.mkdirSync(repo, { recursive: true });
    try {
      run('git', ['init', '--bare', '-q', bare], base);
      git(repo, ['init', '-q']);
      git(repo, ['config', 'user.email', 'guard@local']);
      git(repo, ['config', 'user.name', 'guard']);
      git(repo, ['config', 'core.hooksPath', 'docs/subagent-workflow/hooks']);
      copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
      write(path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json'), JSON.stringify(guardConfig(false), null, 2) + '\n');
      const dir = path.join(repo, 'docs', 'tasks', '0001');
      write(path.join(dir, 'task.md'), ['# Задание 0001. Активное', '',
        '<!-- TASK-META',
        JSON.stringify({
          id: '0001', version: 1, title: 'активное', risk: 'low', created: '2026-10-28',
          owner: 'архитектор', executor: 'subagent:executor', acceptor: 'subagent:judge',
          base: 'HEAD', criteria: 'criteria.json', allowedPaths: ['src/**'], hashExclude: [], decisions: [],
        }, null, 2),
        '-->', '', '## Цель', '', 'Заглушка.', ''].join('\n'));
      write(path.join(dir, 'criteria.json'), JSON.stringify({ task: '0001', criteria: [{ id: 'C1', title: 'c', command: 'node -e "1"', expect: { exitCode: 0 } }] }, null, 2) + '\n');
      write(path.join(dir, 'criteria.lock'), JSON.stringify({ version: 3, task: '0001', contractCommit: '0'.repeat(40), protected: [] }, null, 2) + '\n');
      write(path.join(repo, 'README.md'), '# проба\n');
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', 'base (guard off)']);
      git(repo, ['remote', 'add', 'origin', bare]);
      git(repo, ['push', '-q', '-u', 'origin', 'HEAD:refs/heads/main']);
      /* Включаем guard в рабочем дереве, не коммитя: конфиг читается хуком. */
      write(path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json'), JSON.stringify(guardConfig(true), null, 2) + '\n');
      write(path.join(repo, 'src', 'a.js'), 'export const a = 1;\n');
      git(repo, ['add', 'src/a.js']);
      const commit = git(repo, ['commit', '-q', '-m', 'работа по заданию']);
      /* Приёмка появляется ПОСЛЕ коммита — как в штатном порядке. */
      write(path.join(repo, 'docs', 'tasks', '0001', 'acceptance.json'), JSON.stringify({ task: '0001', status: 'accepted', version: 6 }, null, 2) + '\n');
      const push = git(repo, ['push', 'origin', 'HEAD:refs/heads/main']);
      return {
        ok: commit.code === 0 && push.code === 0,
        detail: 'commit=' + commit.code + ' push=' + push.code + ' ' + push.out.trim().slice(0, 220),
      };
    } finally { cleanup(base); }
  },
  /*
   * Метка обхода обязана работать и на пуше: иначе задокументированный обход
   * действует только до пуша, а это не то, что обещано.
   */
  bypassOnPush() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-pushby-'));
    const repo = path.join(base, 'repo');
    const bare = path.join(base, 'remote.git');
    fs.mkdirSync(repo, { recursive: true });
    try {
      run('git', ['init', '--bare', '-q', bare], base);
      git(repo, ['init', '-q']);
      git(repo, ['config', 'user.email', 'guard@local']);
      git(repo, ['config', 'user.name', 'guard']);
      git(repo, ['config', 'core.hooksPath', 'docs/subagent-workflow/hooks']);
      copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
      write(path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json'), JSON.stringify(guardConfig(false), null, 2) + '\n');
      write(path.join(repo, 'README.md'), '# проба\n');
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', 'base (guard off)']);
      git(repo, ['remote', 'add', 'origin', bare]);
      git(repo, ['push', '-q', '-u', 'origin', 'HEAD:refs/heads/main']);
      write(path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json'), JSON.stringify(guardConfig(true), null, 2) + '\n');
      write(path.join(repo, 'hotfix.txt'), 'срочно\n');
      git(repo, ['add', 'hotfix.txt']);
      const commit = git(repo, ['commit', '-q', '-m', 'hotfix [workflow-bypass: срочно]']);
      const push = git(repo, ['push', 'origin', 'HEAD:refs/heads/main']);
      return {
        ok: commit.code === 0 && push.code === 0,
        detail: 'commit=' + commit.code + ' push=' + push.code + ' ' + push.out.trim().slice(0, 220),
      };
    } finally { cleanup(base); }
  },
  /* Панель пишет только флаг guard и оставляет след в журнале. */
  async panel() {
    const repo = makeRepo({ enabled: false });
    try {
      /* Windows: import() не принимает абсолютный путь, нужен file:// URL. */
      const module = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'guard.js')).href);
      if (typeof module.writeGuardEnabled !== 'function') {
        return { ok: false, detail: 'plugin/lib/guard.js не экспортирует writeGuardEnabled' };
      }
      const configPath = path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json');
      const before = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const first = module.writeGuardEnabled(repo, true);
      const afterOn = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const restSame = ['tasksDir', 'keysFile', 'policy', 'actor', 'models', 'roles']
        .every((key) => JSON.stringify(before[key]) === JSON.stringify(afterOn[key]));
      const logPath = path.join(repo, 'docs', 'subagent-workflow', 'guard.log');
      const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
      const logged = /enabled=true/.test(logText);
      const second = module.writeGuardEnabled(repo, false);
      const afterOff = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const toggled = afterOn.guard && afterOn.guard.enabled === true && afterOff.guard && afterOff.guard.enabled === false;
      return {
        ok: restSame && logged && toggled,
        detail: 'restSame=' + restSame + ' logged=' + logged + ' toggled=' + toggled
          + ' first=' + JSON.stringify(first) + ' second=' + JSON.stringify(second),
      };
    } finally { cleanup(repo); }
  },
};

const only = argValue('--case');
const names = only ? [only] : Object.keys(CASES);
let failed = 0;
for (const name of names) {
  if (!CASES[name]) {
    console.log('FAIL ' + name + ': нет такого кейса');
    failed += 1;
    continue;
  }
  let result;
  try {
    result = await CASES[name]();
  } catch (error) {
    result = { ok: false, detail: 'исключение: ' + (error && error.message ? error.message : error) };
  }
  console.log((result.ok ? 'PASS ' : 'FAIL ') + name + ' — ' + result.detail);
  if (!result.ok) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);