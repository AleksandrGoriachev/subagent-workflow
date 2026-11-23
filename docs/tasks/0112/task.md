# Задание 0112. 2.6.99: отбор тестов по изменённым файлам (check-tests)

<!-- TASK-META
{
  "id": "0112",
  "version": 1,
  "title": "2.6.99: check-tests — полный набор только при изменениях в plugin, иначе selftest + затронутые тесты",
  "risk": "medium",
  "created": "2026-11-23",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "tools/check-tests.mjs",
    "plugin/test/check-tests.test.mjs",
    "spec/SPEC.md",
    "docs/tasks/0112/**"
  ],
  "protectedPaths": ["spec/checks/**", "spec/scripts/**", "plugin/lib/**"],
  "redAllowDirty": ["docs/tasks/0112/**"],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как сократить прогон, не ослабляя проверку кода",
      "chosen": "tools/check-tests.mjs выбирает режим по изменённым файлам: изменения в plugin/** → полный набор плагина; изменения в spec/**/tools/** (движок) → selftest + тесты, чьи зависимости затронуты (tests-for); изменений в коде нет (только docs) → selftest. Качество не снижается: код плагина всегда гоняет полный набор, движок всегда гоняет selftest.",
      "options": ["Всегда полный набор", "Отбор по изменённым путям с фолбэками"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "docs/tasks/0112/report.json", "format": "json", "criterion": "C2" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["перевести критерии наших контрактов на tools/check-tests.mjs", "релиз 2.6.99 отдельной задачей"]
}
-->

## Цель

Один критерий `node tools/check-tests.mjs` заменяет «всегда полный набор»: при изменениях плагина — полный набор,
при изменениях движка — selftest + затронутые тесты, без изменений кода — selftest. Полный набор не пропускается
там, где менялся код плагина.

## Границы знания

Только новый инструмент и его тест; панель и структура не трогаются.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерии и verify.log.

## Коммит

Коммитится по правилам движка.

## Что не входит

1. Правки plugin/lib и spec/scripts (кроме SPEC.md).
2. Правки панели.
3. Релиз 2.6.99 — отдельной задачей.

## Инварианты

1. Изменения в `plugin/lib/**`, `plugin/test/**`, `plugin/tools/**` → режим `full` (`plugin/tools/test.mjs`).
2. Изменения только в `spec/**`/`tools/**` → `affected`: selftest + тесты по `tests-for` (если тесты найдены).
3. Только `docs/**`, `.dsh/**`, task-артефакты → `selftest`.
4. `--dry-run` печатает режим и список тестов, ничего не запуская.
5. Код выхода — код запущенной проверки.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node --test plugin/test/check-tests.test.mjs` | все PASS |
| C2 | `node tools/check-tests.mjs --dry-run` | JSON с mode/tests |
| C3 | `node spec/selftest.mjs` | `SELFTEST OK` |
<!-- CRITERIA:END -->
