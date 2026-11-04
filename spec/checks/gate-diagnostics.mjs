#!/usr/bin/env node
/*
 * 2.6.24 (0060, WC-40/41/42): ворота должны говорить сами.
 *
 * Три замечания стороннего агента, начавшего работу с пакетом 2.6.22:
 *  - WC-40: закоммитил criteria.lock после task-red и получил «lock: contractCommit:
 *    ожидалось X, сейчас Y» без подсказки, что делать; порядок коммитов лежит в SPEC,
 *    но не в точке отказа и не в шаблоне задания.
 *  - WC-41: фатальные ошибки уходят только в stderr; под обёрткой pwsh это «пустой
 *    stdout + exit 1», первый прогон выглядит молчаливым отказом.
 *  - WC-42: хуки требуют node в PATH; в bundled-окружении его там нет, и commit-msg —
 *    блокирующий guard — молча пропускает проверку покрытия да ещё шумит на каждом
 *    коммите. Node штатно берётся из process.execPath, значит init должен записать его.
 *
 * c1 — подсказка порядка коммитов в тексте отказа (task-red и task-verify);
 * c2 — тот же отказ одной строкой в stdout (stderr сохраняется);
 * c3 — хуки работают без node в PATH, если init записал .node-path;
 *      без node вообще — предупреждение один раз на репозиторий;
 * c4 — init пишет .node-path и строку в .gitignore.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

/* Вывод дочерних процессов — в файлы: проверка сама обязана быть примером правила. */
function run(cmd, args, cwd, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gd-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, {
      cwd, timeout: 900000, windowsHide: true, stdio: ['ignore', ofd, efd],
      env: options.env || process.env,
    });
  } finally {
    try { fs.closeSync(ofd); } catch { /* ignore */ }
    try { fs.closeSync(efd); } catch { /* ignore */ }
  }
  let stdout = '';
  let stderr = '';
  try { stdout = fs.readFileSync(outFile, 'utf8'); stderr = fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: res.status, stdout, stderr, out: stdout + stderr };
}
function git(cwd, args, env) { return run('git', ['-C', cwd, ...args], cwd, { env }); }
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}
function cleanup(repo) { fs.rmSync(repo, { recursive: true, force: true }); }

/* PATH без каталога, где лежит node: остальное (git, sh) на месте. */
function pathWithoutNode() {
  const nodeDir = path.dirname(process.execPath).toLowerCase();
  const parts = String(process.env.PATH || '').split(path.delimiter)
    .filter((dir) => dir && path.resolve(dir).toLowerCase() !== nodeDir);
  return parts.join(path.delimiter);
}

/*
 * 0066: «node нет» не всегда представимо (CI Linux держит node в /usr/bin и /usr/local/bin).
 * Смотрим в PATH заданной среды сами: node.exe на Windows, node/nodejs на POSIX с правом X_OK.
 */
function nodeDiscoverable(env) {
  const isWin = process.platform === 'win32';
  const names = isWin ? ['node.exe'] : ['node', 'nodejs'];
  const mode = isWin ? fs.constants.F_OK : fs.constants.X_OK;
  for (const dir of String((env && env.PATH) || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, mode);
        return candidate;
      } catch { /* нет файла или нет прав на исполнение */ }
    }
  }
  return null;
}

const ID = '0001';
const META = {
  id: ID, version: 1, title: 'т', risk: 'low', created: '2026-11-04', owner: 'a',
  executor: 'subagent:executor', acceptor: 'subagent:judge',
  issuedBy: { kind: 'agent', session: 'issuer', model: 'm' }, base: 'HEAD', criteria: 'criteria.json',
  allowedPaths: ['src/**', 'docs/tasks/' + ID + '/**'], protectedPaths: [],
  redAllowDirty: ['docs/tasks/' + ID + '/**'], decisions: [], securityReview: false, humanSignoff: false, followUps: [],
};
function taskBody() {
  return ['# Задание ' + ID, '', '<!-- TASK-META', JSON.stringify(META, null, 2), '-->', '', '## Цель', '', 'x', '',
    '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '', '## Границы знания', '', '1. x.', '',
    '## Среда', '', 'node.', '', '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '',
    '| ID | Проверка | Ожидание |', '| --- | --- | --- |', '| C1 | node -e "console.log(1)" | exit 0 |', '<!-- CRITERIA:END -->',
    '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
}
function criteriaBody() {
  return {
    task: ID, setup: [], teardown: [],
    redExpect: { mustFail: [], mustPass: ['C1'], reasons: {}, noRed: { reason: 'диагностика ворот' } },
    criteria: [{ id: 'C1', title: 't', command: 'node -e "console.log(1)"', cwd: '.', timeoutMs: 60000, tags: ['fast'], expect: { exitCode: 0 } }],
  };
}
/* Контракт заперт, затем HEAD сдвинут коммитом: 'artifact' — артефакт задания, 'code' — код исполнителя. */
function makeStaleLockRepo(kind = 'artifact') {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gate-diag-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p@l']);
  git(repo, ['config', 'user.name', 'p']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', ID);
  write(path.join(dir, 'task.md'), taskBody());
  write(path.join(dir, 'criteria.json'), JSON.stringify(criteriaBody(), null, 2) + '\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'contract']);
  const hash = run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/' + ID, '--write'], repo);
  truthy(hash.code === 0, 'task-hash --write в фикстуре не прошёл: ' + hash.out.trim().slice(-300));
  if (kind === 'code') {
    write(path.join(repo, 'src', 'app.js'), 'export const x = 1;\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'executor code commit moves HEAD']);
  } else {
    write(path.join(dir, 'notes.txt'), 'artifact\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'artifact commit moves HEAD']);
  }
  return { repo, dir };
}
function gate(repo, name) {
  return run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', name), '--task', 'docs/tasks/' + ID, '--base', 'HEAD'], repo);
}

/* c1: в отказе есть не только «ожидалось/сейчас», но и что делать. */
function c1() {
  const t = makeStaleLockRepo();
  try {
    for (const gateName of ['task-red.mjs', 'task-verify.mjs']) {
      const r = gate(t.repo, gateName);
      truthy(r.code !== 0, gateName + ': отказ не случился (exit ' + r.code + ')');
      truthy(/ожидалось/u.test(r.out), gateName + ': нет исходной диагностики «ожидалось»');
      truthy(/не коммит/iu.test(r.out), gateName + ': нет подсказки «не коммить»: ' + r.out.trim().slice(0, 300));
      truthy(/кандидат/iu.test(r.out), gateName + ': подсказка не называет кандидатный коммит');
    }
    console.log('GATEDIAG OK c1');
  } finally { cleanup(t.repo); }
}

/* c2: фатальный отказ виден в stdout одной строкой. */
function c2() {
  const t = makeStaleLockRepo();
  try {
    for (const gateName of ['task-red.mjs', 'task-verify.mjs']) {
      const r = gate(t.repo, gateName);
      truthy(r.code !== 0, gateName + ': отказ не случился');
      const lines = r.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const prefix = gateName.replace('.mjs', '');
      truthy(lines.length > 0, gateName + ': stdout пуст при фатальном отказе (stderr-only)');
      truthy(lines.some((line) => line.startsWith(prefix + ': ')), gateName + ': в stdout нет строки «' + prefix + ': »: ' + lines.slice(0, 3).join(' | '));
    }
    console.log('GATEDIAG OK c2');
  } finally { cleanup(t.repo); }
}

/* c3: хуки без node в PATH — .node-path работает, иначе предупреждение один раз. */
function c3() {
  /* --with-node: PATH не чистим вовсе — ровно так выглядит linux-раннер. */
  if (process.argv.includes('--with-node')) {
    console.log('GATEDIAG SKIP c3: среда не позволяет изобразить «node нет» — PATH не чистился (--with-node)');
    return;
  }
  const env = { ...process.env, PATH: pathWithoutNode() };
  delete env.WF_NODE;
  const foundNode = nodeDiscoverable(env);
  if (foundNode) {
    console.log('GATEDIAG SKIP c3: среда не позволяет изобразить «node нет» — node найден в ' + foundNode);
    return;
  }
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gate-hooks-'));
  try {
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 'p@l']);
    git(repo, ['config', 'user.name', 'p']);
    copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
    /*
     * guard.enabled=false — осознанная настройка проекта (пакетный конфиг), а не предмет
     * WC-42. Включаем guard в СВОЕЙ копии конфига: тогда блокировка коммита — следствие
     * найденного node, а не настройки. Хуки сам конфиг не трогают (см. §Что не входит).
     */
    const cfgFile = path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    cfg.guard = { ...(cfg.guard || {}), enabled: true };
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    git(repo, ['config', 'core.hooksPath', 'docs/subagent-workflow/hooks']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'base']);
    /* 1) .node-path записан (как это делает init) — commit-msg обязан блокировать. */
    write(path.join(repo, 'docs', 'subagent-workflow', '.node-path'), process.execPath + '\n');
    write(path.join(repo, 'src', 'app.js'), 'export const x = 1;\n');
    git(repo, ['add', '-A'], env);
    const blocked = git(repo, ['commit', '-m', 'uncovered change'], env);
    truthy(blocked.code !== 0, 'хук не заблокировал коммит без активного задания: ' + blocked.out.trim().slice(-300));
    truthy(/не покрыт|task-guard/iu.test(blocked.out), 'отказ есть, но без диагностики guard: ' + blocked.out.trim().slice(-300));

    /* 2) node нет нигде: предупреждение, маркер, и guard не выполняется (коммит не блокируется). */
    fs.rmSync(path.join(repo, 'docs', 'subagent-workflow', '.node-path'), { force: true });
    const first = git(repo, ['commit', '-m', 'uncovered change without node'], env);
    truthy(first.code === 0, 'без node коммит не должен блокироваться (guard не выполнен): ' + first.out.trim().slice(-300));
    truthy(/node/iu.test(first.out) && /не найден/iu.test(first.out), 'нет предупреждения о ненайденном node: ' + first.out.trim().slice(-300));
    const marker = git(repo, ['rev-parse', '--git-path', 'workflow-node-missing']).stdout.trim();
    truthy(marker !== '' && fs.existsSync(path.resolve(repo, marker)), 'нет маркера пропуска: ' + marker);

    /* 3) маркер глушит повторное предупреждение. */
    write(path.join(repo, 'src', 'second.js'), 'export const y = 2;\n');
    git(repo, ['add', '-A'], env);
    const second = git(repo, ['commit', '-m', 'second uncovered change'], env);
    truthy(!/node не найден/iu.test(second.out), 'предупреждение повторилось на втором коммите: ' + second.out.trim().slice(-300));
    console.log('GATEDIAG OK c3');
  } finally { cleanup(repo); }
}

/* c4: init записывает .node-path и строку .gitignore. */
function c4() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gate-init-'));
  try {
    const init = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'init.mjs'), '--repo', repo, '--git-init'], PKG);
    truthy(init.code === 0, 'init не прошёл: ' + init.out.trim().slice(-400));
    const nodePathFile = path.join(repo, 'docs', 'subagent-workflow', '.node-path');
    truthy(fs.existsSync(nodePathFile), 'init не записал docs/subagent-workflow/.node-path');
    const value = fs.readFileSync(nodePathFile, 'utf8').trim();
    truthy(path.resolve(value).toLowerCase() === path.resolve(process.execPath).toLowerCase(),
      '.node-path не равен process.execPath: ' + JSON.stringify(value));
    const ignore = fs.existsSync(path.join(repo, '.gitignore')) ? fs.readFileSync(path.join(repo, '.gitignore'), 'utf8') : '';
    truthy(ignore.split(/\r?\n/).some((line) => line.trim() === 'docs/subagent-workflow/.node-path'),
      '.gitignore не содержит docs/subagent-workflow/.node-path');
    console.log('GATEDIAG OK c4');
  } finally { cleanup(repo); }
}

/* c5: подсказка различает причину сдвига HEAD — артефакт, код, metadata. */
function c5() {
  const cases = [
    { kind: 'code', path: 'src/app.js', words: [/код/iu, /task-accept/u] },
    { kind: 'artifact', path: 'docs/tasks/0001/notes.txt', words: [/артефакт/iu, /кандидат/iu] },
  ];
  for (const item of cases) {
    const t = makeStaleLockRepo(item.kind);
    try {
      const r = gate(t.repo, 'task-red.mjs');
      truthy(r.code !== 0, item.kind + ': отказ не случился');
      for (const word of item.words) {
        truthy(word.test(r.out), item.kind + ': в выводе нет ' + word + ': ' + r.out.trim().slice(0, 400));
      }
      truthy(r.out.includes(item.path), item.kind + ': в выводе нет изменённого пути ' + item.path + ': ' + r.out.trim().slice(0, 400));
    } finally { cleanup(t.repo); }
  }
  console.log('GATEDIAG OK c5');
}

const table = { c1, c2, c3, c4, c5 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/gate-diagnostics.mjs c1|c2|c3|c4|c5 [--with-node]');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('GATEDIAG FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}