/**
 * 0081 (WC-56, S4): сводка императива — версия, enforcement, ожидания, отказы.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { imperativeView, readWaits, waitsJournalPath } from '../lib/imperative.js';
import { createWorkflowRuntime, createWebHandler } from '../lib/api.js';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeWorkspace(version = '2.6.35', enforcement = { waitPolicy: 'fail', waitBudgetMs: 120000 }) {
  const root = tempDir('wf-imperative-');
  const workflow = path.join(root, 'docs', 'subagent-workflow');
  fs.mkdirSync(path.join(workflow, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(workflow, 'VERSION'), version + '\n');
  fs.writeFileSync(path.join(workflow, 'scripts', 'job.mjs'), '// job\n');
  fs.writeFileSync(path.join(workflow, 'workflow.config.json'), JSON.stringify({ version: 1, enforcement }) + '\n');
  return root;
}

test('императив зелёный: движок, job.mjs, enforcement', () => {
  const root = makeWorkspace();
  const view = imperativeView({
    root,
    readRoot: root,
    config: { enforcement: { waitPolicy: 'fail', waitBudgetMs: 120000, processPolicy: 'fail', structurePolicy: 'fail' } },
    engine: { version: '2.6.35', installed: true, root },
  });
  assert.equal(view.ok, true);
  assert.deepEqual(view.reasons, []);
  assert.equal(view.checks.job, true);
  assert.equal(view.checks.engine, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('императив красный: старый движок и off ослабляет правило', () => {
  const root = makeWorkspace('2.6.30', { waitPolicy: 'off', waitBudgetMs: 120000 });
  const view = imperativeView({
    root,
    readRoot: root,
    config: { enforcement: { waitPolicy: 'off', waitBudgetMs: 120000 } },
    engine: { version: '2.6.30', installed: true, root },
  });
  assert.equal(view.ok, false);
  assert.match(view.reasons.join('; '), /старше 2\.6\.31/u);
  assert.match(view.reasons.join('; '), /off/u);
  fs.rmSync(root, { recursive: true, force: true });
});

test('журнал ожиданий: счётчики и последние строки', () => {
  const root = makeWorkspace();
  const dir = tempDir('wf-waits-');
  const previous = process.env.WF_WAITS_DIR;
  process.env.WF_WAITS_DIR = dir;
  try {
    const file = waitsJournalPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      JSON.stringify({ at: '2026-11-05T16:55:56.698+03:00', root, tool: 'pwsh', mode: 'fail', denied: true, waitMs: 61000, budgetMs: 120000, attribution: 'call' }),
      JSON.stringify({ at: '2026-11-05T17:00:00.000+03:00', root, tool: 'job_output', mode: 'warn', denied: false, waitMs: 130000, budgetMs: 120000, attribution: 'cwd' }),
    ].join('\n') + '\n');
    const waits = readWaits(root);
    assert.equal(waits.total, 2);
    assert.equal(waits.denied, 1);
    assert.equal(waits.warn, 1);
    assert.equal(waits.last[0].tool, 'job_output');
    assert.equal(waits.last[1].attribution, 'call');
  } finally {
    if (previous === undefined) delete process.env.WF_WAITS_DIR;
    else process.env.WF_WAITS_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function call(handler, url) {
  const response = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(value) { this.body = value === undefined ? '' : String(value); },
  };
  const request = { method: 'GET', url, headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' }, on() { return request; } };
  await handler(request, response);
  return { status: response.statusCode, json: JSON.parse(response.body) };
}

test('GET /api/policy отдаёт imperative с проверками и журналом', async () => {
  const root = makeWorkspace();
  const runtime = createWorkflowRuntime({ roots: [root] });
  const handler = createWebHandler(runtime);
  const response = await call(handler, '/workflow/api/policy');
  assert.equal(response.status, 200);
  assert.ok(response.json.imperative, 'блок imperative в ответе');
  assert.equal(response.json.imperative.root, root);
  assert.equal(response.json.imperative.checks.job, true);
  assert.equal(response.json.imperative.enforcement.waitPolicy, 'fail');
  assert.equal(typeof response.json.imperative.waits.total, 'number');
  fs.rmSync(root, { recursive: true, force: true });
});
