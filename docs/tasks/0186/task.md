# Задание 0186. Маршрутизатор панели разложен по доменам; порог размера файлов записан и проверяется

<!-- TASK-META
{
  "id": "0186",
  "version": 1,
  "title": "createWebHandler (912 строк) разложен на plugin/lib/api/routes/*.js; порог 600/900 записан в docs/CODE-SIZE.md и проверяется code-size.mjs",
  "risk": "medium",
  "created": "2026-11-28",
  "owner": "координатор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "deviation": "корень пакета вне разрешённых корней спавна узла judge (root-not-allowed); приёмку выполняет отдельная сессия узла judge",
  "issuedBy": { "kind": "agent", "session": "session-eceafc45-4b60-4614-abe3-c21aa1a76432", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "plugin/lib/api/router.js",
    "plugin/lib/api/routes/**",
    "docs/CODE-SIZE.md",
    "docs/tasks/0186/**"
  ],
  "protectedPaths": [
    "spec/checks/code-size.mjs",
    "spec/checks/router-split.mjs",
    "spec/scripts/task-verify.mjs",
    "spec/scripts/task-red.mjs",
    "spec/scripts/task-hash.mjs",
    "VERSION",
    "package.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0186/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как разложить 912-строчную createWebHandler, не меняя ни один ответ",
      "chosen": "18 маршрутов уходят в plugin/lib/api/routes/{status,engine,plugin,writes,run,anchors,release}.js как обработчики (ctx: runtime, selection, url, req, res, rel); router.js остаётся диспетчером с таблицей «путь → POST/GET + обработчик», проверкой loopback, /api/task/<id> и прежними 404/500/405",
      "options": ["оставить одну функцию", "таблица маршрутов и modules по доменам"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C1" },
      "reversible": true
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Как зафиксировать порог 600/900, чтобы файлы не отрастали",
      "chosen": "Правило записано в docs/CODE-SIZE.md и проверяется spec/checks/code-size.mjs c1 (fail >900, WARN >600); сгенерированный client.js исключён, тесты — отдельный контур",
      "options": ["только устная договорённость", "документ + исполняемая проверка"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "plugin/lib/api/routes/*.js (7 модулей) + тонкий router.js; docs/CODE-SIZE.md; spec/checks/code-size.mjs, router-split.mjs", "format": "код+данные+проверки", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["api.test.mjs (939) — отдельный шаг: наборы по группам маршрутов + общий harness"]
}
-->

## Цель

Маршрутизатор панели перестаёт быть одной функцией на 912 строк: маршруты
/workflow/api/* живут по доменам (`status`, `engine`, `plugin`, `writes`, `run`,
`anchors`, `release`), а `router.js` — диспетчер с таблицей маршрутов. Одновременно
фиксируется правило порога: >600 строк — ревизия, >900 — отдельная задача, и оно
проверяется машиной.

## Что не входит

1. Изменение поведения маршрутов: пути, методы, коды ответов, тела и порядок проверок.
2. Разбиение `plugin/test/api.test.mjs` — отдельный follow-up.
3. Правка движка, релиз, развёрнутая копия.

## Инварианты

1. Все 18 путей прежние; POST-пути требуют POST и отвечают 405 с `Allow: POST`, GET-пути — GET и `Allow: GET`; неизвестный путь — 404, исключение — 500 (если ответ ещё не отправлен).
2. `/api/task/<id>` остаётся GET-ветвью с прежними 400/404/200.
3. router.js ≤ 200 строк; каждый модуль routes ≤ 400 строк; порог 900 в code-size c1 соблюдён.

## Границы знания

1. Дано: репозиторий пакета и это задание.
2. Менять можно только allowedPaths; проверки `code-size.mjs` и `router-split.mjs` неприкосновенны.
3. Не коммитить, не пушить, не деплоить.

## Среда

- node 25, Windows. Тяжёлые прогоны — сторожем движка (`gate.mjs`, `job.mjs`).
- Полный набор: `node tools/check-tests.mjs` (правки `plugin/**` — полный набор плагина).

## Отчёт

1. Раскладка по модулям и что осталось в диспетчере; где записано правило порога.
2. Файлы — полными путями.
3. Каждый критерий — команда, exit код, дословный вердикт.

## Коммит

Кандидата создаёт `task-accept`; коммит — после записи о приёмке.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/router-split.mjs c1` | `ROUTER-SPLIT OK c1` (7 модулей, router ≤ 200 строк, 18 путей и /api/task/<id> в диспетчере) |
| C2 | `node spec/checks/code-size.mjs c1` | `CODE-SIZE OK c1` (правило записано, ни один рукописный файл не больше 900 строк) |
| C3 | `node spec/checks/router-split.mjs c2` | `ROUTER-SPLIT OK c2` (компаратор отвергает потерянный путь) |
| C4 | `node tools/check-tests.mjs` | exit 0 (полный набор тестов плагина) |
| C5 | `node spec/checks/code-size.mjs c2` | `CODE-SIZE OK c2` (компаратор порога и исключение артефакта) |
<!-- CRITERIA:END -->
