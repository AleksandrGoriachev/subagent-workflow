#!/usr/bin/env node
/*
 * 0182: раскладка spec/scripts/task-accept.mjs на модули.
 *
 * task-accept.mjs — CLI приёмки: оркестрация (аргументы, замок, актор,
 * независимость, свежий прогон, запись, кандидат) остаётся в самом файле, но
 * её обслуживающие части вынесены в spec/scripts/lib/accept/*.mjs: прогресс и
 * fail, кандидатный коммит, проверка verify-входа, теневой прогон движка.
 *
 * Совместимость важна: проверки candidate-ignored-delete и contract-discipline
 * читают ТЕКСТ task-accept.mjs. Поэтому в нём обязаны остаться функция
 * ignoredPaths с git ls-files --others --ignored (без check-ignore), вызов
 * createCandidate(...) и вызов signRecord(...).
 *
 *   node spec/checks/accept-split.mjs c1   модули на месте и в пределах размера
 *   node spec/checks/accept-split.mjs c2   task-accept.mjs ≤ 900 строк, маркеры совместимости на месте
 *   node spec/checks/accept-split.mjs c3   негативный случай: компараторы отвергают потерю маркера и модуля
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = path.join(PKG, 'spec', 'scripts');
const ACCEPT = path.join(SCRIPTS, 'task-accept.mjs');
const DIR = path.join(SCRIPTS, 'lib', 'accept');

const MAX_MODULE_LINES = 200;
const MAX_MAIN_LINES = 900;
const MODULES = ['progress.mjs', 'candidate.mjs', 'validate.mjs', 'shadow.mjs'];

/** Маркеры, которые обязаны остаться в CLI: их читают проверки движка. */
export function compatProblems(text) {
  const problems = [];
  if (!/export function ignoredPaths\(/u.test(text)) problems.push('нет export function ignoredPaths(');
  else {
    const block = text.match(/export function ignoredPaths\([\s\S]*?\n\}/u);
    if (!block || !/--others/u.test(block[0]) || !/--ignored/u.test(block[0])) problems.push('ignoredPaths без git ls-files --others --ignored');
    if (block && /check-ignore/u.test(block[0])) problems.push('ignoredPaths снова опирается на check-ignore');
  }
  if (!/const candidate = createCandidate\(/u.test(text)) problems.push('нет вызова createCandidate(');
  if (!/signRecord\(/u.test(text)) problems.push('нет вызова signRecord(');
  return problems;
}

export function missingModules(existing, required = MODULES) {
  const have = new Set(existing);
  return required.filter((name) => !have.has(name));
}

function fail(message) {
  console.error('ACCEPT-SPLIT FAIL: ' + message);
  process.exit(1);
}

function lineCount(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').split('\n').length;
}

function mainText() {
  if (!fs.existsSync(ACCEPT)) fail('нет spec/scripts/task-accept.mjs');
  return fs.readFileSync(ACCEPT, 'utf8');
}

function c1() {
  for (const name of MODULES) {
    const count = lineCount(path.join(DIR, name));
    if (count === null) fail('нет spec/scripts/lib/accept/' + name);
    if (count > MAX_MODULE_LINES) fail('модуль ' + name + ' больше ' + MAX_MODULE_LINES + ' строк: ' + count);
  }
  console.log('ACCEPT-SPLIT OK c1');
}

function c2() {
  const text = mainText();
  const count = text.split('\n').length;
  if (count > MAX_MAIN_LINES) fail('task-accept.mjs не разложен: ' + count + ' строк (лимит ' + MAX_MAIN_LINES + ')');
  const problems = compatProblems(text);
  if (problems.length > 0) fail('совместимость: ' + problems[0]);
  console.log('ACCEPT-SPLIT OK c2');
}

function c3() {
  const missing = missingModules(['progress.mjs']);
  if (missing.length === 0) fail('компаратор модулей не отличает потерю: проверка лжива');
  if (missingModules(MODULES).length !== 0) fail('компаратор модулей отвергает полный список: проверка лжива');
  const broken = mainText().replace('export function ignoredPaths(', 'export function movedIgnoredPaths(');
  if (compatProblems(broken).length === 0) fail('компаратор совместимости не отличает потерю ignoredPaths: проверка лжива');
  const problems = compatProblems(mainText());
  if (problems.length > 0) fail('совместимость: ' + problems[0]);
  console.log('ACCEPT-SPLIT OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/accept-split.mjs c1|c2|c3');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.error('ACCEPT-SPLIT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
