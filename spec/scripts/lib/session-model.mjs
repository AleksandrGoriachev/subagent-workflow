/**
 * Модель сессии по факту харнесса (WC-25, 0100).
 *
 * У движка нет способа спросить харнесс «какая модель у этой сессии»: DSH_MODEL
 * инструментам не передаётся (проверено: пусто), а в задании модель приёмщика
 * раньше оставалась unknown. Харнесс, однако, сам пишет факт: проекция сессии
 * `~/.dsh/storages/session_projcache/sessions/<DSH_SESSION_ID>.json` содержит
 * `record.rows.modelSelection.val.lastUsed = { provider, model, reasoningEffort }`.
 *
 * Это факт вызова, а не объявление в конфиге, и он принадлежит харнессу, а не
 * приёмщику. Источник по убыванию силы: запись запуска (кто запустил — тот знает
 * план), затем эта проекция, затем env, затем unknown.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Каталог проекций сессий: переопределяется для тестов и нестандартных установок. */
export function projcacheDir(env = process.env) {
  const override = env.WF_PROJCACHE_DIR || env.DSH_PROJCACHE_DIR;
  if (typeof override === 'string' && override.trim() !== '') return path.resolve(override.trim());
  return path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions');
}

/** Имя сессии пригодно для поиска файла: не пусто, без разделителей пути. */
function usableId(sessionId) {
  const id = String(sessionId === null || sessionId === undefined ? '' : sessionId).trim();
  if (id === '' || id.length > 200) return '';
  if (/[\\/]/u.test(id) || id === '.' || id === '..') return '';
  return id;
}

/**
 * Факт модели сессии из проекции харнесса.
 * @returns {{provider: string|null, model: string, reasoningEffort: string|null, source: 'projcache', file: string}|null}
 */
export function sessionModelFact(sessionId, options = {}) {
  const id = usableId(sessionId);
  if (id === '') return null;
  const dir = options.dir || projcacheDir(options.env || process.env);
  const file = path.join(dir, id + '.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const row = parsed && parsed.record && parsed.record.rows && parsed.record.rows.modelSelection;
  const used = row && row.val && row.val.lastUsed;
  if (!used || typeof used.model !== 'string' || used.model.trim() === '') return null;
  return {
    provider: typeof used.provider === 'string' ? used.provider : null,
    model: used.model.trim(),
    reasoningEffort: typeof used.reasoningEffort === 'string' ? used.reasoningEffort : null,
    source: 'projcache',
    file,
  };
}

/** Рабочий каталог сессии из той же проекции (для проверок и атрибуции). */
export function sessionCwdFact(sessionId, options = {}) {
  const id = usableId(sessionId);
  if (id === '') return null;
  const dir = options.dir || projcacheDir(options.env || process.env);
  const file = path.join(dir, id + '.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const row = parsed && parsed.record && parsed.record.rows && parsed.record.rows.workingDirectory;
  const value = row && row.val;
  if (typeof value !== 'string' || value.trim() === '') return null;
  return { cwd: value.trim(), source: 'projcache', file };
}
