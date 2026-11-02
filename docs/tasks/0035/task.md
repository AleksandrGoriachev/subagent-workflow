# Задание 0035. Проверки пакета вне пакета печатают SKIP — все, а не две из восемнадцати

<!-- TASK-META
{
  "id": "0035",
  "version": 1,
  "title": "SKIP вне пакета для всех проверок и покрытие в deployed-copy",
  "risk": "medium",
  "created": "2026-11-02",
  "owner": "архитектор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-b8721a2a-456c-48a2-94cd-8030d895a8e8", "model": "unknown" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/checks/**",
    "docs/tasks/0035/**"
  ],
  "protectedPaths": [],
  "redAllowDirty": [
    "docs/tasks/0035/**"
  ],
  "hashExclude": [
    "artifacts/**"
  ],
  "decisions": [],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Любая проверка из `spec/checks/` при запуске в развёрнутой копии (вне пакета) печатает
`SKIP` и выходит 0; `deployed-copy.mjs` проверяет это для всех проверок, а не для двух.

## Что не входит

1. Поведение проверок внутри пакета — не меняется.
2. Новые проверки поведения движка — отдельные задачи.

## Инварианты

1. Guard не глушит настоящие падения: сломанная проверка вне пакета остаётся падением.
2. Проверки внутри пакета по-прежнему исполняются и падают, когда должны.
3. Секреты не попадают в код, задание, логи и отчёт.

## Границы знания

1. Менять можно только `spec/checks/**` и файлы задания.
2. Тесты не пишешь; приёмочные проверки — у архитектора.
3. Не коммить, не пушить, не деплоить.

## Среда

- Проверки: `node spec/checks/outside-package.mjs`, `node spec/checks/outside-package.mjs --negative`, `node spec/checks/deployed-copy.mjs`

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/outside-package.mjs` | exit 0, в stdout `OUTSIDE-PACKAGE OK` |
| C2 | `node spec/checks/outside-package.mjs --negative` | exit 0, в stdout `NEGATIVE OK` |
| C3 | `node spec/checks/deployed-copy.mjs` | exit 0, в stdout `DEPLOYED COPY OK` |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено — списком.
2. Файлы — полными путями.
3. Каждая проверка — команда и дословный вывод.
4. Отклонения и почему.
5. `git status --short`.

## Коммит

Только после записи о приёмке. Коммит делает архитектор по принятому кандидатному SHA.
