#!/usr/bin/env node
/*
 * 0144/2.6.111: повторный красный после неудачи — не конфликт доказательств.
 *
 * c1: пара red-unproven(exit 1) + red-proven(exit 0) даёт pass в прямом и
 *     обратном порядке строк: red-unproven — факт неудачной попытки, а не
 *     доказательство против, а журнал ворот append-only.
 * c2 (негатив): два настоящих доказательства красного (verdict red-proven) с
 *     разными exit — конфликт и отказ; «выбрать успешный дубль» запрещено.
 * c3 (негатив): только red-unproven без red-proven — гейт не покрыт, отказ.
 *
 * Вне пакета — SKIP (конвенция deployed-copy): policy.mjs подключается лениво,
 * иначе статический импорт падал бы до проверки SKIP.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

/* Задание 0035: вне пакета каталога spec нет — развёрнутая копия печатает SKIP и выходит 0. */
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

/* Повтор красного: первая попытка не доказала, вторая доказала. */
const REPEATED_RED = [
  { gate: 'red', exit: 1, verdict: 'red-unproven' },
  { gate: 'red', exit: 0, verdict: 'red-proven' },
  { gate: 'verify', exit: 0, verdict: 'accepted' },
];

async function evaluate(rows, gates) {
  const { evaluateGates } = await import('../lib/policy.mjs');
  return evaluateGates(rows, gates, true);
}

async function c1() {
  const gates = ['red', 'verify'];
  const direct = await evaluate(REPEATED_RED, gates);
  truthy(direct.status === 'pass', 'прямой порядок: ' + direct.status + ' — ' + direct.detail);
  const reversed = await evaluate([...REPEATED_RED].reverse(), gates);
  truthy(reversed.status === 'pass', 'обратный порядок: ' + reversed.status + ' — ' + reversed.detail);
  console.log('GATE-EVIDENCE OK c1');
}

async function c2() {
  const rows = [
    { gate: 'red', exit: 1, verdict: 'red-proven' },
    { gate: 'red', exit: 0, verdict: 'red-proven' },
    { gate: 'verify', exit: 0, verdict: 'accepted' },
  ];
  const result = await evaluate(rows, ['red', 'verify']);
  truthy(result.status === 'fail', 'конфликт настоящих доказательств прошёл: ' + result.status + ' — ' + result.detail);
  truthy(/конфликт/u.test(String(result.detail || '')), 'отказ не назвал конфликт: ' + result.detail);
  console.log('GATE-EVIDENCE OK c2');
}

async function c3() {
  const rows = [
    { gate: 'red', exit: 1, verdict: 'red-unproven' },
    { gate: 'verify', exit: 0, verdict: 'accepted' },
  ];
  const result = await evaluate(rows, ['red', 'verify']);
  truthy(result.status === 'fail', 'диагностика покрыла гейт: ' + result.status + ' — ' + result.detail);
  truthy(Array.isArray(result.missing) && result.missing.includes('red'), 'в missing нет red: ' + JSON.stringify(result.missing));
  console.log('GATE-EVIDENCE OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/gate-evidence.mjs c1|c2|c3');
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.log('GATE-EVIDENCE FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
