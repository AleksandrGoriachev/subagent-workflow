#!/usr/bin/env node
/*
 * 2.6.17 (0049): дисциплина оценки — правила в шаблоне и проверяемая политика.
 *
 * Критик (retro/2026-11-04/judge-analysis.md): 7 приёмок = 3005 с, из них 1092,8 с ворота,
 * 1103,7 с ручные прогоны критериев (≈980 — дубли ворот), 465,8 с убиты дедлайном обёртки.
 * Правила жили только в брифах, которые архитектор писал руками; здесь они кодируются:
 *   - шаблон задания требует ворота фоном (или run_code с timeoutMs), wait ≤90 с,
 *     ручной прогон критерия не более одного и только если <15 с, до ворот ≤120 с;
 *   - приёмщик не читает отчёт исполнителя при risk>=medium без названной причины;
 *   - актор пишет фактическую модель, а не "unknown".
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

const policyPath = path.join(PKG, 'spec', 'scripts', 'lib', 'acceptance-policy.mjs');

async function policy() {
  truthy(fs.existsSync(policyPath), 'нет spec/scripts/lib/acceptance-policy.mjs');
  return import(pathToFileURL(policyPath).href);
}

async function c1() {
  const template = fs.readFileSync(path.join(PKG, 'spec', 'templates', 'task.md'), 'utf8');
  const start = template.indexOf('## Среда');
  const end = template.indexOf('<!-- CRITERIA:BEGIN');
  truthy(start >= 0 && end > start, 'в шаблоне нет раздела «Среда»');
  const section = template.slice(start, end);
  truthy(/фон/u.test(section), '§Среда не требует фоновый запуск ворот');
  truthy(/timeoutMs/u.test(section), '§Среда не называет run_code timeoutMs');
  truthy(/90/u.test(section), '§Среда не ограничивает ожидание 90 секундами');
  truthy(/15\s*с/u.test(section), '§Среда не ограничивает ручной прогон 15 секундами');
  truthy(/120\s*с/u.test(section), '§Среда не ограничивает время до ворот 120 секундами');
  truthy(/отчёт(а|ом)? исполнител/u.test(section), '§Среда не говорит про отчёт исполнителя');
  console.log('JUDGE OK c1');
}

async function c2() {
  const mod = await policy();
  truthy(typeof mod.reportReadGuard === 'function', 'нет reportReadGuard');
  const denied = mod.reportReadGuard({ risk: 'medium', reportRead: true, reason: '' });
  truthy(denied && denied.error, 'medium+read без причины не отклонён');
  const allowed = mod.reportReadGuard({ risk: 'medium', reportRead: true, reason: 'нужны числа замера' });
  truthy(allowed === null, 'medium+read с причиной отклонён: ' + JSON.stringify(allowed));
  const lowOk = mod.reportReadGuard({ risk: 'low', reportRead: true, reason: '' });
  truthy(lowOk === null, 'low+read отклонён, хотя должен быть разрешён');
  const noRead = mod.reportReadGuard({ risk: 'high', reportRead: false, reason: '' });
  truthy(noRead === null, 'без чтения отчёта должен быть разрешён');
  console.log('JUDGE OK c2');
}

async function c3() {
  const mod = await policy();
  truthy(typeof mod.actorModel === 'function', 'нет actorModel');
  const fromEnv = mod.actorModel({ model: '' }, { DSH_MODEL: 'deepseek-v4.1-flash' });
  truthy(fromEnv === 'deepseek-v4.1-flash', 'модель из DSH_MODEL не прочитана: ' + fromEnv);
  const fromConfig = mod.actorModel({ model: 'qwen3.8-flash' }, {});
  truthy(fromConfig === 'qwen3.8-flash', 'модель из конфига не прочитана: ' + fromConfig);
  const unknown = mod.actorModel({ model: '' }, {});
  truthy(unknown === 'unknown', 'без модели ожидалось unknown: ' + unknown);
  const inAccept = fs.readFileSync(path.join(PKG, 'spec', 'scripts', 'task-accept.mjs'), 'utf8');
  truthy(/actorModel/u.test(inAccept), 'task-accept не использует actorModel');
  truthy(/reportReadGuard/u.test(inAccept), 'task-accept не использует reportReadGuard');
  console.log('JUDGE OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/judge-discipline.mjs c1|c2|c3');
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.log('JUDGE FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
