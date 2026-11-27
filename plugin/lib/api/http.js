/*
 * HTTP-обвязка: loopback, Origin/Content-Type, чтение тела, ответ JSON.
 *
 * 0180: часть plugin/lib/api.js; публичный вход — plugin/lib/api.js.
 */
export function isLoopback(req) {
  const address = req.socket && req.socket.remoteAddress;
  if (address === undefined || address === null || address.length === 0) return true;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/*
 * 2.6.3 (B4): защита изменяющих POST-маршрутов.
 *
 * Content-Type обязателен и только application/json: text/plain — «простой
 * запрос» браузера, он уходит с чужой страницы без preflight, и сервер не
 * должен разбирать такое тело как команду. Origin: отсутствие допустимо (curl,
 * старое same-origin поведение), а чужой Origin отвергается. Проверки стоят до
 * чтения тела и любых записей.
 */
export const LOOPBACK_ORIGIN_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isJsonRequest(req) {
  const headers = req && req.headers ? req.headers : {};
  const raw = headers['content-type'];
  if (typeof raw !== 'string') return false;
  return raw.split(';')[0].trim().toLowerCase() === 'application/json';
}

export function originAllowed(req) {
  const headers = req && req.headers ? req.headers : {};
  const raw = headers.origin;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  let origin;
  try {
    origin = new URL(String(raw));
  } catch {
    return false;
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return false;
  const host = typeof headers.host === 'string' ? headers.host.trim().toLowerCase() : '';
  if (host.length > 0) return origin.host.toLowerCase() === host;
  /*
   * Заголовка Host нет только у прямого вызова обработчика (тесты) и у
   * нестандартных прокси: там сверять не с чем, поэтому разрешаем loopback-
   * источник — панель всегда открыта на 127.0.0.1/localhost.
   */
  return LOOPBACK_ORIGIN_HOSTS.has(origin.hostname);
}

/** @returns {{status: number, error: string}|null} */
export function writeRequestProblem(req) {
  if (!isJsonRequest(req)) {
    return { status: 415, error: 'Content-Type должен быть application/json' };
  }
  if (!originAllowed(req)) {
    return { status: 403, error: 'Origin не совпадает с хостом панели' };
  }
  return null;
}

/** Read a small JSON body; the only POST route takes one. */
export function readJsonBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    if (!req || typeof req.on !== 'function') {
      resolve({});
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('тело запроса слишком большое'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(text);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new Error('тело запроса не JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

/*
 * 2.6.9 (0034): внешний движок.
 *
 * Воркспейс без движка (split-optimizer: только .dsh и structure) читает движок
 * по карте %USERPROFILE%\.dsh\workflow\engine-roots.json (env WF_ENGINE_ROOTS).
 * Чтение идёт из резолвнутого движка, а запись в такой воркспейс запрещена
 * кодом engine-external: сам воркспейс не меняется. Обычный случай — движок в
 * воркспейсе (source 'workspace') или его нет вовсе (source 'none') — работает
 * как раньше.
 */
