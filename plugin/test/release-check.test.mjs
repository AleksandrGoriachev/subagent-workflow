/**
 * 0102 (WC-65): проверка актуальности релиза.
 *
 * c1: разбор replies/latest — движок из tag_name без «v», панель из имени
 *     версионированного ассета;
 * c2: успешная проверка пишет кэш;
 * c3: сбой сети не стирает кэш и возвращает последнюю удачную пару;
 * c4: без кэша ошибка называет причину и не выдумывает версии;
 * c5: кэш читается из WF_RELEASE_CACHE.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseLatestRelease,
  checkLatestRelease,
  releaseCheckPayload,
  readCachedRelease,
  writeCachedRelease,
  releaseCacheFile,
} from '../lib/release-check.mjs';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => Buffer.from(JSON.stringify(payload), 'utf8'),
  };
}

function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-release-check-'));
  return { env: { WF_RELEASE_CACHE: path.join(dir, 'latest-release.json') }, dir };
}

test('c1: разбор релиза — tag_name и версионированный ассет', () => {
  const parsed = parseLatestRelease({
    tag_name: 'v2.6.52',
    published_at: '2026-11-08T12:00:00Z',
    assets: [
      { name: 'dsh-workflow-console.tgz' },
      { name: 'dsh-workflow-console-0.9.24.tgz' },
      { name: 'subagent-workflow-2.6.52.tar.gz' },
    ],
  });
  assert.equal(parsed.engine, '2.6.52');
  assert.equal(parsed.plugin, '0.9.24');
  assert.equal(parsed.publishedAt, '2026-11-08T12:00:00Z');
});

test('c2: успешная проверка пишет кэш', async () => {
  const { env } = tempEnv();
  const payload = await releaseCheckPayload({
    env,
    fetchImpl: async () => jsonResponse({ tag_name: 'v2.6.52', assets: [{ name: 'dsh-workflow-console-0.9.24.tgz' }] }),
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.latest.engine, '2.6.52');
  assert.equal(payload.latest.plugin, '0.9.24');
  const cached = readCachedRelease(env);
  assert.equal(cached.engine, '2.6.52');
  assert.equal(cached.plugin, '0.9.24');
  assert.ok(cached.at);
});

test('c3: сбой сети возвращает последнюю удачную пару и не стирает кэш', async () => {
  const { env } = tempEnv();
  writeCachedRelease({ plugin: '0.9.23', engine: '2.6.50' }, env, new Date('2026-11-08T10:00:00Z'));
  const payload = await releaseCheckPayload({
    env,
    timeoutMs: 50,
    attempts: 1,
    fetchImpl: async () => { const error = new Error('This operation was aborted'); error.name = 'TimeoutError'; throw error; },
  });
  assert.equal(payload.ok, false);
  assert.equal(payload.latest.engine, '2.6.50');
  assert.equal(payload.latest.plugin, '0.9.23');
  assert.match(String(payload.fix), /Последняя удачная проверка/u);
  /* кэш не испорчен неудачей */
  const cached = readCachedRelease(env);
  assert.equal(cached.engine, '2.6.50');
});

test('c4: без кэша ошибка называет причину и не выдумывает версии', async () => {
  const { env } = tempEnv();
  const payload = await releaseCheckPayload({
    env,
    attempts: 1,
    fetchImpl: async () => jsonResponse({ message: 'no' }, 503),
  });
  assert.equal(payload.ok, false);
  assert.equal(payload.latest, null);
  assert.match(String(payload.error), /HTTP 503/u);
});

test('c5: WF_RELEASE_CACHE переопределяет файл кэша', () => {
  const { env, dir } = tempEnv();
  assert.equal(releaseCacheFile(env), path.join(dir, 'latest-release.json'));
  writeCachedRelease({ plugin: '0.9.24', engine: '2.6.52' }, env);
  assert.ok(fs.existsSync(path.join(dir, 'latest-release.json')));
});

test('checkLatestRelease: пустой релиз без версий — ошибка, а не догадка', async () => {
  await assert.rejects(
    () => checkLatestRelease({ attempts: 1, fetchImpl: async () => jsonResponse({ tag_name: '', assets: [] }) }),
    /нет ни tag_name/u,
  );
});
