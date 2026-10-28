# Задание 0999. Проба корней заданий

<!-- TASK-META
{
  "id": "0999",
  "version": 1,
  "title": "проба",
  "risk": "low",
  "created": "2026-10-28",
  "owner": "архитектор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": ["docs/tasks/0999/**"],
  "hashExclude": [],
  "decisions": []
}
-->

## Цель

Проверить, что ворота работают с внешним --repo.

## Что не входит

1. Всё остальное.

## Инварианты

1. Ничего не исполняется.

## Границы знания

1. Только этот каталог.

## Среда

- Node.js.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node -e "process.exit(0)" | exit 0 |
<!-- CRITERIA:END -->

## Отчёт

1. Не требуется.

## Коммит

1. Не требуется.
