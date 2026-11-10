/**
 * 0141 (P1): факты действий и план — источник для C8 (план против фактических действий).
 *
 * Два источника, оба фактические, без догадок:
 *  1) журнал сессии исполнителя — только ЗАПИСИ (write/edit, writeFileSync); чтение не нарушение;
 *  2) дифф задачи — что реально изменилось.
 * План — allowedPaths из контракта. Всё вне плана — находка C8, не приговор.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathMatches } from './facts.mjs';
import { decodeJournal } from '../checks/foreign-workspace.mjs';

const WRITE_TOOLS = new Set(['write', 'edit']);

/** Ключ каталога журналов сессий (тот же, что у проверки W5). */
export function sessionKey(workspace) {
  const text = String(workspace).replace(/[\\/:]+/gu, '-').replace(/^-+|-+$/gu, '');
  return '--' + text + '--';
}

/** Пути записи из аргументов вызова инструмента (только записи, не чтение). */
export function writePathsOf(tool, argsText) {
  const text = String(argsText || '');
  const found = [];
  const push = (value) => {
    const clean = String(value || '').replace(/\\/gu, '/').replace(/^['"]|['"]$/gu, '').trim();
    if (clean !== '' && /[./]/u.test(clean)) found.push(clean);
  };
  if (WRITE_TOOLS.has(String(tool))) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.file_path === 'string') push(parsed.file_path);
    } catch { /* аргументы не JSON — ниже общий разбор */ }
  }
  /* Только записи: writeFileSync и вызовы tools.write/tools.edit. */
  for (const match of text.matchAll(/writeFileSync\s*\(\s*['"`]([^'"`]+)['"`]/gu)) push(match[1]);
  for (const match of text.matchAll(/tools\.(?:write|edit)\s*\(\s*\{[\s\S]{0,200}?file_path\s*:\s*['"]([^'"]+)['"]/gu)) push(match[1]);
  return [...new Set(found)];
}

/** Записи исполнителя по журналу сессии (пусто, если журнала нет). */
export function actionsFromJournal(sessionFile) {
  if (!fs.existsSync(sessionFile)) return { paths: [], note: 'журнала сессии нет' };
  let lines = [];
  try { lines = decodeJournal(sessionFile); }
  catch (error) { return { paths: [], note: 'журнал не читается: ' + String(error && error.message ? error.message : error) }; }
  const paths = [];
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'tool/call' || !entry.data) continue;
    paths.push(...writePathsOf(entry.data.name, entry.data.arguments));
  }
  return { paths: [...new Set(paths)], note: null };
}

/** Файл журнала сессии по id и воркспейсу. */
export function sessionFileOf(workspace, sessionId) {
  return path.join(os.homedir(), '.dsh', 'sessions', sessionKey(workspace), String(sessionId), 'session.v4.jsonl.zstd');
}

/**
 * Пути вне плана. Возвращает null, если план не объявлен (C8 не применим).
 * Сравнение — глобом по нормализованным путям: регистр и слеши не создают обход.
 */
export function pathsOutsidePlan(actual, planned) {
  const plan = Array.isArray(planned) ? planned.filter((item) => String(item || '').trim() !== '') : [];
  if (plan.length === 0) return null;
  return (Array.isArray(actual) ? actual : []).filter((item) => String(item || '').trim() !== '' && !pathMatches(item, plan));
}