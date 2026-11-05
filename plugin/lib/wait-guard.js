/**
 * wait-guard — машинная проверка императива W1 (task 0073, WC-55).
 *
 * Правило: ожидание тяжёлого прогона идёт сторожем scripts/job.mjs
 * (start/wait), а не сном внутри инструмента. Плагин ловит три антипаттерна
 * и действует по политике воркспейса:
 *
 *   - pwsh с Start-Sleep дольше бюджета воркспейса (не ниже 3 с — шум обычной
 *     команды, не выше 60 с — абсолютный порог W1), либо timeoutMs >= 2 * бюджета;
 *   - job_output с wait: true и timeout_ms больше бюджета (120000 по умолчанию);
 *   - project_graph_run с timeoutMs >= 2 * бюджета.
 *
 * fail — вызов отклоняется через ctx.tools.guard (DSH: guard только запрещает,
 * строка — причина отказа, undefined — не вмешиваться).
 * warn — вызов проходит, а tools/post-execute добавляет notice полной формы v4
 * к результату, не теряя downstream-результат.
 * off — молчит.
 *
 * Старый движок (scripts/job.mjs в воркспейсе нет, config.jobScript === false):
 * отклонять нельзя — сторожа в воркспейсе нет. Политика fail действует как
 * warn: сначала обновить движок.
 *
 * 2.6.33 (0074, WC-58): журнал долгих ожиданий. Каждое срабатывание (отказ fail
 * и notice warn) пишется одной строкой JSON в append-only jsonl:
 * { at, root, tool, mode, denied, reason, waitMs, budgetMs }. Каталог —
 * process.env.WF_WAITS_DIR, иначе <HOME>/.dsh/workflow/waits; файл —
 * <12 hex sha256 корня>.jsonl. Ошибка записи глотается: вызов важнее журнала.
 * off не пишет.
 *
 * 0075 (WC-57): политика читается по воркспейсу. registerWaitGuard получает
 * config.roots (абсолютные корни). Корень вызова — самый длинный префикс roots
 * для exec.cwd, иначе exec.agent.cwd / exec.agent.session.cwd, иначе
 * config.root → roots[0] → process.cwd(). Из корня читается
 * <root>/docs/subagent-workflow/workflow.config.json: enforcement.waitPolicy
 * (off|warn|fail) и enforcement.waitBudgetMs. Нет файла, нет ключа, битый JSON
 * или неверное значение — профильный дефолт из config (waitPolicy = fail);
 * ошибка чтения не бросается, кэш сверяет mtime файла. Guard подписывается при
 * наличии ctx.tools.guard независимо от политик корней и отклоняет только
 * вызов в fail-корне; tools/post-execute подписывается всегда и добавляет
 * notice только для warn-корня; off-корень не получает ни отказа, ни notice
 * (off осознанно сильнее профильного fail). Порог — waitBudgetMs корня, иначе
 * профильный; журнал пишет root и mode фактического решения. Вызов без roots
 * ведёт себя как раньше: политика из config и process.cwd().
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Бюджет ожидания по умолчанию, мс: дольше — уже долгое ожидание. */
export const WAIT_BUDGET_MS = 120000;
/** Порог Start-Sleep в секундах: 60 с — абсолютный порог W1. */
export const SLEEP_THRESHOLD_SECONDS = 60;
/** Порог timeoutMs для pwsh/project_graph_run при бюджете по умолчанию. */
export const TOOL_TIMEOUT_THRESHOLD_MS = 2 * WAIT_BUDGET_MS;
/** Нижняя граница порога сна, мс: короче — шум обычной команды, а не ожидание. */
export const MIN_SLEEP_THRESHOLD_MS = 3000;
/** Разрешённые политики: fail | warn | off. */
export const WAIT_POLICIES = ['fail', 'warn', 'off'];
/** Producer-owned источник notice, как у остальных сообщений плагина. */
export const NOTICE_SOURCE_KIND = 'plugin:dsh-workflow-console';
/** Конфиг воркспейса с блоком enforcement — относительно корня. */
const WORKFLOW_CONFIG_RELATIVE = path.join('docs', 'subagent-workflow', 'workflow.config.json');

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
 * Порог «долгого» сна при бюджете воркспейса: бюджет, сжатый в коридор
 * [3 с, 60 с]. 3 с — шум обычной команды, 60 с — абсолютный порог W1.
 */
function sleepThresholdFor(budgetMs) {
  return Math.min(SLEEP_THRESHOLD_SECONDS * 1000, Math.max(budgetMs, MIN_SLEEP_THRESHOLD_MS));
}

/** Порог жёсткого timeoutMs: вдвое больше бюджета (при 120000 — 240000), но не ниже 3 с. */
function timeoutThresholdFor(budgetMs) {
  return Math.max(budgetMs * 2, MIN_SLEEP_THRESHOLD_MS);
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
function recordWait(exec, hit, decision) {
  try {
    const waitMs = finiteNumber(hit.waitMs);
    appendWaitRecord({
      at: isoTimestampWithOffset(new Date()),
      root: String(decision.root),
      tool: toolNameOf(exec),
      mode: decision.mode,
      denied: decision.denied === true,
      reason: String(decision.reason),
      waitMs: waitMs === null ? null : waitMs,
      budgetMs: decision.budgetMs,
    });
  } catch {
    /* журнал не имеет права ломать вызов */
  }
}

/**
 * Чистая функция-детектор долгого ожидания.
 *
 * @param {{name?: string, tool?: string, arguments?: object}|null} exec
 * @param {number} [budgetMs] бюджет ожидания, по умолчанию 120000: порог
 *   job_output(wait, > budget), порог сна (в коридоре [3 с, 60 с]) и
 *   порог timeoutMs (2 * budget)
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
  const sleepThreshold = sleepThresholdFor(budget);
  const timeoutThreshold = timeoutThresholdFor(budget);

  if (name === 'pwsh') {
    const sleep = sleepMilliseconds(args.command);
    if (sleep !== null && sleep >= sleepThreshold) {
      return { kind: 'pwsh-sleep', detail: 'pwsh: Start-Sleep ' + secondsText(sleep), waitMs: sleep };
    }
    const timeout = finiteNumber(args.timeoutMs);
    if (timeout !== null && timeout >= timeoutThreshold) {
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
    if (timeout !== null && timeout >= timeoutThreshold) {
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

/** Политика из профиля: плоские ключи или блок enforcement. */
function resolvePolicy(config) {
  const source = config && typeof config === 'object' ? config : {};
  const nested = source.enforcement && typeof source.enforcement === 'object' && !Array.isArray(source.enforcement)
    ? source.enforcement
    : {};
  const raw = firstDefined(source.waitPolicy, nested.waitPolicy);
  const policy = WAIT_POLICIES.includes(raw) ? raw : 'fail';
  const budget = finiteNumber(firstDefined(source.waitBudgetMs, nested.waitBudgetMs));
  const jobScript = firstDefined(source.jobScript, nested.jobScript) !== false;
  /* Корень профиля: root/repoRoot/workspaceRoot/roots[0] конфига (как в api.js), иначе cwd. */
  const firstConfiguredRoot = Array.isArray(source.roots)
    ? source.roots.find((item) => typeof item === 'string' && item.trim() !== '')
    : undefined;
  const configuredRoot = firstDefined(source.root, source.repoRoot, source.workspaceRoot, firstConfiguredRoot);
  const root = typeof configuredRoot === 'string' && configuredRoot.trim() !== ''
    ? path.resolve(configuredRoot)
    : process.cwd();
  return { policy, budgetMs: budget === null ? WAIT_BUDGET_MS : budget, jobScript, root };
}

/** Абсолютный путь или null: относительные не разворачиваем, чтобы не угадывать корень. */
function absolutePath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || !path.isAbsolute(trimmed)) return null;
  return path.resolve(trimmed);
}

/** Один и тот же путь (на Windows без учёта регистра, как в api.js). */
function samePath(a, b) {
  const left = path.resolve(String(a));
  const right = path.resolve(String(b));
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** Путь внутри корня (сам корень — тоже внутри). */
function isInsideRoot(candidate, root) {
  const absoluteCandidate = absolutePath(candidate);
  const absoluteRoot = absolutePath(root);
  if (absoluteCandidate === null || absoluteRoot === null) return false;
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  if (relative === '') return true;
  if (relative === '..' || relative.startsWith('..' + path.sep)) return false;
  return !path.isAbsolute(relative);
}

/** Абсолютные корни воркспейсов из config.roots (без дублей, порядок конфига). */
function normalizeRoots(config) {
  const source = config && typeof config === 'object' ? config : {};
  const list = Array.isArray(source.roots) ? source.roots : [];
  const roots = [];
  for (const item of list) {
    const root = absolutePath(item);
    if (root === null) continue;
    if (!roots.some((existing) => samePath(existing, root))) roots.push(root);
  }
  return roots;
}

/** Самый длинный корень, содержащий путь, или null. */
function rootForPath(candidate, roots) {
  const absoluteCandidate = absolutePath(candidate);
  if (absoluteCandidate === null) return null;
  let best = null;
  for (const root of roots) {
    if (!isInsideRoot(absoluteCandidate, root)) continue;
    if (best === null || root.length > best.length) best = root;
  }
  return best;
}

/** cwd агента вызова: exec.agent.cwd, иначе exec.agent.session.cwd. */
function agentCwd(exec) {
  const agent = exec && typeof exec === 'object' ? exec.agent : null;
  if (!agent || typeof agent !== 'object') return null;
  const direct = absolutePath(agent.cwd);
  if (direct !== null) return direct;
  const session = agent.session && typeof agent.session === 'object' ? agent.session : null;
  return session === null ? null : absolutePath(session.cwd);
}

/** Корень вызова: exec.cwd → agent cwd → config.root/roots[0]/cwd (инвариант 1). */
function callRoot(exec, state) {
  const direct = rootForPath(exec && exec.cwd, state.roots);
  if (direct !== null) return direct;
  const fromAgent = rootForPath(agentCwd(exec), state.roots);
  if (fromAgent !== null) return fromAgent;
  return state.fallbackRoot;
}

/** Путь конфига воркспейса: <root>/docs/subagent-workflow/workflow.config.json. */
function workspaceConfigFile(root) {
  return path.join(root, WORKFLOW_CONFIG_RELATIVE);
}

/**
 * Политика и бюджет из конфига корня. Нет файла, битый JSON, неверное
 * значение — пустой объект (вызывающий берёт профильный дефолт). Ошибка
 * чтения не бросается; кэш сверяет mtime и размер, поэтому правка конфига
 * видна следующему вызову. Файл исчез после успешного чтения — держим
 * последнее прочитанное значение: политика не прыгает в середине сессии
 * из-за недоступного файла (свежий mtime всегда перечитывается).
 */
function readWorkspaceWaitSettings(root, cache) {
  const file = workspaceConfigFile(root);
  let stat = null;
  try {
    stat = fs.statSync(file);
  } catch {
    const known = cache.get(root);
    return known ? known.settings : {};
  }
  const fingerprint = String(stat.mtimeMs) + ':' + String(stat.size);
  const cached = cache.get(root);
  if (cached && cached.file === file && cached.fingerprint === fingerprint) return cached.settings;

  let settings = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const enforcement = parsed && typeof parsed === 'object'
      && parsed.enforcement && typeof parsed.enforcement === 'object' && !Array.isArray(parsed.enforcement)
      ? parsed.enforcement
      : {};
    const policy = WAIT_POLICIES.includes(enforcement.waitPolicy) ? enforcement.waitPolicy : undefined;
    const budget = finiteNumber(enforcement.waitBudgetMs);
    settings = {
      policy,
      budgetMs: budget !== null && budget > 0 ? budget : undefined,
    };
  } catch {
    settings = {};
  }
  cache.set(root, { file, fingerprint, settings });
  return settings;
}

/**
 * Решение по вызову: корень, политика и бюджет. Воркспейсная политика сильнее
 * профильной, в том числе off (осознанно сильнее профильного fail).
 */
function resolveCall(exec, state) {
  const root = callRoot(exec, state);
  const settings = state.workspaceMode ? readWorkspaceWaitSettings(root, state.cache) : {};
  const policy = settings.policy !== undefined ? settings.policy : state.policy;
  const budgetMs = settings.budgetMs !== undefined ? settings.budgetMs : state.budgetMs;
  /* Старый движок: сторожа в воркспейсе нет — отклонять нельзя, действует warn. */
  const effective = policy === 'fail' && !state.jobScript ? 'warn' : policy;
  return { root, policy, effective, budgetMs, jobScript: state.jobScript };
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
 * @param {object} [config] конфиг плагина: waitPolicy/waitBudgetMs/jobScript
 *   (профильный дефолт) и roots — абсолютные корни воркспейсов; допустим и
 *   блок { enforcement: { ... } } из workflow.config.json
 * @returns {{policy: string, budgetMs: number, jobScript: boolean, roots: string[]}}
 */
export function registerWaitGuard(ctx, config = {}) {
  const profile = resolvePolicy(config);
  const roots = normalizeRoots(config);
  const profileEffective = profile.policy === 'fail' && !profile.jobScript ? 'warn' : profile.policy;
  const state = {
    roots,
    workspaceMode: roots.length > 0,
    policy: profile.policy,
    budgetMs: profile.budgetMs,
    jobScript: profile.jobScript,
    fallbackRoot: profile.root,
    cache: new Map(),
  };
  const result = {
    policy: profileEffective,
    budgetMs: profile.budgetMs,
    jobScript: profile.jobScript,
    roots: roots.slice(),
  };
  if (!ctx || typeof ctx !== 'object') return result;

  const guardAvailable = Boolean(ctx.tools) && typeof ctx.tools.guard === 'function';
  const listenAvailable = typeof ctx.on === 'function';

  /*
   * 0075 (WC-57): смешанные политики. Guard подписывается всегда, когда он
   * есть в ctx, и отклоняет только вызов в fail-корне; post-execute
   * подписывается всегда и добавляет notice только для warn-корня.
   */
  if (state.workspaceMode) {
    if (guardAvailable) {
      ctx.tools.guard((exec) => {
        try {
          const decision = resolveCall(exec, state);
          if (decision.effective !== 'fail') return undefined;
          const hit = detectLongWait(exec, decision.budgetMs);
          if (hit === null) return undefined;
          const reason = waitGuardReason(hit);
          recordWait(exec, hit, {
            root: decision.root,
            mode: 'fail',
            denied: true,
            reason,
            budgetMs: decision.budgetMs,
          });
          return reason;
        } catch {
          return undefined;
        }
      });
    }
    if (listenAvailable) {
      ctx.on('tools/post-execute', async (...args) => {
        const next = downstreamOf(args);
        const result = next ? await next() : undefined;
        try {
          const decision = resolveCall(args[0], state);
          if (decision.effective === 'warn') {
            const hit = detectLongWait(args[0], decision.budgetMs);
            if (hit !== null) {
              recordWait(args[0], hit, {
                root: decision.root,
                mode: 'warn',
                denied: false,
                reason: waitSummary(hit),
                budgetMs: decision.budgetMs,
              });
              return addNotice(result, hit, { engineOutdated: !decision.jobScript });
            }
          }
        } catch {
          /* ошибка политики не ломает downstream-результат */
        }
        return result;
      });
    }
    return result;
  }

  /* Совместимость: без roots — как раньше, политика профиля и один корень. */
  if (profileEffective === 'off') return result;

  if (profileEffective === 'fail') {
    if (!guardAvailable) return result;
    ctx.tools.guard((exec) => {
      try {
        const hit = detectLongWait(exec, profile.budgetMs);
        if (hit === null) return undefined;
        const reason = waitGuardReason(hit);
        recordWait(exec, hit, {
          root: profile.root,
          mode: 'fail',
          denied: true,
          reason,
          budgetMs: profile.budgetMs,
        });
        return reason;
      } catch {
        return undefined;
      }
    });
    return result;
  }

  if (!listenAvailable) return result;
  ctx.on('tools/post-execute', async (...args) => {
    const next = downstreamOf(args);
    const result = next ? await next() : undefined;
    try {
      const hit = detectLongWait(args[0], profile.budgetMs);
      if (hit !== null) {
        recordWait(args[0], hit, {
          root: profile.root,
          mode: 'warn',
          denied: false,
          reason: waitSummary(hit),
          budgetMs: profile.budgetMs,
        });
        return addNotice(result, hit, { engineOutdated: !profile.jobScript });
      }
    } catch {
      /* ошибка политики не ломает downstream-результат */
    }
    return result;
  });
  return result;
}
