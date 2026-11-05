/**
 * wait-guard — машинная проверка императива W1 (task 0073, WC-55).
 *
 * Правило: ожидание тяжёлого прогона идёт сторожем scripts/job.mjs
 * (start/wait), а не сном внутри инструмента. Плагин ловит три антипаттерна
 * и действует по политике воркспейса:
 *
 *   - pwsh с Start-Sleep -Seconds >= 60 (или -Milliseconds >= 60000),
 *     либо timeoutMs >= 240000;
 *   - job_output с wait: true и timeout_ms больше бюджета (120000 по умолчанию);
 *   - project_graph_run с timeoutMs >= 240000.
 *
 * fail — вызов отклоняется через ctx.tools.guard (DSH: guard только запрещает,
 * строка — причина отказа, undefined — не вмешиваться).
 * warn — вызов проходит, а tools/post-execute добавляет notice полной формы v4
 * к результату, не теряя downstream-результат.
 * off — молчит.
 *
 * Старый движок (scripts/job.mjs в воркспейсе нет, config.jobScript === false):
 * отклонять нельзя — сторожа в воркспейсе нет. Guard не подписывается, политика
 * действует как warn: сначала обновить движок.
 *
 * 2.6.33 (0074, WC-58): журнал долгих ожиданий. Каждое срабатывание (отказ fail
 * и notice warn) пишется одной строкой JSON в append-only jsonl:
 * { at, root, tool, mode, denied, reason, waitMs, budgetMs }. Каталог —
 * process.env.WF_WAITS_DIR, иначе <HOME>/.dsh/workflow/waits; файл —
 * <12 hex sha256 корня>.jsonl. Ошибка записи глотается: вызов важнее журнала.
 * off не пишет.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Бюджет ожидания по умолчанию, мс: дольше — уже долгое ожидание. */
export const WAIT_BUDGET_MS = 120000;
/** Порог Start-Sleep в секундах: 60 с и больше — долгое ожидание. */
export const SLEEP_THRESHOLD_SECONDS = 60;
/** Порог timeoutMs для pwsh/project_graph_run: 240000 мс. */
export const TOOL_TIMEOUT_THRESHOLD_MS = 240000;
/** Разрешённые политики: fail | warn | off. */
export const WAIT_POLICIES = ['fail', 'warn', 'off'];
/** Producer-owned источник notice, как у остальных сообщений плагина. */
export const NOTICE_SOURCE_KIND = 'plugin:dsh-workflow-console';

const SLEEP_SECONDS_RE = /-Seconds +[']?([0-9]+([.][0-9]+)?)/gi;
const SLEEP_MILLISECONDS_RE = /-Milliseconds +[']?([0-9]+([.][0-9]+)?)/gi;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Максимальный Start-Sleep в команде pwsh в миллисекундах, или null. */
function sleepMilliseconds(command) {
  if (typeof command !== 'string' || !/Start-Sleep/i.test(command)) return null;
  let max = null;
  for (const match of command.matchAll(SLEEP_SECONDS_RE)) {
    const seconds = finiteNumber(match[1]);
    if (seconds !== null) max = Math.max(max === null ? -Infinity : max, seconds * 1000);
  }
  for (const match of command.matchAll(SLEEP_MILLISECONDS_RE)) {
    const milliseconds = finiteNumber(match[1]);
    if (milliseconds !== null) max = Math.max(max === null ? -Infinity : max, milliseconds);
  }
  return max;
}

function secondsText(milliseconds) {
  const seconds = milliseconds / 1000;
  return (Number.isInteger(seconds) ? String(seconds) : String(Math.round(seconds * 10) / 10)) + ' с';
}

/** Переменная окружения с каталогом журнала долгих ожиданий (для проверок). */
export const WAITS_DIR_ENV = 'WF_WAITS_DIR';
/** Имя файла журнала: первые 12 hex от sha256 корня. */
const JOURNAL_HASH_LENGTH = 12;

/** Каталог журнала: WF_WAITS_DIR, иначе <HOME>/.dsh/workflow/waits. */
function waitsDirectory() {
  const fromEnv = process.env[WAITS_DIR_ENV];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv;
  return path.join(os.homedir(), '.dsh', 'workflow', 'waits');
}

/** Путь журнала корня воркспейса: <каталог>/<12 hex sha256 корня>.jsonl. */
function waitJournalPath(root) {
  const key = createHash('sha256').update(String(root)).digest('hex').slice(0, JOURNAL_HASH_LENGTH);
  return path.join(waitsDirectory(), key + '.jsonl');
}

/** ISO 8601 с локальным оффсетом (как в письмах), а не UTC с Z. */
function isoTimestampWithOffset(date) {
  const pad = (value, width = 2) => String(Math.abs(value)).padStart(width, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetRest = Math.abs(offsetMinutes) % 60;
  return date.getFullYear()
    + '-' + pad(date.getMonth() + 1)
    + '-' + pad(date.getDate())
    + 'T' + pad(date.getHours())
    + ':' + pad(date.getMinutes())
    + ':' + pad(date.getSeconds())
    + '.' + pad(date.getMilliseconds(), 3)
    + sign + pad(offsetHours) + ':' + pad(offsetRest);
}

/** Имя инструмента из exec-объекта waterfall. */
function toolNameOf(exec) {
  if (!exec || typeof exec !== 'object') return '';
  return String(exec.name || exec.tool || '');
}

/**
 * Дописать одну строку журнала. Append-only, каталог создаётся при первой
 * записи. Ошибка записи (права, диск) глотается: отказ и notice формируются
 * независимо от журнала.
 */
function appendWaitRecord(record) {
  try {
    const file = waitJournalPath(record.root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    /* журнал не имеет права ломать вызов */
  }
}

/** Строка журнала на срабатывание сторожа (поля согласованы со structure). */
function recordWait(exec, hit, mode, denied, reason, config) {
  try {
    const waitMs = finiteNumber(hit.waitMs);
    appendWaitRecord({
      at: isoTimestampWithOffset(new Date()),
      root: String(config.root),
      tool: toolNameOf(exec),
      mode,
      denied: denied === true,
      reason: String(reason),
      waitMs: waitMs === null ? null : waitMs,
      budgetMs: config.budgetMs,
    });
  } catch {
    /* журнал не имеет права ломать вызов */
  }
}

/**
 * Чистая функция-детектор долгого ожидания.
 *
 * @param {{name?: string, tool?: string, arguments?: object}|null} exec
 * @param {number} [budgetMs] бюджет ожидания для job_output, по умолчанию 120000
 * @returns {{kind: string, detail: string, waitMs: number}|null}
 *   waitMs — измеренное ожидание в миллисекундах (максимальный Start-Sleep для
 *   pwsh, timeoutMs для pwsh/project_graph_run, timeout_ms для job_output).
 */
export function detectLongWait(exec, budgetMs = WAIT_BUDGET_MS) {
  if (!exec || typeof exec !== 'object') return null;
  const name = String(exec.name || exec.tool || '');
  const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {};
  const given = finiteNumber(budgetMs);
  const budget = given === null || given <= 0 ? WAIT_BUDGET_MS : given;

  if (name === 'pwsh') {
    const sleep = sleepMilliseconds(args.command);
    if (sleep !== null && sleep >= SLEEP_THRESHOLD_SECONDS * 1000) {
      return { kind: 'pwsh-sleep', detail: 'pwsh: Start-Sleep ' + secondsText(sleep), waitMs: sleep };
    }
    const timeout = finiteNumber(args.timeoutMs);
    if (timeout !== null && timeout >= TOOL_TIMEOUT_THRESHOLD_MS) {
      return { kind: 'pwsh-timeout', detail: 'pwsh: timeoutMs=' + timeout, waitMs: timeout };
    }
    return null;
  }

  if (name === 'job_output') {
    const timeout = finiteNumber(args.timeout_ms);
    if (args.wait === true && timeout !== null && timeout > budget) {
      return {
        kind: 'job-wait',
        detail: 'job_output: wait=true, timeout_ms=' + timeout + ' (бюджет ' + budget + ')',
        waitMs: timeout,
      };
    }
    return null;
  }

  if (name === 'project_graph_run') {
    const timeout = finiteNumber(args.timeoutMs);
    if (timeout !== null && timeout >= TOOL_TIMEOUT_THRESHOLD_MS) {
      return { kind: 'graph-run-timeout', detail: 'project_graph_run: timeoutMs=' + timeout, waitMs: timeout };
    }
    return null;
  }

  return null;
}

/** Отказ политики fail: причина со ссылкой на сторожа (guard вернёт её текстом). */
export function waitGuardReason(hit) {
  return 'долгое ожидание ('
    + hit.detail
    + ') запрещено политикой воркспейса enforcement.waitPolicy=fail: ожидайте тяжёлый прогон'
    + ' сторожем scripts/job.mjs — node docs/subagent-workflow/scripts/job.mjs start ... ,'
    + ' затем node docs/subagent-workflow/scripts/job.mjs wait <id>;'
    + ' сон внутри инструмента императивом W1 не допускается';
}

/** Одна и та же строка «долгое ожидание …» для notice и строки журнала. */
function waitSummary(hit) {
  return 'долгое ожидание: ' + hit.detail;
}

/** Notice полной формы v4 (id, role, content, source.kind/form/summary). */
export function waitNoticeMessage(hit, options = {}) {
  const summary = waitSummary(hit);
  /* Старый движок: сторожа в воркспейсе нет — сначала обновить движок. */
  const engineHint = options && options.engineOutdated === true
    ? ' Движок воркспейса старше 2.6.31 (scripts/job.mjs нет) — обновите движок, чтобы правило включалось в fail.'
    : '';
  return {
    id: randomUUID(),
    role: 'user',
    content: [{
      type: 'text',
      text: 'Внимание: ' + hit.detail + '. Императив W1 (обязательность регламента): тяжёлый прогон'
        + ' ожидается сторожем, а не сном внутри инструмента. Запуск:'
        + ' node docs/subagent-workflow/scripts/job.mjs start -- ... ; ожидание:'
        + ' node docs/subagent-workflow/scripts/job.mjs wait <id>.' + engineHint,
    }],
    source: { kind: NOTICE_SOURCE_KIND, form: 'notice', summary },
  };
}

function firstDefined(...values) {
  for (const value of values) if (value !== undefined) return value;
  return undefined;
}

/** Политика из конфига: плоские ключи или блок enforcement. */
function resolvePolicy(config) {
  const source = config && typeof config === 'object' ? config : {};
  const nested = source.enforcement && typeof source.enforcement === 'object' && !Array.isArray(source.enforcement)
    ? source.enforcement
    : {};
  const raw = firstDefined(source.waitPolicy, nested.waitPolicy);
  const policy = WAIT_POLICIES.includes(raw) ? raw : 'fail';
  const budget = finiteNumber(firstDefined(source.waitBudgetMs, nested.waitBudgetMs));
  const jobScript = firstDefined(source.jobScript, nested.jobScript) !== false;
  /* Корень журнала: root/repoRoot/workspaceRoot/roots[0] конфига (как в api.js), иначе cwd. */
  const firstConfiguredRoot = Array.isArray(source.roots)
    ? source.roots.find((item) => typeof item === 'string' && item.trim() !== '')
    : undefined;
  const configuredRoot = firstDefined(source.root, source.repoRoot, source.workspaceRoot, firstConfiguredRoot);
  const root = typeof configuredRoot === 'string' && configuredRoot.trim() !== ''
    ? path.resolve(configuredRoot)
    : process.cwd();
  return { policy, budgetMs: budget === null ? WAIT_BUDGET_MS : budget, jobScript, root };
}

/** Хвост waterfall: последний функциональный аргумент — downstream. */
function downstreamOf(args) {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    if (typeof args[index] === 'function') return args[index];
  }
  return null;
}

function addNotice(result, hit, options) {
  if (!result || typeof result !== 'object') return result;
  const contexts = Array.isArray(result.additionalContexts) ? result.additionalContexts.slice() : [];
  contexts.push(waitNoticeMessage(hit, options));
  result.additionalContexts = contexts;
  return result;
}

/**
 * Подписать сторож на контекст плагина.
 *
 * @param {{tools?: {guard?: Function}, on?: Function}} ctx контекст DSH
 * @param {object} [config] конфиг плагина (waitPolicy/waitBudgetMs/jobScript)
 *   или блок { enforcement: { ... } } из workflow.config.json
 * @returns {{policy: string, budgetMs: number, jobScript: boolean}}
 */
export function registerWaitGuard(ctx, config = {}) {
  const resolved = resolvePolicy(config);
  const effective = resolved.policy === 'fail' && !resolved.jobScript ? 'warn' : resolved.policy;
  const state = { policy: effective, budgetMs: resolved.budgetMs, jobScript: resolved.jobScript };

  if (!ctx || typeof ctx !== 'object') return state;
  if (effective === 'off') return state;

  if (effective === 'fail') {
    if (!ctx.tools || typeof ctx.tools.guard !== 'function') return state;
    ctx.tools.guard((exec) => {
      try {
        const hit = detectLongWait(exec, resolved.budgetMs);
        if (hit === null) return undefined;
        const reason = waitGuardReason(hit);
        recordWait(exec, hit, 'fail', true, reason, resolved);
        return reason;
      } catch {
        return undefined;
      }
    });
    return state;
  }

  if (typeof ctx.on !== 'function') return state;
  ctx.on('tools/post-execute', async (...args) => {
    const next = downstreamOf(args);
    const result = next ? await next() : undefined;
    try {
      const hit = detectLongWait(args[0], resolved.budgetMs);
      if (hit !== null) {
        recordWait(args[0], hit, 'warn', false, waitSummary(hit), resolved);
        return addNotice(result, hit, { engineOutdated: !resolved.jobScript });
      }
    } catch {
      /* ошибка политики не ломает downstream-результат */
    }
    return result;
  });
  return state;
}

