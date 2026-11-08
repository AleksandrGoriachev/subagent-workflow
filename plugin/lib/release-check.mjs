/**
 * Проверка актуальности релиза (0102 / WC-65).
 *
 * Панель умела говорить только «движок в воркспейсе vX, в сборке vY»: это пара
 * «установлено ↔ вшито в панель», а не «есть ли новее в релизе». Пользователь
 * видел «актуально» там, где релиз уже ушёл вперёд, и наоборот.
 *
 * Здесь — один сетевой запрос к releases/latest: API отдаёт килобайты JSON, а
 * не 400 КБ tarball (замер 08.11: 420 мс против 15 с и таймаутов при том же
 * прокси). Отдельно ведётся кэш последней удачной проверки: сеть упала — панель
 * показывает «последняя удачная проверка 18:40: движок 2.6.52», а не пустоту.
 *
 * Сеть — только fetch; fetchImpl подменяется в тестах.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchWithRetry } from './fetch-retry.mjs';

/** Репозиторий релизов движка и панели. */
export const RELEASE_REPO = 'AleksandrGoriachev/subagent-workflow';
/** База GitHub API. */
export const RELEASE_API_BASE = 'https://api.github.com';

/** Файл кэша: последняя удачная проверка. Переопределяется WF_RELEASE_CACHE. */
export function releaseCacheFile(env = process.env) {
  const override = env.WF_RELEASE_CACHE;
  if (typeof override === 'string' && override.trim() !== '') return path.resolve(override.trim());
  return path.join(os.homedir(), '.dsh', 'workflow-console', 'latest-release.json');
}

function versionText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') return null;
  return text.replace(/^v/iu, '') || null;
}

/**
 * Версии из ответа releases/latest: движок — tag_name, панель — имя
 * версионированного ассета dsh-workflow-console-<x.y.z>.tgz.
 */
export function parseLatestRelease(json) {
  const release = json && typeof json === 'object' ? json : {};
  const engine = versionText(release.tag_name);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  let plugin = null;
  for (const asset of assets) {
    if (!asset || typeof asset.name !== 'string') continue;
    const match = asset.name.match(/^dsh-workflow-console-(\d+\.\d+\.\d+)\.tgz$/u);
    if (match) { plugin = match[1]; break; }
  }
  const publishedAt = typeof release.published_at === 'string' && release.published_at.trim()
    ? release.published_at.trim()
    : null;
  return { plugin, engine, publishedAt };
}

/** Кэш последней удачной пары: { at, plugin, engine, publishedAt } или null. */
export function readCachedRelease(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(releaseCacheFile(env), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const plugin = versionText(parsed.plugin);
    const engine = versionText(parsed.engine);
    if (!plugin && !engine) return null;
    return {
      at: typeof parsed.at === 'string' ? parsed.at : null,
      plugin,
      engine,
      publishedAt: typeof parsed.publishedAt === 'string' ? parsed.publishedAt : null,
    };
  } catch {
    return null;
  }
}

/** Записать кэш; ошибка записи не роняет проверку — кэш это удобство. */
export function writeCachedRelease(latest, env = process.env, now = new Date()) {
  const at = now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
  const payload = { at, plugin: latest && latest.plugin ? latest.plugin : null, engine: latest && latest.engine ? latest.engine : null };
  if (latest && latest.publishedAt) payload.publishedAt = latest.publishedAt;
  try {
    const file = releaseCacheFile(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
    return payload;
  } catch {
    return null;
  }
}

/**
 * Один запрос к API: 1–2 попытки, таймаут 12 с.
 * @returns {Promise<{plugin: string|null, engine: string, publishedAt: string|null, checkedAt: string}>}
 */
export async function checkLatestRelease(options = {}) {
  const repo = String(options.repo || RELEASE_REPO).trim().replace(/^\/+|\/+$/gu, '');
  const apiBase = String(options.apiBase || RELEASE_API_BASE).trim().replace(/\/+$/u, '');
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 12000;
  const attempts = Number(options.attempts) > 0 ? Number(options.attempts) : 2;
  const url = apiBase + '/repos/' + repo + '/releases/latest';
  const response = await fetchWithRetry(fetchImpl, url, {
    label: 'описание последнего релиза',
    timeoutMs,
    attempts,
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-workflow-console' },
  });
  let json;
  try {
    json = JSON.parse(Buffer.from(await response.arrayBuffer()).toString('utf8'));
  } catch (error) {
    throw new Error('ответ releases/latest не JSON: ' + (error && error.message ? error.message : String(error)));
  }
  const parsed = parseLatestRelease(json);
  if (!parsed.engine && !parsed.plugin) throw new Error('в релизе нет ни tag_name, ни версии панели в ассетах');
  return { ...parsed, checkedAt: new Date().toISOString() };
}

/**
 * Ответ маршрута: проверка + кэш. Ошибка сети не скрывается и не стирает кэш —
 * возвращается последняя удачная пара с пометкой.
 */
export async function releaseCheckPayload(options = {}) {
  const env = options.env || process.env;
  const cached = readCachedRelease(env);
  try {
    const latest = await checkLatestRelease(options);
    writeCachedRelease(latest, env, options.now);
    return {
      ok: true,
      latest: { plugin: latest.plugin, engine: latest.engine, publishedAt: latest.publishedAt },
      checkedAt: latest.checkedAt,
      cached: false,
      previous: cached ? { plugin: cached.plugin, engine: cached.engine, at: cached.at } : null,
      error: null,
      fix: null,
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return {
      ok: false,
      latest: cached ? { plugin: cached.plugin, engine: cached.engine, publishedAt: cached.publishedAt } : null,
      checkedAt: cached ? cached.at : null,
      cached: Boolean(cached),
      previous: null,
      error: 'не удалось прочитать релиз: ' + message,
      fix: cached
        ? 'Последняя удачная проверка: ' + cached.at + '. Повторите позже — сеть до GitHub недоступна, установка и развёртывание от этого не зависят.'
        : 'Проверьте сеть и повторите. Установка и развёртывание от этой проверки не зависят.',
    };
  }
}
