#!/usr/bin/env node
/*
 * 0141 (2.6.111): тень движка — факт ruleset.
 *
 * Проверяет обе формы подписи якорей и два правила схемы:
 *  c1 — реальный docs/anchors.approval.json (плоская строка signature + keyId рядом):
 *       readRuleset даёт объект подписи, keyId human-user и непустое value;
 *       validateFact проходит, тень снова строит вердикт;
 *  c2 — без approval факт валиден с ruleset.signature = null, но послабление не
 *       распространяется на другие виды и поля (0141/2.6.111);
 *  c3 — негатив: битая подпись и чужой keyId не дают verified=true, reason заполнен;
 *       неизвестный kind и ruleset без version по-прежнему отвергаются;
 *  c4 — реальная конвертация docs/tasks/0139 во временный workspace даёт цепь с ruleset.
 *  c5 — 0142/2.6.111: плоская подпись якорей несёт covers='document' (sign.mjs
 *       подписывает весь документ без полей подписи), и C9 движка проходит на
 *       реальных фактах с реальными acceptors: движок проверяет подпись сам;
 *  c6 — негатив: неизвестное покрытие (covers='unknown') и неподтверждённая
 *       подпись (verified=false) получают C9 fail; detail называет фактическое
 *       значение покрытия, а не только ожидаемое.
 *
 * Временные каталоги — в os.tmpdir(): воркспейс проверкой не засоряется.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

/* Вне пакета (развёрнутая копия) проверка печатает SKIP — конвенция задания 0035. */
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const { readRuleset, convertToWorkspace } = await import(pathToFileURL(path.join(PKG, 'spec', 'scripts', 'facts-convert.mjs')).href);
const { validateFact, readFactFile } = await import(pathToFileURL(path.join(PKG, 'spec', 'lib', 'facts.mjs')).href);
const { generateKeyPair } = await import(pathToFileURL(path.join(PKG, 'spec', 'scripts', 'sign.mjs')).href);
const { evaluateTask, loadAcceptors: loadEngineAcceptors } = await import(pathToFileURL(path.join(PKG, 'spec', 'engine.mjs')).href);

/* BOM пишут Windows-инструменты: JSON.parse на нём падает, как и в конвертере. */
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const removeDir = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* временный каталог переживёт */ } };
const need = (value, message) => { if (!value) throw new Error(message); };

/* Факт ruleset строится так же, как его пишет convertTask: ровно эти поля. */
const rulesetRow = (ruleset) => ({
  kind: 'ruleset',
  version: ruleset.version,
  anchors_hash: ruleset.anchors_hash,
  presets_hash: ruleset.presets_hash,
  seal: ruleset.seal,
  policy: ruleset.policy,
  signature: ruleset.signature,
});

function c1() {
  const ruleset = readRuleset(PKG);
  const signature = ruleset.signature;
  need(signature && typeof signature === 'object' && !Array.isArray(signature), 'ruleset.signature не объект: ' + JSON.stringify(signature));
  need(signature.keyId === 'human-user', 'keyId плоской подписи не human-user: ' + String(signature.keyId));
  need(typeof signature.value === 'string' && signature.value !== '', 'value плоской подписи пустой');
  need(signature.covers !== null && signature.covers !== undefined, 'covers плоской подписи не заполнен');
  need(signature.verified === true, 'плоская подпись не подтверждена человеческим ключом: ' + String(signature.reason));
  const form = validateFact(rulesetRow(ruleset));
  need(form.ok, 'ruleset не проходит схему: ' + String(form.problem));
  console.log('RULESET OK c1');
}

function c2() {
  const dir = tempDir('wf-ruleset-c2-');
  try {
    const ruleset = readRuleset(dir);
    need(ruleset.signature === null, 'без approval ожидался signature=null, получено: ' + JSON.stringify(ruleset.signature));
    const row = rulesetRow(ruleset);
    need(row.signature === null, 'в факте signature не null');
    const form = validateFact(row);
    need(form.ok, 'ruleset с signature=null отвергнут схемой: ' + String(form.problem));
    /*
     * 0141/2.6.111: null — допустимое значение только для ruleset.signature.
     * Для остальных видов null остаётся «нет поля», иначе послабление
     * обесценило бы обязательность полей.
     */
    const nullAt = validateFact({ kind: 'genesis', task: 'x', contract_hash: 'h', at: null, writer: 'w' });
    need(nullAt.ok === false, 'genesis с at=null принят — null разрешён вне ruleset.signature');
    console.log('RULESET OK c2');
  } finally {
    removeDir(dir);
  }
}

function c3() {
  const dir = tempDir('wf-ruleset-c3-');
  try {
    const root = path.join(dir, 'repo');
    const realApproval = readJson(path.join(PKG, 'docs', 'anchors.approval.json'));
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.copyFileSync(path.join(PKG, 'docs', 'anchors.json'), path.join(root, 'docs', 'anchors.json'));
    /* acceptors.json конвертер ищет на уровень выше корня: docs/subagent-workflow рядом с repo. */
    fs.mkdirSync(path.join(dir, 'docs', 'subagent-workflow'), { recursive: true });
    fs.copyFileSync(path.join(PKG, '..', 'docs', 'subagent-workflow', 'acceptors.json'), path.join(dir, 'docs', 'subagent-workflow', 'acceptors.json'));

    /* 1) подпись испорчена: последние байты подменены, keyId настоящий. */
    const broken = { ...realApproval, signature: String(realApproval.signature).slice(0, -4) + 'AAAA' };
    writeJson(path.join(root, 'docs', 'anchors.approval.json'), broken);
    const brokenRuleset = readRuleset(root);
    need(brokenRuleset.signature && typeof brokenRuleset.signature === 'object', 'битая подпись не дала объект: ' + JSON.stringify(brokenRuleset.signature));
    need(brokenRuleset.signature.verified !== true, 'битая подпись признана верной');
    need(typeof brokenRuleset.signature.reason === 'string' && brokenRuleset.signature.reason !== '', 'у битой подписи нет reason');
    need(validateFact(rulesetRow(brokenRuleset)).ok === true, 'факт с битой подписью невалиден — схема мешает проверке подписи');

    /* 2) подпись целая, но ключ чужой: verified=true быть не может. */
    writeJson(path.join(root, 'docs', 'anchors.approval.json'), { ...realApproval, keyId: 'stranger-9000' });
    const strangerRuleset = readRuleset(root);
    need(strangerRuleset.signature && strangerRuleset.signature.verified !== true, 'чужой keyId признан верным');
    need(typeof strangerRuleset.signature.reason === 'string' && strangerRuleset.signature.reason !== '', 'у чужого keyId нет reason');

    /* 3) схема не ослаблена: неизвестный kind и ruleset без version отвергаются. */
    need(validateFact({ kind: 'unknown' }).ok === false, 'неизвестный kind принят схемой');
    const noVersion = { ...rulesetRow(readRuleset(PKG)) };
    delete noVersion.version;
    need(validateFact(noVersion).ok === false, 'ruleset без version принят схемой');
    console.log('RULESET OK c3');
  } finally {
    removeDir(dir);
  }
}

function c4() {
  const dir = tempDir('wf-ruleset-c4-');
  try {
    /*
     * Ключ фактов — временный: проверка не зависит от ~/.wf-keys машины.
     * Конвертация при этом настоящая: артефакты docs/tasks/0139 и repoRoot пакета.
     */
    const keyFile = path.join(dir, 'agent-facts.key.pem');
    fs.writeFileSync(keyFile, generateKeyPair().privateKeyPem);
    const workspace = path.join(dir, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    const result = convertToWorkspace(path.join(PKG, 'docs', 'tasks', '0139'), workspace, { repoRoot: PKG, force: true, factsKey: keyFile });
    need(result.ok, 'конвертация не удалась: ' + (result.problems || []).join('; '));
    const text = fs.readFileSync(result.file, 'utf8');
    const kinds = text.split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => { try { return JSON.parse(line).kind; } catch { return 'broken-line'; } });
    need(kinds.includes('ruleset'), 'в файле фактов нет строки kind=ruleset: ' + result.file);
    const read = readFactFile(result.file);
    need(read.ok, 'readFactFile отверг цепь: ' + read.problems.join('; '));
    const row = read.rows.find((item) => item.kind === 'ruleset');
    need(Boolean(row), 'ruleset не прочитан из цепи');
    need(row.signature && typeof row.signature === 'object' && !Array.isArray(row.signature), 'ruleset без объекта подписи: ' + JSON.stringify(row.signature));
    need(row.signature.keyId === 'human-user', 'keyId в факте не human-user: ' + String(row.signature.keyId));
    need(row.signature.verified === true, 'подпись якорей в факте не подтверждена: ' + String(row.signature.reason));
    console.log('RULESET OK c4');
  } finally {
    removeDir(dir);
  }
}

/* C9 по факту ruleset: остальные ограничения кейсам c5/c6 не нужны, цепь — не предмет. */
function c9Of(ruleset, acceptors) {
  const read = { rows: [rulesetRow(ruleset)], ok: true, problems: [] };
  const result = evaluateTask(read, { acceptors });
  return result.report.find((item) => item.id === 'C9') || { status: 'missing', detail: 'C9 нет в отчёте движка' };
}

/*
 * c5 (0142/2.6.111): плоская подпись якорей (signature — строка) подписывает
 * весь документ, поэтому факт обязан нести covers='document'. Проверка не
 * доверяет полю verified: C9 считается на реальных acceptors, и движок сам
 * сверяет подпись с человеческим ключом.
 */
function c5() {
  const ruleset = readRuleset(PKG);
  const signature = ruleset.signature;
  need(signature && typeof signature === 'object' && !Array.isArray(signature), 'ruleset.signature не объект: ' + JSON.stringify(signature));
  need(signature.covers === 'document', "covers плоской подписи не 'document': " + JSON.stringify(signature.covers));
  need(signature.verified === true, 'плоская подпись не подтверждена человеческим ключом: ' + String(signature.reason));
  const acceptors = loadEngineAcceptors(path.resolve(PKG, '..'));
  need(Array.isArray(acceptors) && acceptors.length > 0, 'acceptors.json не прочитан: движку нечем проверить подпись');
  const c9 = c9Of(ruleset, acceptors);
  need(c9.status === 'pass', 'C9 не прошёл на реальных фактах: ' + c9.status + ' — ' + String(c9.detail));
  const form = validateFact(rulesetRow(ruleset));
  need(form.ok, 'ruleset не проходит схему: ' + String(form.problem));
  console.log('RULESET OK c5');
}

/*
 * c6 (0142/2.6.111, негатив): «принимаем document» не означает «принимаем всё».
 * Неизвестное покрытие — отказ, и detail называет фактическое значение. Вторая
 * половина — неподтверждённая подпись: verified=false остаётся отказом C9.
 */
function c6() {
  const ruleset = readRuleset(PKG);
  const signature = ruleset.signature;
  need(signature && typeof signature === 'object' && !Array.isArray(signature), 'ruleset.signature не объект: ' + JSON.stringify(signature));
  const acceptors = loadEngineAcceptors(path.resolve(PKG, '..'));
  need(Array.isArray(acceptors) && acceptors.length > 0, 'acceptors.json не прочитан: движку нечем проверить подпись');

  const unknown = c9Of({ ...ruleset, signature: { ...signature, covers: 'unknown' } }, acceptors);
  need(unknown.status === 'fail', 'неизвестное покрытие прошло C9: ' + unknown.status);
  need(String(unknown.detail).includes('unknown'), 'detail не называет фактическое покрытие: ' + String(unknown.detail));

  const unverified = c9Of({ ...ruleset, signature: { ...signature, verified: false, reason: 'подпись не проверена' } }, acceptors);
  need(unverified.status === 'fail', 'неподтверждённая подпись прошла C9: ' + unverified.status);
  console.log('RULESET OK c6');
}

const table = { c1, c2, c3, c4, c5, c6 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/facts-ruleset.mjs c1|c2|c3|c4|c5|c6');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('RULESET FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
