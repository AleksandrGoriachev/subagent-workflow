# Задание 0105. Выпуск 2.6.95: подтверждение проектных якорей и permits

<!-- TASK-META
{
  "id": "0105",
  "version": 1,
  "title": "Выпуск 2.6.95: 0104 в релизе",
  "risk": "medium",
  "created": "2026-11-22",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "VERSION", "package.json", "README.md", "CHANGELOG.md", "spec/SPEC.md",
    "spec/scripts/lib/common.mjs", "release.config.json", "docs/tasks/0105/**"
  ],
  "protectedPaths": ["spec/checks/**", "plugin/lib/**", "plugin/test/**", "tools/**"],
  "redAllowDirty": ["docs/tasks/0105/**"],
  "hashExclude": [],
  "decisions": [
    { "id": "D1", "class": "mechanical", "question": "Что входит в 2.6.95", "chosen": "Только принятое в main: 0104 (confirmedVersion/confirmedAt в свежести проектных якорей; permits ищутся в корне воркспейса). Панель 0.9.38.", "options": ["Только принятое", "Плюс правки"], "impact": "internal", "evidence": { "kind": "criterion", "ref": "C2" }, "reversible": true },
    { "id": "D2", "class": "mechanical", "question": "Порядок выпуска", "chosen": "Ассеты → приёмка judge → коммит+тег → архив из тега → публикация.", "options": ["Однофазный", "Двухфазный"], "impact": "internal", "evidence": { "kind": "criterion", "ref": "C3" }, "reversible": true }
  ],
  "resultShape": { "artifact": "docs/tasks/0105/report.json", "format": "json", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["после релиза anchor-freshness --project зелёный на воркспейсе"]
}
-->

## Цель

Выпущен **2.6.95**: проектная свежесть якорей читает манифест structure, W5 видит permits воркспейса.

## Границы знания

Только версии и документация; код принят в main.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерии и verify.log.

## Коммит

Коммитится по правилам движка.

## Что не входит

1. Новый код сверх 0104.
2. Правки панели (0.9.38).
3. Правки чужих плагинов.

## Инварианты

1. Версии согласованы: VERSION, package.json, README, SPEC, TOOL, CHANGELOG.
2. Публикация только tools/release.mjs; тег — commit.ps1.
3. Критерии не требуют тег.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `VERSION`, `package.json`, `plugin/package.json` | `2.6.95|2.6.95|0.9.38|0.9.38` |
| C2 | `node tools/check-version.mjs` | `VERSION OK: 2.6.95` |
| C3 | `node tools/release.mjs preflight 2.6.95` | `preflight: OK` |
| C4 | `node plugin/tools/test.mjs` | exit 0 |
| C5 | `node spec/selftest.mjs` | `SELFTEST OK` |
| C6 | `node tools/release.mjs preflight 2.6.999` | exit 1 |
<!-- CRITERIA:END -->
