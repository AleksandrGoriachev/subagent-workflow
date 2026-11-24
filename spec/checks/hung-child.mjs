#!/usr/bin/env node
/*
 * 2.6.107 (0130): зависший вложенный прогон — вердикт, а не ожидание.
 *
 * Приёмка 0127 зависла в selftest на 13 минут: ребёнок task-check-acceptance не
 * отвечал, снаружи был пустой лог, и спасал только ручной job kill. Здесь проверка
 * двух опор: общий текст «зависло» (hungMessage) и реальный таймаут ребёнка в
 * check-tests (runChildToFile снимает процесс и помечает timedOut).
 *
 * c1: hungMessage молчит на нормальном коде и называет метку/секунды/сигнал на зависании.
 * c2: ребёнок-зависание снимается по таймауту: код 124, timedOut, быстро.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hungMessage } from '../scripts/lib/common.mjs';
import { runChildToFile } from '../../tools/check-tests.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

async function c1() {
  const ok = hungMessage({ status: 0, stdout: 'ok', stderr: '', signal: null, error: null }, 'selftest', 60000);
  truthy(ok === null, 'нормальный код принят за зависание: ' + ok);
  const failed = hungMessage({ status: 1, stdout: '', stderr: 'boom', signal: null }, 'selftest', 60000);
  truthy(failed === null, 'обычный отказ принят за зависание: ' + failed);
  const hung = hungMessage({ status: null, stdout: '', stderr: '', signal: 'SIGKILL' }, 'task-check-acceptance 0001', 180000);
  truthy(typeof hung === 'string' && hung !== '', 'зависание не описано');
  truthy(/task-check-acceptance 0001/u.test(hung), 'метка не названа: ' + hung);
  truthy(/180 с/u.test(hung), 'таймаут не назван: ' + hung);
  truthy(/зависание, а не отказ/u.test(hung), 'нет вывода «зависание, а не отказ»: ' + hung);
  console.log('HUNG OK c1');
}

async function c2() {
  const started = Date.now();
  const result = await runChildToFile({
    name: 'hang',
    args: ['-e', 'setTimeout(function () {}, 60000)'],
    timeoutMs: 1500,
  });
  const elapsed = Date.now() - started;
  truthy(result.timedOut === true, 'ребёнок не помечен timedOut: ' + JSON.stringify(result));
  truthy(result.code === 124, 'код не 124: ' + result.code);
  truthy(elapsed < 30000, 'снятие по таймауту заняло ' + elapsed + ' мс');
  console.log('HUNG OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/hung-child.mjs c1|c2');
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.log('HUNG FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
