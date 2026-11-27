/* 0176: набор «состояния движка и обновление». Общий harness — client.harness.mjs. */
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

test('deployed engine shows versions and guards update with unfinished tasks (0.8.0)', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    /* Задание без записи приёмки: обновление должно быть заблокировано. */
    fs.rmSync(path.join(fixture.taskDir, 'acceptance.json'));
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
    const repoVersion = fs.readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();
    assert.match(rendered, /Версия движка/u);
    assert.match(rendered, /Установлено: v2\.2\.1/u);
    assert.ok(rendered.includes('доступна v' + repoVersion), 'доступная версия из сборки панели');
    assert.match(rendered, /доступна v/u);

    const update = findButton(tree, 'Обновить движок');
    assert.ok(update, 'кнопка обновления на развёрнутом пространстве');
    assert.ok(!findButton(tree, 'Развернуть workflow здесь'), 'пустая кнопка остаётся только для пустого состояния');

    update.props.onClick();
    tree = hooks.render(slot.component);
    rendered = textOf(tree);
    assert.match(rendered, /Незавершённые задания: 0001/u, 'диалог называет ID задания');
    assert.match(rendered, /понимаю риск/u, 'галочка подтверждения риска');
    assert.match(rendered, /смешанные версии скриптов/u, 'объяснение, чем рискует незавершённое задание');

    const confirm = findButton(tree, 'Подтвердить обновление');
    assert.ok(confirm, 'кнопка подтверждения в диалоге');
    assert.equal(confirm.props.disabled, true, 'без галочки подтверждение недоступно');

    const checkbox = elements(tree).find(
      (element) => element.type === 'input' && element.props && element.props.type === 'checkbox',
    );
    assert.ok(checkbox, 'чекбокс «понимаю риск»');
    checkbox.props.onChange({ target: { checked: true } });
    tree = hooks.render(slot.component);
    const enabled = findButton(tree, 'Подтвердить обновление');
    assert.equal(enabled.props.disabled, false, 'с галочкой подтверждение доступно');
  } finally {
    fixture.cleanup();
  }
});

/*
 * 0.9.4 (0041): сборка панели старше движка. Панель не предлагает «Обновить
 * движок» до версии сборки (это было бы понижением): в шапке и в разделе
 * версии она говорит «сборка панели старше» и «понижение движка запрещено»,
 * кнопка неактивна с объяснением, подтверждение не открывается.
 */
test('карточка panel-older: понижение не предлагается', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    /* Движок новее сборки панели: 99.0.0 > VERSION пакета. */
    const engineVersionFile = path.join(fixture.repo, 'docs', 'subagent-workflow', 'VERSION');
    fs.writeFileSync(engineVersionFile, '99.0.0\n');
    const installed = '99.0.0';
    const available = fs.readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();
    assert.ok(available !== installed, 'фикстура новее сборки панели');

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

    assert.ok(rendered.includes('сборка панели старше'), 'панель говорит «сборка панели старше»');
    assert.ok(rendered.includes('понижение движка запрещено'), 'панель говорит «понижение движка запрещено»');
    assert.ok(!rendered.includes('доступна v' + available), 'шапка не обещает версию сборки как доступное обновление');
    assert.match(rendered, /Установлено: v99\.0\.0/u, 'установленная версия названа');
    assert.ok(!/ошибк/iu.test(rendered), 'слово «ошибка» не используется');

    const update = findButton(tree, 'Обновить движок');
    assert.ok(update, 'кнопка обновления на месте');
    assert.equal(update.props.disabled, true, 'кнопка неактивна: понижение не предлагается');
    assert.equal(update.props['aria-disabled'], 'true', 'состояние объявлено для доступности');
    assert.match(update.props.title, /сборка панели старше|понижение движка запрещено/u, 'подсказка объясняет причину');

    /* Клик по неактивной кнопке не открывает подтверждение понижения. */
    update.props.onClick();
    tree = hooks.render(slot.component);
    rendered = textOf(tree);
    assert.ok(!rendered.includes('Обновление движка: подтверждение'), 'подтверждение не открылось');
    assert.equal(findButton(tree, 'Подтвердить обновление'), undefined, 'кнопки подтверждения нет');

    /* Сервер отказывает тем же кодом: 409 panel-older, движок не меняется. */
    const response = await globalThis.fetch('http://localhost/workflow/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: fixture.repo, confirm: true }),
    });
    assert.equal(response.status, 409);
    const body = JSON.parse(await response.text());
    assert.equal(body.code, 'panel-older');
    assert.equal(body.version, installed);
    assert.equal(body.targetVersion, available);
    assert.match(String(body.hint || ''), /понижение движка запрещено/u);
    assert.equal(fs.readFileSync(engineVersionFile, 'utf8').trim(), installed, 'движок не понижен');
  } finally {
    fixture.cleanup();
  }
});

/*
 * 0.9.0: воркспейс без движка читает движок снаружи по карте. Шапка называет
 * режим и путь, кнопки развёртывания и обновления неактивны с объяснением, а
 * сервер отвечает 409 engine-external — панель не обещает запись.
 */
test('mapped workspace reads the external engine and disables writes (0.9.0)', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-console-external-'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  const rootsFile = path.join(dir, 'engine-roots.json');
  fs.writeFileSync(rootsFile, JSON.stringify({ [ws]: fixture.repo }, null, 2));
  const engineRoot = path.resolve(fixture.repo);
  const savedRoots = process.env.WF_ENGINE_ROOTS;
  process.env.WF_ENGINE_ROOTS = rootsFile;
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [ws] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(80);
    tree = hooks.render(slot.component);
    const rendered = textOf(tree);
    assert.ok(rendered.includes('движок: внешний · ' + engineRoot), 'шапка называет путь внешнего движка');
    assert.match(rendered, /Сложение возвращает сумму/u, 'доска прочитана из внешнего движка');
    assert.match(rendered, /внешний движок:/u, 'раздел версии называет внешний движок');
    assert.ok(!findButton(tree, 'Развернуть workflow здесь'), 'развёртывание не предлагается');

    /* 0042: обновление внешнего движка доступно — но идёт в его репозиторий. */
    assert.match(rendered, /обновляется в репозитории движка/u, 'панель говорит, где обновляется движок');
    const update = findButton(tree, 'Обновить движок в репозитории движка');
    assert.ok(update, 'кнопка обновления в репозитории движка на месте');
    assert.equal(update.props.disabled, false, 'обновление внешнего движка доступно');
    assert.match(update.props.title, /репозитории движка/iu);
    assert.equal(fs.existsSync(path.join(ws, 'docs')), false, 'воркспейс не изменён');

    /* Сервер подтверждает: запись в это пространство — 409, а не 200. */
    const response = await globalThis.fetch('http://localhost/workflow/api/guard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: ws, enabled: true }),
    });
    assert.equal(response.status, 409);
    assert.equal(JSON.parse(await response.text()).code, 'engine-external');
  } finally {
    if (savedRoots === undefined) delete process.env.WF_ENGINE_ROOTS;
    else process.env.WF_ENGINE_ROOTS = savedRoots;
    fixture.cleanup();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
    } catch {
      /* утечка временного каталога не отменяет проверенное поведение */
    }
  }
});

/*
 * 2.6.16 (0042): обещание «доступно в этой сборке панели» для внешнего движка
 * снято. Панель говорит, что движок обновляется в его репозитории, называет
 * путь, а кнопка после подтверждения шлёт target: 'engine-repo' — тот же
 * репозиторий, а не воркспейс. Развёртывание и guard для внешнего движка
 * по-прежнему недоступны: это чужая территория.
 */
test('карточка external: обновление в репозитории движка', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  const engineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-engine-'));
  const mapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-map-'));
  const mapFile = path.join(mapDir, 'engine-roots.json');
  const previous = process.env.WF_ENGINE_ROOTS;
  try {
    /* Движок выносим наружу: воркспейс остаётся без docs/subagent-workflow. */
    const engineSrc = path.join(fixture.repo, 'docs', 'subagent-workflow');
    const engineDst = path.join(engineDir, 'docs', 'subagent-workflow');
    fs.mkdirSync(path.dirname(engineDst), { recursive: true });
    fs.renameSync(engineSrc, engineDst);
    fs.writeFileSync(mapFile, JSON.stringify({ [fixture.repo]: engineDir }) + '\n');
    process.env.WF_ENGINE_ROOTS = mapFile;

    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    const api = apiFetch(handler);
    let sent = null;
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).includes('/api/update')) {
        sent = JSON.parse(String(init.body || '{}'));
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ok: true,
            from: '2.2.1',
            version: fs.readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim(),
            engineRepo: engineDir,
            log: '',
          }),
        };
      }
      return api(url, init);
    };

    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);
    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);
    const rendered = textOf(tree);

    assert.match(rendered, /обновляется в репозитории движка/u,
      'панель говорит, что обновление идёт в репозитории движка');
    assert.ok(rendered.includes(engineDir), 'панель называет путь репозитория движка');
    assert.ok(!rendered.includes('Доступно в этой сборке панели'), 'старое обещание снято');

    const update = findButton(tree, 'Обновить движок в репозитории движка');
    assert.ok(update, 'кнопка «Обновить движок в репозитории движка» отрисована');
    assert.equal(update.props.disabled, false, 'кнопка активна: обновление возможно');
    assert.match(update.props.title, /репозитории движка/iu, 'подсказка называет репозиторий движка');

    update.props.onClick();
    tree = hooks.render(slot.component);
    const dialog = textOf(tree);
    assert.match(dialog, /в репозитории движка/u, 'подтверждение называет репозиторий движка');
    assert.ok(dialog.includes(engineDir), 'подтверждение называет путь');

    const confirm = findButton(tree, 'Подтвердить обновление');
    assert.ok(confirm, 'кнопка подтверждения в диалоге');
    assert.equal(confirm.props.disabled, false, 'подтверждение доступно: незавершённых заданий нет');

    confirm.props.onClick();
    await delay(80);
    assert.ok(sent, 'панель отправила запрос обновления');
    assert.equal(sent.target, 'engine-repo', 'цель запроса — репозиторий движка');
    assert.equal(sent.confirm, true, 'запрос только с подтверждением');
    assert.equal(sent.root, fixture.repo, 'корень — открытый воркспейс');
  } finally {
    if (previous === undefined) delete process.env.WF_ENGINE_ROOTS;
    else process.env.WF_ENGINE_ROOTS = previous;
    fixture.cleanup();
    try { fs.rmSync(engineDir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 }); } catch {}
    try { fs.rmSync(mapDir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 }); } catch {}
  }
});

/*
 * 0.9.3 (0039): карточка «движок не подключён» — не сообщение об ошибке, а
 * выбор из двух равноправных действий. Список кандидатов приходит с сервера:
 * только воркспейсы, где движок реально есть, с версией.
 */
