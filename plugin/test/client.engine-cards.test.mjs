/* 0176: набор «карточки движка». Общий harness — client.harness.mjs. */
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

test('карточка absent: два действия, без ошибки', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-console-absent-'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  const engineRepo = makeRepo({ stage: 'remarks' });
  const mapFile = path.join(dir, 'map', 'engine-roots.json');
  const previous = process.env.WF_ENGINE_ROOTS;
  process.env.WF_ENGINE_ROOTS = mapFile;
  try {
    const registry = { list: () => [{ id: 'engine', path: engineRepo.repo }] };
    const handler = createWebHandler(createWorkflowRuntime(
      { roots: [ws] },
      { getWorkspaceRegistry: () => registry },
    ));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);
    let rendered = textOf(tree);

    assert.match(rendered, /движок не подключён/u);
    const deploy = findButton(tree, 'Развернуть здесь');
    const link = findButton(tree, 'Подключить существующий');
    assert.ok(deploy, 'действие «Развернуть здесь»');
    assert.ok(link, 'действие «Подключить существующий»');
    assert.notEqual(deploy.props.disabled, true, 'развернуть можно сразу');
    assert.notEqual(link.props.disabled, true, 'подключить можно сразу');
    assert.ok(!/ошибк/iu.test(rendered), 'отсутствие движка не названо ошибкой');
    assert.ok(rendered.includes("Движок не найден. Установка движка не выполняется автоматически."), 'показывается утверждённая строка отсутствующего движка');
    assert.ok(!/Движок[^.]{0,60}(не удалось|отказ)|(?:не удалось|отказ)[^.]{0,60}движок/iu.test(rendered), 'отсутствие движка не представлено как отказ');

    const card = elements(tree).find(
      (element) => element.type === 'section' && textOf(element).includes('движок не подключён'),
    );
    assert.ok(card, 'карточка движка на экране');
    const alarming = elements(card).filter((element) => element.props
      && typeof element.props.style === 'object'
      && /#ec1313/u.test(String(element.props.style.color || element.props.style.borderColor || '')));
    assert.equal(alarming.length, 0, 'в карточке нет тревожного цвета');

    /* Список скрыт до нажатия и приходит с сервера по кнопке. */
    assert.ok(!rendered.includes('Выберите репозиторий'), 'список кандидатов не показан заранее');
    findButton(tree, 'Подключить существующий').props.onClick();
    let listed = '';
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await delay(100);
      hooks.drain();
      tree = hooks.render(slot.component);
      listed = textOf(tree);
      if (/Выберите репозиторий/u.test(listed)) break;
    }
    assert.match(listed, /Выберите репозиторий/u, 'список кандидатов раскрыт');
    assert.ok(listed.includes(path.basename(engineRepo.repo)), 'кандидат назван по репозиторию');
    assert.match(listed, /v2\.2\.1/u, 'у кандидата есть версия');
  } finally {
    if (previous === undefined) delete process.env.WF_ENGINE_ROOTS;
    else process.env.WF_ENGINE_ROOTS = previous;
    engineRepo.cleanup();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
    } catch {
      /* утечка временного каталога не отменяет проверенное поведение */
    }
  }
});

/*
 * 0.9.3 (0039): при mapped карточка называет путь, версию и источник словами
 * «выбрано в панели»; кнопок связи нет — связь уже есть.
 */
test('карточка mapped: путь, версия, источник', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-console-linked-'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  const mapFile = path.join(dir, 'engine-roots.json');
  fs.writeFileSync(mapFile, JSON.stringify({ [ws]: fixture.repo }, null, 2) + '\n');
  const previous = process.env.WF_ENGINE_ROOTS;
  process.env.WF_ENGINE_ROOTS = mapFile;
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [ws] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);
    const rendered = textOf(tree);

    assert.match(rendered, /Движок подключён/u);
    assert.match(rendered, /выбрано в панели/u, 'источник назван словами панели');
    assert.ok(rendered.includes(fixture.repo), 'путь движка показан');
    assert.match(rendered, /v2\.2\.1/u, 'версия движка показана');
    assert.ok(!findButton(tree, 'Развернуть здесь'), 'при связи кнопка развёртывания не предлагается');
    assert.ok(!findButton(tree, 'Подключить существующий'), 'связь уже есть — второй выбор не нужен');
  } finally {
    if (previous === undefined) delete process.env.WF_ENGINE_ROOTS;
    else process.env.WF_ENGINE_ROOTS = previous;
    fixture.cleanup();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
    } catch {
      /* утечка временного каталога не отменяет проверенное поведение */
    }
  }
});

/*
 * 0.9.3 (0039): декларативная связь из config.engines.roots сильнее карты —
 * карточка говорит «задано конфигом профиля» и не предлагает подменить связь.
 */
test('0.9.3 config: связь задана конфигом профиля', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-console-config-'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  try {
    const handler = createWebHandler(createWorkflowRuntime({
      roots: [ws],
      engines: { roots: { [ws]: fixture.repo } },
    }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);
    const rendered = textOf(tree);

    assert.match(rendered, /задано конфигом профиля/u, 'источник — конфиг профиля');
    assert.ok(rendered.includes(fixture.repo), 'путь объявленного движка показан');
    assert.match(rendered, /v2\.2\.1/u);
    assert.ok(!findButton(tree, 'Подключить существующий'), 'декларативную связь кнопкой не подменяют');
  } finally {
    fixture.cleanup();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
    } catch {
      /* утечка временного каталога не отменяет проверенное поведение */
    }
  }
});
/*
 * 0151 (панель): политика развёртывания видна в карточке движка. init пишет
 * docs/subagent-workflow/deploy-notice.json; панель показывает решение и его
 * цену — что игнорируется и что обязан сделать клон. Состояние дерева об этом
 * молчит, поэтому без отметки строки нет: панель не выдумывает политику.
 */
