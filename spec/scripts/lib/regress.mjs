import path from 'node:path';

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

/*
 * Проектный allowlist регресса (2.6.82).
 *
 * Файл: docs/subagent-workflow/regress.allowlist.json (или --allowlist, или
 * workflow.config.json → regress.allowlist). Записи:
 *   { task: "0111", criteria: ["C2"], reason: "почему провал известен",
 *     reviewBy: "2026-12-12", owner: "coordinator" }
 *
 * Смысл: известный (предсуществующий) провал конкретного критерия принятого
 * задания не объявляется регрессом — но и не исчезает: он попадает в отчёт как
 * allowed, с причиной и сроком. Просроченный reviewBy — WARN; при --strict
 * просроченная запись не подавляет провал (долг должен быть починен или
 * переутверждён).
 *
 * Источник истины один: первый найденный файл по порядку
 *   --allowlist → config regress.allowlist → проект → docs/tasks/<id>/regress.allowlist.json (legacy).
 */
export const ALLOWLIST_PROJECT_PATH = 'docs/subagent-workflow/regress.allowlist.json';

function allowlistString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Разобрать текст allowlist. Ничего не бросает: проблемы возвращаются списком,
 * некорректные записи пропускаются (молча подавлять провал нельзя).
 */
export function parseAllowlist(text, source = '') {
  const result = { source, entries: [], problems: [], fatal: false };
  let parsed;
  try {
    parsed = JSON.parse(String(text).replace(/^\uFEFF/u, ''));
  } catch (error) {
    result.fatal = true;
    result.problems.push('allowlist не является JSON: ' + (error && error.message ? error.message : String(error)));
    return result;
  }
  const rawEntries = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.entries) ? parsed.entries : null);
  if (!rawEntries) {
    result.fatal = true;
    result.problems.push('allowlist: ожидался массив записей или { entries: [...] }');
    return result;
  }
  const seen = new Set();
  rawEntries.forEach((raw, index) => {
    const label = 'запись #' + (index + 1);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { result.problems.push(label + ': не объект'); return; }
    const task = allowlistString(raw.task);
    if (!/^\d{4}$/u.test(task)) { result.problems.push(label + ': task должен быть номером из 4 цифр'); return; }
    const criteria = Array.isArray(raw.criteria) ? raw.criteria.map(allowlistString).filter((item) => item !== '') : [];
    if (criteria.length === 0) { result.problems.push(label + ': criteria должен быть непустым массивом ID'); return; }
    const reason = allowlistString(raw.reason);
    if (reason === '') { result.problems.push(label + ': нет reason — молчаливое подавление запрещено'); return; }
    const reviewBy = allowlistString(raw.reviewBy);
    if (reviewBy !== '' && Number.isNaN(new Date(reviewBy).getTime())) {
      result.problems.push(label + ': reviewBy не дата: ' + reviewBy);
      return;
    }
    const owner = allowlistString(raw.owner);
    if (owner === '') result.problems.push(label + ': нет owner (запись останется без владельца)');
    for (const criterion of criteria) {
      const key = task + '/' + criterion;
      if (seen.has(key)) { result.problems.push(label + ': повтор ' + key + ' — учитывается первая запись'); continue; }
      seen.add(key);
      result.entries.push({ task, criteria: [criterion], reason, reviewBy, owner, rawCriteria: criteria });
    }
  });
  return result;
}

/** Запись allowlist для критерия задания (или null). */
export function allowlistEntry(allowlist, task, criterion) {
  if (!allowlist || !Array.isArray(allowlist.entries)) return null;
  const taskId = String(task);
  const criterionId = String(criterion);
  return allowlist.entries.find((entry) => entry.task === taskId && entry.criteria.includes(criterionId)) || null;
}

/**
 * Решение по провалу критерия: подавлять ли его и просрочен ли срок.
 * strict + просроченный reviewBy — не подавляем: долг обязан быть починен
 * или переутверждён, иначе «известный красный» становится постоянным.
 */
export function allowlistVerdict(allowlist, task, criterion, { now = new Date(), strict = false } = {}) {
  const entry = allowlistEntry(allowlist, task, criterion);
  if (!entry) return null;
  const expired = isExpired(entry, now);
  return { entry, expired, suppress: !(strict && expired) };
}

/** Порядок поиска файла allowlist: CLI → config → проект. */
export function allowlistCandidates({ repo, argvAllowlist, configAllowlist }) {
  const candidates = [];
  if (argvAllowlist !== undefined && argvAllowlist !== null && String(argvAllowlist).trim() !== '') {
    candidates.push({ file: path.resolve(repo, String(argvAllowlist)), source: '--allowlist', required: true });
  }
  if (typeof configAllowlist === 'string' && configAllowlist.trim() !== '') {
    candidates.push({ file: path.resolve(repo, configAllowlist.trim()), source: 'config regress.allowlist', required: true });
  }
  candidates.push({ file: path.join(repo, ALLOWLIST_PROJECT_PATH), source: 'проект', required: false });
  return candidates;
}

/**
 * Пометить известные провалы как allowed. Мутирует результаты (allowedBy) и
 * возвращает список allowed для отчёта. Не маскирует ошибки прогона: только
 * строки с passed === false.
 */
export function applyAllowlistToResults(results, allowlist, task, { strict = false, now = new Date() } = {}) {
  const allowed = [];
  for (const item of Array.isArray(results) ? results : []) {
    if (!item || item.passed !== false) continue;
    const verdict = allowlistVerdict(allowlist, task, String(item.id), { now, strict });
    if (!verdict || !verdict.suppress) continue;
    item.allowedBy = {
      reason: verdict.entry.reason,
      reviewBy: verdict.entry.reviewBy || null,
      owner: verdict.entry.owner || '',
      expired: verdict.expired,
    };
    allowed.push({
      id: String(item.id),
      reason: item.allowedBy.reason,
      reviewBy: item.allowedBy.reviewBy,
      owner: item.allowedBy.owner,
      expired: verdict.expired,
    });
  }
  return allowed;
}
