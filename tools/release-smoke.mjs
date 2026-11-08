#!/usr/bin/env node
/**
 * Приёмка релиза на реальном проводе — до публикации (0105 / WC-68).
 *
 * Зачем: дефект 2.6.53 (Accept: octet-stream на JSON-адрес) прошёл все тесты и
 * нашёлся только на первом живом обновлении, уже после публикации. Гейт ставит
 * проверку ДО выхода: черновик релиза (draft) виден по API и ссылкам так же, как
 * опубликованный, поэтому весь путь можно прогнать на нём.
 *
 * Проверяется то, что реально ломается:
 *  1. releases/tags/<tag> отвечает 200 и отдаёт ожидаемый tag_name;
 *  2. набор ассетов полный (движок tar.gz + zip, панель .tgz, по паре .sha256);
 *  3. скачанные байты совпадают с опубликованными .sha256 и с локальными файлами;
 *  4. VERSION внутри tarball движка равен тегу.
 *
 * Успех пишет квитанцию dist/.smoke-<tag>.json: публикация без свежей квитанции
 * запрещена (tools/release-publish.mjs).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { extractTarGz } from '../plugin/lib/archive.mjs';
import { checkLatestRelease } from '../plugin/lib/release-check.mjs';

export const REPO = 'AleksandrGoriachev/subagent-workflow';
export const API_BASE = 'https://api.github.com';
export const RECEIPT_TTL_MS = 30 * 60 * 1000;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function responseText(response) {
  return Buffer.from(response.arrayBuffer ? response.arrayBufferSync ? response.arrayBufferSync() : null : null);
}

async function readBody(response) {
  if (!response || typeof response.arrayBuffer !== 'function') return Buffer.alloc(0);
  return Buffer.from(await response.arrayBuffer());
}

function authHeaders(token) {
  return token ? { Authorization: 'Bearer ' + token } : {};
}

async function getJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'workflow-release-smoke', ...authHeaders(token) },
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' на ' + url);
  return JSON.parse((await readBody(response)).toString('utf8'));
}

async function getBytes(fetchImpl, url, token) {
  /* Ассеты черновика закрыты авторизацией: без токена 404 — это не «ассета нет». */
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'workflow-release-smoke', ...authHeaders(token) },
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' на ' + url);
  return readBody(response);
}

function assetsByName(release) {
  const map = new Map();
  const list = Array.isArray(release && release.assets) ? release.assets : [];
  for (const asset of list) {
    if (!asset || typeof asset.name !== 'string') continue;
    map.set(asset.name, asset.browser_download_url || asset.url || '');
  }
  return map;
}

/** Ожидаемый набор имён ассетов для тега и версии панели. */
export function expectedAssets(tag, panelVersion) {
  const version = String(tag || '').replace(/^v/u, '');
  return [
    'subagent-workflow-' + version + '.tar.gz',
    'subagent-workflow-' + version + '.tar.gz.sha256',
    'subagent-workflow-' + version + '.zip',
    'subagent-workflow-' + version + '.zip.sha256',
    'dsh-workflow-console.tgz',
    'dsh-workflow-console.tgz.sha256',
    'dsh-workflow-console-' + panelVersion + '.tgz',
    'dsh-workflow-console-' + panelVersion + '.tgz.sha256',
  ];
}

/** sha256 из файла .sha256 вида «<hex>  <имя>». */
export function shaFromFile(text) {
  const match = String(text || '').trim().match(/^([0-9a-f]{64})/iu);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Проверка черновика/релиза на реальном проводе.
 * @returns {Promise<{ok: true, tag: string, receipt: object}>}
 */
export async function smokeRelease(options = {}) {
  const tag = String(options.tag || '').trim();
  if (!tag) throw new Error('не указан тег');
  const repo = options.repo || REPO;
  const apiBase = optionalBase(options.apiBase || API_BASE);
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  const panelVersion = String(options.panelVersion || '')
    || JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'plugin', 'package.json'), 'utf8')).version;
  const assetsDir = options.assetsDir || path.join(import.meta.dirname, '..', 'dist');

  const token = typeof options.token === 'string' && options.token.trim() !== '' ? options.token.trim() : '';
  const release = await getJson(fetchImpl, apiBase + '/repos/' + repo + '/releases/tags/' + encodeURIComponent(tag), token);
  const problems = [];
  const expectedTag = String(tag).replace(/^v/u, '');
  if (String(release.tag_name || '').replace(/^v/u, '') !== expectedTag) {
    problems.push('tag_name отвечает ' + release.tag_name + ', ожидался ' + tag);
  }
  const assets = assetsByName(release);
  const wanted = expectedAssets(tag, panelVersion);
  for (const name of wanted) {
    if (!assets.has(name)) problems.push('нет ассета ' + name);
  }

  const hashes = {};
  /* Панель: байты против .sha256 из релиза и против локальной сборки. */
  const panelName = 'dsh-workflow-console-' + panelVersion + '.tgz';
  if (assets.has(panelName) && assets.has(panelName + '.sha256')) {
    const bytes = await getBytes(fetchImpl, assets.get(panelName), token);
    const hash = sha256(bytes);
    hashes[panelName] = hash;
    const declared = shaFromFile((await getBytes(fetchImpl, assets.get(panelName + '.sha256'), token)).toString('utf8'));
    if (!declared) problems.push('файл ' + panelName + '.sha256 без хеша');
    else if (declared !== hash) problems.push('sha256 ' + panelName + ' не совпал с .sha256 релиза');
    const localFile = path.join(assetsDir, panelName);
    if (fs.existsSync(localFile) && sha256(fs.readFileSync(localFile)) !== hash) {
      problems.push('ассет ' + panelName + ' в релизе не равен локальной сборке');
    }
  }

  /* Движок: байты, .sha256 и VERSION внутри архива. */
  const engineName = 'subagent-workflow-' + expectedTag + '.tar.gz';
  if (assets.has(engineName) && assets.has(engineName + '.sha256')) {
    const bytes = await getBytes(fetchImpl, assets.get(engineName), token);
    const hash = sha256(bytes);
    hashes[engineName] = hash;
    const declared = shaFromFile((await getBytes(fetchImpl, assets.get(engineName + '.sha256'), token)).toString('utf8'));
    if (!declared) problems.push('файл ' + engineName + '.sha256 без хеша');
    else if (declared !== hash) problems.push('sha256 ' + engineName + ' не совпал с .sha256 релиза');
    const localFile = path.join(assetsDir, engineName);
    if (fs.existsSync(localFile) && sha256(fs.readFileSync(localFile)) !== hash) {
      problems.push('ассет ' + engineName + ' в релизе не равен локальной сборке');
    }
    const files = extractTarGz(bytes);
    const versionEntry = [...files.entries()].find(([name]) => name.endsWith('/VERSION') || name === 'VERSION');
    const inside = versionEntry ? Buffer.from(versionEntry[1]).toString('utf8').trim() : '';
    if (inside !== expectedTag) problems.push('VERSION в архиве движка «' + inside + '», ожидался ' + expectedTag);
  }

  if (problems.length > 0) {
    const error = new Error('приёмка релиза не пройдена: ' + problems.join('; '));
    error.problems = problems;
    throw error;
  }

  const receipt = {
    ok: true,
    tag,
    repo,
    draft: release.draft === true,
    checkedAt: new Date().toISOString(),
    assets: wanted.length,
    hashes,
    panelVersion,
    url: release.html_url || null,
  };
  const receiptFile = path.join(assetsDir, '.smoke-' + tag + '.json');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
  return { ok: true, tag, receipt, receiptFile };
}

function optionalBase(value) {
  return String(value || '').replace(/\/+$/u, '');
}

/** Манифест локальной сборки: что должно уехать в релиз. */
export function localAssets(assetsDir) {
  if (!fs.existsSync(assetsDir)) return [];
  return fs.readdirSync(assetsDir)
    .filter((name) => /\.(tgz|tar\.gz|zip)$/u.test(name))
    .map((name) => path.join(assetsDir, name));
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const tag = process.argv[2] || '';
  const { githubToken } = await import('./lib/github-token.mjs');
  smokeRelease({ tag, token: githubToken() || '' })
    .then((result) => {
      console.log('SMOKE OK ' + result.tag + ' — квитанция ' + path.basename(result.receiptFile));
    })
    .catch((error) => {
      console.error(String(error && error.message ? error.message : error));
      process.exitCode = 1;
    });
}
