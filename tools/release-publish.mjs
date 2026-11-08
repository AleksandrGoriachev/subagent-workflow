#!/usr/bin/env node
/**
 * Публикация черновика (0105 / WC-68) — только после приёмки на реальном проводе.
 *
 * Публикует draft, если рядом лежит свежая квитанция dist/.smoke-<tag>.json,
 * записанная tools/release-smoke.mjs (не старше RECEIPT_TTL_MS) и с тем же тегом.
 * Нет квитанции — отказ: релиз не выходит непроверенным.
 */
import fs from 'node:fs';
import path from 'node:path';
import { githubToken } from './lib/github-token.mjs';
import { REPO, API_BASE, RECEIPT_TTL_MS } from './release-smoke.mjs';

export function readReceipt(tag, assetsDir) {
  const file = path.join(assetsDir, '.smoke-' + tag + '.json');
  if (!fs.existsSync(file)) return { ok: false, reason: 'нет квитанции ' + path.basename(file) + ': сначала tools/release-smoke.mjs ' + tag };
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ok: false, reason: 'квитанция не читается: ' + path.basename(file) };
  }
  if (receipt.tag !== tag) return { ok: false, reason: 'квитанция от другого тега: ' + receipt.tag };
  const at = Date.parse(receipt.checkedAt || '');
  if (!Number.isFinite(at)) return { ok: false, reason: 'в квитанции нет времени проверки' };
  if (Date.now() - at > RECEIPT_TTL_MS) {
    return { ok: false, reason: 'квитанция устарела (' + receipt.checkedAt + '): повторите smoke' };
  }
  return { ok: true, receipt };
}

/**
 * @param {{tag: string, token?: string, assetsDir?: string, fetchImpl?: Function, repo?: string}} options
 */
export async function publishRelease(options = {}) {
  const tag = String(options.tag || '').trim();
  if (!tag) throw new Error('не указан тег');
  const repo = options.repo || REPO;
  const assetsDir = options.assetsDir || path.join(import.meta.dirname, '..', 'dist');
  const checked = readReceipt(tag, assetsDir);
  if (!checked.ok) throw new Error(checked.reason);
  const token = options.token || githubToken();
  if (!token) throw new Error('нет токена GitHub');
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  const auth = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'workflow-release-publish' };

  /*
   * 0105: releases/tags/<tag> не отдаёт черновики (404) — а публикуем мы именно
   * черновик. Ищем по списку релизов, где draft виден, как и приёмка.
   */
  async function findRelease() {
    const lookup = await fetchImpl(API_BASE + '/repos/' + repo + '/releases/tags/' + encodeURIComponent(tag), { headers: auth });
    if (lookup.ok) return JSON.parse(Buffer.from(await lookup.arrayBuffer()).toString('utf8'));
    const list = await fetchImpl(API_BASE + '/repos/' + repo + '/releases?per_page=100', { headers: auth });
    const items = JSON.parse(Buffer.from(await list.arrayBuffer()).toString('utf8'));
    const found = (Array.isArray(items) ? items : []).find((item) => String(item && item.tag_name || '').replace(/^v/u, '') === String(tag).replace(/^v/u, ''));
    if (!found) throw new Error('релиз не найден ни среди опубликованных, ни среди черновиков: ' + tag);
    return found;
  }
  const release = await findRelease();
  if (release.draft !== true) return { ok: true, already: true, url: release.html_url || null };

  const patched = await fetchImpl(API_BASE + '/repos/' + repo + '/releases/' + release.id, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ draft: false }),
  });
  const result = JSON.parse(Buffer.from(await patched.arrayBuffer()).toString('utf8'));
  if (!patched.ok) throw new Error('публикация не выполнена: HTTP ' + patched.status + ' ' + (result.message || ''));
  return { ok: true, already: false, url: result.html_url || null, smokeAt: checked.receipt.checkedAt };
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const tag = process.argv[2] || '';
  publishRelease({ tag })
    .then((result) => console.log('PUBLISHED ' + tag + (result.already ? ' (уже опубликован)' : '') + ' ' + (result.url || '')))
    .catch((error) => { console.error(String(error && error.message ? error.message : error)); process.exitCode = 1; });
}
