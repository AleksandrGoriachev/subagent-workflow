/* 0176: набор «развёртывание движка». Общий harness — client.harness.mjs. */
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

test('empty state deploys the engine with confirmation (0.7.0)', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-console-deploy-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'deploy@local']);
  git(repo, ['config', 'user.name', 'deploy']);
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(80);
    tree = hooks.render(slot.component);
    let rendered = textOf(tree);
    assert.match(rendered, /workflow не развёрнут/u);

    let deploy = findButton(tree, 'Развернуть workflow здесь');
    assert.ok(deploy, 'кнопка развёртывания в пустом состоянии');
    assert.match(deploy.props.title, /Развернуть движок/u);

    /* Отказ в подтверждении: ни файлов, ни каталогов. */
    const questions = [];
    globalThis.window.confirm = (text) => {
      questions.push(String(text));
      return false;
    };
    deploy.props.onClick();
    await delay(80);
    assert.equal(fs.existsSync(path.join(repo, 'docs')), false, 'без подтверждения ничего не создаётся');
    assert.equal(questions.length, 1);
    assert.match(questions[0], /docs\/subagent-workflow\//u);
    assert.match(questions[0], /docs\/tasks\//u);
    assert.match(questions[0], /\.gitignore/u);
    assert.match(questions[0], /core\.hooksPath/u);
    /* 2.6.3: ключ проекта назван, глобальный — прямо исключён. */
    assert.match(questions[0], /\.wf-keys\//u);
    assert.match(questions[0], /Глобальный ~\/\.wf-keys не трогается/u);

    /* Согласие: пока движок ставится, кнопка честно говорит «Разворачиваю…». */
    globalThis.window.confirm = () => true;
    tree = hooks.render(slot.component);
    findButton(tree, 'Развернуть workflow здесь').props.onClick();
    assert.ok(findButton(hooks.render(slot.component), 'Разворачиваю'), 'состояние «Разворачиваю…»');

    const repoVersion = fs.readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();
    const versionFile = path.join(repo, 'docs', 'subagent-workflow', 'VERSION');
    for (let attempt = 0; attempt < 60 && !fs.existsSync(versionFile); attempt += 1) {
      await delay(200);
      hooks.drain();
      hooks.render(slot.component);
    }
    assert.ok(fs.existsSync(versionFile), 'кнопка развернула движок');
    assert.equal(fs.readFileSync(versionFile, 'utf8').trim(), repoVersion);
    /* 2.6.3: ключ приёмщика — в проекте, каталог игнорируется git. */
    assert.ok(fs.existsSync(path.join(repo, '.wf-keys', 'agent-judge.key.pem')), 'ключ проекта создан кнопкой');
    assert.ok(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8').split(/\r?\n/).includes('.wf-keys/'));

    /* Панель перечитала состояние: успех с версией и настоящая доска вместо пустоты. */
    let finalText = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await delay(100);
      hooks.drain();
      tree = hooks.render(slot.component);
      finalText = textOf(tree);
      if (finalText.includes('версия ' + repoVersion)) break;
    }
    assert.match(finalText, /Workflow развёрнут: версия /u);
    assert.ok(finalText.includes('версия ' + repoVersion), 'показана версия развёрнутого движка');
    assert.match(finalText, /Перечитано|перечитала состояние/u);
    assert.ok(!findButton(tree, 'Развернуть workflow здесь'), 'после развёртывания кнопка больше не предлагается');
    assert.match(finalText, /В этом репозитории нет задач workflow/u);
  } finally {
    try {
      fs.rmSync(repo, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
    } catch {
      /* утечка временного каталога не отменяет проверенное поведение */
    }
  }
});

/*
 * 0.9.3 (0039): «Развернуть здесь» на не-git воркспейсе выполняет шаг git init,
 * и только затем разворачивает движок. Раньше панель получала not-a-repo и
 * показывала «Развернуть не удалось»: ворота без git всё равно не работают.
 */
test('empty non-git workspace: deploy performs git init, then installs the engine (0.9.3)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-console-nogit-'));
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [dir] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(80);
    tree = hooks.render(slot.component);
    assert.equal(fs.existsSync(path.join(dir, '.git')), false, 'репозитория ещё нет');

    const deploy = findButton(tree, 'Развернуть workflow здесь');
    assert.ok(deploy, 'кнопка развёртывания есть и в не-git пространстве');

    globalThis.window.confirm = () => true;
    deploy.props.onClick();

    const versionFile = path.join(dir, 'docs', 'subagent-workflow', 'VERSION');
    for (let attempt = 0; attempt < 120 && !fs.existsSync(versionFile); attempt += 1) {
      await delay(200);
      hooks.drain();
      hooks.render(slot.component);
    }
    assert.ok(fs.existsSync(path.join(dir, '.git')), 'шаг git init выполнен');
    assert.ok(fs.existsSync(versionFile), 'движок развёрнут после git init');
    assert.equal(
      fs.readFileSync(versionFile, 'utf8').trim(),
      fs.readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim(),
    );
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
});

/*
 * 0.7.0: пустое состояние — не единственный вход. Вкладка «Совместимость» в
 * пространстве без движка показывает ту же кнопку и тот же список изменений:
 * «workflow не развёрнут» не должен отправлять в терминал ни с одного экрана.
 */
test('compatibility tab offers the same deploy button (0.7.0)', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-console-compat-deploy-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'deploy@local']);
  git(repo, ['config', 'user.name', 'deploy']);
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(80);
    findButton(tree, 'Совместимость').props.onClick();
    await delay(40);
    tree = hooks.render(slot.component);
    const rendered = textOf(tree);
    assert.match(rendered, /совместимость станет доступна после развёртывания/u);
    assert.match(rendered, /Развёртывание движка/u);

    const deploy = findButton(tree, 'Развернуть workflow здесь');
    assert.ok(deploy, 'кнопка развёртывания на вкладке «Совместимость»');
    assert.match(deploy.props.title, /Развернуть движок/u);

    /* Подтверждение то же: отказ ничего не пишет, даже если это вкладка совместимости. */
    const questions = [];
    globalThis.window.confirm = (text) => {
      questions.push(String(text));
      return false;
    };
    deploy.props.onClick();
    await delay(80);
    assert.equal(questions.length, 1);
    assert.match(questions[0], /docs\/subagent-workflow\//u);
    assert.match(questions[0], /core\.hooksPath/u);
    assert.equal(fs.existsSync(path.join(repo, 'docs')), false, 'без подтверждения ничего не создаётся');
  } finally {
    try {
      fs.rmSync(repo, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
    } catch {
      /* утечка временного каталога не отменяет проверенное поведение */
    }
  }
});

test('package manifest declares the DSH bundle and client halves', () => {
  const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  assert.equal(manifest.name, 'dsh-workflow-console');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.main, 'lib/index.js');
  assert.equal(manifest.exports['.'], './lib/index.js');
  assert.equal(manifest.exports['./client'], './lib/client.js');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.private, true);
  const patch = fs.readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8');
  assert.match(patch, /id: dsh-workflow-console/);
  assert.match(patch, /roots: \[\]/);
});

/*
 * 0.8.0: на развёрнутом пространстве панель показывает установленную и
 * доступную версии движка, предлагает «Обновить движок», а при незавершённых
 * заданиях перечисляет их и требует галочку «понимаю риск» до подтверждения.
 */
