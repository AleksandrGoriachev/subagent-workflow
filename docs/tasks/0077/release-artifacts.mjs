#!/usr/bin/env node
/**
 * Критерий C4 задания 0077: релиз v2.6.84 опубликован целиком.
 * Читает публичный GitHub API (без токена): релиз не черновик, 8 ассетов
 * выпуска и квитанция SMOKE-v2.6.84.json на месте. Ничего не пишет на диск.
 */
const REPO = 'AleksandrGoriachev/subagent-workflow';
const TAG = String(process.env.WF_EXPECT_TAG || 'v2.6.84').trim();
const PANEL = '0.9.38';
const VERSION = TAG.replace(/^v/u, '');

const expected = [
  'subagent-workflow-' + VERSION + '.tar.gz',
  'subagent-workflow-' + VERSION + '.tar.gz.sha256',
  'subagent-workflow-' + VERSION + '.zip',
  'subagent-workflow-' + VERSION + '.zip.sha256',
  'dsh-workflow-console.tgz',
  'dsh-workflow-console.tgz.sha256',
  'dsh-workflow-console-' + PANEL + '.tgz',
  'dsh-workflow-console-' + PANEL + '.tgz.sha256',
];

function fail(reason) {
  console.error('ARTIFACTS FAIL: ' + reason);
  process.exit(1);
}

async function main() {
  const response = await fetch('https://api.github.com/repos/' + REPO + '/releases/tags/' + TAG, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wf-task-0077' },
  });
  if (response.status === 404) fail('нет тега ' + TAG + ' среди опубликованных релизов');
  if (!response.ok) fail('HTTP ' + response.status + ' на запросе релиза');
  const release = await response.json();
  if (release.draft === true) fail('релиз ' + TAG + ' остался черновиком');
  if (String(release.tag_name) !== TAG) fail('тег релиза ' + release.tag_name + ', ожидался ' + TAG);
  const names = (Array.isArray(release.assets) ? release.assets : []).map((asset) => String(asset.name));
  const missing = expected.filter((name) => !names.includes(name));
  if (missing.length > 0) fail('нет ассетов: ' + missing.join(', '));
  const smoke = 'SMOKE-' + TAG + '.json';
  if (!names.includes(smoke)) fail('нет квитанции ' + smoke);
  const sizes = (Array.isArray(release.assets) ? release.assets : [])
    .map((asset) => asset.name + '=' + asset.size)
    .join(' ');
  console.log('ARTIFACTS OK ' + TAG + ' — ассетов=' + names.length + ' url=' + release.html_url);
  console.log('размеры: ' + sizes);
}

main().catch((error) => fail(String(error && error.message ? error.message : error)));