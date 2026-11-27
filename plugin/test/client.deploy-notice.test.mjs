/* 0176: набор «политика развёртывания из deploy-notice». Общий harness — client.harness.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowRuntime, createWebHandler } from '../lib/api.js';
import { makeRepo, git } from './fixture.mjs';
import {
  createElement, isValidElement, texts, textOf, elements, findButton, findBadge, delay,
  makeReact, loadBundle, mount, fakeWorkspace, apiFetch,
} from './client.harness.mjs';

test('карточка движка: политика развёртывания из deploy-notice.json', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  const noticeFile = path.join(fixture.repo, 'docs', 'subagent-workflow', 'deploy-notice.json');
  fs.writeFileSync(noticeFile, JSON.stringify({
    version: 1,
    at: '2026-11-26T00:30:00.000Z',
    mode: 'local',
    policy: 'gitignore',
    engine: { version: '2.6.113', root: 'C:/engine' },
    workspace: fixture.repo,
    ignored: ['docs/subagent-workflow/'],
    machineLocal: ['docs/subagent-workflow/workflow.config.json'],
    coordinator: {
      notice: 'код движка не вендорится: каталог docs/subagent-workflow/ в .gitignore проекта',
      action: 'клон обязан выполнить init до ворот и до check-acceptance в CI',
    },
  }, null, 2) + '\n');
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);
    const rendered = textOf(tree);

    assert.match(rendered, /развёртывание/u, 'карточка называет решение развёртывания');
    assert.match(rendered, /код движка не вендорится/u, 'видно, что код не вендорится');
    assert.match(rendered, /docs\/subagent-workflow\//u, 'видно, что именно игнорируется');
    assert.match(rendered, /клон обязан выполнить init/u, 'видна цена решения для клона');
  } finally {
    fixture.cleanup();
  }
});

test('карточка движка: без deploy-notice.json политика не выдумывается', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);
    const rendered = textOf(tree);

    assert.ok(!/код движка не вендорится/u.test(rendered), 'без отметки строки политики нет');
    assert.ok(!rendered.includes('клон обязан выполнить init'), 'цена без отметки не печатается');
  } finally {
    fixture.cleanup();
  }
});
