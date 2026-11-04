/*
 * Политика приёмки (0049): дисциплина оценки, которую нельзя оставить в брифе.
 *
 * Критик посчитал 7 приёмок = 3005 с; из них ручные прогоны критериев — 1103,7 с,
 * почти все — дубли ворот. Правила «ворота фоном, отчёт исполнителя не читать,
 * писать фактическую модель» жили только в брифах архитектора и потому не
 * проверялись. Здесь они становятся чистыми функциями: модуль не читает fs,
 * не ходит в сеть и не знает про argv — его вызывают task-accept и проверка
 * spec/checks/judge-discipline.mjs.
 */

/**
 * Можно ли приёмщику читать отчёт исполнителя.
 *
 * Независимость приёмки держится на том, что приёмщик судит по проверкам, а не по
 * рассказу исполнителя: при risk=medium/high чтение отчёта — исключение, и оно
 * должно быть названо. Причина пустая (нет флага или только пробелы) — отказ с
 * рецептом, а не молчаливое разрешение. risk=low и отказ от чтения — всегда ок.
 *
 * @returns {null | { error: string, fix: string }}
 */
export function reportReadGuard({ risk, reportRead, reason } = {}) {
  const level = String(risk == null ? '' : risk).trim();
  if (!reportRead) return null;
  if (level !== 'medium' && level !== 'high') return null;
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why !== '') return null;
  return {
    error: 'приёмщик при risk=' + level + ' не читает отчёт исполнителя без причины — независимость приёмки',
    fix: 'передайте --report-read-reason "<зачем>" или не читайте отчёт',
  };
}

/**
 * Честная запись о том, читал ли приёмщик отчёт исполнителя (0053).
 *
 * reportWithheld (0049) утверждал «отчёт не читали» по одному лишь отсутствию
 * флага: task-accept не видит сессию приёмщика и доказать чтение не может.
 * Поэтому поле заменяется парой, которая не выдаёт заявление за доказательство:
 *   reportRead         — 'declared' (флаг --report-read передан) или 'not-declared';
 *   reportReadVerified — всегда false: доказательства чтения нет;
 *   reportReadReason   — причина из --report-read-reason (trim), иначе ''.
 * reportWithheld остаётся в записи для совместимости потребителей, но
 * доказательством не считается.
 *
 * @returns {{ reportRead: 'declared' | 'not-declared', reportReadVerified: false, reportReadReason: string }}
 */
export function reportReadRecord({ reportRead, reason } = {}) {
  return {
    reportRead: reportRead ? 'declared' : 'not-declared',
    reportReadVerified: false,
    reportReadReason: typeof reason === 'string' ? reason.trim() : '',
  };
}

/**
 * Фактическая модель актора: DSH_MODEL (trim) → config.model (trim) → unknown.
 *
 * Запись приёмки должна называть модель, которая действительно работала, а не
 * «unknown» по умолчанию: иначе проверка ролей (та же семья/другая семья) судит
 * по выдумке. Пустая строка — это отсутствие значения, а не модель.
 */
export function actorModel(config = {}, env = {}) {
  const fromEnv = env && typeof env.DSH_MODEL === 'string' ? env.DSH_MODEL.trim() : '';
  if (fromEnv !== '') return fromEnv;
  const fromConfig = config && typeof config.model === 'string' ? config.model.trim() : '';
  if (fromConfig !== '') return fromConfig;
  return 'unknown';
}
