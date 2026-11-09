/**
 * 0127 (WC-80): отсечение зацикливания.
 *
 * Повод: узел-исполнитель 10.11 сорок минут повторял одну и ту же ошибку
 * `Unexpected token const` — один и тот же вызов с одним и тем же результатом.
 * Ни таймаут, ни лимит шагов этого не ловят: вызовы формально разные (разный
 * текст программы), ошибка одна.
 *
 * Правило: отпечаток = инструмент + нормализованные аргументы + текст ошибки.
 * Второй повтор — подсказка сменить метод; третий — отказ до исполнения.
 * Отказ не «наказывает», а заставляет сменить способ: писать файл через write,
 * тесты гонять сторожем, строки собирать без вложенных апострофов.
 */
import crypto from 'node:crypto';

/** Нормализация аргументов: порядок ключей и пробелы не создают новый отпечаток. */
export function normalizeArgs(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return '[' + value.map(normalizeArgs).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + normalizeArgs(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Отпечаток вызова: инструмент + нормализованные аргументы — по нему считается серия падений. */
export function callSignature(tool, args) {
  return crypto.createHash('sha256').update(String(tool || '') + '|' + normalizeArgs(args), 'utf8').digest('hex').slice(0, 16);
}

/** Отпечаток сбоя: инструмент + аргументы + текст ошибки (без хвостов путей/номеров строк). */
export function signatureOf(tool, args, errorText) {
  const error = String(errorText || '')
    .replace(/\s+/gu, ' ')
    .replace(/\b\d{2,}\b/gu, 'N')
    .trim()
    .slice(0, 400);
  return crypto.createHash('sha256').update(String(tool || '') + '|' + normalizeArgs(args) + '|' + error, 'utf8').digest('hex').slice(0, 16);
}

/** Подсказка по классу ошибки: не «попробуй ещё», а «смени метод». */
export function hintFor(errorText) {
  const text = String(errorText || '');
  if (/Unexpected token|SyntaxError|Unexpected identifier|Expected ident/u.test(text)) {
    return 'синтаксис: не собирай код через шаблонную строку — пиши файл инструментом write или правь через edit, строки клей из массива и join';
  }
  if (/timeout|timed out|deadline|превыш/u.test(text)) {
    return 'долгий прогон: запускай через сторож (job start / job wait), не держи вызов внутри инструмента';
  }
  if (/ENOENT|no such file|не найден|not found/u.test(text)) {
    return 'путь: проверь существование файла до вызова, не повторяй тот же путь';
  }
  if (/assert|AssertionError|ожидал|expected/u.test(text)) {
    return 'тест: одинаковый провал не лечится перезапуском — меняй код или само ожидание, зафиксируй гипотезу';
  }
  return 'тот же вызов с тем же результатом: смени метод, а не повторяй';
}

/**
 * Состояние счётчиков. Хранится в памяти процесса: перезапуск сбрасывает,
 * и это правильно — цикл живёт в сессии, а не в вечности.
 */
export function createLoopState(options = {}) {
  return {
    limit: Number(options.limit) > 0 ? Number(options.limit) : 3,
    counters: new Map(),
    /*
     * 0127: второй счётчик — по классу ошибки, а не по аргументам. Цикл бывает
     * «тем же вызовом» (одинаковые аргументы) и «тем же классом» (аргументы
     * разные, ошибка одна) — второй случай и случился 10.11 у исполнителя.
     */
    patterns: new Map(),
  };
}

/**
 * Учесть результат вызова.
 * @returns {{count: number, action: 'allow'|'warn'|'refuse', hint: string, signature: string}}
 */
export function observeResult(state, input = {}) {
  const session = String(input.session || 'unknown');
  const call = callSignature(input.tool, input.args);
  const key = session + ':' + call;
  const errorText = String(input.error || '');
  if (errorText === '') {
    /* Успех обнуляет серию: важно падение ПОДРЯД, а не раз в жизни. */
    state.counters.delete(key);
    return { count: 0, action: 'allow', hint: '', signature: call };
  }
  const previous = state.counters.get(key);
  const count = (previous ? previous.count : 0) + 1;
  state.counters.set(key, { count, error: errorText });
  const patternKey = session + ':' + String(input.tool || '') + ':' + signatureOf(input.tool, '', errorText);
  const patternPrevious = state.patterns.get(patternKey);
  const patternCount = (patternPrevious ? patternPrevious.count : 0) + 1;
  state.patterns.set(patternKey, { count: patternCount, error: errorText });
  const hint = hintFor(errorText);
  const effective = Math.max(count, patternCount);
  const action = effective >= state.limit ? 'refuse' : effective >= 2 ? 'warn' : 'allow';
  return { count, patternCount, action, hint, signature: call };
}

/** Отказ до исполнения: отпечаток уже достиг предела. */
export function refusalFor(state, input = {}) {
  const session = String(input.session || 'unknown');
  const tool = String(input.tool || '');
  const key = session + ':' + callSignature(tool, input.args);
  const entry = state.counters.get(key);
  if (entry && entry.count >= state.limit) {
    return 'повтор отклонён: этот вызов уже падал ' + entry.count + ' раз(а) подряд. Смени метод: ' + hintFor(entry.error);
  }
  /* Тот же класс ошибки тем же инструментом — блокируем инструмент, пока метод не сменится. */
  let worst = 0;
  let worstError = '';
  for (const [patternKey, entryPattern] of state.patterns) {
    if (!patternKey.startsWith(session + ':' + tool + ':')) continue;
    if (entryPattern.count > worst) { worst = entryPattern.count; worstError = entryPattern.error; }
  }
  if (worst >= state.limit) {
    return 'инструмент ' + (tool || '?') + ' падал ' + worst + ' раз(а) с одной и той же ошибкой. Смени метод: ' + hintFor(worstError);
  }
  return null;
}

function sessionOf(exec) {
  const agent = exec && typeof exec === 'object' ? exec.agent : null;
  const session = agent && agent.session ? agent.session : null;
  return String((session && (session.id || session.sessionId)) || (exec && exec.sessionId) || 'unknown');
}

function errorOf(result) {
  if (!result || typeof result !== 'object') return '';
  if (typeof result.error === 'string' && result.error !== '') return result.error;
  if (result.error && typeof result.error.message === 'string') return result.error.message;
  if (result.isError === true) {
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.map((item) => (item && typeof item.text === 'string' ? item.text : '')).join(' ');
    return text !== '' ? text : 'tool error';
  }
  return '';
}

function downstreamOf(args) {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    if (typeof args[index] === 'function') return args[index];
  }
  return null;
}

/**
 * Подписать отсечение на контекст плагина.
 * @param {{on?: Function}} ctx
 * @param {{limit?: number, policy?: 'fail'|'warn'|'off'}} [config]
 */
export function registerLoopGuard(ctx, config = {}) {
  const state = createLoopState({ limit: config.limit });
  const policy = config.policy === 'warn' || config.policy === 'off' ? config.policy : 'fail';
  const registration = { preExecute: false, postExecute: false, policy, limit: state.limit };
  if (typeof ctx.on !== 'function' || policy === 'off') return registration;
  /* Отказ до исполнения: серия падений этого же вызова уже достигла предела. */
  ctx.on('tools/pre-execute', async (...args) => {
    try {
      const exec = args[0];
      const reason = refusalFor(state, {
        session: sessionOf(exec),
        tool: exec && (exec.name || exec.tool),
        args: exec && exec.arguments,
      });
      if (reason !== null && policy === 'fail') return { kind: 'deny', reason };
    } catch {
      /* сбой счётчика не блокирует вызов */
    }
    const next = downstreamOf(args);
    return typeof next === 'function' ? next() : undefined;
  });
  registration.preExecute = true;
  ctx.on('tools/post-execute', async (...args) => {
    const next = downstreamOf(args);
    const result = next ? await next() : undefined;
    try {
      const error = errorOf(result);
      if (error !== '') {
        const decision = observeResult(state, {
          session: sessionOf(args[0]),
          tool: args[0] && (args[0].name || args[0].tool),
          args: args[0] && args[0].arguments,
          error,
        });
        if (decision.action !== 'allow' && result && typeof result === 'object') {
          const contexts = Array.isArray(result.additionalContexts) ? result.additionalContexts.slice() : [];
          contexts.push({
            type: 'text',
            text: (decision.action === 'refuse' ? 'цикл: ' : 'внимание: ')
              + 'тот же вызов падал ' + decision.count + ' раз(а). ' + decision.hint,
          });
          result.additionalContexts = contexts;
        }
      }
    } catch {
      /* счётчик не должен ломать результат инструмента */
    }
    return result;
  });
  registration.postExecute = true;
  return registration;
}
