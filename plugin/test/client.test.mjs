import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorkflowRuntime, createWebHandler } from '../lib/api.js';
import { makeRepo } from './fixture.mjs';

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
  return async (url) => {
    const parsed = new URL(url, 'http://localhost');
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
    await handler(
      { method: 'GET', url: parsed.pathname + parsed.search, socket: { remoteAddress: '127.0.0.1' } },
      res,
    );
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
  assert.match(rendered, /Нет данных/);
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

test('panel falls back to a configured root and explains the location', async () => {
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
    const text = textOf(tree);
    assert.match(text, /Текущий workspace: other-workspace/);
    assert.match(text, /workflow не развёрнут/);
    assert.match(text, /Сложение возвращает сумму/);
  } finally {
    fixture.cleanup();
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
