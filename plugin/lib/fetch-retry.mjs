/**
 * Загрузка с таймаутом и повтором (0101).
 *
 * GitHub под нагрузкой отвечает 503/504 или рвёт соединение посреди ответа, а
 * прокси в этом окружении добавляет свои таймауты: 08.11 проверка релиза падала
 * с "HTTP 504" и "This operation was aborted", хотя через минуту тот же запрос
 * проходил. Один сетевой сбой не должен означать «обновления нет» — поэтому
 * загрузка повторяется, а причина называется словами.
 */
export const DEFAULT_TIMEOUT_MS = 60000;
export const DEFAULT_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 1500;

/** Код ответа, при котором повтор осмыслен: 408, 425, 429 и 5xx. */
function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * @param {Function} fetchImpl fetch или его подмена
 * @param {string} url
 * @param {{timeoutMs?: number, attempts?: number, label?: string, headers?: object, fetchOptions?: object}} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(fetchImpl, url, options = {}) {
  const fetcher = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  if (typeof fetcher !== 'function') throw new Error('нет fetch для загрузки ' + url);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const attempts = Number(options.attempts) > 0 ? Number(options.attempts) : DEFAULT_ATTEMPTS;
  const label = options.label || 'файл';
  const delayMs = Number(options.delayMs) >= 0 ? Number(options.delayMs) : RETRY_DELAY_MS;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
      const response = await fetcher(url, {
        ...(options.fetchOptions || {}),
        ...(signal ? { signal } : {}),
        ...(options.headers ? { headers: options.headers } : {}),
      });
      if (!response || response.ok !== true) {
        const status = response && response.status !== undefined ? Number(response.status) : 0;
        const error = new Error('HTTP ' + (status || '?') + ' при загрузке ' + label
          + ' — попытка ' + attempt + ' из ' + attempts);
        error.status = status;
        if (!retryableStatus(status)) throw error;
        lastError = error;
      } else {
        return response;
      }
    } catch (error) {
      /* Неретраибельный ответ уже помечен: 4xx кроме 408/425/429 не повторяем. */
      if (error && error.status !== undefined && !retryableStatus(error.status)) throw error;
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  const reason = lastError && lastError.message ? lastError.message : 'сеть недоступна';
  const finalError = new Error(reason + ' — ' + attempts + ' попытки исчерпаны, повторите позже');
  finalError.cause = lastError || undefined;
  throw finalError;
}
