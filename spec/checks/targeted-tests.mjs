#!/usr/bin/env node
/*
 * 2.6.17 (0043): минимальный набор проверок для исполнителя.
 *
 * Исполнитель 0039/0041/0042 тратил больше половины времени на четыре полных прогона
 * plugin/tools/test.mjs (113 с каждый) при правке одного-двух файлов. Здесь появился
 * помощник spec/scripts/tests-for.mjs: по изменённым путям он печатает ТОЛЬКО те
 * файлы тестов, которые их импортируют (транзитивно), а полный набор упоминается в
 * шаблоне задания как «один раз, в конце».
 *
 * Проверяется исполнением помощника, а не чтением его кода.
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const HELPER = path.join(PKG, 'spec', 'scripts', 'tests-for.mjs');
const TEMPLATE = path.join(PKG, 'spec', 'templates', 'task.md');

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function runHelper(args) {
  const result = spawnSync(process.execPath, [HELPER, ...args], {
    cwd: PKG,
    encoding: 'utf8',
    timeout: 120000,
  });
  return { code: result.status, out: String(result.stdout || '') + String(result.stderr || '') };
}

function c1() {
  truthy(fs.existsSync(HELPER), 'нет spec/scripts/tests-for.mjs — помощника нет');
  const { code, out } = runHelper(['plugin/lib/client.js', 'plugin/lib/api.js']);
  truthy(code === 0, 'помощник: exit ' + code + '; вывод: ' + out.slice(0, 700));
  truthy(out.includes('plugin/test/client.test.mjs'), 'client.js: нет client.test.mjs в наборе: ' + out.slice(0, 700));
  truthy(out.includes('plugin/test/api.test.mjs'), 'api.js: нет api.test.mjs в наборе: ' + out.slice(0, 700));
  truthy(!out.includes('plugin/test/compat.test.mjs'), 'лишний compat.test.mjs в минимальном наборе');
  truthy(!out.includes('tools/test.mjs'), 'минимальный набор зовёт полный набор');
  truthy(out.includes('node --test'), 'нет команды node --test');
  console.log('TARGETED OK c1');
}

function c2() {
  truthy(fs.existsSync(HELPER), 'нет spec/scripts/tests-for.mjs — помощника нет');
  const { code, out } = runHelper(['src/nope.js']);
  truthy(code !== 0, 'неизвестный путь принят молча (exit 0): ' + out.slice(0, 700));
  truthy(out.includes('src/nope.js'), 'сообщение не называет неизвестный путь: ' + out.slice(0, 700));
  truthy(!/node --test/u.test(out), 'неизвестный путь всё равно дал команду тестов: ' + out.slice(0, 700));
  console.log('TARGETED OK c2');
}

function c3() {
  truthy(fs.existsSync(TEMPLATE), 'нет spec/templates/task.md');
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  const start = text.indexOf('## Среда');
  const end = text.indexOf('<!-- CRITERIA:BEGIN');
  truthy(start >= 0 && end > start, 'в шаблоне нет раздела «Среда»');
  const section = text.slice(start, end);
  truthy(section.includes('tests-for.mjs'), '§Среда не называет spec/scripts/tests-for.mjs');
  truthy(/затронут/u.test(section), '§Среда не говорит «только затронутые файлы»');
  truthy(/полный набор/u.test(section), '§Среда не говорит про полный набор');
  const full = section.match(/tools\/test\.mjs/gu) || [];
  truthy(full.length === 1, 'полный набор упомянут ' + full.length + ' раз(а), ожидался один');
  truthy(/отчёт|отчет/u.test(section), '§Среда не требует отчёта о том, что гонялось');
  console.log('TARGETED OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/targeted-tests.mjs c1|c2|c3');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('TARGETED FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
