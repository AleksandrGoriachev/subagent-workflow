/**
 * Обновление самого плагина из релиза (WC-52, задание 0079).
 *
 * Панель — отдельный пакет, и до этой правки её можно было обновить только
 * вручную: кнопки /api/update обновляют движок, а вложенная спека панели
 * оставалась прежней. Отсюда тупик «сборка панели старше движка»: движок уже
 * новее, понижать его панель отказывается, а обновить сам пакет нечем.
 *
 * Здесь — установка нового пакета dsh-workflow-console из последнего релиза
 * GitHub: скачать tarball и его .sha256, сверить, развернуть во временный
 * каталог, затем заменить каталог плагина в профиле, сохранив прежний как
 * .dsh-plugin-backup-<версия>-<время>. Для link/junction-установок (dev-копия
 * из репозитория) замена запрещена: код принадлежит рабочему дереву, не профилю.
 *
 * Сеть — только fetch (fetchImpl подменяется в тестах); локальный tarball
 * (options.file) позволяет обновляться без сети. Процессов модуль не запускает.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractTarGz, sha256Hex } from './archive.mjs';
import { fetchWithRetry } from './fetch-retry.mjs';

/** Имя стабильного ассета релиза: его же указывает workflowInstallSpec. */
export const PLUGIN_ASSET_NAME = 'dsh-workflow-console.tgz';
/** Имя пакета: каталог в node_modules профиля. */
export const PLUGIN_PACKAGE_NAME = 'dsh-workflow-console';

function textOf(error) {
  return error && error.message ? error.message : String(error);
}

function trimBase(value) {
  return String(value === null || value === undefined ? '' : value).trim().replace(/\/+$/u, '');
}

/** Путь из архива без абсолютных путей и '..'. */
function safeParts(name) {
  const normalized = String(name).replace(/\\/gu, '/');
  if (normalized.startsWith('/') || /^[a-z]:/iu.test(normalized)) {
    throw new Error('архив плагина содержит абсолютный путь: ' + name);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..')) {
    throw new Error('архив плагина содержит путь с ..: ' + name);
  }
  return parts.filter((part) => part !== '' && part !== '.');
}

/**
 * Ассеты релиза: стабильный tarball плагина и его .sha256.
 *
 * @param {object} json ответ releases/latest
 * @returns {{version: string, tag: string, tarballUrl: string, sha256Url: string}}
 */
export function selectPluginAssets(json) {
  const release = json && typeof json === 'object' ? json : {};
  const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
  if (tag === '') throw new Error('в релизе нет tag_name');
  const version = tag.replace(/^v/iu, '');
  if (version === '') throw new Error('в релизе пустой tag_name');
  const assets = Array.isArray(release.assets) ? release.assets.filter((item) => item && typeof item.name === 'string') : [];
  const tarball = assets.find((item) => item.name === PLUGIN_ASSET_NAME);
  if (!tarball) {
    const names = assets.map((item) => item.name).join(', ');
    throw new Error('в релизе ' + tag + ' нет ассета ' + PLUGIN_ASSET_NAME
      + (names ? ' (ассеты: ' + names + ')' : ''));
  }
  const sha = assets.find((item) => item.name === PLUGIN_ASSET_NAME + '.sha256');
  if (!sha) throw new Error('в релизе ' + tag + ' нет ассета ' + PLUGIN_ASSET_NAME + '.sha256');
  const tarballUrl = typeof tarball.browser_download_url === 'string' ? tarball.browser_download_url : '';
  const sha256Url = typeof sha.browser_download_url === 'string' ? sha.browser_download_url : '';
  if (tarballUrl === '') throw new Error('у ассета ' + PLUGIN_ASSET_NAME + ' нет browser_download_url');
  if (sha256Url === '') throw new Error('у ассета ' + PLUGIN_ASSET_NAME + '.sha256 нет browser_download_url');
  return { version, tag, tarballUrl, sha256Url };
}

/**
 * Развернуть tarball плагина в файлы пакета (common top dir срезается).
 *
 * @param {Buffer} buffer содержимое .tgz
 * @returns {{files: Map<string, Buffer>, version: string}}
 */
export function readPluginFiles(buffer) {
  const raw = extractTarGz(buffer);
  if (raw.size === 0) throw new Error('архив плагина пуст');
  const first = raw.keys().next().value;
  const slash = first.indexOf('/');
  const top = slash > 0 ? first.slice(0, slash) : '';
  const shared = top !== '' && [...raw.keys()].every((name) => name === top || name.startsWith(top + '/'));
  const files = new Map();
  for (const [name, data] of raw) {
    const parts = safeParts(shared ? name.slice(top.length + 1) : name);
    if (parts.length === 0) continue;
    files.set(parts.join('/'), data);
  }
  const manifest = files.get('package.json');
  if (!manifest) throw new Error('в архиве плагина нет package.json');
  let version = '';
  try {
    version = String(JSON.parse(manifest.toString('utf8')).version || '').trim();
  } catch (error) {
    throw new Error('package.json в архиве не JSON: ' + textOf(error));
  }
  if (version === '') throw new Error('в архиве плагина пустая версия');
  if (!files.has('lib/index.js')) throw new Error('в архиве плагина нет lib/index.js');
  return { files, version };
}

/**
 * Куда установлен плагин: обычный каталог профиля или ссылка на рабочее дерево.
 *
 * Junction в Node виден как символическая ссылка, поэтому сверяем realpath:
 * для link-установки замена каталога запрещена — это чужой код.
 *
 * @param {string} packageRoot каталог установленного пакета
 * @returns {{mode: 'dir'|'linked'|'missing', realPath: string|null, hint?: string}}
 */
export function pluginInstallMode(packageRoot) {
  const root = path.resolve(String(packageRoot));
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch {
    return { mode: 'missing', realPath: null, hint: 'каталог плагина не найден: ' + root };
  }
  try {
    const real = fs.realpathSync(root);
    if (path.resolve(real) !== root) {
      return {
        mode: 'linked',
        realPath: real,
        hint: 'плагин связан с рабочим деревом (' + real + '): обновляйте его в репозитории и перезапускайте DSH, устанавливать пакет поверх нельзя',
      };
    }
  } catch (error) {
    return { mode: 'missing', realPath: null, hint: 'не удалось разрешить путь плагина: ' + textOf(error) };
  }
  if (!stat.isDirectory()) return { mode: 'missing', realPath: root, hint: 'плагин не каталог: ' + root };
  return { mode: 'dir', realPath: root };
}

/** Временный каталог с распакованными файлами пакета. */
export function stagePluginFiles(files, prefix = 'wf-plugin-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [name, data] of files) {
    const parts = safeParts(name);
    const target = path.join(dir, ...parts);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  return dir;
}

/**
 * Каталог внутри git-рабочего дерева? Возвращает корень дерева или null.
 *
 * Нужно, чтобы установка пакета не перезаписала исходники: плагин часто
 * связан с репозиторием (junction), и Node разрешает путь через ссылку, из-за
 * чего режим 'linked' не виден. Проверка по .git не зависит от того, как
 * каталог попал сюда.
 */
export function insideGitWorktree(dir) {
  let current = path.resolve(String(dir));
  for (let depth = 0; depth < 12; depth += 1) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Записать файлы пакета в каталог плагина, сохранив прежнее состояние.
 *
 * 0089 (WC-63): каталог больше не заменяется целиком. Раньше он уезжал в
 * .dsh-plugin-backup-*, а на его место вставал только пакет — то есть всё, чего
 * нет в tarball (тесты, бэклог, локальные настройки), исчезало из дерева.
 * Теперь: копия в бэкап, файлы пакета перезаписываются на месте, посторонние
 * остаются. Установка в git-рабочее дерево запрещена без force.
 *
 * @param {{files: Map<string, Buffer>, packageRoot: string, version: string, now?: number, force?: boolean}} options
 * @returns {{backupDir: string, backupName: string, written: number, leftovers: string[]}}
 */
export function installPluginFiles({ files, packageRoot, version, now = Date.now(), force = false }) {
  const target = path.resolve(String(packageRoot));
  const worktree = insideGitWorktree(target);
  if (worktree && force !== true) {
    const error = new Error('каталог плагина — рабочее дерево git (' + worktree
      + '): установка пакета перезаписала бы исходники. Обновите код в репозитории и перезапустите DSH');
    error.code = 'plugin-dev-tree';
    error.worktree = worktree;
    throw error;
  }
  const parent = path.dirname(target);
  const safeVersion = String(version || 'unknown').replace(/[^0-9a-z.\-]/giu, '_');
  let backupName = '.dsh-plugin-backup-' + safeVersion + '-' + now;
  let backupDir = path.join(parent, backupName);
  let attempt = 0;
  while (fs.existsSync(backupDir)) {
    attempt += 1;
    backupName = '.dsh-plugin-backup-' + safeVersion + '-' + now + '-' + attempt;
    backupDir = path.join(parent, backupName);
  }
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(target, backupDir, { recursive: true });
  const written = [];
  const known = new Set();
  try {
    for (const [name, data] of files) {
      const parts = safeParts(name);
      const rel = parts.join('/');
      const dest = path.join(target, ...parts);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
      written.push(rel);
      known.add(rel);
    }
  } catch (error) {
    for (const rel of written) {
      const parts = rel.split('/');
      try {
        const source = path.join(backupDir, ...parts);
        const dest = path.join(target, ...parts);
        if (fs.existsSync(source)) fs.copyFileSync(source, dest);
        else fs.rmSync(dest, { force: true });
      } catch {
        /* частичное восстановление: полный бэкап остался на диске */
      }
    }
    throw error;
  }
  const leftovers = [];
  const walk = (rel) => {
    const dir = rel === '' ? target : path.join(target, ...rel.split('/'));
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = rel === '' ? entry.name : rel + '/' + entry.name;
      if (entry.isDirectory()) walk(child);
      else if (!known.has(child)) leftovers.push(child);
    }
  };
  try {
    walk('');
  } catch {
    /* перечисление остатка — отчётность, не условие установки */
  }
  return { backupDir, backupName, written: written.length, leftovers };
}

/* 0101: повтор и таймаут — см. fetch-retry.mjs; причина называется словами. */
async function download(fetchImpl, url, label) {
  const response = await fetchWithRetry(fetchImpl, url, {
    label,
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'dsh-workflow-console' },
  }).catch((error) => {
    throw new Error('не удалось скачать ' + label + ': ' + textOf(error));
  });
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Подготовить файлы плагина: из локального tarball или из последнего релиза.
 *
 * @param {{apiBase?: string, repo?: string, fetchImpl?: Function, file?: string}} [options]
 * @returns {Promise<{files: Map<string, Buffer>, version: string, tag: string|null}>}
 */
export async function preparePluginTarball(options = {}) {
  if (typeof options.file === 'string' && options.file.trim() !== '') {
    const file = path.resolve(options.file.trim());
    const buffer = fs.readFileSync(file);
    const { files, version } = readPluginFiles(buffer);
    return { files, version, tag: null };
  }
  const apiBase = trimBase(options.apiBase) || 'https://api.github.com';
  const repo = String(options.repo || '').trim().replace(/^\/+|\/+$/gu, '');
  if (repo === '') throw new Error('repo пуст');
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('нет fetch для скачивания релиза плагина');

  const latestUrl = apiBase + '/repos/' + repo + '/releases/latest';
  let latest;
  try {
    latest = JSON.parse((await download(fetchImpl, latestUrl, 'описание последнего релиза')).toString('utf8'));
  } catch (error) {
    if (error && /не удалось скачать/u.test(textOf(error))) throw error;
    throw new Error('описание последнего релиза не JSON: ' + textOf(error));
  }
  const parsed = selectPluginAssets(latest);
  const payload = await download(fetchImpl, parsed.tarballUrl, 'tarball плагина ' + parsed.version);
  const shaText = (await download(fetchImpl, parsed.sha256Url, 'sha256 плагина ' + parsed.version)).toString('utf8');
  const expected = String(shaText).trim().split(/\s+/u)[0] || '';
  if (!/^[0-9a-f]{64}$/iu.test(expected)) {
    throw new Error('файл sha256 не содержит 64-символьный hex');
  }
  const actual = sha256Hex(payload);
  if (actual !== expected.toLowerCase()) {
    throw new Error('sha256 tarball плагина не совпадает: ожидался ' + expected + ', получен ' + actual + ' — архив не разворачивается');
  }
  const { files, version } = readPluginFiles(payload);
  return { files, version, tag: parsed.tag };
}
