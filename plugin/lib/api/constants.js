/*
 * Константы HTTP-половины: префикс маршрутов, имя плагина, источник обновления из релиза.
 *
 * 0180: часть plugin/lib/api.js; публичный вход — plugin/lib/api.js.
 */
export const API_PREFIX = '/workflow';
export const PLUGIN_NAME = 'dsh-workflow-console';

/*
 * 2.6.28 (0067): откуда панель берёт движок для обновления из релиза.
 * apiBase/repo можно переопределить в runtime (конфиг профиля, тесты); значения
 * по умолчанию — публичный GitHub и репозиторий движка.
 */
export const DEFAULT_UPDATE_SOURCE = {
  apiBase: 'https://api.github.com',
  repo: 'AleksandrGoriachev/subagent-workflow',
};

