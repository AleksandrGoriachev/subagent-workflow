# Задание 0104. 2.6.95: проектная свежесть якорей читает confirmedVersion/confirmedAt

<!-- TASK-META
{
  "id": "0104",
  "version": 1,
  "title": "2.6.95: anchor-freshness --project принимает манифест structure (confirmed без объекта)",
  "risk": "medium",
  "created": "2026-11-22",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/checks/anchor-freshness.mjs",
    "spec/checks/foreign-workspace.mjs",
    "plugin/test/anchors-project.test.mjs",
    "docs/tasks/0104/**"
  ],
  "protectedPaths": [
    "plugin/lib/**",
    "tools/**",
    "spec/scripts/**"
  ],
  "redAllowDirty": ["docs/tasks/0104/**"],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как читать дату подтверждения проектного якоря после перехода на манифест structure",
      "chosen": "confirmedOf(anchor): anchor.confirmed как объект (контур/старый вид) либо {version: anchor.confirmedVersion, date: anchor.confirmedAt} (манифест v2/v3 structure, где confirmed — boolean или отсутствует). Формат файла не меняем.",
      "options": ["Требовать confirmed-объект (текущее)", "Фолбэк на confirmedVersion/confirmedAt"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "docs/tasks/0104/report.json", "format": "json", "criterion": "C2" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["релиз 2.6.95 отдельной задачей", "после релиза anchor-freshness --project зелёный на воркспейсе"]
}
-->

## Цель

Наш проектный чек свежести снова зелёный на манифесте structure (v2/v3), где `confirmed` — boolean или отсутствует,
а дата/версия лежат в `confirmedVersion`/`confirmedAt`.

## Границы знания

Только `spec/checks/anchor-freshness.mjs` и его тест; структура и панель не трогаются.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерий C2 и verify.log.

## Коммит

Коммитится по правилам движка.

## Что не входит

1. Формат docs/anchors.json — уже v3, не меняем.
2. Правки structure.
3. Релиз 2.6.95 — отдельной задачей.

## Дополнительно

W5 (foreign-workspace) при запуске из каталога движка искал permits в `<движок>/coordination/permits`
и не видел разрешений воркспейса. Исправляем: кандидаты — корень запуска и его родитель (как для foreign-roots).

## Инварианты

1. Якорь с `confirmed`-объектом читается как раньше.
2. Якорь с `confirmedVersion`/`confirmedAt` без объекта даёт те же version/date.
3. Контурный `evaluateAnchors` не меняет поведения.
4. `hasPermit` ищет разрешения и в `<root>/coordination/permits`, и в `<root>/../coordination/permits`.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node --test plugin/test/anchors-project.test.mjs` | все PASS |
| C2 | `evaluateProjectAnchors` с confirmedVersion/confirmedAt | нет проблемы «confirmed.date» |
| C3 | `node spec/selftest.mjs` | `SELFTEST OK` |
| C4 | `foreign-workspace.mjs` находит permits в корне воркспейса | exit 0 |
<!-- CRITERIA:END -->
