#!/usr/bin/env node
/**
 * T4 (0210): доставка писем обмена.
 *
 * Дефект 11.11: watcher сканировал по активности сессии, журнал фиксировал
 * сканирование, а не вручение; каталог не обходился с 16:10, обе стороны
 * перестали видеть письма. Критерии — механизм, а не обещание:
 *  1) независимый таймер, не привязанный к активности сессии;
 *  2) журнал различает scanned/delivered/pending/error;
 *  3) скан и доставка при старте сессии;
 *  4) тест: письмо, положенное при занятой сессии, доставляется после тика.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { read, report } from './common.mjs';

export function checkT4(root) {
  const watch = read(root, 'lib/exchange-watch.js') || '';
  const test = read(root, 'test/exchange-delivery.test.mjs') || read(root, 'test/exchange-watch.test.mjs') || '';
  const checks = [];
  /*
   * 0184: статический setInterval ничего не доказывает — он был и до дефекта.
   * Доказательство живости сканера: heartbeat, который пишется на каждом тике
   * независимо от активности сессии, и не старше 5 минут.
   */
  const heartbeatFile = path.join(os.homedir(), '.dsh', 'project-graph', 'runs', 'exchange-watch.json');
  let alive = false;
  let aliveDetail = 'нет heartbeat сканера (' + heartbeatFile + ')';
  try {
    const beat = JSON.parse(fs.readFileSync(heartbeatFile, 'utf8'));
    const at = new Date(beat.lastTickAt).getTime();
    alive = Number.isFinite(at) && Date.now() - at <= 5 * 60 * 1000;
    aliveDetail = alive ? '' : 'heartbeat старше 5 минут — scanner не тикает';
  } catch (error) {
    aliveDetail = 'heartbeat не читается: ' + String(error && error.message ? error.message : error);
  }
  checks.push({ name: 'сканер жив: heartbeat не старше 5 минут', ok: alive, detail: aliveDetail });
  checks.push({
    name: 'журнал различает scanned/delivered/pending/error',
    ok: ['scanned', 'delivered', 'pending', 'error'].every((state) => watch.includes("'" + state + "'") || watch.includes('\"' + state + '\"')),
    detail: 'состояния вручения не разделены — молчание не отличить от «писем нет»',
  });
  checks.push({
    name: 'скан и доставка при старте сессии',
    ok: /(start|activate|onStart|sessionStart)[\s\S]{0,200}(scan|deliver|watch)/iu.test(watch),
    detail: 'нет скана/доставки при старте сессии',
  });
  checks.push({
    name: 'тест: письмо при занятой сессии доставляется после тика',
    ok: test !== '' && /(занят|busy|tick|тик)/iu.test(test),
    detail: 'нет теста на доставку письма, положенного во время занятой сессии',
  });
  return checks;
}

if (process.argv[1] && process.argv[1].endsWith('t4-exchange-delivery.mjs')) {
  const root = process.argv[2] || path.resolve('.');
  process.exit(report('T4', checkT4(root)));
}