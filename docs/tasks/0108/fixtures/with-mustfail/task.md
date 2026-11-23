# Задание 0908. Фикстура noRed

<!-- TASK-META
{
  "id": "0908",
  "version": 1,
  "title": "фикстура noRed",
  "risk": "low",
  "created": "2026-11-23",
  "owner": "тест",
  "executor": "subagent:x",
  "acceptor": "subagent:y",
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "src/**"
  ],
  "hashExclude": [],
  "decisions": [],
  "resultShape": {
    "artifact": "docs/tasks/0908/report.json",
    "format": "json",
    "criterion": "C1"
  }
}
-->

## Цель

Проверка линта: noRed при непустом mustFail.

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
