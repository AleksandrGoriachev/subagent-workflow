/**
 * Движок из последнего релиза GitHub (0067).
 *
 * Панель не может взять свежий движок из собственной сборки: в vendor/spec
 * лежит версия, совпадающая с установленной. Этот модуль находит релиз,
 * скачивает tarball движка, сверяет sha256 и разворачивает его во временный
 * каталог; маршрут /api/update дальше передаёт specRoot в init --force.
 *
 * Сеть — только fetch (без процессов и пайпов). fetchImpl можно подменить в
 * тестах; по умолчанию — globalThis.fetch.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractTarGz, sha256Hex } from './archive.mjs';

export const DEFAULT_API_BASE = 'https://api.github.com';
export const DEFAULT_REPO = 'AleksandrGoriachev/subagent-workflow';
export const TARBALL_ASSET = /^subagent-workflow-.*\.tar\.gz$/;

function trimBase(value) {
  return String(value === null || value === undefined ? '' : value).trim().replace(/\/+$/u, '');
}

function textOf(error) {
  return error && error.message ? error.message : String(error);
}

/**
 * Разобрать ответ releases/latest: версия без ведущей v, ссылки на tarball и
 * его .sha256. Нет ассетов — ошибка с именами, которые пришли.
 *
 * @param {object} json ответ GitHub releases/latest
 * @returns {{version: string, tag: string, tarballUrl: string, sha256Url: string}}
 */
export function parseLatestRelease(json) {
  const release = json && typeof json === 'object' ? json : {};
  const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
  if (tag === '') throw new Error('в релизе нет tag_name');
  const version = tag.replace(/^v/iu, '');
  if (version === '') throw new Error('в релизе пустой tag_name');
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const named = assets.filter((asset) => asset && typeof asset.name === 'string');
  const tarball = named.find((asset) => TARBALL_ASSET.test(asset.name));
  if (!tarball) {
    const names = named.map((asset) => asset.name).join(', ');
    throw new Error('в релизе ' + tag + ' нет ассета subagent-workflow-*.tar.gz'
      + (names ? ' (ассеты: ' + names + ')' : ''));
  }
  const shaName = tarball.name + '.sha256';
  const sha = named.find((asset) => asset.name === shaName);
  if (!sha) {
    throw new Error('в релизе ' + tag + ' нет ассета ' + shaName);
  }
  const tarballUrl = typeof tarball.browser_download_url === 'string' ? tarball.browser_download_url : '';
  const sha256Url = typeof sha.browser_download_url === 'string' ? sha.browser_download_url : '';
  if (tarballUrl === '') throw new Error('у ассета ' + tarball.name + ' нет browser_download_url');
  if (sha256Url === '') throw new Error('у ассета ' + shaName + ' нет browser_download_url');
  return { version, tag, tarballUrl, sha256Url };
}

/** Первый токен файла sha256: формат '<hex>  <имя>'. */
function expectedSha(text) {
  const token = String(text || '').trim().split(/\s+/u)[0] || '';
  if (!/^[0-9a-f]{64}$/iu.test(token)) {
    throw new Error('файл sha256 не содержит 64-символьный hex: ' + String(text || '').slice(0, 80));
  }
  return token.toLowerCase();
}

async function download(fetchImpl, url, label) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error('не удалось скачать ' + label + ': ' + textOf(error));
  }
  if (!response || response.ok !== true) {
    throw new Error('не удалось скачать ' + label + ': HTTP ' + (response ? response.status : '?')
      + ' ' + String(url));
  }
  return Buffer.from(await response.arrayBuffer());
}

function safeEntryPath(name) {
  const normalized = String(name).replace(/\\/gu, '/');
  if (normalized.startsWith('/') || /^[a-z]:/iu.test(normalized)) {
    throw new Error('архив содержит абсолютный путь: ' + name);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..')) {
    throw new Error('архив содержит путь с ..: ' + name);
  }
  return parts.filter((part) => part !== '' && part !== '.');
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
  } catch {
    /* временный каталог уберёт ОС; проверенное поведение это не отменяет */
  }
}

/**
 * Скачать и развернуть движок из последнего релиза.
 *
 * Проверяет sha256 до распаковки (расхождение — ошибка, на диск ничего не
 * пишется), срезает общий верхний каталог архива и требует VERSION и
 * scripts/init.mjs. Возвращает specRoot — каталог, который init --force
 * принимает наравне с vendor/spec, и cleanup для временного каталога.
 *
 * @param {{apiBase?: string, repo?: string, fetchImpl?: Function}} [options]
 * @returns {Promise<{specRoot: string, version: string, cleanup: Function}>}
 */
export async function prepareEngineSpec(options = {}) {
  const apiBase = trimBase(options.apiBase || DEFAULT_API_BASE);
  const repo = String(options.repo || DEFAULT_REPO).trim().replace(/^\/+|\/+$/gu, '');
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('нет fetch: нужен Node.js с глобальным fetch или fetchImpl');
  }
  if (apiBase === '') throw new Error('apiBase пуст');
  if (repo === '') throw new Error('repo пуст');

  const latestUrl = apiBase + '/repos/' + repo + '/releases/latest';
  let latest;
  try {
    latest = JSON.parse((await download(fetchImpl, latestUrl, 'описание последнего релиза')).toString('utf8'));
  } catch (error) {
    if (error && /не удалось скачать/u.test(textOf(error))) throw error;
    throw new Error('описание последнего релиза не JSON: ' + textOf(error));
  }
  const parsed = parseLatestRelease(latest);
  const payload = await download(fetchImpl, parsed.tarballUrl, 'tarball движка ' + parsed.version);
  const shaText = (await download(fetchImpl, parsed.sha256Url, 'sha256 релиза ' + parsed.version)).toString('utf8');
  const expected = expectedSha(shaText);
  const actual = sha256Hex(payload);
  if (actual !== expected) {
    throw new Error('sha256 tarball не совпадает: ожидался ' + expected + ', получен ' + actual
      + ' — архив не разворачивается');
  }

  const files = extractTarGz(payload);
  if (files.size === 0) throw new Error('архив движка пуст');
  const first = files.keys().next().value;
  const slash = first.indexOf('/');
  const top = slash > 0 ? first.slice(0, slash) : '';
  const shared = top !== '' && [...files.keys()].every((name) => name === top || name.startsWith(top + '/'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-release-'));
  try {
    for (const [name, data] of files) {
      const parts = safeEntryPath(shared ? name.slice(top.length + 1) : name);
      if (parts.length === 0) continue;
      const target = path.join(root, ...parts);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    const specCandidates = [path.join(root, 'spec'), root];
    const specRoot = specCandidates.find((dir) => fs.existsSync(path.join(dir, 'scripts', 'init.mjs')));
    if (!specRoot) {
      throw new Error('в архиве нет движка: scripts/init.mjs не найден');
    }
    const versionFiles = [path.join(root, 'VERSION'), path.join(specRoot, '..', 'VERSION'), path.join(specRoot, 'VERSION')];
    const versionFile = versionFiles.find((file) => fs.existsSync(file));
    if (!versionFile) throw new Error('в архиве нет VERSION');
    const versionText = fs.readFileSync(versionFile, 'utf8').trim();
    if (versionText === '') throw new Error('в архиве пустой VERSION');
    return {
      specRoot,
      version: versionText,
      cleanup: () => removeDir(root),
    };
  } catch (error) {
    removeDir(root);
    throw error;
  }
}
