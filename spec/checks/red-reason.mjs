#!/usr/bin/env node
/*
 * 2.6.22 (0057, WC-35): красный проверяет причину, а не факт падения.
 *
 * Урок 0055->0056: критерий C2 падал с ReferenceError в самой проверке (require в ESM)
 * и не мог позеленеть ни при какой реализации, но красный был засчитан доказанным.
 * Второй урок пришёл от structure (их 0052): причина совпадала по подстроке в любом
 * месте вывода, поэтому «правильная» причина маскировала чужую.
 *
 * Правила, которые проверяются здесь:
 *  - отказ критерия с необработанной ReferenceError/TypeError/SyntaxError — дефект
 *    проверки, а не доказанный красный (причина не важна);
 *  - причина красного ищется в вердиктной зоне — последних reasonWindow непустых
 *    строках вывода критерия (по умолчанию 25), а не в любом месте вывода;
 *  - ожидаемый сбой (негативный критерий с expect exitCode 1 + TypeError в stderr)
 *    дефектом не считается: сканируются только отказавшие критерии;
 *  - lint отвергает некорректный redExpect.reasonWindow.
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

/*
 * Вывод дочерних процессов идёт в файлы, а не в пайпы: в ограниченной песочнице
 * spawn с stdio 'pipe' не может открыть именованный канал (EPERM), и проверка
 * падала бы на машинах, где ворота работают. Ворота (runCommand) устроены так же.
 */
function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rr-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, { cwd, timeout: 600000, windowsHide: true, stdio: ['ignore', ofd, efd] });
  } finally {
    try { fs.closeSync(ofd); } catch { /* ignore */ }
    try { fs.closeSync(efd); } catch { /* ignore */ }
  }
  let out = '';
  try { out = fs.readFileSync(outFile, 'utf8') + fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: res.status, out, error: res.error ? String(res.error.message) : '' };
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

/* Сценарии: поведение самих проверок. Печатают в stdout/stderr то, что видит задача. */
function noisyLines(marker) {
  const out = [];
  if (marker) out.push("console.log('" + marker + "');");
  for (let i = 0; i < 40; i += 1) out.push("console.log('step " + i + "');");
  return out.join('\n');
}
const SCRIPTS = {
  /* Дефект проверки: необработанная ReferenceError. Метка печатается ДО падения. */
  'crash.mjs': "#!/usr/bin/env node\nconsole.log('CRASH-CHECK start');\nnotDefinedAnywhere();\n",
  /* Причина в начале вывода, вердикт — далеко от него: маскировка чужой причины. */
  'early.mjs': "#!/usr/bin/env node\n" + noisyLines('EXPECTED REASON EARLY') + "\nprocess.exit(1);\n",
  /* Настоящий красный: причина — последняя осмысленная строка вывода. */
  'late.mjs': "#!/usr/bin/env node\n" + noisyLines('filler') + "\nconsole.log('PROPER RED LINE');\nprocess.exit(1);\n",
  /* Ожидаемый сбой: критерий ЗЕЛЁНЫЙ (expect exitCode 1 + TypeError в stderr). */
  'expected-crash.mjs': "#!/usr/bin/env node\nconsole.error('TypeError: boom');\nconsole.error('    at async file:///tmp/check.mjs:3:11');\nprocess.exit(1);\n",
};

function makeTask({ files, criteria: criteriaList, redExpect }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-redreason-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p@l']);
  git(repo, ['config', 'user.name', 'p']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const id = '0001';
  const dir = path.join(repo, 'docs', 'tasks', id);
  const meta = {
    id, version: 1, title: 'т', risk: 'low', created: '2026-11-04', owner: 'a',
    executor: 'subagent:executor', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 'issuer', model: 'm' }, base: 'HEAD', criteria: 'criteria.json',
    allowedPaths: ['checks/**', 'docs/tasks/' + id + '/**'], protectedPaths: [],
    redAllowDirty: ['docs/tasks/' + id + '/**'], decisions: [], securityReview: false, humanSignoff: false, followUps: [],
  };
  const body = ['# Задание ' + id, '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '', '## Цель', '', 'x', '',
    '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '', '## Границы знания', '', '1. x.', '',
    '## Среда', '', 'node.', '', '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '',
    '| ID | Проверка | Ожидание |', '| --- | --- | --- |', '| C1 | node checks/x.mjs | exit 0 |', '<!-- CRITERIA:END -->',
    '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  write(path.join(dir, 'criteria.json'), JSON.stringify({ task: id, setup: [], teardown: [], redExpect, criteria: criteriaList }, null, 2) + '\n');
  for (const [name, text] of Object.entries(files)) write(path.join(repo, 'checks', name), text);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'contract']);
  run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/' + id, '--write'], repo);
  return { repo, dir };
}
function red(repo) {
  return run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-red.mjs'), '--task', 'docs/tasks/0001', '--base', 'HEAD'], repo);
}
function lint(repo) {
  return run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-lint.mjs'), '--task', 'docs/tasks/0001', '--strict'], repo);
}
function readRed(dir) {
  const file = path.join(dir, 'red.json');
  truthy(fs.existsSync(file), 'красный прогон не создал red.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function cleanup(repo) { fs.rmSync(repo, { recursive: true, force: true }); }

const FAST = { cwd: '.', timeoutMs: 60000, tags: ['fast'] };
function crit(id, script, expect, extra) {
  return { id, title: id, command: 'node checks/' + script, cwd: '.', timeoutMs: 60000, tags: ['fast'], expect, ...(extra || {}) };
}

/* c1: отказ критерия с необработанной ReferenceError — дефект проверки, а не красный. */
function c1() {
  const t = makeTask({
    files: SCRIPTS,
    criteria: [crit('C1', 'crash.mjs', { exitCode: 0 }), crit('C2', 'late.mjs', { exitCode: 0 })],
    redExpect: { mustFail: ['C1', 'C2'], mustPass: [], reasons: { C1: 'CRASH-CHECK start', C2: 'PROPER RED LINE' } },
  });
  try {
    const r = red(t.repo);
    truthy(r.code === 1, 'красный засчитан доказанным при дефекте проверки (exit ' + r.code + ')');
    truthy(/дефект проверки/u.test(r.out), 'в выводе нет слов «дефект проверки»');
    truthy(/ReferenceError/u.test(r.out), 'в выводе не назван класс ошибки ReferenceError');
    const data = readRed(t.dir);
    truthy(data.redProven === false, 'red.json: redProven не false');
    const defects = data.redExpectation && data.redExpectation.checkDefects;
    truthy(Array.isArray(defects) && defects.length === 1, 'redExpectation.checkDefects — не один дефект: ' + JSON.stringify(defects));
    truthy(defects[0].id === 'C1' && defects[0].name === 'ReferenceError', 'дефект назван неверно: ' + JSON.stringify(defects[0]));
    console.log('REDREASON OK c1');
  } finally { cleanup(t.repo); }
}

/* c2: причина в начале вывода не доказывает красный; reasonWindow — осознанное расширение. */
function c2() {
  const files = SCRIPTS;
  const tight = makeTask({
    files,
    criteria: [crit('C1', 'early.mjs', { exitCode: 0 })],
    redExpect: { mustFail: ['C1'], mustPass: [], reasons: { C1: 'EXPECTED REASON EARLY' } },
  });
  try {
    const r = red(tight.repo);
    truthy(r.code === 1, 'причина вне вердиктной зоны засчитана: exit ' + r.code);
    truthy(/(вердиктн|окн)/u.test(r.out), 'в выводе не сказано про вердиктную зону/окно');
    const data = readRed(tight.dir);
    truthy(data.redProven === false, 'red.json: красный доказан при причине вне окна');
  } finally { cleanup(tight.repo); }

  const wide = makeTask({
    files,
    criteria: [crit('C1', 'early.mjs', { exitCode: 0 })],
    redExpect: { mustFail: ['C1'], mustPass: [], reasonWindow: 200, reasons: { C1: 'EXPECTED REASON EARLY' } },
  });
  try {
    const r = red(wide.repo);
    truthy(r.code === 0, 'reasonWindow: 200 не расширил окно (exit ' + r.code + ')');
    const data = readRed(wide.dir);
    truthy(data.redProven === true, 'red.json: при reasonWindow: 200 красный не доказан');
  } finally { cleanup(wide.repo); }
  console.log('REDREASON OK c2');
}

/* c3: контроль — настоящий красный доказывается, правило не ужесточило лишнего. */
function c3() {
  const t = makeTask({
    files: SCRIPTS,
    criteria: [crit('C1', 'late.mjs', { exitCode: 0 })],
    redExpect: { mustFail: ['C1'], mustPass: [], reasons: { C1: 'PROPER RED LINE' } },
  });
  try {
    const r = red(t.repo);
    truthy(r.code === 0, 'настоящий красный не доказан (exit ' + r.code + '): ' + r.out.trim().slice(-400));
    const data = readRed(t.dir);
    truthy(data.redProven === true, 'red.json: redProven не true');
    console.log('REDREASON OK c3');
  } finally { cleanup(t.repo); }
}

/* c4: контроль — ожидаемый сбой негативного критерия дефектом не считается. */
function c4() {
  const t = makeTask({
    files: SCRIPTS,
    criteria: [
      crit('C1', 'late.mjs', { exitCode: 0 }),
      crit('C2', 'expected-crash.mjs', { exitCode: 1, stderrContains: 'TypeError: boom' }, { tags: ['fast', 'negative'] }),
    ],
    redExpect: { mustFail: ['C1'], mustPass: ['C2'], reasons: { C1: 'PROPER RED LINE' } },
  });
  try {
    const r = red(t.repo);
    truthy(r.code === 0, 'зелёный негативный критерий с ожидаемым TypeError завалил красный (exit ' + r.code + '): ' + r.out.trim().slice(-400));
    const data = readRed(t.dir);
    const defects = (data.redExpectation && data.redExpectation.checkDefects) || [];
    truthy(defects.length === 0, 'ожидаемый сбой негативного критерия принят за дефект проверки: ' + JSON.stringify(defects));
    console.log('REDREASON OK c4');
  } finally { cleanup(t.repo); }
}

/* c5: lint отвергает некорректный reasonWindow и принимает корректный. */
function c5() {
  const base = {
    files: SCRIPTS,
    criteria: [crit('C1', 'late.mjs', { exitCode: 0 })],
    redExpect: { mustFail: ['C1'], mustPass: [], reasons: { C1: 'PROPER RED LINE' } },
  };
  for (const bad of ['0', 'abc', '-5', '1.5', 'true']) {
    const t = makeTask({ ...base, redExpect: { ...base.redExpect, reasonWindow: bad } });
    try {
      const r = lint(t.repo);
      truthy(r.code !== 0 && /reasonWindow/u.test(r.out), 'lint принял reasonWindow: ' + bad + ' (' + r.out.trim().slice(0, 200) + ')');
    } finally { cleanup(t.repo); }
  }
  const ok = makeTask({ ...base, redExpect: { ...base.redExpect, reasonWindow: 12 } });
  try {
    const r = lint(ok.repo);
    truthy(r.code === 0 && !/reasonWindow/u.test(r.out), 'lint отверг корректный reasonWindow: 12 — ' + r.out.trim().slice(0, 300));
  } finally { cleanup(ok.repo); }
  console.log('REDREASON OK c5');
}

const table = { c1, c2, c3, c4, c5 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/red-reason.mjs c1|c2|c3|c4|c5');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('REDREASON FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
