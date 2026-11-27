#!/usr/bin/env node
/*
 * 0179: раскладка plugin/lib/state.js на модули.
 *
 * state.js — вычисление состояния задачи из артефактов; его импортируют api.js,
 * fixture.mjs и state.test.mjs. Раскладка обязана сохранить путь импорта
 * ('./state.js') и все 55 публичных имён: state.js становится баррелем, код
 * живёт в plugin/lib/state/*.js по слоям (константы, примитивы, контракт,
 * политика, решения, атака, замок, приёмка, состояние, виды, адаптер репозитория).
 *
 *   node spec/checks/state-split.mjs c1   модули на месте, 55 имён видны через баррель
 *   node spec/checks/state-split.mjs c2   баррель тонкий: state.js — только re-export
 *   node spec/checks/state-split.mjs c3   негативный случай: компаратор отвергает потерю имени и ручную правку барреля
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = path.join(PKG, 'plugin', 'lib');
const STATE = path.join(LIB, 'state.js');
const DIR = path.join(LIB, 'state');

const MAX_MODULE_LINES = 500;
const MAX_BARREL_LINES = 150;
const MODULES = [
  'constants.js', 'primitives.js', 'contract.js', 'policy.js', 'decisions.js',
  'attack.js', 'lock.js', 'acceptance.js', 'task-state.js', 'views.js', 'repository.js',
];

/* Заморожено контрактом 0177: 55 экспортов state.js до раскладки. */
const BASELINE_EXPORTS = [
  'TOOL', 'POLICY_LEVELS', 'DECISION_CLASSES', 'DECISION_IMPACTS', 'DECISION_EVIDENCE_KINDS',
  'REMARK_CLASSES', 'STAGES', 'STAGE_LABELS', 'STAGE_ORDER',
  'toPosix', 'fromPosix', 'canonicalize', 'sha256Text', 'sha256Bytes', 'exists', 'readText', 'readJsonSafe',
  'parseTaskMeta', 'extractCriteriaBlock', 'parseCriteriaRaw', 'isManual',
  'policyOf', 'familyOf', 'modelLevel', 'applyLevel',
  'decisionEvidenceKind', 'decisionsDigest', 'summarizeDecisions', 'decisionItems',
  'attackView', 'lockView',
  'coverageView', 'effectsView', 'verifyView', 'redView', 'reviewView', 'recordView',
  'buildTaskState', 'boardTask', 'countStages',
  'policyView',
  'loadConfig', 'captureCommand', 'runGit', 'readGitHead', 'readGitLog',
  'listRepoFiles', 'globToRegExp', 'matchesAny', 'hashProtectedFiles', 'readWorkflowInfo',
  'readBaseline', 'readRepository', 'readRepoInfo', 'readTask',
];

function fail(message) {
  console.error('STATE-SPLIT FAIL: ' + message);
  process.exit(1);
}

function lines(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').split('\n').length;
}

/** Баррель — файл, в котором нет кода: только шапка и строки re-export. */
export function barrelViolations(text) {
  const bad = [];
  let inComment = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (inComment) { if (line.endsWith('*/')) inComment = false; continue; }
    if (line.startsWith('/*')) { if (!line.endsWith('*/')) inComment = true; continue; }
    if (line.startsWith('*') || line.startsWith('//')) continue;
    if (/^export \* from '\.\/state\/[a-z-]+\.js';$/u.test(line)) continue;
    bad.push(line);
  }
  return bad;
}

/** Недостающие имена: баррель обязан отдавать все 55 имён до раскладки. */
export function missingExports(exported, baseline = BASELINE_EXPORTS) {
  const have = new Set(exported);
  return baseline.filter((name) => !have.has(name));
}

function barrelText() {
  if (!fs.existsSync(STATE)) fail('нет plugin/lib/state.js');
  return fs.readFileSync(STATE, 'utf8');
}

async function c1() {
  for (const name of MODULES) {
    const count = lines(path.join(DIR, name));
    if (count === null) fail('нет plugin/lib/state/' + name);
    if (count > MAX_MODULE_LINES) fail('модуль ' + name + ' больше ' + MAX_MODULE_LINES + ' строк: ' + count);
  }
  const mod = await import(pathToFileURL(STATE).href + '?check=' + Date.now());
  const missing = missingExports(Object.keys(mod));
  if (missing.length > 0) fail('баррель не отдаёт имена: ' + missing.slice(0, 5).join(', '));
  console.log('STATE-SPLIT OK c1');
}

function c2() {
  const text = barrelText();
  const count = text.split('\n').length;
  if (count > MAX_BARREL_LINES) fail('state.js не баррель: ' + count + ' строк (лимит ' + MAX_BARREL_LINES + ')');
  const bad = barrelViolations(text);
  if (bad.length > 0) fail('state.js содержит код, а не только re-export: ' + bad[0].slice(0, 80));
  const reexports = text.split('\n').filter((line) => /^export \* from /u.test(line.trim())).length;
  if (reexports < MODULES.length) fail('в барреле ' + reexports + ' re-export, ожидалось не меньше ' + MODULES.length);
  console.log('STATE-SPLIT OK c2');
}

function c3() {
  const text = barrelText();
  const current = barrelViolations(text);
  if (current.length > 0) fail('state.js не баррель: ' + current[0].slice(0, 80));
  const bad = barrelViolations(text + '\nconst leak = 1;');
  if (bad.length === 0) fail('компаратор барреля не отличает ручную правку: проверка лжива');
  const missing = missingExports(['buildTaskState', 'readTask']);
  if (missing.length === 0) fail('компаратор экспортов не отличает потерю имени: проверка лжива');
  if (missingExports(BASELINE_EXPORTS).length !== 0) fail('компаратор экспортов отвергает полный список: проверка лжива');
  console.log('STATE-SPLIT OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/state-split-0179.mjs c1|c2|c3');
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.error('STATE-SPLIT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
