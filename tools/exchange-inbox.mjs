#!/usr/bin/env node
/**
 * 0181: независимая проверка ящика обмена.
 *
 * Плагин structure доставляет письма сам, но его журнал вручения (exchange-seen.json)
 * может отставать: 11.11 письма 51/52 не были отмечены вовсе, пока сессия была занята.
 * Этот инструмент не полагается на плагин: он сам читает каталог писем и журнал
 * вручений, показывает НЕДОСТАВЛЕННЫЕ письма и может отметить их (--mark).
 *
 *   node tools/exchange-inbox.mjs [--dir <каталог>] [--seen <файл>] [--mark]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_DIR = 'C:/Users/Goryachev/Documents/deepseek-harness/coordination/threads/exchange';
const DEFAULT_SEEN = path.join(os.homedir(), '.dsh', 'project-graph', 'runs', 'exchange-seen.json');

export function unreadLetters(dir, seenFile) {
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch { seen = {}; }
  /*
   * 0181: журнал вручений покрывает не всю историю — старые письма в нём не отмечены
   * просто потому, что учёт начали позже. Поэтому «непрочитанным» считается письмо
   * новее ПОСЛЕДНЕЙ отметки этого каталога, а не всякий отсутствующий в журнале.
   */
  const norm = (value) => path.resolve(String(value)).replace(/\\/gu, '/').toLowerCase();
  const dirNorm = norm(dir);
  const dirMarks = Object.entries(seen)
    .filter(([k]) => norm(k).startsWith(dirNorm + '/'))
    .map(([, v]) => Number(v))
    .filter((n) => Number.isFinite(n));
  const watermark = dirMarks.length > 0 ? Math.max(...dirMarks) : 0;
  const rows = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    const file = path.join(dir, name);
    const marked = norm(file) in Object.fromEntries(Object.keys(seen).map((k) => [norm(k), true]));
    const mtimeMs = fs.statSync(file).mtimeMs;
    if (marked) continue;
    if (watermark > 0 && mtimeMs <= watermark) continue;
    const text = fs.readFileSync(file, 'utf8');
    const header = (field) => {
      const m = new RegExp('^' + field + ':\\s*(.+)$', 'mu').exec(text);
      return m ? m[1].trim() : '';
    };
    rows.push({
      name,
      from: header('From'),
      to: header('To'),
      status: header('Status'),
      subject: header('Subject'),
      mtime: fs.statSync(file).mtime,
    });
  }
  return rows.sort((a, b) => a.mtime - b.mtime);
}

if (process.argv[1] && process.argv[1].endsWith('exchange-inbox.mjs')) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = value('--dir') || DEFAULT_DIR;
  const seenFile = value('--seen') || DEFAULT_SEEN;
  const letters = unreadLetters(dir, seenFile);
  if (letters.length === 0) {
    console.log('ящик: непрочитанных писем нет');
    process.exit(0);
  }
  console.log('непрочитанных писем: ' + letters.length);
  for (const letter of letters) {
    console.log('- ' + letter.mtime.toISOString().slice(11, 16) + ' | ' + letter.from + ' → ' + letter.to + ' | ' + letter.status + ' | ' + letter.subject.slice(0, 80));
    console.log('  ' + letter.name);
  }
  if (argv.includes('--mark')) {
    let seen = {};
    try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch { seen = {}; }
    for (const letter of letters) seen[path.resolve(path.join(dir, letter.name))] = Date.now();
    fs.mkdirSync(path.dirname(seenFile), { recursive: true });
    fs.writeFileSync(seenFile, JSON.stringify(seen, null, 1) + '\n');
    console.log('отмечено как доставленные: ' + letters.length);
  }
  process.exit(letters.length > 0 ? 1 : 0);
}