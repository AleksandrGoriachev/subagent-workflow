#!/usr/bin/env node
/**
 * 0127 (WC-80): обнаружение зацикливания по журналу сессии.
 *
 * guard отсекает цикл в живом процессе; эта проверка нужна для приёмки: узел,
 * который сорок минут повторял один и тот же сбой, не должен сдавать работу как
 * «всё сделано». Считаем серии падений по отпечатку вызова, а не по тексту.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeJournal, sessionKey } from './foreign-workspace.mjs';
import { callSignature, signatureOf, hintFor } from '../../plugin/lib/loop-guard.js';

/** Разбор журнала: пары вызов-результат и серии падений. */
export function analyzeJournal(lines, options = {}) {
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 3;
  const calls = new Map();
  const series = new Map();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type === 'tool/call' && entry.data) {
      calls.set(String(entry.data.callId || ''), { tool: String(entry.data.name || ''), args: entry.data.arguments });
      continue;
    }
    if (entry.type !== 'tool/result' || !entry.data || !entry.data.message) continue;
    const message = entry.data.message;
    if (message.isError !== true) continue;
    const call = calls.get(String(message.toolCallId || ''));
    const text = Array.isArray(message.content)
      ? message.content.map((item) => (item && typeof item.text === 'string' ? item.text : '')).join(' ').trim()
      : String(message.content || '');
    if (text === '') continue;
    const tool = call ? call.tool : 'unknown';
    /*
     * Ключ — инструмент + класс ошибки: в реальном цикле аргументы каждый раз
     * слегка другие (переписанный код), а ошибка одна и та же.
     */
    const key = tool + ':' + signatureOf(tool, '', text);
    const entrySeries = series.get(key) || { tool, signature: key, count: 0, error: text, hint: hintFor(text) };
    entrySeries.count += 1;
    entrySeries.error = text;
    series.set(key, entrySeries);
  }
  const groups = [...series.values()].filter((item) => item.count >= limit);
  return { limit, groups, total: series.size };
}

/** Проверить последние сессии воркспейса. */
export function checkRoot(root, options = {}) {
  const workspace = path.resolve(String(root));
  const dir = path.join(options.sessionsDir || path.join(os.homedir(), '.dsh', 'sessions'), sessionKey(workspace));
  if (!fs.existsSync(dir)) return { ok: true, skipped: true, reason: 'нет журналов для воркспейса', groups: [] };
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 3;
  const take = Number(options.sessions) > 0 ? Number(options.sessions) : 3;
  const sessions = fs.readdirSync(dir)
    .map((name) => ({ name, file: path.join(dir, name, 'session.v4.jsonl.zstd') }))
    .filter((item) => fs.existsSync(item.file))
    .map((item) => ({ ...item, mtime: fs.statSync(item.file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, take);
  const groups = [];
  for (const session of sessions) {
    const result = analyzeJournal(decodeJournal(session.file), { limit });
    for (const group of result.groups) groups.push({ ...group, session: session.name });
  }
  return { ok: groups.length === 0, groups, sessions: sessions.length, limit };
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const root = value('--root') || process.cwd();
  const result = checkRoot(root, { limit: value('--limit'), sessions: value('--sessions') });
  if (result.skipped) console.log('loop-detector: SKIP — ' + result.reason);
  for (const group of result.groups) {
    console.log('LOOP ' + group.tool + ': ' + group.count + ' одинаковых падений подряд (сессия ' + (group.session || '?') + ')');
    console.log('       ' + String(group.error).replace(/\s+/gu, ' ').slice(0, 160));
    console.log('       сменить метод: ' + group.hint);
  }
  if (!result.skipped && result.ok) console.log('loop-detector: OK — серий падений не найдено (сессий ' + result.sessions + ', порог ' + result.limit + ')');
  if (!result.ok) process.exitCode = 1;
}
