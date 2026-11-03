/**
 * Внешний движок: откуда воркспейс берёт движок (2.6.9 → 2.6.14).
 *
 * 2.6.9 (0034): воркспейс без движка читает его по карте
 * `~/.dsh/workflow/engine-roots.json` (`{ "<abs workspace>": "<abs engine repo>" }`),
 * путь переопределяет env WF_ENGINE_ROOTS, а запись в такой воркспейс запрещена
 * кодом engine-external (api.js).
 *
 * 2.6.14 (0039): связь можно объявить декларативно — в конфиге плагина,
 * `engines.roots` той же формы, что карта. Порядок источников:
 *
 *   local (VERSION в воркспейсе) → config (engines.roots) → карта → absent.
 *
 * Конфиг сильнее карты: связь из конфига кнопкой не подменяется (api.js
 * отвечает 409 engine-config). Ответ резолвера называет источник:
 * {installed, mode: local|mapped|absent, root, version,
 *  source: workspace|config|mapping|none}.
 *
 * Правила модуля:
 * - чтение: конфиг и карту пишет человек/установщик/кнопка, резолвер только читает;
 * - относительные пути и записи без движка связью не считаются;
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
 * Разобрать объявление связей (карта или config.engines.roots): объект
 * `{ "<воркспейс>": "<движок>" }`. Относительные пути и дубли после
 * нормализации пропускаются, первый выигрывает.
 *
 * @param {unknown} value
 * @param {string} label имя источника для диагностики
 * @returns {{roots: Array<{workspace: string, engine: string}>,
 *            byKey: Map<string, {workspace: string, engine: string}>,
 *            skipped: string[], error: string|null}}
 */
function collectRoots(value, label) {
  const result = { roots: [], byKey: new Map(), skipped: [], error: null };
  if (value === undefined || value === null) return result;
  if (typeof value !== 'object' || Array.isArray(value)) {
    result.error = label + ': ожидается объект { "<воркспейс>": "<движок>" }';
    return result;
  }
  for (const [workspace, engine] of Object.entries(value)) {
    const workspaceKey = enginePathKey(workspace);
    const engineKey = enginePathKey(engine);
    if (workspaceKey === null || engineKey === null) {
      /* Относительные и пустые пути не разрешаем: связь — только абсолютные. */
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

/**
 * Связи, объявленные в конфиге плагина: `config.engines.roots`.
 *
 * @param {unknown} config конфиг плагина (cordis.patch.yml → config)
 * @returns {{roots: Array<{workspace: string, engine: string}>,
 *            byKey: Map<string, {workspace: string, engine: string}>,
 *            skipped: string[], error: string|null}}
 */
export function readConfigEngineRoots(config) {
  if (!config || typeof config !== 'object') {
    return { roots: [], byKey: new Map(), skipped: [], error: null };
  }
  const engines = config.engines;
  if (!engines || typeof engines !== 'object' || Array.isArray(engines)) {
    return { roots: [], byKey: new Map(), skipped: [], error: null };
  }
  return collectRoots(engines.roots, 'engines.roots');
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
    /* Файла нет — обычное состояние: движок не настроен. */
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
  const collected = collectRoots(parsed, 'engine-roots.json');
  result.roots = collected.roots;
  result.byKey = collected.byKey;
  result.skipped = collected.skipped;
  return result;
}

/**
 * Записать связь воркспейс → движок в карту атомарно: временный файл в том же
 * каталоге и переименование. После успеха посторонних файлов в каталоге карты
 * не остаётся. Битый файл карты не перезаписывается: вернуть ошибку честнее,
 * чем молча уничтожить чужие записи.
 *
 * @param {string} workspace абсолютный путь воркспейса
 * @param {string} engine абсолютный путь репозитория с движком
 * @param {{file?: string, env?: NodeJS.ProcessEnv}} [options]
 * @returns {{ok: boolean, code?: string, error?: string, file?: string,
 *            workspace?: string, engine?: string}}
 */
export function writeEngineLink(workspace, engine, options = {}) {
  const env = options.env || process.env;
  const file = options.file ? path.resolve(String(options.file)) : engineRootsFile(env);
  const workspacePath = cleanEnginePath(workspace);
  const enginePath = cleanEnginePath(engine);
  if (workspacePath === null) {
    return { ok: false, code: 'bad-workspace', error: 'воркспейс должен быть абсолютным путём: ' + String(workspace) };
  }
  if (enginePath === null) {
    return { ok: false, code: 'bad-engine', error: 'движок должен быть абсолютным путём: ' + String(engine) };
  }
  let map = {};
  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    text = null;
  }
  if (text !== null && text.trim().length > 0) {
    try {
      map = JSON.parse(text);
    } catch (error) {
      return {
        ok: false,
        code: 'map-broken',
        error: 'engine-roots.json: файл не JSON — ' + String(error && error.message ? error.message : error),
      };
    }
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      return { ok: false, code: 'map-broken', error: 'engine-roots.json: ожидается объект { "<воркспейс>": "<движок>" }' };
    }
  }
  map[workspacePath] = enginePath;
  const body = JSON.stringify(map, null, 2) + '\n';
  const dir = path.dirname(file);
  let temp = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    temp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.' + Date.now().toString(36) + '.tmp');
    fs.writeFileSync(temp, body, 'utf8');
    fs.renameSync(temp, file);
  } catch (error) {
    return {
      ok: false,
      code: 'map-write-failed',
      error: 'не удалось записать карту ' + file + ': ' + String(error && error.message ? error.message : error),
    };
  } finally {
    if (temp !== null) {
      try {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      } catch {
        /* временный файл уже переименован или недоступен */
      }
    }
  }
  return { ok: true, file, workspace: workspacePath, engine: enginePath };
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

/** Версия развёрнутой копии из маркера VERSION или null. */
export function engineVersion(root) {
  const resolved = cleanEnginePath(root);
  if (resolved === null) return null;
  try {
    const text = fs.readFileSync(path.join(resolved, ENGINE_VERSION_REL), 'utf8').trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Разрешить движок для воркспейса.
 *
 * - в воркспейсе есть docs/subagent-workflow/VERSION → mode 'local', source 'workspace';
 * - иначе объявление config.engines.roots с движком → mode 'mapped', source 'config';
 * - иначе запись карты с движком → mode 'mapped', source 'mapping';
 * - иначе mode 'absent'. Объявленная, но битая связь из конфига отдаёт
 *   source 'config' при installed: false — видно, что связь есть, но движка нет.
 *
 * @param {string|null} root воркспейс, который открыла панель
 * @param {{config?: object, file?: string, env?: NodeJS.ProcessEnv}} [options]
 * @returns {{installed: boolean, mode: 'local'|'mapped'|'absent',
 *            root: string|null, version: string|null,
 *            source: 'workspace'|'config'|'mapping'|'none',
 *            workspace: string|null, rootsFile: string, mapError: string|null,
 *            configError: string|null, mapped: string|null}}
 */
export function resolveEngine(root, options = {}) {
  const env = options.env || process.env;
  const file = options.file ? path.resolve(String(options.file)) : engineRootsFile(env);
  const workspace = cleanEnginePath(root);
  const base = {
    installed: false,
    mode: 'absent',
    root: null,
    version: null,
    source: 'none',
    workspace,
    rootsFile: file,
    mapError: null,
    configError: null,
    mapped: null,
  };
  if (workspace === null) return base;

  /* 1. Движок внутри воркспейса — сильнее любого объявления снаружи. */
  if (hasEngine(workspace)) {
    return {
      ...base,
      installed: true,
      mode: 'local',
      root: workspace,
      version: engineVersion(workspace),
      source: 'workspace',
    };
  }

  const key = enginePathKey(workspace);

  /* 2. Декларативная связь из конфига профиля. */
  const declared = readConfigEngineRoots(options.config);
  base.configError = declared.error;
  const declaredEntry = key === null ? null : declared.byKey.get(key) || null;
  if (declaredEntry) {
    base.mapped = declaredEntry.engine;
    if (hasEngine(declaredEntry.engine)) {
      return {
        ...base,
        installed: true,
        mode: 'mapped',
        root: declaredEntry.engine,
        version: engineVersion(declaredEntry.engine),
        source: 'config',
      };
    }
    /* Объявленная, но битая связь: source остаётся config — источник назван. */
    return { ...base, source: 'config' };
  }

  /* 3. Карта движков — прежний способ связать воркспейс с движком. */
  const map = readEngineRoots({ ...options, file, env });
  base.mapError = map.error;
  const entry = key === null ? null : map.byKey.get(key) || null;
  if (!entry) return base;
  base.mapped = entry.engine;
  if (!hasEngine(entry.engine)) {
    /* Карта указывает на каталог без движка: читать нечего, но и писать некуда. */
    return base;
  }
  return {
    ...base,
    installed: true,
    mode: 'mapped',
    root: entry.engine,
    version: engineVersion(entry.engine),
    source: 'mapping',
  };
}

/**
 * Проекция для /api/status: {installed, mode, version, source, root}.
 * mode и source выводятся из источника, поэтому ответ не может сказать
 * «подключён», не назвав откуда.
 */
export function engineView(engine) {
  const value = engine && typeof engine === 'object' ? engine : {};
  const installed = value.installed === true;
  const rawSource = value.source;
  const source = rawSource === 'workspace' || rawSource === 'config' || rawSource === 'mapping' || rawSource === 'none'
    ? rawSource
    : 'none';
  const mode = value.mode === 'local' || value.mode === 'mapped' || value.mode === 'absent'
    ? value.mode
    : installed
      ? (source === 'workspace' ? 'local' : 'mapped')
      : 'absent';
  return {
    installed,
    mode,
    root: value.root || null,
    version: value.version || null,
    source,
  };
}
