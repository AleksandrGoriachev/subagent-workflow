#!/usr/bin/env node
/*
 * 0191: INSTALL.md обязан совпадать с кодом ожидания узла графа.
 *
 * structure приняли 0385: инструмент project_graph_wait, ответ
 * { childId, state: "running" | "finished" | "unknown", waitedMs, exitCode?, tail? }.
 * Документ не должен ни обещать несуществующего, ни отрицать существующее:
 * старая формулировка «штатного wait/status нет» после 0385 ложна.
 *
 *   node spec/checks/install-wait.mjs c1   INSTALL.md описывает project_graph_wait по факту
 *   node spec/checks/install-wait.mjs c2   негативный случай: детектор отвергает старый текст
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(PKG, 'INSTALL.md');

const REQUIRED = ['project_graph_wait', 'childId', 'state', '"running"', '"finished"', '"unknown"', 'waitedMs', 'exitCode', 'tail', '30000', '60000', '800'];
const FORBIDDEN = ['штатного `wait/status`', 'ждать его штатно нечем', 'Пока его нет', 'ждём его', 'ожидания, которого не существует'];

function fail(message) {
  console.error('INSTALL-WAIT FAIL: ' + message);
  process.exit(1);
}

/** Проблемы документа: чего не хватает и что противоречит факту. */
export function problems(text) {
  const missing = REQUIRED.filter((token) => !text.includes(token));
  const stale = FORBIDDEN.filter((phrase) => text.includes(phrase));
  return { missing, stale };
}

function c1() {
  if (!fs.existsSync(FILE)) fail('нет INSTALL.md');
  const text = fs.readFileSync(FILE, 'utf8');
  const { missing, stale } = problems(text);
  if (stale.length > 0) fail('INSTALL.md всё ещё отрицает ожидание узла: ' + stale[0]);
  if (missing.length > 0) fail('INSTALL.md не описывает: ' + missing.slice(0, 4).join(', '));
  console.log('INSTALL-WAIT OK c1');
}

function c2() {
  const text = fs.readFileSync(FILE, 'utf8');
  const broken = text.replace('project_graph_wait', 'project_graph_await');
  if (problems(broken).missing.length === 0) fail('компаратор не замечает потерю имени инструмента: проверка лжива');
  if (problems(text).missing.length !== 0) fail('компаратор считает живой документ неполным: проверка лжива');
  console.log('INSTALL-WAIT OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/install-wait.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.error('INSTALL-WAIT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
