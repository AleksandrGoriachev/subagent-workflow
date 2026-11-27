/*
 * Замок контракта: сводка для карточки.
 *
 * 0179: часть state.js; публичный вход — plugin/lib/state.js (баррель).
 */
import { canonicalize, sha256Text } from './primitives.js';
import { extractCriteriaBlock } from './contract.js';
/* ------------------------------------------------------------------ *
 * lock
 * ------------------------------------------------------------------ */

export function lockView(lock, { taskMd, criteriaRaw, attackSha256, protectedActual, taskId } = {}) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return null;
  const expected = {
    task: taskId === undefined ? null : String(taskId),
    taskFileSha256: typeof taskMd === 'string' ? sha256Text(canonicalize(taskMd)) : null,
    criteriaSha256: (() => {
      const block = extractCriteriaBlock(taskMd);
      return block === null ? null : sha256Text(canonicalize(block));
    })(),
    criteriaJsonSha256: typeof criteriaRaw === 'string' ? sha256Text(canonicalize(criteriaRaw)) : null,
    attackSha256: attackSha256 === undefined ? null : attackSha256,
  };
  const mismatches = [];
  for (const key of Object.keys(expected)) {
    if (expected[key] === null) continue;
    if (String(lock[key] === undefined ? null : lock[key]) !== String(expected[key])) {
      mismatches.push({ field: key, expected: expected[key], actual: lock[key] === undefined ? null : lock[key] });
    }
  }
  let protectedDiff = { changed: [], missing: [], added: [] };
  if (Array.isArray(protectedActual)) {
    const locked = new Map((Array.isArray(lock.protected) ? lock.protected : []).map((item) => [String(item.path), item.sha256]));
    const actual = new Map(protectedActual.map((item) => [String(item.path), item.sha256]));
    for (const [file, hash] of actual) {
      if (!locked.has(file)) protectedDiff.added.push(file);
      else if (locked.get(file) !== hash) protectedDiff.changed.push(file);
    }
    for (const file of locked.keys()) if (!actual.has(file)) protectedDiff.missing.push(file);
  }
  const protectedClean = !protectedDiff.changed.length && !protectedDiff.missing.length && !protectedDiff.added.length;
  const versionOk = lock.version === 3;
  return {
    present: true,
    version: lock.version === undefined ? null : lock.version,
    versionOk,
    task: lock.task === undefined ? null : String(lock.task),
    createdAt: lock.createdAt || null,
    tool: lock.tool || null,
    contractCommit: lock.contractCommit || null,
    expected,
    mismatches,
    protectedDiff,
    inSync: mismatches.length === 0 && protectedClean && versionOk,
  };
}

