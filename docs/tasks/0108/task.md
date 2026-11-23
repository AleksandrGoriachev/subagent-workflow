# Задание 0108. 2.6.97: redExpect.noRed — механизм вместо отказа

<!-- TASK-META
{
  "id": "0108",
  "version": 1,
  "title": "2.6.97: noRed для e2e-смоука существующего сценария",
  "risk": "medium",
  "created": "2026-11-23",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/scripts/lib/common.mjs",
    "spec/scripts/task-red.mjs",
    "spec/scripts/task-verify.mjs",
    "spec/scripts/task-accept.mjs",
    "spec/scripts/task-lint.mjs",
    "plugin/test/red-nored.test.mjs",
    "spec/SPEC.md",
    "docs/tasks/0108/**"
  ],
  "protectedPaths": ["plugin/lib/**", "plugin/tools/**", "spec/checks/**", "tools/**"],
  "redAllowDirty": ["docs/tasks/0108/**"],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "question": "Как движок принимает e2e-смоук, у которого на базе зелёная база",
      "chosen": "redExpect.noRed { reason } при пустом mustFail и risk=low: red.json получает redKind 'noRed', redProven=true (состояние решено осознанным отказом) и причину; verify/accept несут noRed с причиной; тексты red-noRed и red-not-proven раздельные; noRed запрещён при непустом mustFail и для medium/high.",
      "options": ["Отказ без обхода", "noRed с обязательной причиной и записью"],
      "impact": "public-contract",
      "evidence": { "kind": "criterion", "ref": "C2" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "docs/tasks/0108/report.json", "format": "json", "criterion": "C2" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["релиз 2.6.97 отдельной задачей", "kanban проверит 0014 на 2.6.97"]
}
-->

## Цель

Контракт «existing e2e smoke» проходит штатно: пустой `mustFail` + `noRed.reason` у `risk: low` даёт
`redKind: "noRed"` и причину в verify/acceptance, а не отказ «красный не доказан».

## Границы знания

Только red/verify/accept/lint и общая функция redExpect; структура и панель не трогаются.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерии и verify.log.

## Коммит

Коммитится по правилам движка.

## Что не входит

1. Сдвиг HEAD относительно contractCommit (2.6.98).
2. Правки панели.
3. Релиз 2.6.97 — отдельной задачей.

## Инварианты

1. `noRed` действует только при `risk: low` и пустом `mustFail`; причина непустая.
2. `red.json`: `redKind: "noRed"`, `redProven: true`, `redExpectation.noRed.reason`.
3. `task-verify` пишет `red.noRed` в verify.json; отказ для medium/high — `red-noRed`; отсутствие доказанного красного — `red-not-proven`.
4. `task-accept` переносит `redKind`/`noRed` в acceptance.json.
5. `task-lint`: `noRed` при непустом `mustFail` — ERROR; `noRed` у не-low — ERROR.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node --test plugin/test/red-nored.test.mjs` | все PASS |
| C2 | `evaluateRedExpectation` с noRed и низким риском | `ok`, `noRed` |
| C3 | lint на фикстуре noRed+mustFail | ошибка про noRed |
| C4 | `task-red.mjs` содержит `redKind` | exit 0 |
| C5 | `task-verify.mjs` содержит `red-noRed` | exit 0 |
| C6 | `node spec/selftest.mjs` | `SELFTEST OK` |
<!-- CRITERIA:END -->
