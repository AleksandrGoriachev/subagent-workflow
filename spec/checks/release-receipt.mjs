#!/usr/bin/env node
/**
 * 0108 (WC-74): квитанция приёмки живёт в релизе, а не в памяти агента.
 *
 * Почему: 2.6.60 был создан сразу опубликованным, минуя draft -> smoke -> publish.
 * Содержимое проверялось после, но сам обход был виден только в памяти агента —
 * то есть нигде. Теперь успешная приёмка прикладывает к релизу ассет
 * SMOKE-<tag>.json, а публикация без него отказывает.
 *
 * Проверка делает две вещи:
 *  1. статически: единственный путь, который переводит draft в published, —
 *     tools/release-publish.mjs; другой скрипт с PATCH draft:false считается обходом;
 *  2. по сети (только при --online и токене): у последних N релизов обязан быть
 *     ассет SMOKE-*.json; релиз без него вышел в обход гейта.
 *
 * Без --online проверка печатает SKIP и не красит прогон: офлайн-среда не должна
 * выглядеть нарушением.
 */
import fs from 'node:fs';
import path from 'node:path';

export const RECEIPT_RE = /^SMOKE-.*\.json$/u;

/** Статическая часть: кто вправе публиковать. */
export function scanPublishers(toolsDir) {
  const problems = [];
  const dir = String(toolsDir || '');
  if (!fs.existsSync(dir)) return [{ file: dir, reason: 'нет каталога tools' }];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.mjs')) continue;
    const file = path.join(dir, name);
    const text = fs.readFileSync(file, 'utf8');
    /* Публикация — это PATCH с draft:false; черновик создаёт draft:true. */
    const publishes = /draft\s*:\s*false/u.test(text);
    if (!publishes) continue;
    if (name === 'release-publish.mjs') continue;
    problems.push({ file: name, reason: 'переводит релиз в published в обход release-publish.mjs' });
  }
  return problems;
}

/** У релиза есть квитанция приёмки? */
export function hasReceipt(release) {
  const assets = release && Array.isArray(release.assets) ? release.assets : [];
  return assets.some((asset) => RECEIPT_RE.test(String(asset && asset.name)));
}

/**
 * Онлайн-часть: последние N релизов обязаны нести квитанцию.
 * @param {{fetchImpl?: Function, repo?: string, apiBase?: string, token?: string, limit?: number}} options
 */
export async function checkReleases(options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  const repo = options.repo || 'AleksandrGoriachev/subagent-workflow';
  const apiBase = String(options.apiBase || 'https://api.github.com').replace(/\/+$/u, '');
  const token = String(options.token || '').trim();
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 5;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'workflow-release-receipt' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetchImpl(apiBase + '/repos/' + repo + '/releases?per_page=' + limit, { headers });
  if (!response || response.ok !== true) throw new Error('GitHub не отдал список релизов: HTTP ' + (response ? response.status : '?'));
  const list = JSON.parse(Buffer.from(await response.arrayBuffer()).toString('utf8'));
  const problems = [];
  const checked = [];
  for (const release of Array.isArray(list) ? list : []) {
    if (!release || release.draft === true) continue;
    const ok = hasReceipt(release);
    checked.push({ tag: release.tag_name, ok });
    if (!ok) problems.push(release.tag_name + ': опубликован без SMOKE-<tag>.json — выпуск в обход гейта');
  }
  return { ok: problems.length === 0, problems, checked };
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const args = process.argv.slice(2);
  const online = args.includes('--online');
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const problems = scanPublishers(path.join(repoRoot, 'tools'));
  for (const problem of problems) console.log('RELEASE-RECEIPT ERROR ' + problem.file + ': ' + problem.reason);
  if (online) {
    const { githubToken } = await import('../tools/lib/github-token.mjs');
    const result = await checkReleases({ token: githubToken() || '' });
    for (const row of result.checked) console.log((row.ok ? 'OK  ' : 'ERR ') + row.tag);
    for (const problem of result.problems) console.log('RELEASE-RECEIPT ERROR ' + problem);
    if (!result.ok) process.exitCode = 1;
  } else {
    console.log('SKIP онлайн-часть: запустите с --online и токеном GitHub (проверка ассетов SMOKE-*.json у последних релизов)');
  }
  if (problems.length > 0) process.exitCode = 1;
  if (process.exitCode !== 1) console.log('release-receipt: OK — публикует только release-publish.mjs');
}
