/**
 * Контракт до красного (WC-20, 0092): пробный прогон mustPass на базе.
 *
 * mustPass по определению зелёные ДО работы. Если они красные на базе, контракт
 * сломан: красный прогон докажет не поведение, а ошибку проверки, и время
 * потрачено зря. Поэтому preflight гоняет только mustPass, дешёвые первыми;
 * дорогие не запускаются, если дешёвая уже упала.
 */
import path from 'node:path';
import { runCommand, evaluateExpectation } from './common.mjs';

/** Граница «дешёвая проверка» по заявленному таймауту. */
export const CHEAP_TIMEOUT_MS = 120000;

export function isExpensiveCriterion(criterion) {
  const tags = Array.isArray(criterion && criterion.tags) ? criterion.tags : [];
  return tags.includes('expensive') || Number((criterion && criterion.timeoutMs) || 0) > CHEAP_TIMEOUT_MS;
}

/** mustPass-критерии в порядке «дешёвые → дорогие». */
export function mustPassOrder(criteria) {
  const ids = new Set(Array.isArray(criteria.redExpect && criteria.redExpect.mustPass)
    ? criteria.redExpect.mustPass.map(String)
    : []);
  const list = (Array.isArray(criteria.criteria) ? criteria.criteria : []).filter((item) => ids.has(String(item.id)));
  return [...list.filter((item) => !isExpensiveCriterion(item)), ...list.filter((item) => isExpensiveCriterion(item))];
}

/**
 * @returns {Promise<{ok: boolean, empty: boolean, rows: object[], skipped: string[]}>}
 */
export async function preflightMustPass({ repo, criteria, env = process.env, log = () => {} }) {
  const ordered = mustPassOrder(criteria);
  if (ordered.length === 0) return { ok: true, empty: true, rows: [], skipped: [] };
  const rows = [];
  const skipped = [];
  let cheapFailed = false;
  for (const criterion of ordered) {
    const id = String(criterion.id);
    const expensive = isExpensiveCriterion(criterion);
    if (expensive && cheapFailed) {
      skipped.push(id);
      log('SKIP ' + id + ' — дорогая проверка, дешёвые mustPass уже упали');
      continue;
    }
    const run = await runCommand(criterion.command, {
      cwd: path.resolve(String(repo), String(criterion.cwd || '.')),
      env,
      timeoutMs: Number(criterion.timeoutMs) > 0 ? Number(criterion.timeoutMs) : CHEAP_TIMEOUT_MS,
    });
    const verdict = evaluateExpectation(criterion.expect, run);
    const row = {
      id,
      command: String(criterion.command),
      ok: verdict.passed,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      reasons: verdict.reasons,
    };
    rows.push(row);
    log((row.ok ? 'PASS ' : 'FAIL ') + id + '  exit ' + row.exitCode + '  ' + row.durationMs + ' ms');
    if (!row.ok) {
      for (const reason of row.reasons) log('        ' + reason);
      if (!expensive) cheapFailed = true;
    }
  }
  return { ok: rows.every((row) => row.ok), empty: false, rows, skipped };
}
