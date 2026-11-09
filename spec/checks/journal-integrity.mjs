#!/usr/bin/env node
/**
 * 0109 (WC-75): целостность журнала ворот и запрет метки обхода на защищённых путях.
 *
 * Повод: 09.11 у structure в задачах 0171–0177 в HEAD оставались только red и
 * verify — строка accept исчезала бесследно. Не потому что кто-то злой: журнал
 * писался после reset, и следующая git-операция его снимала. Плюс у нас же жила
 * метка [workflow-bypass: ...], которая легализовала коммит вне контракта.
 *
 * Проверка делает два независимых дела:
 *  1. journal-integrity: каждая строка gates.jsonl несёт prev — sha256 предыдущей
 *     строки; разрыв/правка/удаление обнаруживаются. Нет prev у старой записи —
 *     это история (WARN), а не нарушение.
 *  2. bypass-policy: метка обхода действует только на документацию; коммит с ней,
 *     трогающий защищённые пути (lib/, checks/, spec/, tools/, structure/), — ERROR.
 */
import fs from 'node:fs';
import path from 'node:path';
import { verifyChain } from '../scripts/lib/common.mjs';

/** Пути, которые нельзя менять «по метке»: только контракт и артефакты. */
export const PROTECTED = ['lib/', 'checks/', 'spec/', 'tools/', 'structure/'];

/** Трогает ли коммит защищённые пути. */
export function touchesProtected(paths, protectedRoots = PROTECTED) {
  const list = Array.isArray(paths) ? paths : [];
  const roots = (Array.isArray(protectedRoots) ? protectedRoots : PROTECTED).map((root) => String(root).replace(/\/+$/u, '') + '/');
  return list.filter((file) => {
    const normalized = String(file).replace(/\\/gu, '/').replace(/^\.\//u, '');
    return roots.some((root) => normalized.startsWith(root) || normalized === root.slice(0, -1));
  });
}

/**
 * Разбор сообщения коммита: есть ли метка обхода и какие пути она прикрывает.
 * @param {string} message
 * @param {string[]} paths
 * @param {{marker?: string, protectedRoots?: string[]}} [options]
 */
export function bypassDecision(message, paths, options = {}) {
  const marker = String(options.marker || 'workflow-bypass');
  const text = String(message || '');
  const hasMarker = text.includes(marker);
  const risky = touchesProtected(paths, options.protectedRoots);
  if (!hasMarker) return { ok: true, bypass: false, risky: [] };
  if (risky.length === 0) return { ok: true, bypass: true, risky: [] };
  return {
    ok: false,
    bypass: true,
    risky,
    reason: 'метка ' + marker + ' не действует на защищённые пути: ' + risky.slice(0, 3).join(', ')
      + (risky.length > 3 ? ' и ещё ' + (risky.length - 3) : '') + ' — нужен контракт задачи и артефакты ворот',
  };
}

/** Проверить все журналы ворот репозитория. */
export function checkJournals(root) {
  const dir = path.join(String(root), 'docs', 'tasks');
  if (!fs.existsSync(dir)) return { ok: true, problems: [], checked: 0, legacy: 0 };
  const problems = [];
  let checked = 0;
  let legacy = 0;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name, 'gates.jsonl');
    if (!fs.existsSync(file)) continue;
    checked += 1;
    const result = verifyChain(file);
    if (result.lines === 0) continue;
    /* Журнал без единой записи с prev — история до цепочки, не нарушение. */
    if (result.legacy === true) { legacy += 1; continue; }
    if (!result.ok) problems.push(name + ': ' + result.problems.join('; '));
  }
  return { ok: problems.length === 0, problems, checked, legacy };
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const rootArg = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(import.meta.dirname, '..', '..');
  const result = checkJournals(rootArg);
  for (const problem of result.problems) console.log('JOURNAL ERROR ' + problem);
  if (result.legacy > 0) console.log('JOURNAL WARN журналов без цепочки (история): ' + result.legacy);
  if (result.ok) console.log('journal-integrity: OK — проверено журналов ' + result.checked);
  else process.exitCode = 1;
}
