/*
 * Классификация принятых заданий для гейта regress (2.3.1).
 *
 * Регресс (код сломался) и долг провенанса (при приёмке не было красного) — разные
 * вещи. Смешивать их в одном «fail» нельзя: в проекте с законными low-обходами
 * regress был бы красным всегда, и сигнал перестали бы читать.
 *
 *   ok                    — проверки зелёные, красный доказан
 *   regressed             — критерий закрытой задачи падает на HEAD
 *   unproven-lawful       — low + записанный allowMissingRed: красного нет по правилам
 *   unproven-violation    — medium/high без красного, или low без записанного обхода
 *   untrusted             — запись v4+ не проверяется ключом (подпись/отзыв/статус)
 *   legacy                — запись v1–v3: современная подпись неприменима
 *   error                 — запись не разбирается
 */

export const REGRESS_STATUSES = [
  'ok', 'regressed', 'unproven-lawful', 'unproven-violation', 'untrusted', 'legacy', 'error',
];

const FAILING = new Set(['regressed', 'unproven-violation', 'untrusted', 'error']);

export function classifyAcceptance(record, { signatureOk = true, revoked = false } = {}) {
  if (!record || typeof record !== 'object') return { status: 'error', reason: 'запись не разобрана' };
  const version = Number(record.version || 0);
  if (version < 4) return { status: 'legacy', reason: 'запись v' + version + ': машинно не проверяется' };
  if (record.status !== 'accepted') return { status: 'untrusted', reason: 'статус записи: ' + String(record.status) };
  if (!signatureOk) return { status: 'untrusted', reason: 'подпись не сходится с закреплённым ключом' };
  if (revoked) return { status: 'untrusted', reason: 'ключ отозван до приёмки' };

  const red = record.red;
  const redFresh = Boolean(red) && record.version >= 6
    ? red.baseSha === record.contractCommit
    : Boolean(red) && red.contractCommit === record.contractCommit;
  if (redFresh) return { status: 'ok', reason: '' };
  if (red) return { status: 'unproven-violation', reason: 'красный прогон не относится к этому контракту' };

  const bypass = Boolean(record.bypasses && record.bypasses.allowMissingRed === true);
  if (record.risk === 'low' && bypass) {
    return { status: 'unproven-lawful', reason: 'low + allowMissingRed: красного нет по правилам' };
  }
  return {
    status: 'unproven-violation',
    reason: record.risk === 'low'
      ? 'low без красного и без записанного allowMissingRed'
      : 'risk=' + String(record.risk) + ' без красного — обхода для medium/high нет',
  };
}

export function failsByDefault(status) {
  return FAILING.has(status);
}

export function loadBaseline(text) {
  const parsed = typeof text === 'string' ? JSON.parse(text) : text;
  const entries = Array.isArray(parsed && parsed.entries) ? parsed.entries : [];
  return {
    version: Number(parsed && parsed.version) || 1,
    generatedAt: parsed && parsed.generatedAt ? String(parsed.generatedAt) : null,
    entries: entries
      .filter((entry) => entry && typeof entry.task === 'string' && typeof entry.status === 'string')
      .map((entry) => ({
        task: entry.task,
        status: entry.status,
        reason: String(entry.reason || ''),
        since: entry.since ? String(entry.since) : null,
        reviewBy: entry.reviewBy ? String(entry.reviewBy) : null,
      })),
  };
}

export function baselineEntry(baseline, task, status) {
  if (!baseline) return null;
  return baseline.entries.find((entry) => entry.task === task && entry.status === status) || null;
}

/*
 * Кандидаты в baseline — только законный долг (unproven-lawful). Нарушения
 * (unproven-violation) по умолчанию не легализуются: иначе одна команда
 * --write-baseline превращает medium/high без красного в «норму».
 */
export function baselineCandidates(tasks, { includeViolations = false } = {}) {
  const allowed = includeViolations
    ? new Set(['unproven-lawful', 'unproven-violation'])
    : new Set(['unproven-lawful']);
  return (Array.isArray(tasks) ? tasks : [])
    .filter((item) => item && allowed.has(item.provenance))
    .map((item) => ({
      task: item.task,
      status: item.provenance,
      reason: item.reason || 'принято с обходом',
    }));
}

/*
 * Exit-правило гейта. Регресс/ошибка/недоверенная запись/нарушение — всегда fail,
 * даже если задача попала в baseline: baseline фиксирует долг провенанса, а не
 * разрешение ломаться. Это дефект 2.3.1, пойманый разбором на ws-school-app.
 */
export function shouldFail(item, strict = false) {
  if (!item) return false;
  const status = String(item.status || '');
  if (status === 'regressed' || status === 'error' || status === 'untrusted' || status === 'unproven-violation') {
    return true;
  }
  if (status === 'baselined') return Boolean(item.expiredBaseline) && strict;
  if (strict && (status === 'unproven-lawful' || (item.baseline && item.expiredBaseline))) return true;
  return false;
}

export function isExpired(entry, now = new Date()) {
  if (!entry || !entry.reviewBy) return false;
  const date = new Date(entry.reviewBy);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < now.getTime();
}
