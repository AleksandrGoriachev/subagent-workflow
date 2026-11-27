#!/usr/bin/env node
/*
 * 0176: раскладка панели на модули.
 *
 * Панель остаётся одним классическим скриптом для загрузчика DSH (lib/client.js),
 * но пишется фрагментами plugin/client/*.js по слоям: вход, константы, подсказки,
 * стили, helpers, вид, движок, доска, карточка, политика. Сборка — 
 * plugin/tools/build-client.mjs; файл обязан совпадать со склейкой байт в байт,
 * иначе панель разошлась с исходниками.
 *
 * Тесты панели разложены по наборам с общим harness; имена 23 тестов заморожены
 * контрактом: раскладка не имеет права терять покрытие.
 *
 *   node spec/checks/panel-split.mjs c1   структура и совпадение сборки
 *   node spec/checks/panel-split.mjs c2   инвентарь тестов равен замороженному
 *   node spec/checks/panel-split.mjs c3   негативный случай: компараторы отвергают подмену
 *
 * Проверка ничего не пишет в репозиторий.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT_DIR = path.join(PKG, 'plugin', 'client');
const CLIENT = path.join(PKG, 'plugin', 'lib', 'client.js');
const TEST_DIR = path.join(PKG, 'plugin', 'test');
const BUILD = path.join(PKG, 'plugin', 'tools', 'build-client.mjs');

const MAX_FRAGMENT_LINES = 600;
const MAX_TEST_FILE_LINES = 400;
const MAX_HARNESS_LINES = 300;

/* Порядок — порядок склейки: фрагмент = непрерывный кусок одного скрипта. */
const FRAGMENTS = [
  '00-head.js',
  '01-constants.js',
  '02-hints.js',
  '03-styles.js',
  '04-helpers.js',
  '05-view.js',
  '06-engine.js',
  '07-engine-ui.js',
  '08-board.js',
  '09-board-detail.js',
  '10-card.js',
  '11-policy.js',
  '99-tail.js',
];

const SUITES = [
  'client.panel.test.mjs',
  'client.hints.test.mjs',
  'client.deploy.test.mjs',
  'client.engine.test.mjs',
  'client.engine-cards.test.mjs',
  'client.deploy-notice.test.mjs',
];

/* Заморожено контрактом 0176: 23 теста панели до раскладки. */
const BASELINE_TESTS = [
  'client bundle registers the Workflow conversation view',
  'panel renders a real board, task card and policy page',
  'policy page toggles the guard flag with confirmation (0.5.0)',
  'panel follows the current workspace and opens compatibility',
  'badges explain themselves: hints on hover and focus (WC-1)',
  'card aria-label carries effect and regress hints, card shows «Регресс» (0.4.1)',
  'badge «эффект» colored by policy severity, not by status (0.4.1)',
  'card says «не проверялось» when gates did not check the effect (0.4.1)',
  'diagnostics buttons run a read-only check and show the log (v2, step 1)',
  'panel does not substitute a foreign project: empty state first, configured roots on request',
  'empty state deploys the engine with confirmation (0.7.0)',
  'empty non-git workspace: deploy performs git init, then installs the engine (0.9.3)',
  'compatibility tab offers the same deploy button (0.7.0)',
  'package manifest declares the DSH bundle and client halves',
  'deployed engine shows versions and guards update with unfinished tasks (0.8.0)',
  'карточка panel-older: понижение не предлагается',
  'mapped workspace reads the external engine and disables writes (0.9.0)',
  'карточка external: обновление в репозитории движка',
  'карточка absent: два действия, без ошибки',
  'карточка mapped: путь, версия, источник',
  '0.9.3 config: связь задана конфигом профиля',
  'карточка движка: политика развёртывания из deploy-notice.json',
  'карточка движка: без deploy-notice.json политика не выдумывается',
];

function fail(message) {
  console.error('PANEL-SPLIT FAIL: ' + message);
  process.exit(1);
}

function readLines(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').split('\n').length;
}

function readFragment(name) {
  const file = path.join(CLIENT_DIR, name);
  if (!fs.existsSync(file)) fail('нет plugin/client/' + name);
  return fs.readFileSync(file, 'utf8');
}

/** Склейка фрагментов — ровно те байты, которые обязан содержать lib/client.js. */
export function buildFromFragments(readFile = readFragment) {
  return FRAGMENTS.map((name) => readFile(name)).join('');
}

export function sameBuilt(expected, actual) {
  return typeof actual === 'string' && expected === actual;
}

/** Имена тестов набора; набор без единого test() считается ошибкой раскладки. */
export function testNamesOf(file) {
  if (!fs.existsSync(file)) fail('нет plugin/test/' + path.basename(file));
  const text = fs.readFileSync(file, 'utf8');
  const names = [];
  const re = /^test\(\s*["'`]([^"'`]+)["'`]/gmu;
  let match;
  while ((match = re.exec(text)) !== null) names.push(match[1]);
  if (names.length === 0) fail('в ' + path.basename(file) + ' нет ни одного теста');
  return names;
}

export function inventoryMismatch(found, baseline = BASELINE_TESTS) {
  const have = new Map();
  for (const name of found) have.set(name, (have.get(name) || 0) + 1);
  const want = new Map();
  for (const name of baseline) want.set(name, (want.get(name) || 0) + 1);
  const missing = [...want.keys()].filter((name) => (have.get(name) || 0) < want.get(name));
  const extra = [...have.keys()].filter((name) => (want.get(name) || 0) < have.get(name));
  return { missing, extra };
}

function c1() {
  for (const name of FRAGMENTS) {
    const lines = readLines(path.join(CLIENT_DIR, name));
    if (lines === null) fail('нет plugin/client/' + name);
    if (lines > MAX_FRAGMENT_LINES) fail('фрагмент ' + name + ' больше ' + MAX_FRAGMENT_LINES + ' строк: ' + lines);
  }
  if (!fs.existsSync(BUILD)) fail('нет plugin/tools/build-client.mjs: сборка не воспроизводима');
  const built = buildFromFragments();
  if (!fs.existsSync(CLIENT)) fail('нет plugin/lib/client.js');
  const actual = fs.readFileSync(CLIENT, 'utf8');
  if (!sameBuilt(built, actual)) {
    fail('plugin/lib/client.js не совпадает со склейкой фрагментов: сборка устарела или файл правлен руками');
  }
  const check = spawnSync(process.execPath, [BUILD, '--check'], { cwd: PKG, encoding: 'utf8' });
  if (check.status !== 0) fail('build-client.mjs --check: ' + String(check.stderr || check.stdout || '').trim());
  if (fs.existsSync(path.join(TEST_DIR, 'client.test.mjs'))) fail('client.test.mjs остался: раскладка не завершена');
  for (const suite of SUITES) {
    const lines = readLines(path.join(TEST_DIR, suite));
    if (lines === null) fail('нет plugin/test/' + suite);
    if (lines > MAX_TEST_FILE_LINES) fail('набор ' + suite + ' больше ' + MAX_TEST_FILE_LINES + ' строк: ' + lines);
  }
  const harness = readLines(path.join(TEST_DIR, 'client.harness.mjs'));
  if (harness === null) fail('нет plugin/test/client.harness.mjs');
  if (harness > MAX_HARNESS_LINES) fail('client.harness.mjs больше ' + MAX_HARNESS_LINES + ' строк: ' + harness);
  console.log('PANEL-SPLIT OK c1');
}

function c2() {
  const found = [];
  for (const suite of SUITES) found.push(...testNamesOf(path.join(TEST_DIR, suite)));
  const { missing, extra } = inventoryMismatch(found);
  if (missing.length > 0) fail('потеряны тесты: ' + missing.slice(0, 3).join(' | '));
  if (extra.length > 0) fail('лишние тесты: ' + extra.slice(0, 3).join(' | '));
  console.log('PANEL-SPLIT OK c2');
}

function c3() {
  const built = buildFromFragments();
  if (sameBuilt(built, built + '\n// drift')) fail('компаратор сборки не отличает дрейф: проверка лжива');
  const found = [];
  for (const suite of SUITES) found.push(...testNamesOf(path.join(TEST_DIR, suite)));
  const dropped = found.slice(0, -1);
  const mismatch = inventoryMismatch(dropped);
  if (mismatch.missing.length === 0) fail('компаратор инвентаря не отличает потерянный тест: проверка лжива');
  const duplicated = found.concat(found[0]);
  const extra = inventoryMismatch(duplicated);
  if (extra.extra.length === 0) fail('компаратор инвентаря не отличает лишний тест: проверка лжива');
  console.log('PANEL-SPLIT OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/panel-split.mjs c1|c2|c3');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.error('PANEL-SPLIT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
