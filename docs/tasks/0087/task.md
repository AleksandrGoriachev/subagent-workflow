# Задание 0087. Выпуск 2.6.87: коммит-гейт требует задание и при guard.enabled=false

<!-- TASK-META
{
  "id": "0087",
  "version": 1,
  "title": "Выпуск 2.6.87: 0086 в релизе",
  "risk": "medium",
  "created": "2026-11-21",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "spec/SPEC.md",
    "spec/scripts/lib/common.mjs",
    "release.config.json",
    "docs/tasks/0087/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "plugin/test/**",
    "tools/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0087/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Что входит в 2.6.87",
      "chosen": "Только уже принятое в main: 0086 (обязательность активного задания при guard.enabled=false; флаг отключает аудит и --range). Никакого нового кода и никаких правок панели — панель остаётся 0.9.38.",
      "options": ["Только принятое в main", "Плюс новые правки"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" }
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Порядок выпуска",
      "chosen": "Двухфазный: подготовка в рабочем дереве (ассеты без коммита) → приёмка узлом judge → коммит+тег → архив из тега + sha256 → публикация узлом release-1.",
      "options": ["Однофазный (отклонён на 0078)", "Двухфазный"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C3" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "structure (письмо --220): после релиза обновить движок у structure и в dsh-kanban-board",
    "развернуть 2.6.87 в default-workspace (docs/subagent-workflow) и закоммитить деплой в воркспейсе"
  ]
}
-->

## Цель

Выпущен **2.6.87**: принятое в 0086 изменение коммит-гейта доступно пользователю — коммит без активного
задания невозможен даже при `guard.enabled=false`, а флаг управляет только аудитом и `--range`.

## Что не входит

1. Новый код сверх принятого в main (0086).
2. Правки панели: версия 0.9.38 не меняется.
3. Развёртывание в воркспейсы — после публикации, отдельным шагом.

## Инварианты

1. Версии согласованы: VERSION, package.json (+dshPanelVersion=0.9.38), README, spec/SPEC.md, TOOL, CHANGELOG, панель 0.9.38.
2. Публикация — только `tools/release.mjs`; тег ставит `tools/commit.ps1`.
3. Критерии задачи выпуска НЕ требуют тег текущей версии и «релиз опубликован» (они появляются после приёмки) — иначе task-verify откажет на HEAD == contractCommit.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `VERSION`, `package.json`, `plugin/package.json` — одной строкой | `2.6.87|2.6.87|0.9.38|0.9.38` |
| C2 | `node tools/check-version.mjs` | `VERSION OK: 2.6.87` |
| C3 | `node tools/release.mjs preflight 2.6.87` | `preflight: OK` |
| C4 | `node plugin/tools/test.mjs` | exit 0, ни одного упавшего теста |
| C5 | `node spec/selftest.mjs` | `SELFTEST OK` |
| C6 | `node tools/release.mjs preflight 2.6.999` | exit 1, `preflight: не пройден` |
<!-- CRITERIA:END -->
