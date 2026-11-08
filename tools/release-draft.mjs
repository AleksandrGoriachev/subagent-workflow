#!/usr/bin/env node
/**
 * Черновик релиза (0105 / WC-68): создать draft и загрузить ассеты.
 *
 * Черновик существует по API и ссылкам, но не виден как «последний релиз» —
 * поэтому его можно прогнать штатной проверкой (tools/release-smoke.mjs) до того,
 * как он станет публичным. Публикация — tools/release-publish.mjs, и она требует
 * свежую квитанцию smoke.
 */
import fs from 'node:fs';
import path from 'node:path';
import { githubToken } from './lib/github-token.mjs';
import { REPO, API_BASE } from './release-smoke.mjs';

export function assetName(file) {
  return path.basename(file);
}

/**
 * @param {{tag: string, name?: string, body?: string, assetsDir?: string, token?: string, fetchImpl?: Function, repo?: string}} options
 */
export async function createDraft(options = {}) {
  const tag = String(options.tag || '').trim();
  if (!tag) throw new Error('не указан тег');
  const repo = options.repo || REPO;
  const token = options.token || githubToken();
  if (!token) throw new Error('нет токена GitHub: GITHUB_TOKEN или git credential fill');
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  const assetsDir = options.assetsDir || path.join(import.meta.dirname, '..', 'dist');
  const panelVersion = String(options.panelVersion || '')
    || JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'plugin', 'package.json'), 'utf8')).version;
  const auth = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'workflow-release-draft' };

  const payload = {
    tag_name: tag,
    name: options.name || tag,
    body: options.body || '',
    draft: true,
    prerelease: false,
  };
  const created = await fetchImpl(API_BASE + '/repos/' + repo + '/releases', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(payload),
  });
  const release = JSON.parse(Buffer.from(await created.arrayBuffer()).toString('utf8'));
  if (!created.ok) throw new Error('черновик не создан: HTTP ' + created.status + ' ' + (release.message || ''));

  /*
   * 0105: в dist лежат сборки всех прошлых версий — грузим только то, что
   * относится к этому тегу и версии панели. Иначе первый же прогон залил в
   * черновик 240 старых файлов (поймано на себе 08.11).
   */
  const { expectedAssets } = await import('./release-smoke.mjs');
  const files = expectedAssets(tag, panelVersion).map((name) => path.join(assetsDir, name));
  const missing = files.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    throw new Error('нет локальных ассетов: ' + missing.map((file) => path.basename(file)).join(', '));
  }

  const uploaded = [];
  for (const file of files) {
    const name = assetName(file);
    const bytes = fs.readFileSync(file);
    const response = await fetchImpl('https://uploads.github.com/repos/' + repo + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(name), {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    const result = JSON.parse(Buffer.from(await response.arrayBuffer()).toString('utf8'));
    if (!response.ok) throw new Error('ассет ' + name + ' не загружен: HTTP ' + response.status + ' ' + (result.message || ''));
    uploaded.push(name);
  }
  return { releaseId: release.id, tag, draft: true, uploaded, htmlUrl: release.html_url || null };
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const args = process.argv.slice(2);
  const tag = args.find((arg) => arg.startsWith('v') || /^\d+\./u.test(arg)) || '';
  const nameIndex = args.indexOf('--name');
  const bodyIndex = args.indexOf('--body-file');
  const name = nameIndex >= 0 ? args[nameIndex + 1] : '';
  const bodyFile = bodyIndex >= 0 ? args[bodyIndex + 1] : '';
  const body = bodyFile && fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : '';
  createDraft({ tag, name, body })
    .then((result) => console.log('DRAFT ' + result.tag + ' id=' + result.releaseId + ' ассетов=' + result.uploaded.length))
    .catch((error) => { console.error(String(error && error.message ? error.message : error)); process.exitCode = 1; });
}
