#!/usr/bin/env node
/*
 * 2.6.21 (0055, WC-24): ворота сами печатают exit и длительность каждого критерия.
 *
 * Приёмщик 0039–0048 добирал это ручными прогонами (≈980 с дублей по замеру критика): в stdout
 * ворот было только `PASS  C1  5.5 s`, без exit кода и без общей сводки. Печатаем строку
 * `PASS  C1  exit 0  530 ms` и в конце — итог по всем критериям: приёмщику не нужен повтор.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const common = await import(pathToFileURL(path.join(PKG, 'spec', 'scripts', 'lib', 'common.mjs')).href);

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function c1() {
  truthy(typeof common.formatGateRow === 'function', 'в common.mjs нет formatGateRow');
  const pass = common.formatGateRow({ id: 'C1', exitCode: 0, durationMs: 530, passed: true });
  truthy(/^PASS\s+C1\s+exit 0\s+530 ms$/u.test(pass), 'строка PASS не по формату: ' + JSON.stringify(pass));
  const fail = common.formatGateRow({ id: 'C2', exitCode: 3, durationMs: 1200, passed: false });
  truthy(/^FAIL\s+C2\s+exit 3\s+1200 ms$/u.test(fail), 'строка FAIL не по формату: ' + JSON.stringify(fail));
  truthy(typeof common.formatGateSummary === 'function', 'в common.mjs нет formatGateSummary');
  const summary = common.formatGateSummary([
    { id: 'C1', exitCode: 0, durationMs: 530, passed: true },
    { id: 'C2', exitCode: 3, durationMs: 1200, passed: false },
  ]);
  truthy(/Итог/u.test(summary), 'в сводке нет слова «Итог»: ' + JSON.stringify(summary));
  truthy(/C1 exit 0 530 ms/u.test(summary), 'сводка не называет C1: ' + JSON.stringify(summary));
  truthy(/C2 exit 3 1200 ms/u.test(summary), 'сводка не называет C2: ' + JSON.stringify(summary));
  console.log('GATEOUT OK c1');
}

function c2() {
  for (const gate of ['task-red.mjs', 'task-verify.mjs', 'task-accept.mjs']) {
    const file = path.join(PKG, 'spec', 'scripts', gate);
    truthy(fs.existsSync(file), 'нет ' + gate);
    const text = fs.readFileSync(file, 'utf8');
    truthy(/formatGateRow/u.test(text), gate + ' не печатает строки через formatGateRow');
    truthy(/formatGateSummary/u.test(text), gate + ' не печатает итог через formatGateSummary');
    execFileSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  }
  console.log('GATEOUT OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/gate-output.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('GATEOUT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
