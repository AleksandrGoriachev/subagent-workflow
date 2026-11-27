#!/usr/bin/env node
/*
 * Сборка панели (0176): plugin/lib/client.js — конкатенация фрагментов
 * plugin/client/*.js в порядке имён, байт в байт.
 *
 * Загрузчик DSH отдаёт lib/client.js как один классический скрипт и не умеет
 * синхронно подгружать соседние файлы, поэтому раскладка живёт только в
 * исходниках: фрагменты — слои одного скрипта (вход, константы, подсказки,
 * стили, helpers, вид, движок, доска, карточка, политика, хвост), а не
 * самостоятельные модули. Правило: фрагмент — непрерывный кусок файла.
 *
 *   node plugin/tools/build-client.mjs           собрать lib/client.js
 *   node plugin/tools/build-client.mjs --check   сравнить, ничего не писать
 *
 * Дрейф («файл правлен руками») ловится проверкой spec/checks/panel-split.mjs c1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLIENT_DIR = path.join(PKG, 'plugin', 'client');
export const CLIENT_FILE = path.join(PKG, 'plugin', 'lib', 'client.js');

/** Фрагменты в порядке склейки: имена задают порядок слоёв. */
export function fragments() {
  return fs.readdirSync(CLIENT_DIR).filter((name) => name.endsWith('.js')).sort();
}

/** Точное содержимое lib/client.js: конкатенация без разделителей и добавок. */
export function buildClient() {
  return fragments().map((name) => fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8')).join('');
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const expected = buildClient();
  if (process.argv.includes('--check')) {
    const actual = fs.existsSync(CLIENT_FILE) ? fs.readFileSync(CLIENT_FILE, 'utf8') : null;
    if (actual !== expected) {
      console.error('build-client: lib/client.js не совпадает со склейкой фрагментов — запустите node plugin/tools/build-client.mjs');
      process.exit(1);
    }
    console.log('build-client: ок (' + fragments().length + ' фрагментов)');
  } else {
    fs.writeFileSync(CLIENT_FILE, expected);
    console.log('build-client: собрано ' + fragments().length + ' фрагментов в ' + path.relative(PKG, CLIENT_FILE).split(path.sep).join('/'));
  }
}
