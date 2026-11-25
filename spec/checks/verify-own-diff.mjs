#!/usr/bin/env node
/*
 * 2.6.103 (0120): границы, покрытие и скан секретов в task-verify смотрят только
 * на СВОИ незакоммиченные изменения.
 *
 * Повод — kanban, задание 0014 (письмо 22). 2.6.100 научила ownChanges первую
 * проверку границ (до критериев), но пост-проверка после criteria/setup/teardown по-
 * прежнему считала diff от contractCommit. За 21 чужой коммит в дифф попали
 * docs/tasks/0015..0020/**, package.json, coordination/** — verify признал их
 * «файлами вне allowedPaths» и «не покрытыми критериями» и отказал заданию, к
 * которому они отношения не имеют. ownChanges появился в 2.6.100 именно для этого
 * класса ошибок; здесь он применяется к тому же диффу, что и в первой проверке.
 *
 * c1: чужие коммиты задели docs/tasks/<чужое>/**, package.json и coordination/** —
 *     verify зелёный.
 * c2: СВОЁ незакоммиченное изменение вне allowedPaths — verify отказывает
 *     (границы не ослаблены).
 * c3: СВОЁ изменение внутри allowedPaths, но вне covers — verify отказывает
 *     (покрытие не ослаблено).
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

/* Вывод дочерних процессов — в файлы, а не в пайпы: песочница не даёт именованных каналов. */
function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-owndiff-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, { cwd, timeout: 900000, windowsHide: true, stdio: ['ignore', ofd, efd] });
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
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}

const ID = '0001';
const TASK = 'docs/tasks/' + ID;
const PROBE = "import fs from 'node:fs';\nif (!fs.existsSync('lib/checked/probe.mjs')) process.exit(2);\nconsole.log('ok');\n";

function script(repo, name) {
  return path.join(repo, 'docs', 'subagent-workflow', 'scripts', name);
}

/* Репозиторий: контракт заперт, красный noRed доказан на contractCommit. */
function makeRepo(options = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-owndiff-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p@l']);
  git(repo, ['config', 'user.name', 'p']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', ID);
  const meta = {
    id: ID, version: 1, title: 'т', risk: 'low', created: '2026-11-04', owner: 'a',
    executor: 'subagent:executor', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 'issuer', model: 'm' }, base: 'HEAD', criteria: 'criteria.json',
    allowedPaths: ['lib/**', TASK + '/**', ...(Array.isArray(options.extraAllowed) ? options.extraAllowed : [])], protectedPaths: [],
    redAllowDirty: [TASK + '/**'], decisions: [], securityReview: false, humanSignoff: false, followUps: [],
  };
  const body = ['# Задание ' + ID, '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '', '## Цель', '', 'x', '',
    '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '', '## Границы знания', '', '1. x.', '',
    '## Среда', '', 'node.', '', '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '',
    '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
    '| C1 | node lib/checked/probe.mjs | ok |', '<!-- CRITERIA:END -->',
    '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  const criteria = {
    task: ID, setup: [], teardown: [],
    redExpect: { mustFail: [], mustPass: ['C1'], reasons: {}, noRed: { reason: 'смоук существующего поведения' } },
    criteria: [{
      id: 'C1', title: 't', command: 'node lib/checked/probe.mjs', cwd: '.', timeoutMs: 120000,
      covers: ['lib/checked/**', ...(Array.isArray(options.extraCovers) ? options.extraCovers : [])], tags: ['fast'], expect: { exitCode: 0, stdoutContains: 'ok' },
    }],
  };
  write(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2) + '\n');
  write(path.join(repo, 'lib', 'checked', 'probe.mjs'), PROBE);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'contract']);
  const contractCommit = git(repo, ['rev-parse', 'HEAD']).out.trim();
  const hash = run(process.execPath, [script(repo, 'task-hash.mjs'), '--task', TASK, '--write'], repo);
  truthy(hash.code === 0, 'task-hash --write в фикстуре не прошёл: ' + hash.out.trim().slice(-400));
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'criteria.lock'), 'utf8'));
  write(path.join(dir, 'red.json'), JSON.stringify({
    version: 5, kind: 'red', task: ID, createdAt: '2026-11-04T00:00:00.000Z', base: 'HEAD',
    baseSha: contractCommit, headSha: contractCommit, contractCommit,
    criteriaSha256: lock.criteriaSha256, criteriaJsonSha256: lock.criteriaJsonSha256,
    executed: 1, finished: 1, failed: 0, failedIds: [], allGreen: true,
    redProven: true, redKind: 'noRed', noRed: { reason: 'смоук существующего поведения' },
    redExpectation: { configured: true, ok: true, errors: [], mustFail: [], mustPass: ['C1'] },
    bypasses: {}, log: 'red.log', results: [],
  }, null, 2) + '\n');
  write(path.join(dir, 'red.log'), '# red\n');
  return { repo, dir, contractCommit };
}

/* Чужие коммиты: артефакты соседних заданий, package.json, coordination/**. */
function foreignCommit(repo) {
  write(path.join(repo, 'docs', 'tasks', '0099', 'red.json'), '{"version":5}\n');
  write(path.join(repo, 'docs', 'tasks', '0099', 'verify.json'), '{"version":4}\n');
  write(path.join(repo, 'coordination', 'presence', 'p.json'), '{"at":1}\n');
  const pkgFile = path.join(repo, 'package.json');
  const pkg = fs.existsSync(pkgFile) ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')) : {};
  pkg.foreignMarker = 'x';
  write(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  /* Только чужие пути: git add docs утащил бы артефакты своего задания. */
  git(repo, ['add', 'docs/tasks/0099', 'coordination', 'package.json']);
  git(repo, ['commit', '-q', '-m', 'foreign work']);
  return git(repo, ['rev-parse', 'HEAD']).out.trim();
}

function verify(repo, dir) {
  const r = run(process.execPath, [script(repo, 'task-verify.mjs'), '--task', TASK], repo);
  let record = null;
  try { record = JSON.parse(fs.readFileSync(path.join(dir, 'verify.json'), 'utf8')); } catch { /* ignore */ }
  return { code: r.code, out: r.out, record };
}

function c1() {
  const fx = makeRepo();
  try {
    const head = foreignCommit(fx.repo);
    truthy(head !== fx.contractCommit, 'фикстура: HEAD не сдвинулся');
    const r = verify(fx.repo, fx.dir);
    truthy(r.code === 0, 'verify отказал из-за чужих коммитов (exit ' + r.code + '): ' + r.out.trim().slice(-600));
    const violations = (r.record && r.record.violations) || [];
    truthy(violations.length === 0, 'violations не пусты: ' + JSON.stringify(violations.slice(0, 5)));
  } finally { fs.rmSync(fx.repo, { recursive: true, force: true }); }
  console.log('OWNDIFF OK c1');
}

function c2() {
  const fx = makeRepo();
  try {
    foreignCommit(fx.repo);
    write(path.join(fx.repo, 'src', 'out-of-scope.js'), 'export const x = 1;\n');
    const r = verify(fx.repo, fx.dir);
    truthy(r.code !== 0, 'verify принял своё изменение вне allowedPaths');
    truthy(/(файл вне allowedPaths|изменения вне разрешённых путей)/u.test(r.out), 'отказ не называет границу: ' + r.out.trim().slice(-400));
    truthy(/src\/out-of-scope\.js/u.test(r.out), 'отказ не называет файл src/out-of-scope.js');
  } finally { fs.rmSync(fx.repo, { recursive: true, force: true }); }
  console.log('OWNDIFF OK c2');
}

/*
 * 0145 (2.6.111): чужой артефакт, объявленный в allowedPaths, — своё изменение;
 * не объявленный — по-прежнему не наше (в changedPaths не попадает).
 */
function c4() {
  const declared = makeRepo({ extraAllowed: ['docs/tasks/0099/**'], extraCovers: ['docs/tasks/0099/**'] });
  try {
    write(path.join(declared.repo, 'docs', 'tasks', '0099', 'engine-shadow.json'), '{"agree":true}\n');
    const r = verify(declared.repo, declared.dir);
    truthy(r.code === 0, 'verify отказал для объявленного чужого артефакта (exit ' + r.code + '): ' + r.out.trim().slice(-500));
    const paths = (r.record && r.record.changedPaths) || [];
    truthy(paths.includes('docs/tasks/0099/engine-shadow.json'), 'объявленный чужой артефакт не попал в changedPaths: ' + JSON.stringify(paths));
  } finally { fs.rmSync(declared.repo, { recursive: true, force: true }); }

  const plain = makeRepo();
  try {
    write(path.join(plain.repo, 'docs', 'tasks', '0099', 'engine-shadow.json'), '{"agree":true}\n');
    const r = verify(plain.repo, plain.dir);
    truthy(r.code === 0, 'verify отказал из-за необъявленного чужого артефакта (exit ' + r.code + '): ' + r.out.trim().slice(-500));
    const paths = (r.record && r.record.changedPaths) || [];
    truthy(!paths.includes('docs/tasks/0099/engine-shadow.json'), 'необъявленный чужой артефакт попал в changedPaths: ' + JSON.stringify(paths));
  } finally { fs.rmSync(plain.repo, { recursive: true, force: true }); }
  console.log('OWNDIFF OK c4');
}

function c3() {
  const fx = makeRepo();
  try {
    foreignCommit(fx.repo);
    write(path.join(fx.repo, 'lib', 'other', 'extra.js'), 'export const y = 2;\n');
    const r = verify(fx.repo, fx.dir);
    truthy(r.code !== 0, 'verify принял своё изменение без покрытия критерием');
    truthy(/не покрыт ни одним критерием/u.test(r.out), 'отказ не называет покрытие: ' + r.out.trim().slice(-400));
    truthy(/lib\/other\/extra\.js/u.test(r.out), 'отказ не называет файл lib/other/extra.js');
  } finally { fs.rmSync(fx.repo, { recursive: true, force: true }); }
  console.log('OWNDIFF OK c3');
}

const table = { c1, c2, c3, c4 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/verify-own-diff.mjs c1|c2|c3|c4');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('OWNDIFF FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}