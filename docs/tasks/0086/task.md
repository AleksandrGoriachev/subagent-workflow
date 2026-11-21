# Задание 0086. 2.6.87: коммит-гейт требует задание и при guard.enabled=false

<!-- TASK-META
{
  "id": "0086",
  "version": 1,
  "title": "2.6.87: обязательность задания не зависит от guard.enabled",
  "risk": "medium",
  "created": "2026-11-21",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/scripts/task-guard.mjs",
    "spec/scripts/init.mjs",
    "plugin/test/task-guard.test.mjs",
    "spec/SPEC.md",
    "docs/tasks/0086/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "spec/e2e.mjs",
    "tools/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0086/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "question": "Что должен отключать guard.enabled=false",
      "chosen": "Только аудит, --range и полноту проверок. Обязательность активного задания для --staged от флага не зависит: путь вне задания — отказ (exit 1) и при false.",
      "options": [
        "Оставить инвариант 2.5.0 (false = молча exit 0)",
        "Разделить: задание обязательно всегда, флаг управляет аудитом/диапазоном"
      ],
      "impact": "user-visible",
      "evidence": { "kind": "criterion", "ref": "C1" }
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Что делает метка workflow-bypass при выключенном guard",
      "chosen": "Разрешает коммит вне задания, но защищённые пути (lib/ checks/ spec/ tools/ structure/ presets/ plugin/lib/ plugin/test/) под меткой по-прежнему запрещены.",
      "options": ["Метка не действует при false", "Действует как при true, кроме защищённых путей"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "structure (письмо --220): после релиза обновить движок у structure и в dsh-kanban-board; локальный форк 0326 не применять",
    "релиз 2.6.87 — отдельной задачей: VERSION/CHANGELOG/SPEC-заголовок, тег, публикация узлом release-1"
  ]
}
-->

## Цель

Коммит без активного задания невозможен даже при выключенном guard: флаг `guard.enabled`
управляет аудитом и проверкой диапазона (`--range`), а не обязательностью задания. Требование
structure (письмо --220) закрыто кодом и проверками, а не декларацией.

## Что не входит

1. Смена режима `guard.mode` (fail/warn/off) и семантика `warn`.
2. Релиз 2.6.87: версии, тег, публикация — отдельная задача.
3. Панель (флаг guard) — поведение `writeGuardEnabled` не меняется.

## Инварианты

1. `enabled=false` + путь вне задания → exit 1 с названием пути и словом «задание/не покрыт».
2. `enabled=false` + путь под заданием → exit 0.
3. `enabled=false` + метка обхода + незащищённый путь → exit 0; защищённый путь → exit 1.
4. `enabled=false --audit` и `--staged` на чистом индексе → exit 0 (аудит не блокирует).
5. `enabled=true` — прежние коды (allow/deny/bypass/push) не меняются.
6. Инвариант 2.5.0 «при enabled !== true скрипт молча выходит 0» снят и заменён в спеке.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/guard-acceptance.mjs --case disabled` | `PASS disabled`: covered=0, uncovered exit=1 |
| C2 | `node spec/checks/guard-acceptance.mjs --case disabledBypass` | `PASS disabledBypass`: метка 0, защищённый путь 1 |
| C3 | `node spec/checks/guard-acceptance.mjs --case disabledAudit` | `PASS disabledAudit`: audit=0 |
| C4 | `--case allow` и `--case deny` | `PASS deny` |
| C5 | `--case bypass` | `PASS bypass` |
| C6 | `--case pushAfterAcceptance` | `PASS pushAfterAcceptance` |
| C7 | `--case bypassOnPush` | `PASS bypassOnPush` |
| C8 | `node spec/checks/guard-acceptance.mjs` | все кейсы PASS |
| C9 | `node spec/selftest.mjs` | `SELFTEST OK` |
| C10 | `node --test plugin/test/task-guard.test.mjs` | `# fail 0` |
<!-- CRITERIA:END -->
