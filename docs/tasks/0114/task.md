# Задание 0114. 2.6.100: чужие артефакты и коммиты не блокируют verify

<!-- TASK-META
{
  "id": "0114",
  "version": 1,
  "title": "2.6.100: границы verify — только свои незакоммиченные изменения; headDrift терпит чужие allowedPaths",
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
    "spec/scripts/task-verify.mjs",
    "plugin/test/head-drift.test.mjs",
    "spec/SPEC.md",
    "docs/tasks/0114/**"
  ],
  "protectedPaths": ["plugin/lib/**", "plugin/tools/**", "spec/checks/**", "tools/**"],
  "redAllowDirty": ["docs/tasks/0114/**"],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "question": "Чьи изменения проверяет verify и что блокирует headDrift",
      "chosen": "Исполнитель не коммитит: любой коммит после контракта — чужой. Поэтому границы verify считаются по своим незакоммиченным изменениям (staged/unstaged/untracked) с игнорированием артефактов чужих заданий (docs/tasks/<чужой id>/**) и .dsh/**; headDrift отклоняет сдвиг только при правках docs/tasks/<свой id>/** (контракт), а коммиты чужих задач в allowedPaths не блокируют.",
      "options": ["Сверять весь diff contractCommit..worktree", "Только свои незакоммиченные изменения"],
      "impact": "public-contract",
      "evidence": { "kind": "criterion", "ref": "C1" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "docs/tasks/0114/report.json", "format": "json", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["релиз 2.6.100 отдельной задачей", "kanban проверит 0014"]
}
-->

## Цель

Verify задания не блокируется чужими артефактами и чужими коммитами: проверяются только свои незакоммиченные
изменения, headDrift терпит чужие правки в allowedPaths.

## Границы знания

Только verifyLock/verify и общий помощник; red/accept не меняются.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерии и verify.log.

## Коммит

Коммитится по правилам движка.

## Что не входит

1. Сдвиг HEAD до красного прогона.
2. Правки панели.
3. Релиз 2.6.100 — отдельной задачей.

## Инварианты

1. `headDrift`: чужие коммиты в `allowedPaths`/прочих путях — допустимы; правка `docs/tasks/<id>/**` этого задания — отказ.
2. Границы verify — только незакоммиченные изменения рабочего дерева.
3. Артефакты чужих заданий (`docs/tasks/<чужой id>/**`) и `.dsh/**` в границы не попадают.
4. `verify.json` фиксирует `changes: "own-uncommitted"` и `headDrift`.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | общий помощник `ownChanges` в `common.mjs` | exit 0 |
| C2 | `task-verify.mjs` использует `ownChanges` | exit 0 |
| C3 | `node --test plugin/test/head-drift.test.mjs` | все PASS |
| C4 | `node spec/selftest.mjs` | `SELFTEST OK` |
<!-- CRITERIA:END -->
