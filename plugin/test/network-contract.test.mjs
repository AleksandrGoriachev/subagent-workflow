/**
 * 0104 (WC-67): сеть проверяется контрактным моком, а не «успешным ответом».
 *
 * c1: мок ведёт себя как GitHub — API без Accept: application/vnd.github+json
 *     отвечает 415, и это ловит именно наш код (дефект 2.6.53);
 * c2: наш код посылает на API правильный Accept, на ассеты — octet-stream;
 * c3: release-check проходит через мок и разбирает версии;
 * c4: режим 503 и обрыв соединения дают названную ошибку, а не 415.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGithubMock } from './github-mock.mjs';
import { prepareEngineSpec } from '../lib/release-source.mjs';
import { checkLatestRelease, releaseCheckPayload } from '../lib/release-check.mjs';

function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mock-'));
  return { env: { WF_RELEASE_CACHE: path.join(dir, 'latest-release.json') }, dir };
}

test('c1: мок с зубами — octet-stream на API даёт 415', async () => {
  const { fetchImpl } = createGithubMock();
  const response = await fetchImpl('https://api.github.com/repos/o/r/releases/latest', {
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'x' },
  });
  assert.equal(response.status, 415);
});

test('c2: наш код говорит с API как JSON, с ассетом — как с файлом', async () => {
  const mock = createGithubMock({ mode: 'asset-404' });
  /* Доходим до стадии ассета: API-запрос обязан пройти без 415. */
  await assert.rejects(() => prepareEngineSpec({ fetchImpl: mock.fetchImpl }));
  const apiCall = mock.calls.find((call) => call.url.startsWith('https://api.github.com/'));
  assert.ok(apiCall, 'был запрос к API');
  assert.match(apiCall.accept, /application\/vnd\.github\+json/u);
  assert.ok(mock.calls.every((call) => call.userAgent !== ''), 'User-Agent на каждом запросе');
});

test('c3: release-check через мок разбирает версии', async () => {
  const { env } = tempEnv();
  const mock = createGithubMock();
  const latest = await checkLatestRelease({ fetchImpl: mock.fetchImpl });
  assert.equal(latest.engine, '9.9.9');
  assert.equal(latest.plugin, '9.9.9');
  const payload = await releaseCheckPayload({ env, fetchImpl: mock.fetchImpl });
  assert.equal(payload.ok, true);
  assert.equal(payload.latest.engine, '9.9.9');
});

test('c4: 503 и обрыв называют причину, а не 415', async () => {
  const { env } = tempEnv();
  const unavailable = await releaseCheckPayload({ env, attempts: 1, fetchImpl: createGithubMock({ mode: '503' }).fetchImpl });
  assert.equal(unavailable.ok, false);
  assert.match(String(unavailable.error), /HTTP 503/u);
  const aborted = await releaseCheckPayload({ env, attempts: 1, fetchImpl: createGithubMock({ mode: 'timeout' }).fetchImpl });
  assert.equal(aborted.ok, false);
  assert.match(String(aborted.error), /aborted|timeout/iu);
});
