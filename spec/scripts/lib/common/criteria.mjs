/*
 * Критерии: параллельный прогон, ожидания, форматирование.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import path from 'node:path';
import { runCommand, criteriaConcurrency } from './proc.mjs';
import { isManual } from './journal.mjs';
export async function runCriteria(criteria, options = {}) {
  const list = Array.isArray(criteria) ? criteria.slice() : [];
  const base = path.resolve(options.cwd || options.repo || process.cwd());
  const env = options.env && typeof options.env === 'object' ? { ...options.env } : {};
  const defaultTimeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 120000;
  const multiplier = Number(options.timeoutMultiplier) > 0 ? Number(options.timeoutMultiplier) : 1;
  const rows = new Array(list.length).fill(null);
  let next = 0;

  const runOne = async (index) => {
    const criterion = list[index] && typeof list[index] === 'object' ? list[index] : {};
    if (isManual(criterion) || criterion.command === undefined || criterion.command === null) return;
    const id = String(criterion.id);
    const command = String(criterion.command);
    const cwd = criterion.cwd ? path.resolve(base, String(criterion.cwd)) : base;
    const declaredTimeout = Number(criterion.timeoutMs) > 0 ? Number(criterion.timeoutMs) : defaultTimeoutMs;
    const timeoutMs = Math.max(1, Math.round(declaredTimeout * multiplier));
    const childEnv = {
      ...env,
      ...(criterion.env && typeof criterion.env === 'object' ? criterion.env : {}),
    };
    const started = Date.now();
    let result;
    try {
      result = await runCommand(command, { cwd, env: childEnv, timeoutMs, maxOutput: options.maxOutput });
    } catch (error) {
      result = {
        exitCode: 127,
        stdout: '',
        stderr: error && error.message ? String(error.message) : String(error),
        timedOut: false,
        durationMs: Date.now() - started,
      };
    }
    const stdout = result && result.stdout !== undefined && result.stdout !== null ? String(result.stdout) : '';
    const stderr = result && result.stderr !== undefined && result.stderr !== null ? String(result.stderr) : '';
    rows[index] = {
      id,
      command,
      exitCode: result && typeof result.exitCode === 'number' ? result.exitCode : 127,
      output: stderr === '' ? stdout : stdout + String.fromCharCode(10) + stderr,
      durationMs: result && typeof result.durationMs === 'number' ? result.durationMs : Date.now() - started,
      stdout,
      stderr,
      timedOut: Boolean(result && result.timedOut),
    };
  };

  const width = Math.max(1, Math.min(criteriaConcurrency(options), Math.max(1, list.length)));
  const workers = [];
  for (let i = 0; i < width; i += 1) {
    workers.push((async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= list.length) return;
        await runOne(index);
      }
    })());
  }
  await Promise.all(workers);
  return rows.filter((row) => row !== null);
}

export function evaluateExpectation(expect, result) {
  const reasons = [];
  const e = expect && Object.keys(expect).length ? expect : { exitCode: 0 };
  if ('exitCode' in e && result.exitCode !== e.exitCode) {
    reasons.push('exit code ' + result.exitCode + ' != ' + e.exitCode);
  }
  const contains = e.stdoutContains === undefined ? [] : (Array.isArray(e.stdoutContains) ? e.stdoutContains : [e.stdoutContains]);
  for (const s of contains) if (!result.stdout.includes(s)) reasons.push('stdout не содержит: ' + s);
  const stderrContains = e.stderrContains === undefined ? [] : (Array.isArray(e.stderrContains) ? e.stderrContains : [e.stderrContains]);
  for (const s of stderrContains) if (!result.stderr.includes(s)) reasons.push('stderr не содержит: ' + s);
  if (e.stdoutRegex) {
    try { if (!new RegExp(e.stdoutRegex, 'm').test(result.stdout)) reasons.push('stdout не соответствует /' + e.stdoutRegex + '/m'); }
    catch (err) { reasons.push('некорректный stdoutRegex: ' + err.message); }
  }
  if (e.stderrRegex) {
    try { if (!new RegExp(e.stderrRegex, 'm').test(result.stderr)) reasons.push('stderr не соответствует /' + e.stderrRegex + '/m'); }
    catch (err) { reasons.push('некорректный stderrRegex: ' + err.message); }
  }
  if (e.json) {
    try {
      const value = JSON.parse(result.stdout);
      const actual = String(e.json.path || '').split('.').filter(Boolean).reduce((acc, key) => (acc == null ? acc : acc[key]), value);
      if ('equals' in e.json && JSON.stringify(actual) !== JSON.stringify(e.json.equals)) {
        reasons.push('json ' + e.json.path + ' = ' + JSON.stringify(actual) + ' != ' + JSON.stringify(e.json.equals));
      }
      if (e.json.matches) {
        try { if (!new RegExp(e.json.matches, 'm').test(String(actual))) reasons.push('json ' + e.json.path + ' не соответствует /' + e.json.matches + '/'); }
        catch (err) { reasons.push('некорректный json.matches: ' + err.message); }
      }
    } catch (err) { reasons.push('stdout не JSON: ' + err.message); }
  }
  return { passed: reasons.length === 0, reasons };
}

export function formatMs(ms) {
  if (ms < 1000) return ms + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
  return (ms / 60000).toFixed(1) + ' min';
}

/*
 * 0055 (WC-24): ворота печатают exit-код и длительность каждого критерия.
 *
 * Замер критика: приёмщик 0039–0048 добирал эти числа ручными прогонами (≈980 с
 * дублей за семь приёмок) — в stdout было только `PASS  C1  5.5 s`, без кода
 * возврата и без общей картины. Формат строки побайтно задан контрактом задания:
 * `PASS  <id>  exit <code>  <ms> ms` (два пробела между полями). Функции чистые:
 * ничего не читают и не пишут, поэтому ими же пользуется проверка формата.
 */
