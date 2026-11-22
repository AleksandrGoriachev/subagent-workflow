# Задание 0103. Выпуск 2.6.94: нормализация reviewer и привязка review

<!-- TASK-META
{
  "id": "0103",
  "version": 1,
  "title": "Выпуск 2.6.94: 0102 в релизе",
  "risk": "medium",
  "created": "2026-11-22",
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
    "docs/tasks/0103/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "plugin/lib/**",
    "plugin/test/**",
    "tools/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0103/**"
  ],
  "hashExclude": [],
  "decisions": [
    { "id": "D1", "class": "mechanical", "question": "Что входит в 2.6.94", "chosen": "Только принятое в main: 0102 (нормализация reviewer, привязка review к контракту, ранняя проверка, WARN lint, resultShape у принятых). Панель 0.9.38.", "options": ["Только принятое в main", "Плюс новые правки"], "impact": "internal", "evidence": { "kind": "criterion", "ref": "C2" }, "reversible": true },
    { "id": "D2", "class": "mechanical", "question": "Порядок выпуска", "chosen": "Двухфазный: ассеты без коммита → приёмка judge → коммит+тег → архив из тега → публикация release-1.", "options": ["Однофазный (отклонён на 0078)", "Двухфазный"], "impact": "internal", "evidence": { "kind": "criterion", "ref": "C3" }, "reversible": true }
  ],
  "resultShape": { "artifact": "docs/tasks/0103/report.json", "format": "json", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "structure обновится до 2.6.94 и прогонит 0331-подобный контракт с subagent:-префиксом"
  ]
}
-->

## Цель

Выпущен **2.6.94**: контракт с `subagent:`-префиксом проходит приёмку, а review на чужую редакцию отклоняется.

## Границы знания

Только версии и документация; код уже принят в main.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерии и verify.log.

## Коммит

Коммитится контракт и ассеты по правилам движка.

## Что не входит

1. Новый код сверх принятого в main (0102).
2. Правки панели: 0.9.38.
3. Правки чужих плагинов.

## Инварианты

1. Версии согласованы: VERSION, package.json (+dshPanelVersion=0.9.38), README, spec/SPEC.md, TOOL, CHANGELOG.
2. Публикация — только `tools/release.mjs`; тег ставит `tools/commit.ps1`.
3. Критерии не требуют тег и «релиз опубликован».

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `VERSION`, `package.json`, `plugin/package.json` одной строкой | `2.6.94|2.6.94|0.9.38|0.9.38` |
| C2 | `node tools/check-version.mjs` | `VERSION OK: 2.6.94` |
| C3 | `node tools/release.mjs preflight 2.6.94` | `preflight: OK` |
| C4 | `node plugin/tools/test.mjs` | exit 0 |
| C5 | `node spec/selftest.mjs` | `SELFTEST OK` |
| C6 | `node tools/release.mjs preflight 2.6.999` | exit 1, `preflight: не пройден` |
<!-- CRITERIA:END -->
