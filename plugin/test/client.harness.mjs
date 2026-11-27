/*
 * 0176: общий harness тестов панели. Один и тот же фейковый React, загрузчик
 * бандла, монтирование вида и HTTP-двойник для всех наборов; сами наборы —
 * client.*.test.mjs. Поведение хелперов перенесено из client.test.mjs без правок.
 */
import assert from 'node:assert/strict';

const ELEMENT = Symbol.for('react.element');

export function createElement(type, props, ...children) {
  return { $$typeof: ELEMENT, type, props: props || {}, children };
}

export function isValidElement(value) {
  return Boolean(value && value.$$typeof === ELEMENT);
}

export function texts(node, out = []) {
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

export function textOf(node) {
  return texts(node).join(' ');
}

export function elements(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
    return out;
  }
  if (node.type) out.push(node);
  if (node.children) elements(node.children, out);
  return out;
}

export function findButton(tree, text) {
  return elements(tree).find(
    (element) => element.type === 'button' && textOf(element).replace(/\s+/g, ' ').includes(text),
  );
}

export function findBadge(tree, text) {
  return elements(tree).find(
    (element) => element.type === 'span' && textOf(element).replace(/\s+/g, ' ').trim() === text,
  );
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeReact() {
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

export async function loadBundle(ReactImpl) {
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

export function mount(plugin, workspaceService = null) {
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

export function fakeWorkspace(path, title = 'fixture-workspace') {
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

export function apiFetch(handler) {
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
