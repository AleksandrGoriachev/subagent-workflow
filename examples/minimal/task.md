# Задание 0001. Сложение возвращает сумму

<!-- TASK-META
{
  "id": "0001",
  "version": 1,
  "title": "Сложение возвращает сумму",
  "risk": "medium",
  "created": "2026-10-25",
  "owner": "постановщик",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "<сессия постановщика>", "model": "<модель>" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": ["src/**", "docs/tasks/0001/**"],
  "protectedPaths": ["checks/**"],
  "redAllowDirty": ["docs/tasks/0001/**"],
  "hashExclude": [],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

`add(a, b)` возвращает `a + b`; проверка `checks/add.mjs` печатает `ok 3` для 1 и 2.

## Что не входит

Другие операции, производительность, стиль.

## Инварианты

- Негативная проверка `checks/negative.mjs` продолжает отказывать.

## Границы знания

Можно менять `src/**`; `checks/**` защищены.

## Среда

Node.js 20+, git.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Критерий | Команда | Ожидание | Теги |
| --- | --- | --- | --- | --- |
| C1 | Сложение | `node checks/add.mjs` | exit 0, «ok 3» | fast, behavior |
| C2 | Негатив | `node checks/negative.mjs` | exit 1, «invalid input» | fast, negative |
<!-- CRITERIA:END -->

## Отчёт

Изменения, файлы, вывод проверок, `git status --short`.

## Коммит

Сообщение со id задания и хешем критериев.
