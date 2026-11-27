# Задание 0180. api.js разложен на модули, публичный вход сохранён

<!-- TASK-META
{
  "id": "0180",
  "version": 1,
  "title": "plugin/lib/api.js (1411 строк) разложен на plugin/lib/api/*.js; api.js — тонкий вход с прежними 6 именами",
  "risk": "medium",
  "created": "2026-11-27",
  "owner": "координатор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "deviation": "корень пакета вне разрешённых корней спавна узла judge (root-not-allowed); приёмку выполняет отдельная сессия узла judge",
  "issuedBy": { "kind": "agent", "session": "session-eceafc45-4b60-4614-abe3-c21aa1a76432", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "plugin/lib/api.js",
    "plugin/lib/api/**",
    "docs/tasks/0180/**"
  ],
  "protectedPaths": [
    "spec/checks/api-split.mjs",
    "spec/scripts/**",
    "VERSION",
    "package.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0180/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как разложить api.js, если его импортируют тесты, index.js и dev-server",
      "chosen": "Код уходит в plugin/lib/api/{constants,roots,http,payloads,router}.js; api.js остаётся публичным входом с прежними именами (createWorkflowRuntime, createWebHandler, registerWorkflowWeb, API_PREFIX, PLUGIN_NAME, DEFAULT_UPDATE_SOURCE), импортёры не правятся",
      "options": ["править импортёров", "тонкий вход api.js"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "plugin/lib/api/*.js (5 модулей) + тонкий api.js; spec/checks/api-split.mjs c1|c2|c3", "format": "код+проверки", "criterion": "C2" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

HTTP-половина панели перестаёт быть одним файлом на 1411 строк: константы, корни и рантайм, HTTP-обвязка,
ответы состояния и маршрутизатор живут отдельными модулями, а `plugin/lib/api.js` остаётся тонким входом с
прежними шестью публичными именами. Поведение маршрутов не меняется.

## Что не входит

1. Разбиение самого маршрутизатора на файлы по доменам — отдельный шаг, если понадобится.
2. Правка поведения маршрутов: коды ответов, тела, проверки Origin/Content-Type — без изменений.
3. Правка импортёров (`index.js`, тесты, `tools/dev-server.mjs`).

## Инварианты

1. `import { createWorkflowRuntime, createWebHandler } from './api.js'` работает как раньше.
2. api.js не содержит тела `createWebHandler`/`createWorkflowRuntime`/`selectRoot`; модуль ≤ 1000 строк, api.js ≤ 80.
3. Все 18 маршрутов и их ответы не меняются (полный набор тестов плагина).

## Границы знания

1. Дано: репозиторий пакета и это задание.
2. Менять можно только allowedPaths; проверка `spec/checks/api-split.mjs` после контракта неприкосновенна.
3. Не коммитить, не пушить, не деплоить.

## Среда

- node 25, Windows. Тяжёлые прогоны — сторожем движка (`gate.mjs`, `job.mjs`).
- Полный набор: `node tools/check-tests.mjs` (правки `plugin/**` — полный набор плагина).

## Отчёт

1. Раскладка по модулям.
2. Файлы — полными путями.
3. Каждый критерий — команда, exit код, дословный вердикт.

## Коммит

Кандидата создаёт `task-accept`; коммит — после записи о приёмке.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/api-split.mjs c1` | `API-SPLIT OK c1` (5 модулей ≤ 1000 строк) |
| C2 | `node spec/checks/api-split.mjs c2` | `API-SPLIT OK c2` (api.js ≤ 80 строк, 6 имён, без тела маршрутизатора) |
| C3 | `node spec/checks/api-split.mjs c3` | `API-SPLIT OK c3` (компараторы отвергают потерю имени и тело в api.js) |
| C4 | `node tools/check-tests.mjs` | exit 0 (полный набор тестов плагина) |
<!-- CRITERIA:END -->
