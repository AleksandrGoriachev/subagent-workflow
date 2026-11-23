# Задание 0110. 2.6.98: приёмка при сдвиге HEAD чужими коммитами

<!-- TASK-META
{
  "id": "0110",
  "version": 1,
  "title": "2.6.98: headDrift — контракт сверяется по хешам, а не по равенству HEAD",
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
    "spec/scripts/task-accept.mjs",
    "plugin/test/head-drift.test.mjs",
    "spec/SPEC.md",
    "docs/tasks/0110/**"
  ],
  "protectedPaths": ["plugin/lib/**", "plugin/tools/**", "spec/checks/**", "tools/**"],
  "redAllowDirty": ["docs/tasks/0110/**"],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "question": "Как принимать задание, если после контракта в репозиторий коммитили другие задачи",
      "chosen": "Сдвиг HEAD допускается, когда: contractCommit — предок HEAD; task.md/criteria.json/защищённые хеши совпали; коммиты между contractCommit и HEAD не задевают taskDir/allowedPaths/protectedPaths. Коммиты-чужие исключаются из базы диффа границ; verify/accept несут headDrift {from,to,foreignCommits,paths}. red по-прежнему бежит на contractCommit (red.baseSha=contractCommit).",
      "options": ["Только равенство HEAD", "headDrift с проверкой путей"],
      "impact": "public-contract",
      "evidence": { "kind": "criterion", "ref": "C1" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "docs/tasks/0110/report.json", "format": "json", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["релиз 2.6.98 отдельной задачей", "kanban проверит 0014 без перезамка"]
}
-->

## Цель

Контракт, запертый на `contractCommit`, не блокируется чужими коммитами: приёмка идёт, если контрактные хеши совпали,
а чужие коммиты не задели пути задания; сдвиг виден в `verify.json`/`acceptance.json`.

## Границы знания

Только verifyLock/verify/accept и общий помощник; red не меняется.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерии и verify.log.

## Коммит

Коммитится по правилам движка.

## Что не входит

1. Сдвиг HEAD до красного прогона (red по-прежнему на contractCommit).
2. Правки панели.
3. Релиз 2.6.98 — отдельной задачей.

## Инварианты

1. `red.baseSha` остаётся `contractCommit`; чужие коммиты появляются только после красного.
2. Пересечение чужих коммитов с `taskDir`/`allowedPaths`/`protectedPaths` — отказ с названными путями.
3. Не-предок или совпадение хешей контракта не выполнено — отказ.
4. `verify.json`/`acceptance.json` несут `headDrift`; при отсутствии сдвига поле `null`.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node --test plugin/test/head-drift.test.mjs` | все PASS |
| C2 | `task-verify.mjs` содержит `headDrift` | exit 0 |
| C3 | `task-accept.mjs` содержит `headDrift` | exit 0 |
| C4 | `node spec/selftest.mjs` | `SELFTEST OK` |
<!-- CRITERIA:END -->
