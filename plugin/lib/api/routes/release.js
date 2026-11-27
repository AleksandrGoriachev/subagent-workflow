/*
 * Проверка актуальности релиза.
 *
 * 0187: часть маршрутизатора plugin/lib/api/router.js; вход — router.js.
 */
import { releaseCheckPayload } from '../../release-check.mjs';
import { readJsonBody, sendJson } from '../http.js';

export async function check(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
  /*
   * 0102 (WC-65): проверка актуальности по требованию, не на загрузке
   * страницы. Ответ всегда 200: сеть упала — это состояние проверки, а не
   * ошибка маршрута, и панель обязана показать последнюю удачную пару.
   * Тело необязательно: панель шлёт пустой объект.
   */
  let checkBody = {};
  try {
    checkBody = await readJsonBody(req);
  } catch {
    checkBody = {};
  }
  const repoOverride = checkBody && typeof checkBody.repo === 'string' ? checkBody.repo.trim() : '';
  const payload = await releaseCheckPayload({
    repo: repoOverride !== '' ? repoOverride : undefined,
    fetchImpl: typeof runtime.fetchReleaseApi === 'function' ? runtime.fetchReleaseApi : undefined,
  });
  sendJson(res, 200, payload);
  return;
}

