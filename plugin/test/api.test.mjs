import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkflowRuntime,
  createWebHandler,
} from '../lib/api.js';
import { makeRepo, snapshotFiles, git } from './fixture.mjs';

function makeRequest(url, options = {}) {
  return {
    method: options.method || 'GET',
    url,
    socket: { remoteAddress: options.remote === undefined ? '127.0.0.1' : options.remote },
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    writableEnded: false,
    body: '',
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    end(body) {
      this.body = body === undefined ? '' : String(body);
      this.writableEnded = true;
    },
  };
}

async function call(handler, url, options = {}) {
  const res = makeResponse();
  await handler(makeRequest(url, options), res);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.statusCode, headers: res.headers, json, text: res.body };
}

function setup(stage = 'remarks') {
  const fixture = makeRepo({ stage });
  const runtime = createWorkflowRuntime({ roots: [fixture.repo] });
  const handler = createWebHandler(runtime);
  return { fixture, runtime, handler };
}

test('GET /workflow/api/status reports the repository and policy', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/status');
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json.plugin.name, 'dsh-workflow-console');
    assert.equal(response.json.roots.length, 1);
    assert.equal(response.json.roots[0].exists, true);
    assert.equal(response.json.root, fixture.repo);
    assert.equal(response.json.repo.configLoaded, true);
    assert.equal(response.json.repo.packageVersion, '2.2.1');
    assert.equal(response.json.repo.policy.line, 'decisions=fail, coverage=fail, attack=fail, modelFamily=warn');
    assert.equal(response.json.rootConfigured, true);
    assert.equal(response.json.repo.compat.pluginVersion, '0.1.1');
    assert.equal(response.json.repo.compat.summary.limited, false);
  } finally {
    fixture.cleanup();
  }
});

test('GET /workflow/api/tasks returns the board with stages and skipped files', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/tasks');
    assert.equal(response.status, 200);
    assert.equal(response.json.tasks.length, 1);
    const task = response.json.tasks[0];
    assert.equal(task.id, '0001');
    assert.equal(task.stage, 'remarks');
    assert.equal(task.stageLabel, 'замечания');
    assert.equal(task.errors, 0);
    assert.ok(task.warnings >= 2);
    assert.equal(response.json.counts.remarks, 1);
    assert.equal(response.json.skipped.length, 1);
    assert.match(response.json.skipped[0].path, /0001-old\.md$/);
    assert.match(response.json.head, /^[0-9a-f]{40}$/);
  } finally {
    fixture.cleanup();
  }
});

test('GET /workflow/api/task/:id returns decisions, attack, coverage and record', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/task/0001');
    assert.equal(response.status, 200);
    const task = response.json.task;
    assert.equal(task.id, '0001');
    assert.equal(task.stage, 'remarks');
    assert.deepEqual(task.decisions.assumed, ['D2']);
    assert.equal(task.criteria[0].covers[0], 'src/**');
    assert.equal(task.attack.summary.blocking, 1);
    assert.equal(task.attack.summary.unresolved, 0);
    assert.equal(task.coverage.uncovered.length, 0);
    assert.equal(task.record.version, 6);
    assert.equal(task.record.releaseReady, false);
    assert.equal(task.lock.inSync, true);
    assert.ok(task.git.log.length >= 1);
  } finally {
    fixture.cleanup();
  }
});

test('GET /workflow/api/policy matches the doctor policy line', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/policy');
    assert.equal(response.status, 200);
    assert.equal(response.json.line, 'decisions=fail, coverage=fail, attack=fail, modelFamily=warn');
    assert.equal(response.json.policy.decisions, 'fail');
    assert.equal(response.json.policy.coverage, 'fail');
    assert.equal(response.json.policy.attack, 'fail');
    assert.equal(response.json.policy.roles.modelFamily, 'warn');
    assert.equal(response.json.roles.find((role) => role.name === 'critic').family, 'family-b');
    assert.deepEqual(response.json.models, { 'model-a': 'family-a', 'model-b': 'family-b' });
    assert.equal(response.json.configPath.endsWith('workflow.config.json'), true);
  } finally {
    fixture.cleanup();
  }
});

test('GET /workflow/api/compat reports versions and recommendations', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/compat');
    assert.equal(response.status, 200);
    assert.equal(response.json.pluginVersion, '0.1.1');
    assert.equal(response.json.supported, '2.0.0 – 2.2.x');
    assert.equal(response.json.workflowVersion, '2.2.1');
    assert.equal(response.json.summary.limited, false);
    assert.ok(Array.isArray(response.json.checks));
    assert.ok(response.json.checks.some((item) => item.id === 'package-spec'));
    assert.equal(response.json.configPath.endsWith('workflow.config.json'), true);
  } finally {
    fixture.cleanup();
  }
});

test('a registered workspace is readable even when it is not a configured root', async () => {
  const fixture = makeRepo({ stage: 'accepted' });
  try {
    const runtime = createWorkflowRuntime(
      { roots: ['C:\\not-a-real-workflow-root'] },
      { getWorkspaceRegistry: () => ({ list: () => [{ path: fixture.repo, title: 'fixture' }] }) },
    );
    const handler = createWebHandler(runtime);
    const status = await call(handler, '/workflow/api/status?root=' + encodeURIComponent(fixture.repo));
    assert.equal(status.status, 200);
    assert.equal(status.json.rootConfigured, false);
    assert.equal(status.json.repo.configLoaded, true);
    const tasks = await call(handler, '/workflow/api/tasks?root=' + encodeURIComponent(fixture.repo));
    assert.equal(tasks.status, 200);
    assert.equal(tasks.json.tasks.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('non-GET methods answer 405 with Allow: GET', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/tasks', { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, 'GET');
  } finally {
    fixture.cleanup();
  }
});

test('unknown routes answer 404 and a foreign root answers 400', async () => {
  const { fixture, handler } = setup();
  try {
    const missing = await call(handler, '/workflow/api/nope');
    assert.equal(missing.status, 404);
    const foreign = await call(handler, '/workflow/api/tasks?root=' + encodeURIComponent('C:\\\\Windows'));
    assert.equal(foreign.status, 400);
    assert.match(foreign.json.error, /не входит/);
    const status = await call(handler, '/workflow/api/status?root=' + encodeURIComponent('C:\\\\Windows'));
    assert.equal(status.status, 200);
    assert.equal(status.json.repo, null);
    assert.match(status.json.error, /не входит/);
  } finally {
    fixture.cleanup();
  }
});

test('a non-loopback peer is rejected', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/tasks', { remote: '10.1.2.3' });
    assert.equal(response.status, 403);
  } finally {
    fixture.cleanup();
  }
});

test('a traversal-shaped task id is rejected', async () => {
  const { fixture, handler } = setup();
  try {
    const response = await call(handler, '/workflow/api/task/..%2F..%2Fetc');
    assert.equal(response.status, 400);
  } finally {
    fixture.cleanup();
  }
});

test('a full request sweep does not change files or git status', async () => {
  const { fixture, handler } = setup();
  try {
    const before = snapshotFiles(fixture.repo);
    const statusBefore = git(fixture.repo, ['status', '--porcelain']);
    await call(handler, '/workflow/api/status');
    await call(handler, '/workflow/api/tasks');
    await call(handler, '/workflow/api/task/0001');
    await call(handler, '/workflow/api/policy');
    const after = snapshotFiles(fixture.repo);
    assert.deepEqual(after, before);
    assert.equal(git(fixture.repo, ['status', '--porcelain']), statusBefore);
  } finally {
    fixture.cleanup();
  }
});
