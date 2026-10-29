import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowRuntime, createWebHandler } from '../lib/api.js';
import { makeRepo, git } from './fixture.mjs';

const ELEMENT = Symbol.for('react.element');

function createElement(type, props, ...children) {
  return { $$typeof: ELEMENT, type, props: props || {}, children };
}

function isValidElement(value) {
  return Boolean(value && value.$$typeof === ELEMENT);
}

function texts(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) texts(child, out);
    return out;
  }
  if (node.children) texts(node.children, out);
  return out;
}

function textOf(node) {
  return texts(node).join(' ');
}

function elements(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
    return out;
  }
  if (node.type) out.push(node);
  if (node.children) elements(node.children, out);
  return out;
}

function findButton(tree, text) {
  return elements(tree).find(
    (element) => element.type === 'button' && textOf(element).replace(/\s+/g, ' ').includes(text),
  );
}

function findBadge(tree, text) {
  return elements(tree).find(
    (element) => element.type === 'span' && textOf(element).replace(/\s+/g, ' ').trim() === text,
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeReact() {
  const states = [];
  const effects = [];
  let cursor = 0;
  return {
    states,
    effects,
    React: {
      createElement,
      isValidElement,
      useState(initial) {
        const index = cursor;
        cursor += 1;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], (next) => {
          states[index] = typeof next === 'function' ? next(states[index]) : next;
        }];
      },
      useEffect(effect) {
        effects.push(effect);
      },
      useCallback(fn) {
        return fn;
      },
      useMemo(fn) {
        return fn();
      },
    },
    render(component) {
      cursor = 0;
      return component();
    },
    drain() {
      const pending = effects.splice(0);
      for (const effect of pending) effect();
    },
  };
}

async function loadBundle(ReactImpl) {
  let registration = null;
  globalThis.window = {
    __ModuleLoader__: {
      load(value) {
        registration = value;
      },
    },
  };
  await import('../lib/client.js?test=' + Math.random().toString(36).slice(2));
  assert.ok(registration, 'bundle registered itself');
  return registration.factory((specifier) => {
    if (specifier === 'react') return ReactImpl;
    throw new Error('unexpected require: ' + specifier);
  });
}

function mount(plugin, workspaceService = null) {
  let slot = null;
  plugin.apply({
    get(name) {
      return name === 'uiWorkspace' ? workspaceService : undefined;
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'conversation.view');
        callback();
      },
      register(options, component) {
        slot = { options, component };
      },
    },
  });
  return slot;
}

function fakeWorkspace(path, title = 'fixture-workspace') {
  return {
    mainReference: { sessionId: 's1' },
    sessions: {
      list: {
        getSnapshot: () => ({
          byId: { s1: { id: 's1', cwd: path, retainedBy: { mainView: 1 } } },
        }),
      },
    },
    workspaces: {
      list: {
        getSnapshot: () => ({
          items: [{ workspaceId: 'w1', path, title, sessionIds: ['s1'] }],
        }),
      },
    },
  };
}

function apiFetch(handler) {
  return async (url, init = {}) => {
    const parsed = new URL(url, 'http://localhost');
    const method = String(init.method || 'GET').toUpperCase();
    const res = {
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
    /*
     * 2.6.3: как настоящий HTTP-слой, имена заголовков в нижнем регистре — от
     * них зависит проверка Content-Type/Origin изменяющих POST-маршрутов.
     */
    const headers = {};
    for (const [key, value] of Object.entries(init.headers || {})) {
      headers[String(key).toLowerCase()] = value;
    }
    const request = {
      method,
      url: parsed.pathname + parsed.search,
      headers,
      socket: { remoteAddress: '127.0.0.1' },
    };
    if (typeof init.body === 'string' && init.body.length > 0) {
      const listeners = { data: [], end: [], error: [] };
      request.on = (event, fn) => {
        (listeners[event] = listeners[event] || []).push(fn);
        return request;
      };
      queueMicrotask(() => {
        for (const fn of listeners.data) fn(Buffer.from(init.body, 'utf8'));
        for (const fn of listeners.end) fn();
      });
    }
    await handler(request, res);
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      text: async () => res.body,
    };
  };
}

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
  assert.equal(slot.options.label(), 'Workflow');
  assert.equal(typeof slot.component, 'function');

  const rendered = textOf(slot.component());
  assert.match(rendered, /Workflow/);
  assert.match(rendered, /Доска/);
  assert.match(rendered, /Политика/);
  assert.match(rendered, /Обновить/);
  assert.match(rendered, /workflow не развёрнут/);
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

test('badges explain themselves: hints on hover and focus (WC-1)', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    // Правка защищённого файла после замка даёт блокирующий флаг.
    fs.appendFileSync(path.join(fixture.repo, 'checks', 'add.mjs'), '\n// правка после замка\n');
    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);
    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);

    const exact = (text) => elements(tree).find(
      (element) => element.type === 'span' && textOf(element).replace(/\s+/g, ' ').trim() === text,
    );

    const risk = exact('medium');
    assert.ok(risk, 'риск-бейдж на доске');
    assert.match(risk.props.title, /^Риск задания: средний/);
    assert.match(risk.props['aria-label'], /Риск задания/);
    assert.equal(risk.props.tabIndex, undefined, 'внутри кнопки-карточки бейдж не фокусируется');

    const errors = elements(tree).find(
      (element) => element.type === 'span' && /^ошибок \d+$/.test(textOf(element).trim()),
    );
    assert.ok(errors, 'бейдж «ошибок N»');
    assert.match(errors.props.title, /Блокирующие замечания/);

    const warnings = elements(tree).find(
      (element) => element.type === 'span' && /^предупр\. \d+$/.test(textOf(element).trim()),
    );
    assert.ok(warnings, 'бейдж «предупр. N»');
    assert.match(warnings.props.title, /Некритичные предупреждения/);

    const cardButton = findButton(tree, '0001');
    cardButton.props.onClick();
    await delay(120);
    tree = hooks.render(slot.component);

    const stage = elements(tree).find(
      (element) => element.type === 'span' && textOf(element).trim() === 'Замечания' && element.props.title,
    );
    assert.ok(stage, 'бейдж стадии в карточке');
    assert.match(stage.props.title, /^Замечания — /);
    assert.equal(stage.props.tabIndex, 0, 'бейдж стадии доступен с клавиатуры');

    const flagCode = elements(tree).find(
      (element) => element.type === 'span' && textOf(element).trim() === 'lock-mismatch-protected',
    );
    assert.ok(flagCode, 'код флага в карточке');
    assert.match(flagCode.props.title, /защищённые файлы/i);
  } finally {
    fixture.cleanup();
  }
});

/*
 * 0.4.1: бейджи внутри кнопки-карточки не фокусируются, поэтому подсказки
 * эффекта и регресса обязаны попадать в aria-label самой кнопки. И в карточке
 * появляется раздел «Регресс» с просроченным reviewBy.
 */
test('card aria-label carries effect and regress hints, card shows «Регресс» (0.4.1)', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    fs.writeFileSync(path.join(fixture.repo, 'regress.baseline.json'), JSON.stringify({
      version: 1,
      generatedAt: '2026-10-01T00:00:00.000Z',
      entries: [{
        task: '0001',
        status: 'unproven-lawful',
        reason: 'low: красный прогон не требуется',
        since: '2026-10-01',
        reviewBy: '2000-01-01',
      }],
    }, null, 2) + '\n');

    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);
    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);

    const cardButton = findButton(tree, '0001');
    const aria = cardButton.props['aria-label'];
    assert.match(aria, /Эффект решения/u, 'подсказка эффекта в aria-label кнопки');
    assert.match(aria, /Регресс-долг/u, 'подсказка регресса в aria-label кнопки');
    assert.match(aria, /unproven-lawful/u);
    assert.match(aria, /срок истёк/u);

    const effectBadge = findBadge(tree, 'эффект');
    assert.ok(effectBadge, 'бейдж «эффект» на доске');
    assert.match(effectBadge.props.title, /требует эффекта/u);
    assert.equal(effectBadge.props.tabIndex, undefined, 'внутри кнопки бейдж не фокусируется');

    const regressBadge = findBadge(tree, 'регресс: unproven-lawful');
    assert.ok(regressBadge, 'бейдж регресса на доске');
    assert.equal(regressBadge.props.tabIndex, undefined, 'внутри кнопки бейдж не фокусируется');

    cardButton.props.onClick();
    await delay(120);
    const rendered = textOf(hooks.render(slot.component));
    assert.match(rendered, /Регресс/u, 'раздел «Регресс» в карточке');
    assert.match(rendered, /reviewBy/u);
    assert.match(rendered, /unproven-lawful/u);
    assert.match(rendered, /2000-01-01 — срок истёк/u);
    assert.match(rendered, /low: красный прогон не требуется/u);
  } finally {
    fixture.cleanup();
  }
});

/*
 * 0.4.1: цвет бейджа «эффект» — строгость флага effect-problem из политики.
 * Статус missing одинаков во всех трёх случаях, значит различие даёт policy.
 */
test('badge «эффект» colored by policy severity, not by status (0.4.1)', async () => {
  const cases = [
    { policy: 'fail', token: '#ec1313', hint: /требует эффекта/u },
    { policy: 'warn', token: '#f59e0b', hint: /требует эффекта/u },
    { policy: 'off', token: 'rgba(127,127,127,0.78)', hint: /decisions=off/u },
  ];
  for (const item of cases) {
    const fixture = makeRepo({ stage: 'remarks' });
    try {
      const configPath = path.join(fixture.repo, 'docs', 'subagent-workflow', 'workflow.config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.policy.decisions = item.policy;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
      globalThis.fetch = apiFetch(handler);
      const hooks = makeReact();
      const plugin = await loadBundle(hooks.React);
      const slot = mount(plugin);
      let tree = hooks.render(slot.component);
      hooks.drain();
      await delay(120);
      tree = hooks.render(slot.component);

      const effectBadge = findBadge(tree, 'эффект');
      assert.ok(effectBadge, 'бейдж «эффект» при decisions=' + item.policy);
      assert.ok(
        String(effectBadge.props.style.color).includes(item.token),
        'decisions=' + item.policy + ': цвет бейджа из строгости (' + effectBadge.props.style.color + ')',
      );
      assert.match(effectBadge.props.title, item.hint);
    } finally {
      fixture.cleanup();
    }
  }
});

/*
 * 0.4.1: checked=false — это «не проверялось», а не «ok». «ok» показываем
 * только когда ворота действительно провели проверку.
 */
test('card says «не проверялось» when gates did not check the effect (0.4.1)', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const verifyPath = path.join(fixture.taskDir, 'verify.json');
    const verify = JSON.parse(fs.readFileSync(verifyPath, 'utf8'));
    verify.effects = { required: true, checked: false, ok: true };
    fs.writeFileSync(verifyPath, JSON.stringify(verify, null, 2) + '\n');
    const recordPath = path.join(fixture.taskDir, 'acceptance.json');
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    record.effectConsistency = { checked: false, ok: true };
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');

    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);
    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);
    findButton(tree, '0001').props.onClick();
    await delay(120);
    const rendered = textOf(hooks.render(slot.component));

    assert.match(rendered, /не проверялось/u);
    assert.ok(!/verify\.json\s+ok/u.test(rendered), 'verify.json не должен выглядеть проверенным');
    assert.ok(!/запись приёмки\s+ok/u.test(rendered), 'запись приёмки не должна выглядеть проверенной');
  } finally {
    fixture.cleanup();
  }
});

test('diagnostics buttons run a read-only check and show the log (v2, step 1)', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const scripts = path.join(fixture.repo, 'docs', 'subagent-workflow', 'scripts');
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, 'task-lint.mjs'), "console.log('fake lint: 0001 — ок');\n", 'utf8');

    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);

    const doctor = findButton(tree, 'Проверить настройку');
    assert.ok(doctor, 'кнопка «Проверить настройку» в шапке');
    assert.match(doctor.props.title, /всё ли готово/u);
    assert.match(doctor.props.title, /Ничего не меняет/u);

    findButton(tree, '0001').props.onClick();
    await delay(120);
    tree = hooks.render(slot.component);
    const lint = findButton(tree, 'Проверить задание');
    const accept = findButton(tree, 'Проверить запись');
    assert.ok(lint, 'кнопка «Проверить задание» в карточке');
    assert.ok(accept, 'кнопка «Проверить запись» в карточке');
    assert.match(lint.props.title, /Только чтение/u);

    lint.props.onClick();
    /*
     * Проверка запускается отдельным процессом: на загруженной машине она может
     * занять больше секунды. Ждём появления вывода, а не фиксированные 600 мс.
     */
    let rendered = '';
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await delay(200);
      hooks.drain();
      rendered = textOf(hooks.render(slot.component));
      if (/fake lint: 0001 — ок/u.test(rendered)) break;
    }
    tree = hooks.render(slot.component);
    assert.match(rendered, /fake lint: 0001 — ок/u);
    assert.match(rendered, /Только чтение: проверка не пишет в репозиторий/u);
    assert.match(rendered, /task-lint\.mjs --task docs\/tasks\/0001/u);
  } finally {
    fixture.cleanup();
  }
});

test('panel does not substitute a foreign project: empty state first, configured roots on request', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin, fakeWorkspace('C:\\other-workspace', 'other-workspace'));
    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(80);
    tree = hooks.render(slot.component);
    let text = textOf(tree);
    assert.match(text, /Текущий workspace: other-workspace/);
    assert.match(text, /workflow не развёрнут/);
    assert.ok(!text.includes('Сложение возвращает сумму'), 'чужой проект не показывается сам');
    const reveal = findButton(tree, 'Показать репозитории из настроек');
    assert.ok(reveal, 'кнопка явного выбора настроенных репозиториев');
    reveal.props.onClick();
    await delay(20);
    tree = hooks.render(slot.component);
    const pick = findButton(tree, path.basename(fixture.repo));
    assert.ok(pick, 'настроенный корень появляется только по запросу');
    pick.props.onClick();
    await delay(80);
    tree = hooks.render(slot.component);
    text = textOf(tree);
    assert.match(text, /Сложение возвращает сумму/);
  } finally {
    fixture.cleanup();
  }
});

/*
 * 0.7.0: в пространстве без движка пустое состояние не отправляет в терминал, а
 * предлагает кнопку. Подтверждение перечисляет, что появится в проекте; отказ от
 * подтверждения не пишет ничего; после согласия движок разворачивается и панель
 * перечитывает состояние.
 */
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

test('deploy failure shows the code and the init tail (0.7.0)', async () => {
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
    const deploy = findButton(tree, 'Развернуть workflow здесь');
    assert.ok(deploy, 'кнопка есть и в не-git пространстве: отказ объясняет сервер');

    globalThis.window.confirm = () => true;
    deploy.props.onClick();
    let rendered = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(100);
      hooks.drain();
      rendered = textOf(hooks.render(slot.component));
      if (/not-a-repo/u.test(rendered)) break;
    }
    assert.match(rendered, /Развернуть не удалось/u);
    assert.match(rendered, /not-a-repo/u, 'код отказа виден в плашке');
    assert.match(rendered, /не git-репозиторий/u);
    assert.equal(fs.existsSync(path.join(dir, 'docs')), false, 'отказ ничего не пишет');
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
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
