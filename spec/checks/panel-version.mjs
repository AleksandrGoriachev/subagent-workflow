#!/usr/bin/env node
/*
 * 0136 (2.6.109): панель и движок нумеруются раздельно — и подписи это говорят.
 *
 * Проверки:
 *  c1 — 0.9.39 в plugin/lib/compat.js (PLUGIN_VERSION), plugin/package.json
 *       (version), корневом package.json (dshPanelVersion) и TOOL из
 *       plugin/lib/state.js. TOOL выводится из PLUGIN_VERSION, поэтому
 *       проверяется исполнением, а не поиском строки;
 *  c2 — в plugin/lib/client.js нет «Версия сборки панели: v…», есть
 *       «Движок в этой сборке панели» и пояснение о раздельной нумерации;
 *       panelOlderHint и шапка («Панель: v…») остаются на месте;
 *  c3 (негатив) — на копии с расхождением (compat 0.9.38, package 0.9.39)
 *       функция проверки c1 сообщает о расхождении; на согласованной копии
 *       она при этом зелёная, то есть молчит не всегда.
 *
 * Проверка оформлена функциями от корня (root): c3 прогоняет их на копии.
 * Конвенция пакета: вне пакета печатаем SKIP (иначе deployed-copy краснеет).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(ROOT, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

/* Ожидаемая версия панели. Движок живёт отдельно (2.6.x) и здесь не сверяется. */
export const PANEL_VERSION = '0.9.39';
/* Файлы, которых достаточно, чтобы прогнать проверку c1 на копии. */
const PANEL_FILES = [
  'plugin/lib/compat.js',
  'plugin/lib/state.js',
  'plugin/package.json',
  'package.json',
];

function readText(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

function readJson(root, rel) {
  const text = readText(root, rel);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/*
 * c1: одна версия панели в трёх местах и в TOOL. Ни одно место не пропускается:
 * расхождение хотя бы одного — это и есть та путаница, которую закрывает 0136.
 */
export async function checkPanelVersions(root) {
  const base = path.resolve(root);
  const problems = [];

  const compat = readText(base, 'plugin/lib/compat.js');
  if (compat === null) {
    problems.push('plugin/lib/compat.js: файл не найден');
  } else {
    const match = compat.match(/export const PLUGIN_VERSION\s*=\s*'([^']*)'/);
    if (!match) problems.push('plugin/lib/compat.js: нет export const PLUGIN_VERSION');
    else if (match[1] !== PANEL_VERSION) {
      problems.push('plugin/lib/compat.js: PLUGIN_VERSION ' + match[1] + ' не совпадает с ' + PANEL_VERSION);
    }
  }

  const pluginPackage = readJson(base, 'plugin/package.json');
  if (pluginPackage === null) {
    problems.push('plugin/package.json: файл не читается');
  } else if (String(pluginPackage.version || '') !== PANEL_VERSION) {
    problems.push('plugin/package.json: version ' + JSON.stringify(pluginPackage.version) + ' не совпадает с ' + PANEL_VERSION);
  }

  const rootPackage = readJson(base, 'package.json');
  if (rootPackage === null) {
    problems.push('package.json: файл не читается');
  } else if (String(rootPackage.dshPanelVersion || '') !== PANEL_VERSION) {
    problems.push('package.json: dshPanelVersion ' + JSON.stringify(rootPackage.dshPanelVersion) + ' не совпадает с ' + PANEL_VERSION);
  }

  /*
   * TOOL не вписан руками: state.js собирает его из PLUGIN_VERSION. Поэтому
   * проверяем значением — import покажет, что увидит панель на самом деле.
   */
  const statePath = path.join(base, 'plugin/lib/state.js');
  if (!fs.existsSync(statePath)) {
    problems.push('plugin/lib/state.js: файл не найден');
  } else {
    try {
      const state = await import(pathToFileURL(statePath).href);
      const expected = 'dsh-workflow-console/' + PANEL_VERSION;
      if (state.TOOL !== expected) {
        problems.push('plugin/lib/state.js: TOOL ' + JSON.stringify(state.TOOL) + ' не совпадает с ' + JSON.stringify(expected));
      }
    } catch (error) {
      problems.push('plugin/lib/state.js: TOOL не проверен: ' + (error && error.message ? error.message : String(error)));
    }
  }

  return { ok: problems.length === 0, version: PANEL_VERSION, problems };
}

/* Тело функции по имени — до следующей функции того же файла. */
function functionBody(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const tail = source.slice(start);
  const next = tail.slice(marker.length).match(/\n[ \t]*function [A-Za-z_$]/);
  return next ? tail.slice(0, marker.length + next.index) : tail;
}

/*
 * c2: подписи не выдают версию вложенного движка за версию сборки панели.
 * Тексты panelOlderHint про «сборку панели старше» — про движок, а не про
 * номер панели, и должны остаться.
 */
export function checkPanelLabels(root) {
  const base = path.resolve(root);
  const problems = [];
  const client = readText(base, 'plugin/lib/client.js');
  if (client === null) {
    problems.push('plugin/lib/client.js: файл не найден');
    return { ok: false, problems };
  }

  if (client.includes('Версия сборки панели: v')) {
    problems.push('client.js: осталась подпись «Версия сборки панели: v…» — версия движка выдаётся за версию панели');
  }
  if (!client.includes('Движок в этой сборке панели')) {
    problems.push('client.js: нет подписи «Движок в этой сборке панели»');
  }
  if (!client.includes('в этой сборке панели')) {
    problems.push('client.js: нет подписи «в этой сборке панели»');
  }
  if (!client.includes('нумеруются раздельно')) {
    problems.push('client.js: нет пояснения, что панель и движок нумеруются раздельно');
  }

  const hint = functionBody(client, 'panelOlderHint');
  if (hint === null) {
    problems.push('client.js: нет функции panelOlderHint');
  } else if (!hint.includes('сборка панели старше')) {
    problems.push('client.js: в panelOlderHint потеряна строка «сборка панели старше»');
  }

  /* Шапка показывает панель её собственной версией, а не версией движка. */
  if (!client.includes('"Панель: v" + status.plugin.version')) {
    problems.push('client.js: шапка не выводит «Панель: v<версия панели>»');
  }

  return { ok: problems.length === 0, problems };
}

/* Копия панельных файлов для c3: проверка идёт на копии, не на репозитории. */
function copyPanelFiles(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, 'plugin', 'lib'), { recursive: true });
  for (const rel of PANEL_FILES) {
    fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
  }
  return dir;
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

async function c1() {
  const result = await checkPanelVersions(ROOT);
  truthy(result.ok, result.problems.join('; '));
}

function c2() {
  const result = checkPanelLabels(ROOT);
  truthy(result.ok, result.problems.join('; '));
}

/*
 * c3 (негатив): расхождение панельной версии должно ловиться, а согласованная
 * копия — проходить. Без контрольного прогона «поймал расхождение» ничего не
 * доказывает: молчащая функция тоже «не падает».
 */
async function c3() {
  const dirs = [];
  try {
    const good = copyPanelFiles('wf-panel-version-good-');
    dirs.push(good);
    const control = await checkPanelVersions(good);
    truthy(control.ok, 'контроль: согласованная копия не прошла проверку — ' + control.problems.join('; '));

    const bad = copyPanelFiles('wf-panel-version-bad-');
    dirs.push(bad);
    const compatPath = path.join(bad, 'plugin/lib/compat.js');
    const source = fs.readFileSync(compatPath, 'utf8');
    const patched = source.replace(/export const PLUGIN_VERSION\s*=\s*'[^']*'/, "export const PLUGIN_VERSION = '0.9.38'");
    truthy(patched !== source, 'не удалось подменить PLUGIN_VERSION в копии');
    fs.writeFileSync(compatPath, patched);

    const result = await checkPanelVersions(bad);
    truthy(!result.ok, 'копия с расхождением (compat 0.9.38, package 0.9.39) признана согласованной: проверка молчит');
    truthy(
      result.problems.some((item) => item.includes('0.9.38')),
      'в сообщении о расхождении нет версии 0.9.38: ' + result.problems.join('; '),
    );
  } finally {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
}

const cases = { c1, c2, c3 };
const id = String(process.argv[2] || 'c1').toLowerCase();
try {
  if (!Object.hasOwn(cases, id)) {
    console.log('PANEL FAIL usage: node spec/checks/panel-version.mjs c1|c2|c3');
    process.exit(2);
  }
  await cases[id]();
  console.log('PANEL OK ' + id);
} catch (error) {
  console.log('PANEL FAIL ' + id + ': ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
}
