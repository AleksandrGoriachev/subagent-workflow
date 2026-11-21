# Задание 0902. Фикстура для task-lint

<!-- TASK-META
{
  "id": "0902",
  "version": 1,
  "title": "фикстура 0902",
  "risk": "low",
  "created": "2026-11-21",
  "owner": "тест",
  "executor": "subagent:x",
  "acceptor": "subagent:y",
  "acceptorNode": "judge",
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "src/**"
  ],
  "hashExclude": [],
  "decisions": [],
  "resultShape": {
    "artifact": "docs/tasks/0902/report.json",
    "format": "json",
    "criterion": "C1"
  }
}
-->

## Цель

Проверка линта на фикстуре.

## Что не входит

Ничего.

## Инварианты

1. Только этот каталог.

## Границы знания

Только этот каталог.

## Среда

node 25.

## Отчёт

Одним абзацем.

## Коммит

Не коммитится.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node -e "1"` | exit 0 |
<!-- CRITERIA:END -->
