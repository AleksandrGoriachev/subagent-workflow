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
 */
import { randomUUID } from 'node:crypto';

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

/**
 * Чистая функция-детектор долгого ожидания.
 *
 * @param {{name?: string, tool?: string, arguments?: object}|null} exec
 * @param {number} [budgetMs] бюджет ожидания для job_output, по умолчанию 120000
 * @returns {{kind: string, detail: string}|null}
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
      return { kind: 'pwsh-sleep', detail: 'pwsh: Start-Sleep ' + secondsText(sleep) };
    }
    const timeout = finiteNumber(args.timeoutMs);
    if (timeout !== null && timeout >= TOOL_TIMEOUT_THRESHOLD_MS) {
      return { kind: 'pwsh-timeout', detail: 'pwsh: timeoutMs=' + timeout };
    }
    return null;
  }

  if (name === 'job_output') {
    const timeout = finiteNumber(args.timeout_ms);
    if (args.wait === true && timeout !== null && timeout > budget) {
      return { kind: 'job-wait', detail: 'job_output: wait=true, timeout_ms=' + timeout + ' (бюджет ' + budget + ')' };
    }
    return null;
  }

  if (name === 'project_graph_run') {
    const timeout = finiteNumber(args.timeoutMs);
    if (timeout !== null && timeout >= TOOL_TIMEOUT_THRESHOLD_MS) {
      return { kind: 'graph-run-timeout', detail: 'project_graph_run: timeoutMs=' + timeout };
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

/** Notice полной формы v4 (id, role, content, source.kind/form/summary). */
export function waitNoticeMessage(hit, options = {}) {
  const summary = 'долгое ожидание: ' + hit.detail;
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
  return { policy, budgetMs: budget === null ? WAIT_BUDGET_MS : budget, jobScript };
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
  const state = { ...resolved, policy: effective };

  if (!ctx || typeof ctx !== 'object') return state;
  if (effective === 'off') return state;

  if (effective === 'fail') {
    if (!ctx.tools || typeof ctx.tools.guard !== 'function') return state;
    ctx.tools.guard((exec) => {
      try {
        const hit = detectLongWait(exec, resolved.budgetMs);
        return hit === null ? undefined : waitGuardReason(hit);
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
      if (hit !== null) return addNotice(result, hit, { engineOutdated: !resolved.jobScript });
    } catch {
      /* ошибка политики не ломает downstream-результат */
    }
    return result;
  });
  return state;
}

