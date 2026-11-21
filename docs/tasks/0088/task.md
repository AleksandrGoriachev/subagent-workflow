# Задание 0088. 2.6.88: бюджеты ожидания, маршрут вместо отказа, сторож повторов, образ результата

<!-- TASK-META
{
  "id": "0088",
  "version": 1,
  "title": "2.6.88: границы цикла узла — бюджет, маршрут, повторы, образ результата",
  "risk": "medium",
  "created": "2026-11-21",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "plugin/lib/wait-guard.js",
    "plugin/test/guard-router.test.mjs",
    "plugin/test/wait-guard.test.mjs",
    "spec/scripts/task-lint.mjs",
    "spec/scripts/init.mjs",
    "spec/SPEC.md",
    "tools/launch-metrics.mjs",
    "docs/metrics/**",
    "docs/tasks/0088/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "tools/commit.ps1",
    "tools/release.mjs"
  ],
  "redAllowDirty": [
    "docs/tasks/0088/**",
    "tools/launch-metrics.mjs",
    "docs/metrics/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Где стоят границы цикла",
      "chosen": "Три сторожа в plugin/lib/wait-guard.js: (1) повтор того же вызова после отказа — не более 2 раз, третий блокируется; (2) бюджет узла enforcement.nodeBudgetMs — запрос ожидания дольше остатка бюджета отклоняется с требованием промежуточной сдачи; (3) текст отказа несёт готовый маршрут в job.mjs (команда и wait), а не только «нельзя».",
      "options": ["Только текст отказа", "Сторожа повторов и бюджета + маршрут"],
      "impact": "user-visible",
      "evidence": { "kind": "criterion", "ref": "C1" }
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Как обеспечивается «образ результата»",
      "chosen": "В TASK-META появляется resultShape {artifact, format, criterion}; task-lint --strict без него падает, без --strict предупреждает; старые задачи не ломаются.",
      "options": ["Обязательно всегда", "Только под --strict"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C4" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "релиз 2.6.88 отдельной задачей; снапшот docs/metrics/baseline-2.6.87.json — точка «до»",
    "после деплоя 2.6.88 снять снимок «после» и сравнить тем же tools/launch-metrics.mjs --compare"
  ]
}
-->

## Цель

Цикл узла получает границы: повтор одного и того же вызова после отказа ограничен, бюджет узла
превращает долгое ожидание в требование промежуточной сдачи, отказ сторожа содержит готовый маршрут,
а контракт задачи обязан назвать образ результата. «До/после» измеряется одним инструментом.

## Что не входит

1. Правки хоста (жёсткий таймаут вызова инструмента) — это зона DSH.
2. Правки structure/чужих плагинов — только отчёт.
3. Релиз 2.6.88 (версии, тег, публикация) — отдельной задачей.

## Инварианты

1. Повтор после отказа: 1-й и 2-й проходят (существующее поведение), 3-й блокируется с маршрутом.
2. Исчерпанный бюджет: запрос ожидания дольше остатка отклоняется словами «промежуточн»; короткие вызовы проходят.
3. Отказ называет команду маршрута: строка `job.mjs start` и подсказка `job.mjs wait`.
4. `task-lint --strict` без `resultShape` — exit 1 и упоминание `resultShape`; с ним — exit 0.
5. Существующие задачи (`docs/tasks/0086`) под `--strict` проходят: обратная совместимость.
6. `tools/launch-metrics.mjs --compare` печатает таблицу изменений; baseline 2.6.87 лежит в `docs/metrics/`.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node --test plugin/test/guard-router.test.mjs --test-name-pattern="повтор"` | PASS, третий вызов отклонён |
| C2 | то же, `--test-name-pattern="бюджет"` | PASS, отказ со словом «промежуточн» |
| C3 | то же, `--test-name-pattern="маршрут"` | PASS, в тексте `job.mjs start` |
| C4 | `node spec/scripts/task-lint.mjs --task docs/tasks/0088/fixtures/without-shape --strict` | exit 1, упоминает `resultShape` |
| C5 | `node spec/scripts/task-lint.mjs --task docs/tasks/0088/fixtures/with-shape --strict` | exit 0 |
| C6 | `node spec/scripts/task-lint.mjs --task docs/tasks/0086 --strict` | exit 0 (совместимость) |
| C7 | `node spec/selftest.mjs` | `SELFTEST OK` |
| C8 | `node tools/launch-metrics.mjs --compare docs/metrics/baseline-2.6.87.json --workspaces e-trace --sessions 2` | exit 0, строка таблицы |
| C9 | `node plugin/tools/test.mjs` | exit 0 |
<!-- CRITERIA:END -->
