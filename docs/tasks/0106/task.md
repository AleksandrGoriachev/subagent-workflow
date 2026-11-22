# Задание 0106. 2.6.96: параллельный прогон тестов и монитор задач

<!-- TASK-META
{
  "id": "0106",
  "version": 1,
  "title": "2.6.96: скорость гейта и мониторинг задач (баги видны сразу)",
  "risk": "medium",
  "created": "2026-11-22",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "plugin/tools/test.mjs",
    "plugin/lib/api.js",
    "plugin/lib/client.js",
    "plugin/test/task-monitor.test.mjs",
    "tools/task-monitor.mjs",
    "spec/SPEC.md",
    "docs/tasks/0106/**"
  ],
  "protectedPaths": ["spec/checks/**", "spec/scripts/**"],
  "redAllowDirty": ["docs/tasks/0106/**"],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как ускорить гейт без потери качества",
      "chosen": "Вернуть параллельный прогон тестов по умолчанию (WF_TEST_CONCURRENCY=auto → cpus-1, минимум 2): причина прежних флейков (git ETIMEDOUT в фикстурах) устранена в 2.6.93 ретраем и таймаутом WF_GIT_TIMEOUT_MS; последовательный режим остаётся через WF_TEST_CONCURRENCY=1. Набор тестов тот же — качество не меняется.",
      "options": ["Оставить последовательно", "Параллельно по умолчанию с фолбэком"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C5" },
      "reversible": true
    },
    {
      "id": "D2",
      "class": "semantic",
      "question": "Где живёт мониторинг моих задач",
      "chosen": "Тул tools/task-monitor.mjs читает docs/tasks/* (контракт/красный/verify/приёмка), считает стадию, время с последнего артефакта и флаги (красный не доказан, verify красный, нет приёмки, зависло), публикует <root>/.dsh/workflow/tasks.json; панель показывает блок «Задачи» на вкладке «Метрики», API /api/tasks отдаёт снимок.",
      "options": ["Только отчёт руками", "Тул + панель + снимок"],
      "impact": "user-visible",
      "evidence": { "kind": "criterion", "ref": "C1" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "docs/tasks/0106/report.json", "format": "json", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["релиз 2.6.96 отдельной задачей", "следующий шаг — отбор тестов по изменённым файлам (tests-for)"]
}
-->

## Цель

Гейт тестов плагина снова идёт параллельно (быстрее в ~2 раза), а задачи воркспейса видны монитором:
стадия, задержки и флаги проблем — чтобы баг не ждал следующего релиза.

## Границы знания

Только `plugin/tools/test.mjs`, новый `tools/task-monitor.mjs`, блок панели и его тест.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерии и verify.log.

## Коммит

Коммитится по правилам движка.

## Что не входит

1. Отбор тестов по изменённым файлам (`tests-for`) — следующий шаг.
2. Правки блока якорей.
3. Релиз 2.6.96 — отдельной задачей.

## Инварианты

1. Параллельный прогон по умолчанию; `WF_TEST_CONCURRENCY=1` — последовательно; набор тестов не меняется.
2. Монитор не пишет в задачи, только читает; снимок публикуется в `<root>/.dsh/workflow/tasks.json`.
3. `/api/tasks` отдаёт снимок как есть; нет файла — 404 с подсказкой.
4. Флаги: `red-not-proven`, `verify-red`, `no-acceptance`, `stalled`, `superseded`.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node tools/task-monitor.mjs --json` | JSON со списком задач и summary |
| C2 | `node tools/task-monitor.mjs --publish <tmp>` | `.dsh/workflow/tasks.json` создан |
| C3 | `plugin/lib/api.js` содержит маршрут `/api/tasks` | exit 0 |
| C4 | `plugin/lib/client.js` содержит блок «Задачи» | exit 0 |
| C5 | `node plugin/tools/test.mjs` | exit 0 |
| C6 | `node --test plugin/test/task-monitor.test.mjs` | все PASS |
<!-- CRITERIA:END -->
