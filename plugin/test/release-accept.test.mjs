/**
 * 0103: Accept по адресу — API GitHub отдаёт JSON только с
 * application/vnd.github+json, а на octet-stream отвечает 415.
 *
 * c1: описание релиза (api.github.com) запрашивается как JSON;
 * c2: tarball релиза — как octet-stream;
 * c3: обновление движка из релиза проходит на подменённом fetch (никакого 415).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEngineSpec } from '../lib/release-source.mjs';

const API = 'https://api.github.com/repos/AleksandrGoriachev/subagent-workflow/releases/latest';
const TARBALL = 'https://github.com/AleksandrGoriachev/subagent-workflow/releases/download/v2.6.53/subagent-workflow-2.6.53.tar.gz';

function seenAccept() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, accept: options.headers && options.headers.Accept });
    return { ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) };
  };
  return { calls, fetchImpl };
}

test('c1/c2: Accept выбирается по адресу', async () => {
  const { calls, fetchImpl } = seenAccept();
  await assert.rejects(() => prepareEngineSpec({ fetchImpl, apiBase: 'https://api.github.com', repo: 'o/r' }));
  assert.equal(calls.length >= 1, true, 'запрос описания релиза был');
  assert.match(String(calls[0].url), /^https:\/\/api\.github\.com\/repos\/o\/r\/releases\/latest$/u);
  assert.equal(calls[0].accept, 'application/vnd.github+json', 'описание релиза — JSON');
  assert.ok(!calls.some((call) => call.url === TARBALL));
});

test('c3: 415 не повторяется и не выдаёт себя за сеть', async () => {
  const fetchImpl = async () => ({ ok: false, status: 415, arrayBuffer: async () => Buffer.alloc(0) });
  await assert.rejects(
    () => prepareEngineSpec({ fetchImpl }),
    /HTTP 415|не удалось/u,
  );
});
