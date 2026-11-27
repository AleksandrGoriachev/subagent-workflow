/* 0176: набор «вид, доска, карточка, политика». Общий harness — client.harness.mjs. */
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

test('client bundle registers the Workflow conversation view', async () => {
  globalThis.fetch = () => {
    throw new Error('the panel must not fetch during render');
  };
  const plugin = await loadBundle({
    createElement,
    isValidElement,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect() {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  });
  assert.equal(typeof plugin.apply, 'function');
  assert.ok(Array.isArray(plugin.inject) && plugin.inject.includes('slots'));

  const slot = mount(plugin);
  assert.equal(slot.options.name, 'conversation.view');
  assert.equal(slot.options.id, 'workflow');
  assert.equal(typeof slot.options.label, 'function');
  assert.equal(slot.options.label(), 'Консоль workflow');
  assert.equal(typeof slot.component, 'function');

  const rendered = textOf(slot.component());
  assert.match(rendered, /Консоль workflow/u);
  const tabs = elements(slot.component()).filter((element) => element.type === 'button'
    && ['Обзор', 'Доска', 'Якоря', 'Политика', 'Совместимость'].includes(textOf(element).replace(/\s+/g, ' ').trim()));
  assert.deepEqual(tabs.slice(0, 5).map((element) => textOf(element).replace(/\s+/g, ' ').trim()), ['Доска', 'Обзор', 'Якоря', 'Политика', 'Совместимость']);
  const activeDefault = tabs.find((element) => textOf(element).replace(/\s+/g, ' ').trim() === 'Обзор');
  assert.ok(activeDefault && activeDefault.props.style && activeDefault.props.style.background, 'overview is the active default tab');
  assert.match(rendered, /Доска/);
  assert.match(rendered, /Политика/);
  assert.match(rendered, /Обновить/);
  assert.match(rendered, /workflow не развёрнут/);
  const overviewTree = slot.component();
  const overviewBody = elements(overviewTree).find((element) => element.type === 'div'
    && element.children.some((child) => child && child.type === 'section'
      && textOf(child).includes('Сейчас')));
  assert.ok(overviewBody, 'Overview composition is rendered');
  const overviewText = textOf(overviewBody);
  assert.ok(overviewText.includes('Сейчас'), 'Overview summary is present');
  assert.ok(overviewText.includes('Версия движка'), 'Overview engine version is present');
  assert.ok(overviewText.includes('Проверить актуальность'), 'Overview offers the release check');
  assert.ok(!overviewText.includes('Семантические якоря'), 'Overview does not duplicate the anchors card');
  assert.ok(overviewText.includes('Якоря'), 'Overview keeps the anchors relevance line');
  assert.ok(overviewText.includes('Карточки задач'), 'Overview task cards are present');
  assert.equal((overviewText.match(/Сейчас/g) || []).length, 1, 'Overview renders the summary once');
  assert.equal((overviewText.match(/Версия движка/g) || []).length, 1, 'Overview renders the engine version once');
  const blockOrder = ['Сейчас', 'Версия движка', 'Карточки задач']
    .map((label) => overviewText.indexOf(label));
  assert.ok(blockOrder.every((index) => index >= 0), 'all Overview blocks are present');
  assert.deepEqual(blockOrder, [...blockOrder].sort((left, right) => left - right), 'Overview blocks follow the approved order');
});

test('panel renders a real board, task card and policy page', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(80);
    tree = hooks.render(slot.component);
    let rendered = textOf(tree);
    assert.match(rendered, /Сложение возвращает сумму/);
    assert.match(rendered, /1 задача/);
    assert.match(rendered, /в работе: 0/);
    assert.match(rendered, /Что означают стадии/);
    assert.match(rendered, /Замок контракта/);
    assert.match(rendered, /Прошли шаг/);
    assert.match(rendered, /Замечания/);
    assert.match(rendered, /0001/);
    assert.ok(!rendered.includes("нет задач в этой стадии"), 'empty columns are hidden by default');

    const cardButton = findButton(tree, '0001');
    assert.ok(cardButton, 'task card button');
    cardButton.props.onClick();
    await delay(80);
    tree = hooks.render(slot.component);
    rendered = textOf(tree);
    assert.match(rendered, /assumed/);
    assert.match(rendered, /D2/);
    assert.match(rendered, /releaseReady/);
    assert.match(rendered, /family-b/);
    assert.match(rendered, /Покрытие/);
    assert.match(rendered, /Запись/);
    assert.match(rendered, /Что дальше/);
    assert.match(rendered, /остались assumed-решения/);
    const cardBody = elements(tree).find((element) => element.type === 'div'
      && element.props.style && element.props.style.flex === '1 1 auto'
      && element.props.style.overflow === 'auto');
    const cardBodyNode = cardBody && cardBody.children[cardBody.children.length - 1];
    const cardBodyText = textOf(cardBodyNode);
    const identityTextIndex = cardBodyText.indexOf('0001 · Сложение возвращает сумму');
    const explanationTextIndex = cardBodyText.indexOf('Карточка показывает идентификатор, состояние');
    const actionsTextIndex = cardBodyText.indexOf('Проверить задание');
    assert.ok(identityTextIndex >= 0 && explanationTextIndex >= 0 && actionsTextIndex >= 0, 'identity, explanation and actions exist');
    assert.ok(identityTextIndex < explanationTextIndex, 'identity precedes explanation');
    assert.ok(identityTextIndex < actionsTextIndex, 'identity precedes actions');

    const boardTab = findButton(tree, 'Доска');
    assert.ok(boardTab, 'board tab');
    boardTab.props.onClick();
    tree = hooks.render(slot.component);
    rendered = textOf(tree);
    assert.match(rendered, /Доска задач/);
    assert.ok(!rendered.includes('Семантические якоря'), 'anchors card moved off the board tab');

    const anchorsTab = findButton(tree, 'Якоря');
    assert.ok(anchorsTab, 'anchors tab');
    anchorsTab.props.onClick();
    tree = hooks.render(slot.component);
    rendered = textOf(tree);
    assert.match(rendered, /Семантические якоря/);

    const policyButton = findButton(tree, 'Политика');
    assert.ok(policyButton, 'policy tab');
    policyButton.props.onClick();
    await delay(80);
    tree = hooks.render(slot.component);
    rendered = textOf(tree);
    assert.match(rendered, /decisions=fail, coverage=fail, attack=fail, modelFamily=warn/);
    assert.match(rendered, /fail — запрещать/);
    assert.match(rendered, /critic/);
    assert.match(rendered, /family-b/);
    assert.match(rendered, /workflow\.config\.json/);
  } finally {
    fixture.cleanup();
  }
});

test('policy page toggles the guard flag with confirmation (0.5.0)', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);
    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(80);
    tree = hooks.render(slot.component);

    const policyButton = findButton(tree, 'Политика');
    assert.ok(policyButton, 'policy tab');
    policyButton.props.onClick();
    await delay(80);
    tree = hooks.render(slot.component);
    let rendered = textOf(tree);
    assert.match(rendered, /Проверка коммитов/u);
    assert.match(rendered, /guard\.enabled/u);

    const toggle = findButton(tree, 'Включить проверку коммитов');
    assert.ok(toggle, 'кнопка включения guard');
    /* В браузере это window.confirm; в тесте — заглушка, как и в реальном окне. */
    globalThis.window.confirm = () => true;
    toggle.props.onClick();
    await delay(160);

    const configPath = path.join(fixture.repo, 'docs', 'subagent-workflow', 'workflow.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(config.guard.enabled, true, 'панель пишет guard.enabled');
    assert.ok(fs.existsSync(path.join(fixture.repo, 'docs', 'subagent-workflow', 'guard.log')), 'включение попадает в guard.log');

    tree = hooks.render(slot.component);
    rendered = textOf(tree);
    assert.match(rendered, /Проверка коммитов включена/u);
    assert.ok(findButton(tree, 'Выключить проверку коммитов'), 'после включения кнопка выключает');
  } finally {
    fixture.cleanup();
  }
});

test('panel follows the current workspace and opens compatibility', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin, fakeWorkspace(fixture.repo));
    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(80);
    tree = hooks.render(slot.component);
    let text = textOf(tree);
    assert.match(text, /Текущий workspace: fixture-workspace/);
    assert.match(text, /показан: /);
    assert.match(text, /Сложение возвращает сумму/);

    const compatButton = findButton(tree, 'Совместимость');
    assert.ok(compatButton, 'compatibility tab');
    compatButton.props.onClick();
    await delay(120);
    tree = hooks.render(slot.component);
    text = textOf(tree);
    assert.match(text, /Версии/);
    assert.match(text, /2\.2\.1/);
    assert.match(text, /Проверки/);
    assert.match(text, /Совместимо с workflow/);
  } finally {
    fixture.cleanup();
  }
});
