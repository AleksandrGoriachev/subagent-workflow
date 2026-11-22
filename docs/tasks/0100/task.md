# Задание 0100. 2.6.94: git в тестовых фикстурах переживает ETIMEDOUT

<!-- TASK-META
{
  "id": "0100",
  "version": 1,
  "title": "2.6.94: повтор git-команд в фикстурах при ETIMEDOUT",
  "risk": "medium",
  "created": "2026-11-22",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "plugin/test/fixture.mjs",
    "docs/tasks/0100/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "plugin/lib/**",
    "plugin/test/**",
    "tools/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0100/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как лечить ETIMEDOUT git в тестах",
      "chosen": "Повтор идемпотентных git-команд в фикстуре до 3 раз (300/600 мс пауза) при неуспехе, включая ETIMEDOUT. Таймаут одного вызова остаётся настраиваемым (WF_GIT_TIMEOUT_MS, 2.6.93). Ретрай только в тестовой фикстуре, не в гейте.",
      "options": ["Поднимать таймаут бесконечно", "Ретрай в фикстуре"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C1" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "после релиза 2.6.93/94 проверить приёмку без повторов"
  ]
}
-->

## Цель

Тестовая фикстура переживает транзиентный ETIMEDOUT локального git: команда повторяется до трёх раз,
поэтому гейт тестов не краснеет из-за одного зависшего git.

## Что не входит

1. Повтор в самом гейте (не маскируем падения).
2. Правки production-кода и тестов.
3. Релиз — отдельной задачей.

## Инварианты

1. `git(cwd,args)` в `plugin/test/fixture.mjs` повторяет команду до 3 попыток с паузой.
2. После трёх неуспехов — прежняя ошибка с текстом git.
3. Тесты без git (валидатор квитанции) не затронуты.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | в `plugin/test/fixture.mjs` есть ретрай git | exit 0 |
| C2 | `node --test plugin/test/review-receipt.test.mjs` | все тесты PASS |
| C3 | `node spec/selftest.mjs` | `SELFTEST OK` |
<!-- CRITERIA:END -->

## Примечание

Контракт пересобран после закрытия 0099 (superseded): красный прогон должен идти на текущем HEAD.
