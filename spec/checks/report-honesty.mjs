#!/usr/bin/env node
/*
 * 2.6.20 (0053): отчёт без выборочных проверок и честные поля о чтении отчёта.
 *
 * 1) structure (письмо --135): их 0052 упала на первой приёмке, потому что исполнитель не прогнал
 *    регресс-проверку 0047 и отчёт об этом молчал. В шаблоне §Отчёт теперь требуется команда и exit
 *    каждой проверки из criteria.json, включая регресс.
 * 2) reportWithheld врал, если приёмщик читал отчёт без флага: task-accept не может доказать факт
 *    чтения. Поэтому поля становятся честными: reportRead = declared|not-declared,
 *    reportReadVerified = false (пока нет доказательства), причина — рядом.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function c1() {
  const template = fs.readFileSync(path.join(PKG, 'spec', 'templates', 'task.md'), 'utf8');
  const start = template.indexOf('## Отчёт');
  truthy(start >= 0, 'в шаблоне нет раздела «Отчёт»');
  const section = template.slice(start);
  truthy(/criteria\.json/u.test(section), '§Отчёт не ссылается на criteria.json');
  truthy(/регресс/iu.test(section), '§Отчёт не требует регресс-проверок');
  truthy(/exit|код возврата/iu.test(section), '§Отчёт не требует exit кода каждой проверки');
  console.log('REPORT OK c1');
}

async function c2() {
  const policyPath = path.join(PKG, 'spec', 'scripts', 'lib', 'acceptance-policy.mjs');
  truthy(fs.existsSync(policyPath), 'нет acceptance-policy.mjs');
  const mod = await import(pathToFileURL(policyPath).href);
  truthy(typeof mod.reportReadRecord === 'function', 'в acceptance-policy нет reportReadRecord');
  const declared = mod.reportReadRecord({ reportRead: true, reason: 'нужны числа замера' });
  truthy(declared.reportRead === 'declared', 'чтение с флагом не размечено как declared: ' + JSON.stringify(declared));
  truthy(declared.reportReadVerified === false, 'reportReadVerified должен быть false: ' + JSON.stringify(declared));
  truthy(declared.reportReadReason === 'нужны числа замера', 'причина не сохранена');
  const notDeclared = mod.reportReadRecord({ reportRead: false, reason: '' });
  truthy(notDeclared.reportRead === 'not-declared', 'без флага ожидалось not-declared: ' + JSON.stringify(notDeclared));
  truthy(notDeclared.reportReadVerified === false, 'reportReadVerified должен быть false и без флага');
  const source = fs.readFileSync(path.join(PKG, 'spec', 'scripts', 'task-accept.mjs'), 'utf8');
  truthy(/reportReadRecord/u.test(source), 'task-accept не использует reportReadRecord');
  console.log('REPORT OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/report-honesty.mjs c1|c2');
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.log('REPORT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
