#!/usr/bin/env node
/*
 * 2.6.19 (0052): две дешёвые дисциплины, которые стоили часов.
 *
 * 1) Границы до красного (WC-29, замер structure --127: 27 мин 22 с в 0046→0054, из них 20 мин 30 с —
 *    выброшенная работа исполнителя, который полез в lib/api.js вне allowedPaths). Настоящий dry-run
 *    до работы невозможен — исполнитель не знает заранее, какие файлы тронет. Что можно: правило в
 *    шаблоне «до первой правки сверь список файлов с allowedPaths; неизвестное — стоп и вопрос».
 * 2) Ложный accepted (WC-30, замечание приёмщика 0051): строка accept в gates.jsonl писалась до
 *    сборки кандидата, и при её сбое журнал утверждал бы «принято». Строка должна идти после кандидата.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const start = template.indexOf('## Среда');
  const end = template.indexOf('<!-- CRITERIA:BEGIN');
  truthy(start >= 0 && end > start, 'в шаблоне нет раздела «Среда»');
  const section = template.slice(start, end);
  truthy(/allowedPaths/u.test(section), '§Среда не требует сверки с allowedPaths');
  truthy(/до первой правки|перед первой правкой/iu.test(section), '§Среда не говорит «до первой правки»');
  truthy(/стоп/iu.test(section), '§Среда не требует остановиться на неизвестном файле');
  console.log('DISCIPLINE OK c1');
}

function c2() {
  const source = fs.readFileSync(path.join(PKG, 'spec', 'scripts', 'task-accept.mjs'), 'utf8');
  /* Ищем именно вызов, а не объявление функции: объявление стоит вверху файла. */
  const callAt = source.indexOf('const candidate = createCandidate(');
  const candidateAt = callAt > 0 ? callAt : source.lastIndexOf('createCandidate(');
  truthy(candidateAt > 0, 'в task-accept нет вызова createCandidate');
  const acceptAt = source.search(/appendGateRecord\([\s\S]{0,400}?kind:\s*'accept'/u);
  truthy(acceptAt > 0, 'в task-accept нет записи журнала с kind=accept');
  truthy(acceptAt > candidateAt, 'строка accept пишется до сборки кандидата (индекс ' + acceptAt + ' < ' + candidateAt + ') — при сбое сборки в журнале останется ложный accepted');
  const signAt = source.indexOf('signAcceptance');
  if (signAt > 0) truthy(acceptAt > signAt, 'строка accept пишется до подписи записи');
  console.log('DISCIPLINE OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/contract-discipline.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('DISCIPLINE FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
