/**
 * Подмена GitHub, которая ведёт себя как GitHub (0104 / WC-67).
 *
 * Зачем: дефект 415 (2.6.53) проскочил все гейты, потому что подмена в тестах
 * возвращала «успешный ответ» и не смотрела на запрос. Тест доказывал, что код
 * умеет читать хороший ответ, но не проверял, правильно ли он разговаривает.
 *
 * Здесь мок моделирует сервер:
 *  - api.github.com без Accept: application/vnd.github+json → 415 (как настоящий);
 *  - api.github.com без User-Agent → 403;
 *  - режимы '503', 'timeout', 'asset-404' и failTimes — для отказов;
 *  - журнал запросов: { url, method, headers } — тест утверждает контракт.
 */
export const DEFAULT_RELEASE = {
  tag_name: 'v9.9.9',
  published_at: '2026-11-08T00:00:00Z',
  assets: [
    { name: 'dsh-workflow-console-9.9.9.tgz', browser_download_url: 'https://github.com/o/r/releases/download/v9.9.9/dsh-workflow-console-9.9.9.tgz' },
    { name: 'dsh-workflow-console-9.9.9.tgz.sha256', browser_download_url: 'https://github.com/o/r/releases/download/v9.9.9/dsh-workflow-console-9.9.9.tgz.sha256' },
    { name: 'subagent-workflow-9.9.9.tar.gz', browser_download_url: 'https://github.com/o/r/releases/download/v9.9.9/subagent-workflow-9.9.9.tar.gz' },
    { name: 'subagent-workflow-9.9.9.tar.gz.sha256', browser_download_url: 'https://github.com/o/r/releases/download/v9.9.9/subagent-workflow-9.9.9.tar.gz.sha256' },
  ],
};

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted) return String(value);
  }
  return '';
}

function reply(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body === undefined ? {} : body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    arrayBuffer: async () => Buffer.from(text, 'utf8'),
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

/**
 * @param {{mode?: 'ok'|'503'|'timeout'|'asset-404', release?: object, failTimes?: number, assetBody?: string}} [options]
 */
export function createGithubMock(options = {}) {
  const calls = [];
  const state = {
    mode: options.mode || 'ok',
    release: options.release || DEFAULT_RELEASE,
    failTimes: Number(options.failTimes) || 0,
    assetBody: options.assetBody === undefined ? 'asset-bytes' : options.assetBody,
  };

  async function fetchImpl(url, init = {}) {
    const target = String(url);
    const headers = init.headers || {};
    calls.push({
      url: target,
      method: init.method || 'GET',
      headers,
      accept: headerValue(headers, 'Accept'),
      userAgent: headerValue(headers, 'User-Agent'),
    });

    if (!headerValue(headers, 'User-Agent')) return reply(403, { message: 'User agent required' });
    if (state.failTimes > 0) {
      state.failTimes -= 1;
      const error = new Error('This operation was aborted');
      error.name = 'TimeoutError';
      throw error;
    }
    if (state.mode === 'timeout') {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    }
    if (state.mode === '503') return reply(503, { message: 'Service unavailable' });

    const isApi = /^https:\/\/api\.github\.com\//u.test(target);
    if (isApi) {
      /* Как настоящий API: JSON отдаётся только за правильный Accept. */
      if (!headerValue(headers, 'Accept').includes('application/vnd.github+json')) {
        return reply(415, { message: 'Unsupported media type' });
      }
      if (/\/releases\/latest$/u.test(target)) return reply(200, state.release);
      const byTag = target.match(/\/releases\/tags\/(.+)$/u);
      if (byTag) return reply(200, state.release);
      return reply(404, { message: 'Not Found' });
    }

    /* Ассеты: принимают любой Accept, но 404 в режиме asset-404. */
    if (state.mode === 'asset-404') return reply(404, { message: 'Not Found' });
    return reply(200, state.assetBody);
  }

  return { fetchImpl, calls, state };
}
