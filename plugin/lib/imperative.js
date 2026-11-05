/**
 * Императив воркспейса одним взглядом (S4, задание 0081/WC-56).
 *
 * Панель обязана показывать по каждому воркспейсу: версию движка, значения
 * enforcement.*, счётчик долгих ожиданий и последние отказы, а сводкой —
 * исполняется ли императив. Данные здесь не выводятся из памяти процесса:
 * версия и job.mjs читаются из развёрнутой копии, ожидания — из журнала
 * ~/.dsh/workflow/waits/<hash корня>.jsonl (формат 0074).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { compareVersions } from './deploy.js';

/** Минимальная версия движка со сторожем W1 (2.6.31, WC-54). */
export const MIN_ENGINE_VERSION = '2.6.31';
/** Переменная окружения каталога журнала: та же, что у сторожа. */
export const WAITS_DIR_ENV = 'WF_WAITS_DIR';

export function waitsDirectory() {
  const fromEnv = process.env[WAITS_DIR_ENV];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv;
  return path.join(os.homedir(), '.dsh', 'workflow', 'waits');
}

export function waitsJournalPath(root) {
  const key = crypto.createHash('sha256').update(String(root)).digest('hex').slice(0, 12);
  return path.join(waitsDirectory(), key + '.jsonl');
}

/**
 * Журнал ожиданий корня: счётчики и последние записи.
 *
 * @param {string} root абсолютный корень воркспейса
 * @param {number} [limit] сколько последних строк вернуть
 * @returns {{path: string, exists: boolean, total: number, denied: number, warn: number, last: object[]}}
 */
export function readWaits(root, limit = 3) {
  const file = waitsJournalPath(root);
  const result = { path: file, exists: false, total: 0, denied: 0, warn: 0, last: [] };
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
    result.exists = true;
  } catch {
    return result;
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* битая строка не отменяет остальные */
    }
  }
  result.total = rows.length;
  for (const row of rows) {
    if (row && row.denied === true) result.denied += 1;
    else if (row && row.mode === 'warn') result.warn += 1;
  }
  result.last = rows.slice(-Math.max(1, limit)).reverse();
  return result;
}

function enforcementOf(config) {
  const block = config && typeof config === 'object' && config.enforcement
    && typeof config.enforcement === 'object' && !Array.isArray(config.enforcement)
    ? config.enforcement
    : null;
  if (!block) return null;
  return {
    waitPolicy: block.waitPolicy === undefined ? null : block.waitPolicy,
    waitBudgetMs: block.waitBudgetMs === undefined ? null : block.waitBudgetMs,
    processPolicy: block.processPolicy === undefined ? null : block.processPolicy,
    structurePolicy: block.structurePolicy === undefined ? null : block.structurePolicy,
  };
}

/**
 * Сводка императива по корню.
 *
 * @param {{root: string, readRoot: string, config: object|null, engine: object}} options
 * @returns {object}
 */
export function imperativeView(options = {}) {
  const root = options.root ? path.resolve(String(options.root)) : null;
  const readRoot = options.readRoot ? path.resolve(String(options.readRoot)) : root;
  const engine = options.engine && typeof options.engine === 'object' ? options.engine : {};
  const version = typeof engine.version === 'string' ? engine.version : null;
  const enforcement = enforcementOf(options.config);
  const jobScript = readRoot
    ? fs.existsSync(path.join(readRoot, 'docs', 'subagent-workflow', 'scripts', 'job.mjs'))
    : false;
  const waits = root ? readWaits(root) : { path: null, exists: false, total: 0, denied: 0, warn: 0, last: [] };

  const checks = {
    engine: version !== null && compareVersions(version, MIN_ENGINE_VERSION) >= 0,
    job: jobScript,
    enforcement: Boolean(enforcement && ['off', 'warn', 'fail'].includes(enforcement.waitPolicy)),
    /* off — осознанно ослабленный режим: правило не исполняется, это видно. */
    strict: Boolean(enforcement && enforcement.waitPolicy !== 'off'),
  };
  const reasons = [];
  if (!checks.engine) reasons.push('движок старше ' + MIN_ENGINE_VERSION + ' (нет сторожа W1)');
  if (!checks.job) reasons.push('в развёрнутой копии нет scripts/job.mjs — ожидать тяжёлый прогон нечем');
  if (!checks.enforcement) reasons.push('в workflow.config.json нет валидного enforcement.waitPolicy');
  if (!checks.strict) reasons.push('waitPolicy = off: императив ослаблен осознанно');
  return {
    root,
    enforcement,
    engine: { version, installed: engine.installed === true, root: engine.root || null },
    minimumEngine: MIN_ENGINE_VERSION,
    waits,
    checks,
    ok: checks.engine && checks.job && checks.enforcement && checks.strict,
    reasons,
  };
}
