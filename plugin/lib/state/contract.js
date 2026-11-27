/*
 * Разбор контракта задания: TASK-META, блок критериев, manual-критерии.
 *
 * 0179: часть state.js; публичный вход — plugin/lib/state.js (баррель).
 */
/* ------------------------------------------------------------------ *
 * contract parsing
 * ------------------------------------------------------------------ */

export function parseTaskMeta(taskMd) {
  if (typeof taskMd !== 'string') return { ok: false, meta: null, error: 'нет task.md' };
  const match = taskMd.match(/<!--\s*TASK-META\s*([\s\S]*?)-->/);
  if (!match) return { ok: false, meta: null, error: 'в task.md нет блока <!-- TASK-META ... -->' };
  try {
    const meta = JSON.parse(match[1].trim());
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return { ok: false, meta: null, error: 'TASK-META не объект' };
    }
    return { ok: true, meta, error: null };
  } catch (error) {
    return { ok: false, meta: null, error: 'TASK-META не JSON: ' + String(error.message || error) };
  }
}

export function extractCriteriaBlock(taskMd) {
  if (typeof taskMd !== 'string') return null;
  const match = taskMd.match(/<!--\s*CRITERIA:BEGIN\s*-->([\s\S]*?)<!--\s*CRITERIA:END\s*-->/);
  return match ? match[1] : null;
}

export function parseCriteriaRaw(raw) {
  if (typeof raw !== 'string') return { ok: false, parsed: null, criteria: [], error: 'нет criteria.json' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, parsed: null, criteria: [], error: 'criteria.json не JSON: ' + String(error.message || error) };
  }
  const criteria = Array.isArray(parsed) ? parsed : parsed && parsed.criteria;
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return { ok: false, parsed, criteria: [], error: 'criteria.json: пустой или отсутствующий список criteria' };
  }
  return { ok: true, parsed, criteria, error: null };
}

export function isManual(criterion) {
  return criterion && (criterion.manual === true || (Array.isArray(criterion.tags) && criterion.tags.includes('manual')));
}

