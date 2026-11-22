# Задание 0098. 2.6.93: гейт тестов плагина не падает флейком

<!-- TASK-META
{
  "id": "0098",
  "version": 1,
  "title": "2.6.93: тесты плагина — последовательный прогон и полный лог при падении",
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
    "plugin/lib/state.js",
    "docs/tasks/0098/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "plugin/test/**",
    "tools/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0098/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как убрать ложный красный в гейте тестов плагина",
      "chosen": "Прогон с --test-concurrency=1 (убирает гонку за порты/тайминги между API-тестами под нагрузкой) и полный лог в файл: при падении печатается путь и последние строки, чтобы флейк был диагностируем, а не «exit 1 без причины». Повтор-обход не добавляем: гейт не должен маскировать падения.",
      "options": ["Ретрай гейта", "Последовательный прогон + лог падения"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C1" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "релиз 2.6.93 отдельной задачей"
  ]
}
-->

## Цель

`node plugin/tools/test.mjs` перестаёт давать ложный красный под нагрузкой: файлы идут последовательно,
а при падении остаётся полный лог с путём — по нему видно, какой тест и почему упал.

## Что не входит

1. Правки самих тестов и плагина.
2. Ретрай-обход гейта (маскировал бы реальные падения).
3. Релиз 2.6.93 — отдельной задачей.

## Инварианты

1. Прогон последовательный (`--test-concurrency=1`), порядок файлов прежний (сортировка).
2. При ненулевом коде выхода печатается путь к полному логу и его последние 30 строк.
3. `runGit` в `plugin/lib/state.js` берёт таймаут из `WF_GIT_TIMEOUT_MS` (по умолчанию 120 с вместо 20 с):
   под нагрузкой `git config user.email` вылетал по ETIMEDOUT и ронял мой же гейт.
4. Код выхода пробрасывается как раньше.
5. `WF_TEST_CONCURRENCY` позволяет осознанно поднять параллельность.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `plugin/tools/test.mjs` передаёт `--test-concurrency=1` | exit 0 |
| C2 | при падении печатается путь к полному логу | exit 0 |
| C3 | `node plugin/tools/test.mjs` | exit 0 |
| C4 | `node spec/selftest.mjs` | `SELFTEST OK` |
| C5 | `plugin/lib/state.js` учитывает `WF_GIT_TIMEOUT_MS` | exit 0 |
<!-- CRITERIA:END -->
