#!/usr/bin/env node
/**
 * Критерий C4 задания 0077: релиз v2.6.84 опубликован целиком.
 * Читает публичный GitHub API (без токена): релиз не черновик, ассеты выпуска и
 * квитанция SMOKE-v2.6.84.json на месте. Ничего не пишет на диск.
 *
 * Никаких process.exit внутри async: в Node на Windows выход при открытом
 * fetch-хэндле роняет libuv (код 3221226505), поэтому вердикт задаётся
 * process.exitCode, а процесс завершается сам.
 */
const REPO = 'AleksandrGoriachev/subagent-workflow';
const TAG = String(process.env.WF_EXPECT_TAG || 'v2.6.84').trim();
const VERSION = TAG.replace(/^v/u, '');
const PANEL = String(process.env.WF_EXPECT_PANEL || '0.9.38').trim();

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

function bad(reason) {
  const error = new Error(reason);
  error.expected = true;
  throw error;
}

async function run() {
  const response = await fetch('https://api.github.com/repos/' + REPO + '/releases/tags/' + TAG, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wf-task-0077' },
  });
  if (response.status === 404) bad('нет тега ' + TAG + ' среди опубликованных релизов');
  if (!response.ok) bad('HTTP ' + response.status + ' на запросе релиза');
  const release = await response.json();
  if (release.draft === true) bad('релиз ' + TAG + ' остался черновиком');
  if (String(release.tag_name) !== TAG) bad('тег релиза ' + release.tag_name + ', ожидался ' + TAG);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const names = assets.map((asset) => String(asset.name));
  const missing = expected.filter((name) => !names.includes(name));
  if (missing.length > 0) bad('нет ассетов: ' + missing.join(', '));
  const smoke = 'SMOKE-' + TAG + '.json';
  if (!names.includes(smoke)) bad('нет квитанции ' + smoke);
  console.log('ARTIFACTS OK ' + TAG + ' — ассетов=' + names.length + ' url=' + release.html_url);
  console.log('размеры: ' + assets.map((asset) => asset.name + '=' + asset.size).join(' '));
}

run().catch((error) => {
  console.error('ARTIFACTS FAIL: ' + String(error && error.message ? error.message : error));
  process.exitCode = 1;
});
