/**
 * Внешний движок: воркспейс без движка читает его по карте (2.6.9, панель 0.9.0).
 *
 * split-optimizer — DSH-воркспейс без git и без кода (только .dsh и structure).
 * Развернуть в него движок значит изменить его, а открывать чужой воркспейс ради
 * панели нельзя. Поэтому панель читает движок снаружи по карте
 * `~/.dsh/workflow/engine-roots.json` (`{ "<abs workspace>": "<abs engine repo>" }`),
 * путь переопределяет env WF_ENGINE_ROOTS, а запись в такой воркспейс запрещена
 * кодом engine-external (api.js).
 *
 * Правила модуля:
 * - только чтение: карту пишет человек или установщик, панель её не создаёт;
 * - битый файл карты не роняет панель: это «движка нет», а не исключение;
 * - пути сравниваются без учёта регистра и хвостового слэша (Windows).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ENGINE_ROOTS_ENV = 'WF_ENGINE_ROOTS';
/** Карта воркспейс → движок; по умолчанию — в домашнем каталоге пользователя. */
export const ENGINE_ROOTS_REL = path.join('.dsh', 'workflow', 'engine-roots.json');
/** Маркер развёрнутого движка внутри репозитория. */
export const ENGINE_VERSION_REL = path.join('docs', 'subagent-workflow', 'VERSION');

/** Файл карты: env WF_ENGINE_ROOTS или <home>/.dsh/workflow/engine-roots.json. */
export function engineRootsFile(env = process.env) {
  const override = env && typeof env[ENGINE_ROOTS_ENV] === 'string' ? env[ENGINE_ROOTS_ENV].trim() : '';
  if (override.length > 0) return path.resolve(override);
  const home = (env && (env.USERPROFILE || env.HOME)) || os.homedir();
  return path.resolve(home, ENGINE_ROOTS_REL);
}

/** Абсолютный путь без хвостовых разделителей (разделитель корня диска цел). */
export function cleanEnginePath(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const raw = value.trim();
  if (!path.isAbsolute(raw)) return null;
  let resolved;
  try {
    resolved = path.resolve(raw);
  } catch {
    return null;
  }
  const root = path.parse(resolved).root || '';
  while (resolved.length > root.length && /[\\/]$/u.test(resolved)) resolved = resolved.slice(0, -1);
  return resolved.length > 0 ? resolved : null;
}

/**
 * Ключ сравнения путей: абсолютный, без хвостового слэша, без регистра на
 * Windows. Относительный или пустой путь ключом не является.
 */
export function enginePathKey(value) {
  const resolved = cleanEnginePath(value);
  if (resolved === null) return null;
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Прочитать карту. Отсутствие файла — не ошибка (движок не настроен), битый
 * JSON и не-объект — `error`, а не исключение: панель должна открыться.
 *
 * @param {{file?: string, env?: NodeJS.ProcessEnv}} [options]
 * @returns {{file: string, exists: boolean, error: string|null,
 *            roots: Array<{workspace: string, engine: string}>,
 *            byKey: Map<string, {workspace: string, engine: string}>,
 *            skipped: string[]}}
 */
export function readEngineRoots(options = {}) {
  const env = options.env || process.env;
  const file = options.file ? path.resolve(String(options.file)) : engineRootsFile(env);
  const result = { file, exists: false, error: null, roots: [], byKey: new Map(), skipped: [] };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    /* Файла нет — обычное состояние: движок не настроен. Панель карту не пишет. */
    return result;
  }
  result.exists = true;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    result.error = 'engine-roots.json: файл не JSON — ' + String(error && error.message ? error.message : error);
    return result;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    result.error = 'engine-roots.json: ожидается объект { "<воркспейс>": "<движок>" }';
    return result;
  }
  for (const [workspace, engine] of Object.entries(parsed)) {
    const workspaceKey = enginePathKey(workspace);
    const engineKey = enginePathKey(engine);
    if (workspaceKey === null || engineKey === null) {
      /* Относительные и непустые пути не разрешаем: карта — только абсолютные. */
      result.skipped.push(String(workspace));
      continue;
    }
    if (result.byKey.has(workspaceKey)) {
      /* Дубль после нормализации (регистр/хвостовой слэш): первый выигрывает. */
      result.skipped.push(String(workspace));
      continue;
    }
    const entry = { workspace: cleanEnginePath(workspace), engine: cleanEnginePath(engine) };
    result.byKey.set(workspaceKey, entry);
    result.roots.push(entry);
  }
  return result;
}

/** Есть ли движок в этом каталоге (маркер — VERSION развёрнутой копии). */
export function hasEngine(root) {
  const resolved = cleanEnginePath(root);
  if (resolved === null) return false;
  try {
    return fs.existsSync(path.join(resolved, ENGINE_VERSION_REL));
  } catch {
    return false;
  }
}

/**
 * Разрешить движок для воркспейса.
 *
 * - в воркспейсе есть docs/subagent-workflow/VERSION → source 'workspace';
 * - иначе запись карты, у которой движок на месте → source 'mapping';
 * - иначе installed: false, source 'none'.
 *
 * @param {string|null} root воркспейс, который открыла панель
 * @param {{file?: string, env?: NodeJS.ProcessEnv}} [options]
 * @returns {{installed: boolean, root: string|null, source: 'workspace'|'mapping'|'none',
 *            workspace: string|null, rootsFile: string, mapError: string|null,
 *            mapped: string|null}}
 */
export function resolveEngine(root, options = {}) {
  const env = options.env || process.env;
  const file = options.file ? path.resolve(String(options.file)) : engineRootsFile(env);
  const workspace = cleanEnginePath(root);
  const base = {
    installed: false,
    root: null,
    source: 'none',
    workspace,
    rootsFile: file,
    mapError: null,
    mapped: null,
  };
  if (workspace === null) return base;
  if (hasEngine(workspace)) {
    return { ...base, installed: true, root: workspace, source: 'workspace' };
  }
  const map = readEngineRoots({ ...options, file });
  base.mapError = map.error;
  const key = enginePathKey(workspace);
  const entry = key === null ? null : map.byKey.get(key) || null;
  if (!entry) return base;
  base.mapped = entry.engine;
  if (!hasEngine(entry.engine)) {
    /* Карта указывает на каталог без движка: читать нечего, но и писать некуда. */
    return base;
  }
  return { ...base, installed: true, root: entry.engine, source: 'mapping' };
}

/** Проекция для /api/status: ровно контракт {installed, root, source}. */
export function engineView(engine) {
  const value = engine && typeof engine === 'object' ? engine : {};
  return {
    installed: value.installed === true,
    root: value.root || null,
    source: value.source === 'workspace' || value.source === 'mapping' ? value.source : 'none',
  };
}
