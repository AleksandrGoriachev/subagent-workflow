#!/usr/bin/env node
/*
 * Раскладка маршрутизатора панели (plugin/lib/api/router.js).
 *
 * 18 маршрутов /workflow/api/* живут в plugin/lib/api/routes/*.js по доменам,
 * router.js — диспетчер: метод/префикс/loopback, таблица «путь → обработчик» и
 * /api/task/<id>. Таблица заморожена: каждый путь обязан остаться в диспетчере,
 * иначе маршрут молча пропадёт.
 *
 *   node spec/checks/router-split-0188.mjs c1   routes-модули есть, router тонкий, 18 путей в таблице
 *   node spec/checks/router-split-0188.mjs c2   негативный случай: компаратор отвергает потерю пути
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = path.join(PKG, 'plugin', 'lib', 'api');
const ROUTER = path.join(API, 'router.js');
const ROUTES = path.join(API, 'routes');

const MAX_ROUTER_LINES = 200;
const MODULES = ['status.js', 'engine.js', 'plugin.js', 'writes.js', 'run.js', 'anchors.js', 'release.js'];
/* Заморожено контрактом 0188: 18 путей до раскладки. */
const PATHS = [
  '/api/metrics', '/api/status', '/api/tasks', '/api/policy', '/api/compat',
  '/api/anchors', '/api/anchors/approve', '/api/release-check',
  '/api/engine/candidates', '/api/engine-link', '/api/update', '/api/plugin-update',
  '/api/checks', '/api/run', '/api/guard', '/api/deploy', '/api/task-hash', '/api/new-task',
];

export function missingPaths(text, paths = PATHS) {
  return paths.filter((p) => !text.includes("'" + p + "'"));
}

function fail(message) {
  console.error('ROUTER-SPLIT FAIL: ' + message);
  process.exit(1);
}

function c1() {
  for (const name of MODULES) {
    if (!fs.existsSync(path.join(ROUTES, name))) fail('нет plugin/lib/api/routes/' + name);
  }
  if (!fs.existsSync(ROUTER)) fail('нет plugin/lib/api/router.js');
  const text = fs.readFileSync(ROUTER, 'utf8');
  const lines = text.split('\n').length;
  if (lines > MAX_ROUTER_LINES) fail('router.js не диспетчер: ' + lines + ' строк (лимит ' + MAX_ROUTER_LINES + ')');
  const missing = missingPaths(text);
  if (missing.length > 0) fail('в диспетчере нет путей: ' + missing.slice(0, 3).join(', '));
  if (!text.includes("startsWith('/api/task/')")) fail('нет ветви /api/task/<id>');
  console.log('ROUTER-SPLIT OK c1');
}

function c2() {
  const text = fs.readFileSync(ROUTER, 'utf8');
  const broken = text.replaceAll("'/api/guard'", "'/api/guard-typo'");
  if (missingPaths(broken).length === 0) fail('компаратор не замечает потерянный путь: проверка лжива');
  if (missingPaths(text).length !== 0) fail('компаратор считает полную таблицу неполной: проверка лжива');
  console.log('ROUTER-SPLIT OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/router-split-0188.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.error('ROUTER-SPLIT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
