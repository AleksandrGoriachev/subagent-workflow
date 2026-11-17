#!/usr/bin/env node
/*
 * 2.6.82: проектный allowlist регресса.
 *
 * Обязательства:
 *  - c1: разбор массива и { entries: [...] }: запись раскрывается по критериям, причина/владелец/срок сохраняются;
 *  - c2: некорректные записи не подавляют провал молча — попадают в problems, в entries их нет;
 *  - c3: порядок источников: --allowlist → config → проект;
 *  - c4: решение: подавление только при совпадении task+criterion; просрочка подавляет, но при --strict — нет;
 *  - c5: применение помечает провал allowedBy и не считает его провалом; зелёные строки не трогает;
 *  - c6: битый JSON — fatal, entries пусты;
 *  - c7: CLI: проектный allowlist подхватывается; битый проектный файл — exit 1; --allowlist без файла — exit 1.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAllowlist, allowlistEntry, allowlistVerdict, allowlistCandidates, applyAllowlistToResults,
  ALLOWLIST_PROJECT_PATH,
} from '../scripts/lib/regress.mjs';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'task-regress.mjs');
const quiet = () => {};
const truthy = (value, label) => { if (!value) throw new Error(label); };
const equal = (actual, expected, label) => {
  if (actual !== expected) throw new Error(label + ': ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual));
};

const NOW = new Date('2026-11-17T12:00:00.000Z');

/* c1: разбор двух форм */
const fromArray = parseAllowlist(JSON.stringify([
  { task: '0111', criteria: ['C2'], reason: 'предсуществующий провал', reviewBy: '2026-12-12', owner: 'coordinator' },
]));
equal(fromArray.entries.length, 1, 'c1: массив → одна запись');
equal(fromArray.entries[0].task, '0111', 'c1: task');
equal(fromArray.entries[0].criteria[0], 'C2', 'c1: criterion');
equal(fromArray.entries[0].owner, 'coordinator', 'c1: owner');
const fromObject = parseAllowlist(JSON.stringify({ entries: [
  { task: '0150', criteria: ['C6', 'C7'], reason: 'известный провал', reviewBy: '2026-12-12', owner: 'coordinator' },
] }));
equal(fromObject.entries.length, 2, 'c1: {entries} → две записи по критериям');
equal(fromObject.problems.length, 0, 'c1: проблем нет');

/* c2: некорректные записи не проходят */
const bad = parseAllowlist(JSON.stringify([
  { task: '11', criteria: ['C1'], reason: 'x' },
  { task: '0111', criteria: [], reason: 'x' },
  { task: '0111', criteria: ['C2'] },
  { task: '0111', criteria: ['C2'], reason: 'дубль' },
  { task: '0111', criteria: ['C2'], reason: 'дубль2' },
  { task: '0111', criteria: ['C3'], reason: 'ok', reviewBy: 'не дата' },
]));
equal(bad.entries.length, 1, 'c2: проходит только одна корректная запись');
truthy(bad.problems.length >= 4, 'c2: проблемы перечислены');

/* c3: порядок источников */
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-allowlist-'));
const projectFile = path.join(repo, ALLOWLIST_PROJECT_PATH);
const argvFile = path.join(repo, 'cli.allowlist.json');
const configFile = path.join(repo, 'config.allowlist.json');
const candidatesDefault = allowlistCandidates({ repo });
equal(candidatesDefault.length, 1, 'c3: без CLI/config — один кандидат');
equal(candidatesDefault[0].file, projectFile, 'c3: кандидат по проекту');
equal(candidatesDefault[0].required, false, 'c3: проектный файл необязателен');
const candidatesConfig = allowlistCandidates({ repo, configAllowlist: 'config.allowlist.json' });
equal(candidatesConfig[0].file, configFile, 'c3: config раньше проекта');
equal(candidatesConfig[0].required, true, 'c3: config обязателен');
const candidatesCli = allowlistCandidates({ repo, argvAllowlist: 'cli.allowlist.json', configAllowlist: 'config.allowlist.json' });
equal(candidatesCli[0].file, argvFile, 'c3: CLI раньше config');
equal(candidatesCli[1].file, configFile, 'c3: config вторым');

/* c4: решение по провалу */
const allowlist = parseAllowlist(JSON.stringify([
  { task: '0111', criteria: ['C2'], reason: 'долг', reviewBy: '2026-12-12', owner: 'coordinator' },
  { task: '0111', criteria: ['C9'], reason: 'просрочен', reviewBy: '2026-01-01', owner: 'coordinator' },
]));
truthy(allowlistEntry(allowlist, '0111', 'C2'), 'c4: запись найдена');
equal(allowlistEntry(allowlist, '0111', 'C3'), null, 'c4: чужой критерий не найден');
equal(allowlistEntry(allowlist, '0112', 'C2'), null, 'c4: чужая задача не найдена');
const fresh = allowlistVerdict(allowlist, '0111', 'C2', { now: NOW, strict: true });
truthy(fresh && fresh.suppress === true, 'c4: свежая запись подавляет и при strict');
const expired = allowlistVerdict(allowlist, '0111', 'C9', { now: NOW, strict: false });
truthy(expired && expired.expired === true && expired.suppress === true, 'c4: просрочка подавляет без strict');
const expiredStrict = allowlistVerdict(allowlist, '0111', 'C9', { now: NOW, strict: true });
truthy(expiredStrict && expiredStrict.suppress === false, 'c4: при strict просрочка не подавляет');

/* c5: применение к результатам */
const results = [
  { id: 'C1', passed: true },
  { id: 'C2', passed: false, reasons: ['старый провал'] },
  { id: 'C3', passed: false, reasons: ['настоящий регресс'] },
];
const allowed = applyAllowlistToResults(results, allowlist, '0111', { now: NOW, strict: false });
equal(allowed.length, 1, 'c5: подавлен один провал');
equal(allowed[0].id, 'C2', 'c5: подавлен именно C2');
truthy(results[1].allowedBy, 'c5: строка помечена allowedBy');
truthy(!results[2].allowedBy, 'c5: настоящий регресс не помечен');
const failed = results.filter((item) => item.passed === false && !item.allowedBy).map((item) => item.id);
equal(failed.join(','), 'C3', 'c5: в провалах остаётся только C3');

/* c6: битый JSON — fatal */
const broken = parseAllowlist('{ not json');
truthy(broken.fatal === true, 'c6: битый JSON помечен fatal');
equal(broken.entries.length, 0, 'c6: записей нет');

/* c7: CLI-проверки */
function writeRepo(allowlistText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-allowlist-cli-'));
  fs.mkdirSync(path.join(dir, 'docs', 'subagent-workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'subagent-workflow', 'acceptors.json'), JSON.stringify({ acceptors: [] }) + '\n');
  if (allowlistText !== null) fs.writeFileSync(path.join(dir, ALLOWLIST_PROJECT_PATH), allowlistText);
  return dir;
}
const goodRepo = writeRepo(JSON.stringify([{ task: '0111', criteria: ['C2'], reason: 'известный провал', reviewBy: '2026-12-12', owner: 'coordinator' }]));
const good = spawnSyncPipeFree(process.execPath, [SCRIPT, '--repo', goodRepo], { encoding: 'utf8' });
equal(good.status, 0, 'c7: проектный allowlist не ломает прогон без принятых заданий: ' + String(good.stderr || '').slice(0, 200));
const badRepo = writeRepo('{ broken');
const badRun = spawnSyncPipeFree(process.execPath, [SCRIPT, '--repo', badRepo], { encoding: 'utf8' });
equal(badRun.status, 1, 'c7: битый проектный allowlist — exit 1');
truthy(String(badRun.stderr || '').includes('allowlist не разобран'), 'c7: причина названа');
const missing = spawnSyncPipeFree(process.execPath, [SCRIPT, '--repo', goodRepo, '--allowlist', path.join(goodRepo, 'nope.json')], { encoding: 'utf8' });
equal(missing.status, 1, 'c7: --allowlist без файла — exit 1');

fs.rmSync(repo, { recursive: true, force: true });
fs.rmSync(goodRepo, { recursive: true, force: true });
fs.rmSync(badRepo, { recursive: true, force: true });

console.log('regress-allowlist: OK c1–c7');
