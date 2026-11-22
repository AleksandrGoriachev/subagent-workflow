# Задание 0903. Фикстура

<!-- TASK-META
{
  "id": "0903",
  "version": 1,
  "title": "фикстура линта 0903",
  "risk": "low",
  "created": "2026-11-22",
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
  "reviewer": "subagent:reviewer-1",
  "reviewerNode": "reviewer-1"
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
