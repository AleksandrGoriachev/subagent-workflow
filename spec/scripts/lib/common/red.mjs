/*
 * Красный прогон: дефекты проверки, причины, окно.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
export const RED_REASON_WINDOW = 25;
/** Классы ошибок, означающих дефект самой проверки, а не отказ проверяемого кода. */
export const CHECK_DEFECT_NAMES = ['ReferenceError', 'TypeError', 'SyntaxError'];

export function outputLines(text) {
  return String(text === undefined || text === null ? '' : text)
    .replaceAll(String.fromCharCode(13), '')
    .split(String.fromCharCode(10));
}

/** Непустые строки вывода: пустые строки вердиктную зону не раздувают. */
export function nonEmptyLines(text) {
  return outputLines(text).map((line) => line.trim()).filter((line) => line !== '');
}

/**
 * Дефект проверки (0057, WC-35): у отказавшего критерия строка
 * `ReferenceError: …` (допустим префикс `Uncaught `) и в следующих 7 строках —
 * кадр стека (`    at …` или `node:internal`). Такой отказ означает ошибку в самой
 * проверке: она не позеленеет ни при какой реализации. Зелёный критерий не
 * сканируется вовсе, поэтому ожидаемый сбой негативного критерия дефектом не
 * становится. Возвращает null | { name, line } (line — обрезанная строка ошибки).
 */
export function detectCheckDefect(result) {
  if (!result || result.passed === true) return null;
  const text = String(result.stdout === undefined || result.stdout === null ? '' : result.stdout)
    + String.fromCharCode(10)
    + String(result.stderr === undefined || result.stderr === null ? '' : result.stderr);
  const lines = outputLines(text);
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*(?:Uncaught\s+)?(ReferenceError|TypeError|SyntaxError):\s*(?:\S|$)/u.exec(lines[i]);
    if (!match) continue;
    const frames = lines.slice(i + 1, i + 8);
    const hasFrame = frames.some((line) => /^\s+at\s+/u.test(line) || line.includes('node:internal'));
    if (hasFrame) return { name: match[1], line: lines[i].trim() };
  }
  return null;
}

/**
 * Сопоставление причины красного с вердиктной зоной вывода (0057, WC-35).
 *
 * Окно — последние windowSize непустых строк (CRLF терпим, пустые строки не
 * считаются). Строка обязана содержать причину подстрокой, не обязательно с
 * начала. Ищется последнее вхождение: ранняя «правильная» причина не должна
 * прикрывать чужую, потому что вердикт печатается в конце. distance — сколько
 * непустых строк после найденной; ok только при distance < windowSize.
 * Возвращает { ok, found, distance, total, line }, line — номер найденной
 * строки среди непустых (1-based), total — число непустых строк.
 */
export function matchRedReason(text, reason, windowSize) {
  const window = Number.isInteger(windowSize) && windowSize >= 1 && windowSize <= 10000 ? windowSize : RED_REASON_WINDOW;
  const lines = nonEmptyLines(text);
  const total = lines.length;
  const needle = String(reason === undefined || reason === null ? '' : reason);
  let index = -1;
  for (let i = 0; i < lines.length; i += 1) if (lines[i].includes(needle)) index = i;
  if (index < 0) return { ok: false, found: false, distance: null, total, line: null };
  const distance = total - index - 1;
  return { ok: distance < window, found: true, distance, total, line: index + 1 };
}

/**
 * Размер вердиктного окна (0057, WC-35): redExpect.reasonWindow, если это целое
 * 1..10000, иначе RED_REASON_WINDOW. Некорректное значение отвергает task-lint;
 * здесь оно не роняет ворота, а даёт окно по умолчанию.
 */
export function redReasonWindow(redExpect) {
  const value = redExpect && typeof redExpect === 'object' && !Array.isArray(redExpect) ? redExpect.reasonWindow : undefined;
  return Number.isInteger(value) && value >= 1 && value <= 10000 ? value : RED_REASON_WINDOW;
}

export function evaluateRedExpectation(redExpect, results, options = {}) {
  const list = Array.isArray(results) ? results : [];
  /*
   * 0108 (2.6.97): e2e-смоук существующего сценария не имеет критерия, который
   * обязан упасть. redExpect.noRed.reason — осознанный отказ от красного,
   * разрешён только для risk=low; во всех остальных случаях mustFail пуст —
   * отказ, как раньше.
   */
  const risk = String((options && options.risk) || '');
  const shape = (checkDefects, reasonChecks, window) => ({ checkDefects, reasonChecks, reasonWindow: window });
  if (redExpect === undefined || redExpect === null) {
    return {
      configured: false, ok: list.some((r) => !r.passed), errors: [], mustFail: [], mustPass: [], noRed: null,
      ...shape([], [], RED_REASON_WINDOW),
    };
  }
  if (typeof redExpect !== 'object' || Array.isArray(redExpect)) {
    return {
      configured: true, ok: false, errors: ['redExpect должен быть объектом'], mustFail: [], mustPass: [], noRed: null,
      ...shape([], [], RED_REASON_WINDOW),
    };
  }
  const mustFail = Array.isArray(redExpect.mustFail) ? redExpect.mustFail.map(String) : [];
  const mustPass = Array.isArray(redExpect.mustPass) ? redExpect.mustPass.map(String) : [];
  const reasons = redExpect.reasons && typeof redExpect.reasons === 'object' ? redExpect.reasons : {};
  const window = redReasonWindow(redExpect);
  const byId = new Map(list.map((r) => [r.id, r]));
  const errors = [];
  const checkDefects = [];
  const reasonChecks = [];
  /*
   * Дефект проверки важнее совпадения причины: если проверка падает собственной
   * ReferenceError/TypeError/SyntaxError, красный не доказывает ничего, даже когда
   * ожидаемая причина в выводе есть.
   */
  for (const result of list) {
    if (!result || result.passed === true) continue;
    const defect = detectCheckDefect(result);
    if (!defect) continue;
    const entry = { id: String(result.id), name: defect.name, line: defect.line };
    checkDefects.push(entry);
    errors.push('дефект проверки: критерий ' + entry.id + ' — ' + entry.name + ': ' + entry.line
      + '. Отказ самой проверки, а не доказанный красный: устраните ошибку в проверке.');
  }
  const noRedRaw = redExpect.noRed && typeof redExpect.noRed === 'object' && !Array.isArray(redExpect.noRed) ? redExpect.noRed : null;
  const noRedReason = noRedRaw && typeof noRedRaw.reason === 'string' ? noRedRaw.reason.trim() : '';
  const noRed = mustFail.length === 0 && noRedReason !== '' && risk === 'low' ? { reason: noRedReason } : null;
  if (mustFail.length === 0 && !noRed) {
    const hint = noRedReason === '' ? '' : ' (noRed разрешён только для risk=low)';
    errors.push('redExpect.mustFail пуст: неясно, что обязано упасть' + hint);
  }
  for (const id of mustFail) {
    const result = byId.get(id);
    if (!result) { errors.push('redExpect: нет критерия ' + id); continue; }
    if (result.passed) { errors.push('redExpect: критерий ' + id + ' обязан упасть, а он зелёный'); continue; }
    const reason = reasons[id];
    if (typeof reason !== 'string' || reason === '') continue;
    const text = String(result.stdout || '') + String.fromCharCode(10) + String(result.stderr || '');
    const match = matchRedReason(text, reason, window);
    reasonChecks.push({ id, ok: match.ok, distance: match.distance, total: match.total, window });
    if (!match.found) {
      errors.push('redExpect: критерий ' + id + ' упал не по ожидаемой причине (' + reason + ')');
    } else if (!match.ok) {
      errors.push('redExpect: критерий ' + id + ' — причина «' + reason + '» есть только в строке '
        + match.line + ' из ' + match.total + ' непустых, а вердиктная зона — последние '
        + window + ' непустых строк вывода. Расширяйте reasonWindow осознанно, если причина'
        + ' законно напечатана выше зоны');
    }
  }
  for (const id of mustPass) {
    const result = byId.get(id);
    if (!result) { errors.push('redExpect: нет критерия ' + id); continue; }
    if (!result.passed) errors.push('redExpect: критерий ' + id + ' обязан быть зелёным на базе');
  }
  const declared = new Set([...mustFail, ...mustPass]);
  for (const result of list) {
    if (!declared.has(result.id)) errors.push('redExpect: критерий ' + result.id + ' не указан ни в mustFail, ни в mustPass');
  }
  return {
    configured: true, ok: errors.length === 0, errors, mustFail, mustPass,
    noRed: noRed && errors.length === 0 ? noRed : null,
    ...shape(checkDefects, reasonChecks, window),
  };
}

