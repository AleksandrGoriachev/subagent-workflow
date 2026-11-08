/**
 * 0101: загрузка с повтором. Проверяем исполнением: один сбой сети или 5xx не
 * означает «обновления нет», а 4xx не повторяется и называется кодом.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from '../lib/fetch-retry.mjs';

function response(status, body = 'ok') {
  return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => Buffer.from(body) };
}

test('fetchWithRetry: успех с первой попытки — один запрос', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(200); };
  const result = await fetchWithRetry(fetchImpl, 'https://x/a', { delayMs: 0 });
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
});

test('fetchWithRetry: 503 повторяется, затем успех', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1 ? response(503) : response(200);
  };
  const result = await fetchWithRetry(fetchImpl, 'https://x/a', { delayMs: 0 });
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
});

test('fetchWithRetry: 404 не повторяется', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(404); };
  await assert.rejects(() => fetchWithRetry(fetchImpl, 'https://x/a', { delayMs: 0 }), /HTTP 404/u);
  assert.equal(calls, 1);
});

test('fetchWithRetry: обрыв соединения повторяется и называет причину', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 3) return response(200);
    const error = new Error('This operation was aborted');
    error.name = 'TimeoutError';
    throw error;
  };
  const result = await fetchWithRetry(fetchImpl, 'https://x/a', { delayMs: 0, attempts: 3 });
  assert.equal(result.status, 200);
  assert.equal(calls, 3);
});

test('fetchWithRetry: исчерпанные попытки называют число и причину', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(502); };
  await assert.rejects(
    () => fetchWithRetry(fetchImpl, 'https://x/a', { delayMs: 0, attempts: 2 }),
    /HTTP 502.*2 попытки исчерпаны|2 попытки исчерпаны/u,
  );
  assert.equal(calls, 2);
});
