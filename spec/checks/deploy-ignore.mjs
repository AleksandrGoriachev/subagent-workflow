#!/usr/bin/env node
/*
 * 0151: развёртывание не вендорит код движка и уведомляет координатора.
 *
 * Повод: в dsh-project-graph и ws-school-app развёрнутая копия движка лежит в
 * git проекта, поэтому каждое обновление движка появляется в чужой истории и
 * требует обхода task-guard («обновление движка вне allowedPaths задания»).
 * Решение владельца пакета: `docs/subagent-workflow/` уходит в .gitignore
 * проекта, init применяет это сам, а координатор получает след, из которого
 * видно цену решения (конфиг, ключи и хуки стали машинными).
 *
 *   c1 — init в чистом репозитории: строка `docs/subagent-workflow/` в .gitignore,
 *        чужие строки целы, движок не попадает в индекс, notice-файл и журнал;
 *   c2 — повторный init не дублирует строку и добавляет ровно одну запись журнала;
 *   c3 — init --external воркспейс не трогает (2.6.9), уведомление идёт журналом;
 *   c4 (негатив) — детектор краснеет без строки, а --deploy-policy vendored
 *        возвращает прежнее поведение: копия в индексе.
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

const IG = 'docs/subagent-workflow/';
const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }

function git(cwd, args) {
  const r = spawnSyncPipeFree('git', ['-C', cwd, ...args], { cwd, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function lines(text) { return String(text || '').split(/\r?\n/u); }

/** Детектор: ровно одна строка `docs/subagent-workflow/` в .gitignore. */
export function ignoreProblems(text) {
  const rows = lines(text).map((line) => line.trim());
  const hits = rows.filter((line) => line === IG).length;
  const problems = [];
  if (hits === 0) problems.push('в .gitignore нет строки ' + IG);
  if (hits > 1) problems.push('строка ' + IG + ' встречается ' + hits + ' раза');
  return problems;
}

/** Чистый репозиторий проекта: README, свой .gitignore, базовый коммит. */
function makeRepo(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-depignore-' + name + '-'));
  const proj = path.join(base, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  git(proj, ['init', '-q']);
  git(proj, ['config', 'user.email', 'p@l']);
  git(proj, ['config', 'user.name', 'p']);
  git(proj, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(proj, 'README.md'), '# probe\n');
  const foreign = 'node_modules/\n';
  fs.writeFileSync(path.join(proj, '.gitignore'), foreign);
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-qm', 'base']);
  return { base, proj, foreign, notices: path.join(base, 'notices.jsonl') };
}

/** Запуск init в фикстуре; журнал уведомлений уводим в фикстуру. */
function runInit({ proj, notices, args = [], env = {} }) {
  const r = spawnSyncPipeFree(process.execPath, [
    path.join(PKG, 'spec', 'scripts', 'init.mjs'), '--repo', proj, ...args,
  ], {
    cwd: proj,
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, WF_DEPLOY_NOTICES: notices, ...env },
  });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

function noticeOf(proj) {
  const file = path.join(proj, 'docs', 'subagent-workflow', 'deploy-notice.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function journalRows(file) {
  return lines(readText(file)).map((line) => line.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

/** Индекс после `git add -A`: какие пути проект у себя зафиксировал бы. */
function stagedPaths(proj) {
  git(proj, ['add', '-A']);
  return lines(git(proj, ['status', '--porcelain']).out).filter(Boolean).map((row) => row.slice(3).replace(/\\/gu, '/'));
}

function isEngine(p) { return p === 'docs/subagent-workflow' || p.startsWith(IG); }

if (mode === 'c1') {
  const f = makeRepo('c1');
  const r = runInit({ proj: f.proj, notices: f.notices });
  if (r.code !== 0) fail('c1', 'init вышел ' + r.code + ': ' + r.out.slice(-500));
  const ignore = readText(path.join(f.proj, '.gitignore'));
  if (!ignore.includes('node_modules/')) fail('c1', 'чужая строка .gitignore потеряна');
  for (const problem of ignoreProblems(ignore)) fail('c1', problem);
  const staged = stagedPaths(f.proj).filter(isEngine);
  if (staged.length > 0) fail('c1', 'движок попал в индекс: ' + staged.slice(0, 3).join(', '));
  const notice = noticeOf(f.proj);
  if (!notice) fail('c1', 'нет docs/subagent-workflow/deploy-notice.json');
  else {
    if (notice.mode !== 'local') fail('c1', 'режим уведомления ' + notice.mode);
    if (notice.policy !== 'gitignore') fail('c1', 'политика уведомления ' + notice.policy);
    if (!Array.isArray(notice.ignored) || !notice.ignored.includes(IG)) fail('c1', 'ignored не называет ' + IG);
    if (!Array.isArray(notice.machineLocal) || notice.machineLocal.length !== 3) fail('c1', 'machineLocal не называет конфиг, ключи и хуки');
    if (!notice.coordinator || !String(notice.coordinator.notice || '').trim()) fail('c1', 'в уведомлении нет текста координатору');
  }
  const rows = journalRows(f.notices);
  if (rows.length !== 1) fail('c1', 'в журнале ' + rows.length + ' записей, ожидалась 1');
  else if (rows[0].mode !== 'local' || rows[0].policy !== 'gitignore') fail('c1', 'журнал: ' + rows[0].mode + '/' + rows[0].policy);
  if (!/координатору/u.test(r.out)) fail('c1', 'init не печатает строку координатору');
  if (bad === 0) console.log('DEPLOY-IGNORE OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const f = makeRepo('c2');
  const first = runInit({ proj: f.proj, notices: f.notices });
  if (first.code !== 0) fail('c2', 'первый init вышел ' + first.code);
  const ignoreAfterFirst = readText(path.join(f.proj, '.gitignore'));
  const second = runInit({ proj: f.proj, notices: f.notices });
  if (second.code !== 0) fail('c2', 'второй init вышел ' + second.code + ': ' + second.out.slice(-400));
  const ignoreAfterSecond = readText(path.join(f.proj, '.gitignore'));
  for (const problem of ignoreProblems(ignoreAfterSecond)) fail('c2', problem);
  if (ignoreAfterFirst !== ignoreAfterSecond) fail('c2', 'повторный init переписал .gitignore');
  const rows = journalRows(f.notices);
  if (rows.length !== 2) fail('c2', 'в журнале ' + rows.length + ' записей после двух запусков');
  if (bad === 0) console.log('DEPLOY-IGNORE OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c3') {
  const f = makeRepo('c3');
  const map = path.join(f.base, 'engine-roots.json');
  /*
   * Внешний движок — это развёрнутая копия в другом воркспейсе: маркер лежит в
   * <движок>/docs/subagent-workflow/VERSION, а не в корне пакета.
   */
  const engine = path.join(f.base, 'engine');
  fs.mkdirSync(path.join(engine, 'docs', 'subagent-workflow'), { recursive: true });
  fs.writeFileSync(path.join(engine, 'docs', 'subagent-workflow', 'VERSION'), '2.6.112\n');
  const r = runInit({ proj: f.proj, notices: f.notices, args: ['--external', engine], env: { WF_ENGINE_ROOTS: map } });
  if (r.code !== 0) fail('c3', 'init --external вышел ' + r.code + ': ' + r.out.slice(-500));
  if (fs.existsSync(path.join(f.proj, 'docs'))) fail('c3', 'воркспейс изменён: появился docs/');
  if (readText(path.join(f.proj, '.gitignore')) !== f.foreign) fail('c3', '.gitignore воркспейса изменён');
  const mapText = readText(map);
  if (!mapText.includes('proj')) fail('c3', 'в карте движков нет воркспейса');
  const rows = journalRows(f.notices);
  if (rows.length !== 1) fail('c3', 'в журнале ' + rows.length + ' записей');
  else if (rows[0].mode !== 'external') fail('c3', 'режим журнала ' + rows[0].mode);
  if (!/координатору/u.test(r.out)) fail('c3', 'нет строки координатору');
  if (!/воркспейс не изменён/u.test(r.out)) fail('c3', 'нет утверждения, что воркспейс не изменён');
  if (bad === 0) console.log('DEPLOY-IGNORE OK c3');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c4') {
  /* Негативный контроль детектора: без строки он обязан краснеть. */
  if (ignoreProblems('node_modules/\n').length === 0) fail('c4', 'детектор не заметил отсутствие строки ' + IG);
  if (ignoreProblems('node_modules/\n' + IG + '\n').length !== 0) fail('c4', 'детектор краснеет на правильном .gitignore');
  if (ignoreProblems(IG + '\n' + IG + '\n').length === 0) fail('c4', 'детектор не заметил дубль строки');
  /* Opt-out: vendored возвращает прежнее поведение — копия живёт в истории проекта. */
  const f = makeRepo('c4');
  const r = runInit({ proj: f.proj, notices: f.notices, args: ['--deploy-policy', 'vendored'] });
  if (r.code !== 0) fail('c4', 'init --deploy-policy vendored вышел ' + r.code + ': ' + r.out.slice(-400));
  if (ignoreProblems(readText(path.join(f.proj, '.gitignore'))).length === 0) fail('c4', 'vendored всё равно поставил строку игнора');
  const staged = stagedPaths(f.proj).filter(isEngine);
  if (staged.length === 0) fail('c4', 'vendored не оставил копию движка в индексе проекта');
  const notice = noticeOf(f.proj);
  if (!notice) fail('c4', 'vendored не записал уведомление');
  else if (notice.policy !== 'vendored') fail('c4', 'политика уведомления ' + notice.policy);
  if (bad === 0) console.log('DEPLOY-IGNORE OK c4');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/deploy-ignore.mjs c1|c2|c3|c4');
process.exit(2);
