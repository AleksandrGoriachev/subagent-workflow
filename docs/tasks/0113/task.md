# Задание 0113. Выпуск 2.6.99: check-tests в релизе

<!-- TASK-META
{
  "id": "0113",
  "version": 1,
  "title": "Выпуск 2.6.99: 0112 в релизе",
  "risk": "medium",
  "created": "2026-11-23",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": ["VERSION", "package.json", "README.md", "CHANGELOG.md", "spec/SPEC.md", "spec/scripts/lib/common.mjs", "release.config.json", "docs/tasks/0113/**"],
  "protectedPaths": ["spec/checks/**", "plugin/lib/**", "plugin/test/**", "tools/**"],
  "redAllowDirty": ["docs/tasks/0113/**"],
  "hashExclude": [],
  "decisions": [
    { "id": "D1", "class": "mechanical", "question": "Что входит в 2.6.99", "chosen": "Только принятое в main: 0112 (tools/check-tests.mjs, тесты, SPEC). Панель 0.9.38.", "options": ["Только принятое", "Плюс правки"], "impact": "internal", "evidence": { "kind": "criterion", "ref": "C2" }, "reversible": true },
    { "id": "D2", "class": "mechanical", "question": "Порядок выпуска", "chosen": "Ассеты → приёмка judge → коммит+тег → архив из тега → публикация. Критерий проверки — tools/check-tests.mjs (в релизе код не менялся, значит selftest).", "options": ["Однофазный", "Двухфазный"], "impact": "internal", "evidence": { "kind": "criterion", "ref": "C3" }, "reversible": true }
  ],
  "resultShape": { "artifact": "docs/tasks/0113/report.json", "format": "json", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["следующие контракты переводить на tools/check-tests.mjs"]
}
-->

## Цель

Выпущен **2.6.99**: проверка выбирается по изменённым файлам, полный набор — только при изменениях плагина.

## Границы знания

Только версии и документация; код принят в main.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерии и verify.log.

## Коммит

Коммитится по правилам движка.

## Что не входит

1. Новый код сверх 0112.
2. Правки панели.
3. Правки чужих плагинов.

## Инварианты

1. Версии согласованы: VERSION, package.json, README, SPEC, TOOL, CHANGELOG.
2. Публикация только tools/release.mjs; тег — commit.ps1.
3. Критерии не требуют тег.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `VERSION`, `package.json`, `plugin/package.json` | `2.6.99|2.6.99|0.9.38|0.9.38` |
| C2 | `node tools/check-version.mjs` | `VERSION OK: 2.6.99` |
| C3 | `node tools/release.mjs preflight 2.6.99` | `preflight: OK` |
| C4 | `node tools/check-tests.mjs` | exit 0 (режим selftest) |
| C5 | `node tools/release.mjs preflight 2.6.999` | exit 1 |
<!-- CRITERIA:END -->
