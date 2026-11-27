#!/usr/bin/env node
/*
 * 0180: раскладка plugin/lib/api.js на модули.
 *
 * api.js — HTTP-половина панели: 18 маршрутов /workflow/api/*, резолв корней и
 * движка, HTTP-обвязка. Файл разложен на plugin/lib/api/{constants,roots,http,
 * payloads,router}.js; api.js остаётся публичным входом (createWorkflowRuntime,
 * createWebHandler, registerWorkflowWeb, API_PREFIX, PLUGIN_NAME,
 * DEFAULT_UPDATE_SOURCE) и не содержит тела маршрутизатора.
 *
 *   node spec/checks/api-split.mjs c1   модули на месте, размеры в пределах
 *   node spec/checks/api-split.mjs c2   api.js — тонкий вход, 6 имён на месте
 *   node spec/checks/api-split.mjs c3   негативный случай: компараторы отвергают потерю имени и код в api.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = path.join(PKG, 'plugin', 'lib');
const API = path.join(LIB, 'api.js');
const DIR = path.join(LIB, 'api');

const MAX_MODULE_LINES = 1000;
const MAX_API_LINES = 80;
const MODULES = ['constants.js', 'roots.js', 'http.js', 'payloads.js', 'router.js'];
const PUBLIC_EXPORTS = ['API_PREFIX', 'PLUGIN_NAME', 'DEFAULT_UPDATE_SOURCE', 'createWorkflowRuntime', 'createWebHandler', 'registerWorkflowWeb'];

function fail(message) {
  console.error('API-SPLIT FAIL: ' + message);
  process.exit(1);
}

function lineCount(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').split('\n').length;
}

export function missingExports(exported, baseline = PUBLIC_EXPORTS) {
  const have = new Set(exported);
  return baseline.filter((name) => !have.has(name));
}

/** api.js не держит тело маршрутизатора: только вход, константы и регистрация. */
export function apiLeaks(text) {
  const leaks = [];
  if (/function\s+createWebHandler\s*\(/u.test(text)) leaks.push('function createWebHandler');
  if (/function\s+createWorkflowRuntime\s*\(/u.test(text)) leaks.push('function createWorkflowRuntime');
  if (/function\s+selectRoot\s*\(/u.test(text)) leaks.push('function selectRoot');
  return leaks;
}

async function c1() {
  for (const name of MODULES) {
    const count = lineCount(path.join(DIR, name));
    if (count === null) fail('нет plugin/lib/api/' + name);
    if (count > MAX_MODULE_LINES) fail('модуль ' + name + ' больше ' + MAX_MODULE_LINES + ' строк: ' + count);
  }
  console.log('API-SPLIT OK c1');
}

async function c2() {
  const count = lineCount(API);
  if (count === null) fail('нет plugin/lib/api.js');
  if (count > MAX_API_LINES) fail('api.js не баррель: ' + count + ' строк (лимит ' + MAX_API_LINES + ')');
  const mod = await import(pathToFileURL(API).href + '?check=' + Date.now());
  const missing = missingExports(Object.keys(mod));
  if (missing.length > 0) fail('api.js не отдаёт имена: ' + missing.join(', '));
  const leaks = apiLeaks(fs.readFileSync(API, 'utf8'));
  if (leaks.length > 0) fail('api.js содержит тело модуля: ' + leaks.join(', '));
  console.log('API-SPLIT OK c2');
}

async function c3() {
  const missing = missingExports(['createWorkflowRuntime']);
  if (missing.length === 0) fail('компаратор экспортов не отличает потерю имени: проверка лжива');
  if (missingExports(PUBLIC_EXPORTS).length !== 0) fail('компаратор экспортов отвергает полный список: проверка лжива');
  const leaks = apiLeaks('export function createWebHandler(runtime) { return runtime; }');
  if (leaks.length === 0) fail('детектор кода не отличает тело маршрутизатора: проверка лжива');
  const current = apiLeaks(fs.readFileSync(API, 'utf8'));
  if (current.length > 0) fail('api.js содержит тело модуля: ' + current.join(', '));
  console.log('API-SPLIT OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/api-split.mjs c1|c2|c3');
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.error('API-SPLIT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
