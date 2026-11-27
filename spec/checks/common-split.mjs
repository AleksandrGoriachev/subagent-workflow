#!/usr/bin/env node
/*
 * 0181: раскладка spec/scripts/lib/common.mjs на модули.
 *
 * common.mjs — библиотека движка, её импортируют 106 файлов. Раскладка обязана
 * сохранить путь импорта и все 105 публичных имён: common.mjs становится
 * баррелем, код живёт в spec/scripts/lib/common/*.mjs по слоям (версия, CLI,
 * файлы, процессы, git, контракт, глобы, журнал, замок, секреты, критерии,
 * решения, красный, конфиг).
 *
 *   node spec/checks/common-split.mjs c1   модули на месте, 105 имён видны через баррель
 *   node spec/checks/common-split.mjs c2   баррель тонкий: common.mjs — только re-export
 *   node spec/checks/common-split.mjs c3   негативный случай: компараторы отвергают правку барреля и потерю имени
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = path.join(PKG, 'spec', 'scripts', 'lib');
const COMMON = path.join(LIB, 'common.mjs');
const DIR = path.join(LIB, 'common');

const MAX_MODULE_LINES = 450;
const MAX_BARREL_LINES = 150;
const MODULES = [
  'engine-version.mjs', 'cli.mjs', 'fsio.mjs', 'proc.mjs', 'git-base.mjs', 'contract-git.mjs',
  'glob.mjs', 'git-status.mjs', 'task-contract.mjs', 'journal.mjs', 'lock.mjs', 'secrets.mjs',
  'criteria.mjs', 'decisions.mjs', 'red.mjs', 'config.mjs',
];

/* Заморожено контрактом 0181: 105 экспортов common.mjs до раскладки. */
const BASELINE_EXPORTS = [
  'TOOL',
  'TASK_ARTIFACTS',
  'fail',
  'parseArgv',
  'toPosix',
  'fromPosix',
  'relPosix',
  'resolvePath',
  'exists',
  'readText',
  'readJson',
  'writeText',
  'writeJson',
  'canonicalize',
  'sha256',
  'sha256File',
  'quoteArg',
  'runSync',
  'isMainModule',
  'spawnSyncPipeFree',
  'git',
  'headCommit',
  'filesAtCommit',
  'filesAtCommitDetailed',
  'checkContractCommitted',
  'sameLockContract',
  'findRepoRoot',
  'repoRoot',
  'parseTaskMeta',
  'attributionGap',
  'metaAttributionGap',
  'nodeConsistency',
  'extractCriteriaBlock',
  'parseCriteria',
  'taskFiles',
  'GATE_JOURNAL',
  'gateJournalFile',
  'gateAt',
  'gateCriteriaOf',
  'gateRecord',
  'chainTip',
  'verifyChain',
  'appendGateRecord',
  'readTask',
  'globToRegExp',
  'matchesAny',
  'patternsIntersect',
  'walkFiles',
  'listRepoFiles',
  'ENGINE_DIR_PATTERNS',
  'protectedManifest',
  'relockAllowed',
  'contractSnapshot',
  'hashProtectedFiles',
  'computeLock',
  'hasAcceptedRecord',
  'hungMessage',
  'acceptanceRepeatGuard',
  'acceptanceNotes',
  'verifyLock',
  'lockOrderHint',
  'reportFatal',
  'parsePorcelainStatus',
  'extrasAtRisk',
  'stashSnapshot',
  'worktreeSnapshot',
  'finalizationLines',
  'dirtyPaths',
  'ownChanges',
  'diffPaths',
  'headDrift',
  'readDiffText',
  'SECRET_PATTERNS',
  'scanSecrets',
  'truncate',
  'runCommand',
  'criteriaConcurrency',
  'runCriteria',
  'evaluateExpectation',
  'formatMs',
  'formatGateRow',
  'formatGateSummary',
  'isManual',
  'DECISION_CLASSES',
  'DECISION_IMPACTS',
  'DECISION_EVIDENCE_KINDS',
  'decisionsDigest',
  'decisionEvidenceKind',
  'summarizeDecisions',
  'computeCoverage',
  'userFacingDecisions',
  'effectLinks',
  'evaluateEffects',
  'RED_REASON_WINDOW',
  'CHECK_DEFECT_NAMES',
  'detectCheckDefect',
  'matchRedReason',
  'redReasonWindow',
  'evaluateRedExpectation',
  'assertInsideRepo',
  'stableResults',
  'computeWorktreeDigest',
  'ACTOR_SOURCE_KINDS',
  'normalizeActorConfig',
  'loadConfig',
];

function fail(message) {
  console.error('COMMON-SPLIT FAIL: ' + message);
  process.exit(1);
}

function lines(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').split('\n').length;
}

/** Баррель — файл без кода: шапка и строки re-export из ./common/*.mjs. */
export function barrelViolations(text) {
  const bad = [];
  let inComment = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (inComment) { if (line.endsWith('*/')) inComment = false; continue; }
    if (line.startsWith('/*')) { if (!line.endsWith('*/')) inComment = true; continue; }
    if (line.startsWith('*') || line.startsWith('//')) continue;
    if (/^export \{ [^}]+ \} from '\.\/common\/[a-z-]+\.mjs';$/u.test(line)) continue;
    bad.push(line);
  }
  return bad;
}

export function missingExports(exported, baseline = BASELINE_EXPORTS) {
  const have = new Set(exported);
  return baseline.filter((name) => !have.has(name));
}

function barrelText() {
  if (!fs.existsSync(COMMON)) fail('нет spec/scripts/lib/common.mjs');
  return fs.readFileSync(COMMON, 'utf8');
}

async function c1() {
  for (const name of MODULES) {
    const count = lines(path.join(DIR, name));
    if (count === null) fail('нет spec/scripts/lib/common/' + name);
    if (count > MAX_MODULE_LINES) fail('модуль ' + name + ' больше ' + MAX_MODULE_LINES + ' строк: ' + count);
  }
  const mod = await import(pathToFileURL(COMMON).href + '?check=' + Date.now());
  const missing = missingExports(Object.keys(mod));
  if (missing.length > 0) fail('баррель не отдаёт имена: ' + missing.slice(0, 5).join(', '));
  console.log('COMMON-SPLIT OK c1');
}

function c2() {
  const text = barrelText();
  const count = text.split('\n').length;
  if (count > MAX_BARREL_LINES) fail('common.mjs не баррель: ' + count + ' строк (лимит ' + MAX_BARREL_LINES + ')');
  const bad = barrelViolations(text);
  if (bad.length > 0) fail('common.mjs содержит код, а не только re-export: ' + bad[0].slice(0, 80));
  const reexports = text.split('\n').filter((line) => /^export \{ /u.test(line.trim())).length;
  if (reexports < MODULES.length) fail('в барреле ' + reexports + ' re-export, ожидалось не меньше ' + MODULES.length);
  console.log('COMMON-SPLIT OK c2');
}

function c3() {
  const text = barrelText();
  const current = barrelViolations(text);
  if (current.length > 0) fail('common.mjs не баррель: ' + current[0].slice(0, 80));
  const bad = barrelViolations(text + '\nconst leak = 1;');
  if (bad.length === 0) fail('компаратор барреля не отличает ручную правку: проверка лжива');
  const missing = missingExports(['parseArgv', 'loadConfig']);
  if (missing.length === 0) fail('компаратор экспортов не отличает потерю имени: проверка лжива');
  if (missingExports(BASELINE_EXPORTS).length !== 0) fail('компаратор экспортов отвергает полный список: проверка лжива');
  console.log('COMMON-SPLIT OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/common-split.mjs c1|c2|c3');
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.error('COMMON-SPLIT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
