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
 * fail — вызов отклоняется до исполнения событием tools/pre-execute
 * ({kind: 'deny', reason}); ctx.tools.guard (строка-причина / undefined) остаётся
 * вторым слоем, когда сервис доступен.
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
 * наличии ctx.tools.guard вторым слоем (0076) независимо от политик корней и
 * отклоняет только вызов в fail-корне; tools/post-execute подписывается всегда и добавляет
 * notice только для warn-корня; off-корень не получает ни отказа, ни notice
 * (off осознанно сильнее профильного fail). Порог — waitBudgetMs корня, иначе
 * профильный; журнал пишет root и mode фактического решения. Вызов без roots
 * ведёт себя как раньше: политика из config и process.cwd().
 *
 * 0076 (WC-59): отказ не зависит от инъекции сервиса tools. registerWaitGuard
 * подписывает tools/pre-execute (exec, next) и на долгий вызов в fail-корне
 * возвращает {kind: 'deny', reason} БЕЗ вызова next(); обычный вызов уходит в
 * next(). Политика, порог, кэш по mtime и журнал — прежние. ctx.tools.guard
 * подписывается вторым слоем, если сервис есть; его отсутствие не ошибка.
 *
 * 0077 (WC-60): порядок регистрации. Доступ к ctx.tools стоит ПОСЛЕ подписки и
 * внутри try/catch: в хосте, где сервис tools не инжектирован в контекст
 * плагина, обращение к нему бросает, и прежний код обрывал регистрацию до
 * tools/pre-execute — политика fail молчала. registerWaitGuard возвращает
 * result.registration = { preExecute, guard, postExecute, guardError }: живое
 * состояние видно из /workflow/api/status.
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
/**
 * 2.6.88: сколько отказов по одному и тому же вызову допускается до жёсткой
 * остановки. Первый и второй отказ — обычная политика W1; третий и далее —
 * «повтор после отказа»: агент не импровизирует, а получает маршрут в сторож.
 */
export const REPEAT_LIMIT = 2;
/** 2.6.89: тишина по умолчанию — 10 минут без событий считаются зависанием. */
export const DEFAULT_SILENCE_MS = 600000;
/** Память повторов и начало узла: ключ → состояние. Живёт в процессе плагина. */
const guardMemory = new Map();
const nodeStarts = new Map();
/** 2.6.89: последнее событие сессии — основа стопа по тишине. */
const lastSeen = new Map();
/** Тестовый сброс памяти: без него сценарии влияют друг на друга. */
export function resetGuardMemory() {
  guardMemory.clear();
  nodeStarts.clear();
  lastSeen.clear();
}
/** Producer-owned источник notice, как у остальных сообщений плагина. */
export const NOTICE_SOURCE_KIND = 'plugin:dsh-workflow-console';
/** Конфиг воркспейса с блоком enforcement — относительно корня. */
const WORKFLOW_CONFIG_RELATIVE = path.join('docs', 'subagent-workflow', 'workflow.config.json');

const SLEEP_SECONDS_RE = /-Seconds +[']?([0-9]+([.][0-9]+)?)/gi;
const SLEEP_MILLISECONDS_RE = /-Milliseconds +[']?([0-9]+([.][0-9]+)?)/gi;

function errorTextOf(error) {
  return error && typeof error.message === 'string' ? error.message : String(error);
}

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
      /* 0080: cwd | agent | call | fallback — видно, откуда взят корень. */
      attribution: typeof decision.attribution === 'string' ? decision.attribution : null,
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
  /*
   * 0122 (2.6.104): отказ называет не только сторожа, но и как читать результат.
   * Замер structure: 38 событий «cannot read .tmp/jobs/<id>.log: not found» —
   * агент искал лог у корня репозитория, а в развёрнутой копии каталог заданий
   * лежит под docs/subagent-workflow/.tmp/jobs. Поэтому: start печатает строку
   * LOG <абсолютный путь>, а хвост отдают wait --tail N и log <id>.
   */
  return 'долгое ожидание ('
    + hit.detail
    + ') запрещено политикой воркспейса enforcement.waitPolicy=fail: ожидайте тяжёлый прогон'
    + ' сторожем scripts/job.mjs — node docs/subagent-workflow/scripts/job.mjs start ... ,'
    + ' затем node docs/subagent-workflow/scripts/job.mjs wait <id> --tail 20;'
    + ' лог: start печатает «LOG <абсолютный путь>», содержимое — job.mjs log <id> [--tail N];'
    + ' ворота одной командой — node spec/scripts/gate.mjs <red|verify|accept|tests>;'
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
  const nodeBudget = finiteNumber(firstDefined(source.nodeBudgetMs, nested.nodeBudgetMs));
  const silence = finiteNumber(firstDefined(source.silenceMs, nested.silenceMs));
  const jobScript = firstDefined(source.jobScript, nested.jobScript) !== false;
  /* Корень профиля: root/repoRoot/workspaceRoot/roots[0] конфига (как в api.js), иначе cwd. */
  const firstConfiguredRoot = Array.isArray(source.roots)
    ? source.roots.find((item) => typeof item === 'string' && item.trim() !== '')
    : undefined;
  const configuredRoot = firstDefined(source.root, source.repoRoot, source.workspaceRoot, firstConfiguredRoot);
  const root = typeof configuredRoot === 'string' && configuredRoot.trim() !== ''
    ? path.resolve(configuredRoot)
    : process.cwd();
  return {
    policy,
    budgetMs: budget === null ? WAIT_BUDGET_MS : budget,
    nodeBudgetMs: nodeBudget === null || nodeBudget <= 0 ? 0 : nodeBudget,
    silenceMs: silence === null ? DEFAULT_SILENCE_MS : silence,
    jobScript,
    root,
  };
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

/**
 * cwd сессии по идентификатору вызова (0080/WC-62: атрибуция корня).
 *
 * У вызова из PTC-моста нет ни exec.cwd, ни agent.cwd: мост передаёт только
 * parent/rootCallId. Корень восстанавливается по карте callId → cwd сессии,
 * которую сторож ведёт из session/event (tool/call пишет, tool/result стирает).
 */
function callIdCwd(exec, state) {
  if (!state || !(state.callRoots instanceof Map)) return null;
  const ids = [exec && exec.rootCallId, exec && exec.parent, exec && exec.callId];
  for (const id of ids) {
    if (typeof id !== 'string' || id === '') continue;
    const cwd = state.callRoots.get(id);
    if (typeof cwd === 'string' && cwd !== '') return cwd;
  }
  return null;
}

/**
 * Корень вызова: exec.cwd → agent cwd → cwd сессии по callId →
 * config.root/roots[0]/cwd (инвариант 1). Возвращает пару корень+источник,
 * чтобы журнал был честным: fallback — это «корень не определён», а не решение.
 */
function callRootWithSource(exec, state) {
  const direct = rootForPath(exec && exec.cwd, state.roots);
  if (direct !== null) return { root: direct, attribution: 'cwd' };
  const fromAgent = rootForPath(agentCwd(exec), state.roots);
  if (fromAgent !== null) return { root: fromAgent, attribution: 'agent' };
  const fromCall = rootForPath(callIdCwd(exec, state), state.roots);
  if (fromCall !== null) return { root: fromCall, attribution: 'call' };
  return { root: state.fallbackRoot, attribution: 'fallback' };
}

function callRoot(exec, state) {
  return callRootWithSource(exec, state).root;
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
    const nodeBudget = finiteNumber(enforcement.nodeBudgetMs);
    const silence = finiteNumber(enforcement.silenceMs);
    settings = {
      policy,
      budgetMs: budget !== null && budget > 0 ? budget : undefined,
      /* 2.6.88: бюджет жизни узла; 0/нет ключа — выключен. */
      nodeBudgetMs: nodeBudget !== null && nodeBudget > 0 ? nodeBudget : undefined,
      /* 2.6.89: тишина; 0 — выключена, нет ключа — профильный дефолт. */
      silenceMs: silence !== null ? silence : undefined,
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
  const located = callRootWithSource(exec, state);
  const root = located.root;
  const settings = state.workspaceMode ? readWorkspaceWaitSettings(root, state.cache) : {};
  const policy = settings.policy !== undefined ? settings.policy : state.policy;
  const budgetMs = settings.budgetMs !== undefined ? settings.budgetMs : state.budgetMs;
  const nodeBudgetMs = settings.nodeBudgetMs !== undefined ? settings.nodeBudgetMs : state.nodeBudgetMs;
  const silenceMs = settings.silenceMs !== undefined ? settings.silenceMs : state.silenceMs;
  /* Старый движок: сторожа в воркспейсе нет — отклонять нельзя, действует warn. */
  const effective = policy === 'fail' && !state.jobScript ? 'warn' : policy;
  return {
    root,
    attribution: located.attribution,
    policy,
    effective,
    budgetMs,
    nodeBudgetMs,
    silenceMs,
    jobScript: state.jobScript,
  };
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

/** 2.6.88: ключ сессии для памяти повторов и бюджета узла. */
function sessionIdOf(exec) {
  const agent = exec && exec.agent && typeof exec.agent === 'object' ? exec.agent : {};
  const session = agent.session && typeof agent.session === 'object' ? agent.session : {};
  const candidates = [session.id, agent.sessionId, exec && exec.sessionId, exec && exec.callId];
  for (const value of candidates) {
    if (typeof value === 'string' && value !== '') return value;
  }
  return 'session';
}

/** 2.6.88: подпись вызова — имя инструмента и его аргументы без порядка ключей. */
function signatureOf(exec) {
  const name = String((exec && (exec.name || exec.tool)) || '');
  const args = exec && exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {};
  return createHash('sha1').update(name + '|' + JSON.stringify(args)).digest('hex').slice(0, 12);
}

/** 2.6.88: маршрут в сторож — готовой командой, а не «нельзя». */
function routeHint(root, exec) {
  const script = path.join(root, 'docs', 'subagent-workflow', 'scripts', 'job.mjs');
  const args = exec && exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {};
  const command = typeof args.command === 'string' && args.command.trim() !== ''
    ? args.command.trim().slice(0, 80)
    : '(тот же вызов)';
  return 'Маршрут: node ' + script + ' start -- ' + command + ' ; затем node ' + script + ' wait <id>';
}

/**
 * Решение об отказе по одному вызову: {kind: 'deny', reason} для
 * tools/pre-execute, либо null (не долгий вызов / корень не fail). Журнал
 * пишется здесь же — и для pre-execute, и для guard второго слоя. Ошибка
 * политики не бросается: решение не принимается, вызов решает downstream.
 *
 * 2.6.88: два дополнительных предела поверх W1:
 *   - повтор того же вызова после отказа: третий и далее — «повтор после отказа»
 *     с маршрутом в сторож (агент не крутит один и тот же вызов);
 *   - бюджет узла (enforcement.nodeBudgetMs): если остаток меньше запрошенного
 *     ожидания — отказ с требованием промежуточной сдачи.
 */
function preExecuteDenial(exec, state) {
  try {
    const decision = resolveCall(exec, state);
    const now = typeof state.now === 'function' ? state.now() : Date.now();
    const sessionId = sessionIdOf(exec);
    /*
     * 2.6.89: тишина считается по любым вызовам — и коротким тоже. Молчание
     * между событиями и есть признак зависания; длительность работы — нет.
     */
    const previous = lastSeen.get(sessionId);
    const gap = previous === undefined ? 0 : Math.max(0, now - previous);
    lastSeen.set(sessionId, now);
    if (decision.effective !== 'fail') return null;
    const hit = detectLongWait(exec, decision.budgetMs);
    if (hit === null) return null;
    const signature = signatureOf(exec);
    const repeatKey = sessionId + '|' + decision.root + '|' + signature;
    const attempt = guardMemory.get(repeatKey) || { count: 0 };
    attempt.count += 1;
    attempt.at = now;
    guardMemory.set(repeatKey, attempt);

    if (!nodeStarts.has(sessionId)) nodeStarts.set(sessionId, now);
    const startedAt = nodeStarts.get(sessionId);
    const elapsed = Math.max(0, now - startedAt);

    let reason;
    if (attempt.count > REPEAT_LIMIT) {
      reason = 'повтор того же вызова после отказа (' + attempt.count + '-й раз) — остановка: '
        + hit.detail + '. ' + routeHint(decision.root, exec);
    } else if (decision.silenceMs > 0 && gap >= decision.silenceMs) {
      reason = 'тишина ' + Math.round(gap / 60000) + ' мин без событий (порог '
        + Math.round(decision.silenceMs / 60000) + ' мин): сдай промежуточный результат и продолжи следующим шагом. '
        + routeHint(decision.root, exec);
    } else if (decision.nodeBudgetMs > 0 && elapsed + hit.waitMs > decision.nodeBudgetMs) {
      reason = 'бюджет узла исчерпан: прошло ' + Math.round(elapsed / 1000) + ' с из '
        + Math.round(decision.nodeBudgetMs / 1000) + ' с, а запрошено ещё '
        + Math.round(hit.waitMs / 1000) + ' с (' + hit.detail + '). Сдай промежуточный результат'
        + ' и продолжи следующим шагом; ' + routeHint(decision.root, exec);
    } else {
      reason = waitGuardReason(hit) + ' ' + routeHint(decision.root, exec);
    }

    recordWait(exec, hit, {
      root: decision.root,
      attribution: decision.attribution,
      mode: 'fail',
      denied: true,
      reason,
      budgetMs: decision.budgetMs,
    });
    return { kind: 'deny', reason };
  } catch {
    return null;
  }
}

/** Второй слой: guard возвращает строку-причину или undefined (не вмешиваться). */
function guardDenial(exec, state) {
  const denial = preExecuteDenial(exec, state);
  return denial === null ? undefined : denial.reason;
}

/** tools/pre-execute: отказ до исполнения, иначе решение отдаётся downstream. */
function preExecuteHandler(state) {
  return async (...args) => {
    const denial = preExecuteDenial(args[0], state);
    if (denial !== null) return denial;
    const next = downstreamOf(args);
    return typeof next === 'function' ? next() : undefined;
  };
}

/** tools/post-execute: notice warn-корня, downstream-результат не теряется. */
function postExecuteHandler(state) {
  return async (...args) => {
    const next = downstreamOf(args);
    const result = next ? await next() : undefined;
    try {
      const decision = resolveCall(args[0], state);
      if (decision.effective === 'warn') {
        const hit = detectLongWait(args[0], decision.budgetMs);
        if (hit !== null) {
          recordWait(args[0], hit, {
            root: decision.root,
            attribution: decision.attribution,
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
  };
}

/**
 * Подписать сторож на контекст плагина.
 *
 * @param {{tools?: {guard?: Function}, on?: Function}} ctx контекст DSH:
 *   on — waterfall-события (tools/pre-execute, tools/post-execute); tools.guard —
 *   второй слой, его отсутствие не ошибка
 * @param {object} [config] конфиг плагина: waitPolicy/waitBudgetMs/jobScript
 *   (профильный дефолт) и roots — абсолютные корни воркспейсов; допустим и
 *   блок { enforcement: { ... } } из workflow.config.json
 * @returns {{policy: string, budgetMs: number, jobScript: boolean, roots: string[]}}
 */
export function registerWaitGuard(ctx, config = {}, options = {}) {
  /* 2.6.88: регистрация начинает чистую память повторов и бюджета —
   * один экземпляр плагина на процесс, иначе счётчики переезжают между сессиями. */
  guardMemory.clear();
  nodeStarts.clear();
  const profile = resolvePolicy(config);
  const roots = normalizeRoots(config);
  const profileEffective = profile.policy === 'fail' && !profile.jobScript ? 'warn' : profile.policy;
  const state = {
    roots,
    /* 0080: callId → cwd сессии; у вложенных вызовов другого источника корня нет. */
    callRoots: new Map(),
    workspaceMode: roots.length > 0,
    policy: profile.policy,
    budgetMs: profile.budgetMs,
    nodeBudgetMs: profile.nodeBudgetMs,
    silenceMs: profile.silenceMs,
    jobScript: profile.jobScript,
    fallbackRoot: profile.root,
    cache: new Map(),
    /* 2.6.88: часы инъектируемы — сценарии бюджета проверяются без сна. */
    now: typeof options.now === 'function' ? options.now : Date.now,
  };
  const result = {
    policy: profileEffective,
    budgetMs: profile.budgetMs,
    jobScript: profile.jobScript,
    roots: roots.slice(),
  };
  if (!ctx || typeof ctx !== 'object') return result;

  const listenAvailable = typeof ctx.on === 'function';
  /*
   * 2.6.36 (WC-60): подписка — первая операция, сервис tools читается ПОСЛЕ неё
   * и внутри try/catch. Прежний порядок (Boolean(ctx.tools) выше подписки)
   * обрывал регистрацию целиком там, где сервис tools не инжектирован в
   * контекст плагина: apply() ловил исключение, панель работала, а
   * tools/pre-execute не подписывался — и политика fail молчала.
   */
  const registration = {
    preExecute: false,
    guard: false,
    postExecute: false,
    guardError: null,
  };
  const subscribe = (event, handler) => {
    if (!listenAvailable) return false;
    try {
      ctx.on(event, handler);
      return true;
    } catch (error) {
      registration.guardError = errorTextOf(error);
      return false;
    }
  };
  const attachGuard = (service) => {
    if (!service || typeof service.guard !== 'function') return;
    try {
      service.guard((exec) => guardDenial(exec, state));
      registration.guard = true;
    } catch (error) {
      registration.guardError = errorTextOf(error);
    }
  };

  /*
   * 0080: карта вызов → cwd сессии. PTC-мост не передаёт ни exec.cwd, ни agent
   * для вложенных вызовов, поэтому корень берётся из события сессии по
   * callId/rootCallId. Ошибка карты не имеет права ломать вызов.
   */
  const cwdOfSession = (session) => {
    const candidates = [
      session && session.cwd,
      session && session.header && session.header.cwd,
      session && session.agent && session.agent.cwd,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate !== '') return candidate;
    }
    return '';
  };
  const rememberCall = (session, event) => {
    try {
      if (!event || typeof event !== 'object' || !listenAvailable) return;
      const data = event.data && typeof event.data === 'object' ? event.data : {};
      const id = typeof data.callId === 'string' ? data.callId : '';
      if (id === '') return;
      if (event.type === 'tool/call') {
        const cwd = cwdOfSession(session);
        if (cwd === '') return;
        state.callRoots.set(id, cwd);
        while (state.callRoots.size > 500) {
          const oldest = state.callRoots.keys().next().value;
          if (oldest === undefined) break;
          state.callRoots.delete(oldest);
        }
      } else if (event.type === 'tool/result') {
        state.callRoots.delete(id);
      }
    } catch {
      /* атрибуция не имеет права ломать вызов */
    }
  };
  if (listenAvailable) subscribe('session/event', rememberCall);

  if (state.workspaceMode || profileEffective === 'fail') {
    registration.preExecute = subscribe('tools/pre-execute', preExecuteHandler(state));
  }

  let toolsService = null;
  let toolsError = null;
  try {
    toolsService = ctx.tools;
  } catch (error) {
    toolsError = errorTextOf(error);
    registration.guardError = toolsError;
  }
  /*
   * 0194: в контексте плагина сервис tools доступен только через inject —
   * прямое чтение ctx.tools бросает «cannot get property tools without inject»,
   * и guard молчал. Подписки above остаются на корневом ctx (их доставку
   * проверяет wait-guard.test.mjs), а guard дотягивается в инжектированном
   * контексте. Если inject недоступен (старый хост, юнит-контекст), поведение
   * прежнее: guard:false и причина в guardError.
   */
  if (!toolsService && typeof ctx.inject === 'function') {
    try {
      ctx.inject(['tools'], (toolsCtx) => {
        try {
          attachGuard(toolsCtx && toolsCtx.tools);
          if (registration.guard) {
            /* Поздний успех снимает только ошибку чтения ctx.tools, не ошибки подписок. */
            if (registration.guardError === toolsError) registration.guardError = null;
            if (typeof options.onGuardAttached === 'function') options.onGuardAttached(result);
          }
        } catch (error) {
          registration.guardError = errorTextOf(error);
        }
      });
    } catch (error) {
      registration.guardError = errorTextOf(error);
    }
  }

  if (state.workspaceMode) {
    /* 0075 (WC-57): смешанные политики. Guard — вторым слоем, post-execute —
     * notice только для warn-корня, off-корень молчит. */
    attachGuard(toolsService);
    registration.postExecute = subscribe('tools/post-execute', postExecuteHandler(state));
    result.registration = registration;
    return result;
  }

  /* Совместимость: без roots — как раньше, политика профиля и один корень. */
  if (profileEffective === 'off') {
    result.registration = registration;
    return result;
  }

  if (profileEffective === 'fail') {
    if (!registration.preExecute) attachGuard(toolsService);
    result.registration = registration;
    return result;
  }

  registration.postExecute = subscribe('tools/post-execute', postExecuteHandler(state));
  result.registration = registration;
  return result;
}
