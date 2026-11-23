# Задание 0117. Выпуск 2.6.101: TOOL из VERSION

<!-- TASK-META
{
  "id": "0117",
  "version": 1,
  "title": "Выпуск 2.6.101: 0116 в релизе",
  "risk": "medium",
  "created": "2026-11-23",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": ["VERSION", "package.json", "README.md", "CHANGELOG.md", "spec/SPEC.md", "release.config.json", "docs/tasks/0117/**"],
  "protectedPaths": ["spec/checks/**", "plugin/lib/**", "plugin/test/**", "spec/scripts/**"],
  "redAllowDirty": ["docs/tasks/0117/**"],
  "hashExclude": [],
  "decisions": [
    { "id": "D1", "class": "mechanical", "question": "Что входит в 2.6.101", "chosen": "Только принятое в main: 0116 (TOOL из VERSION, check-version проверяет исполнением). Панель 0.9.38. Bump не правит common.mjs.", "options": ["Только принятое", "Плюс правки"], "impact": "internal", "evidence": { "kind": "criterion", "ref": "C2" }, "reversible": true },
    { "id": "D2", "class": "mechanical", "question": "Порядок выпуска", "chosen": "Ассеты → приёмка judge → коммит+тег → архив из тега → публикация; проверка — tools/check-tests.mjs (ожидается selftest).", "options": ["Однофазный", "Двухфазный"], "impact": "internal", "evidence": { "kind": "criterion", "ref": "C3" }, "reversible": true }
  ],
  "resultShape": { "artifact": "docs/tasks/0117/report.json", "format": "json", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["проверить время релизного прогона: не должно быть 22 файлов тестов"]
}
-->

## Цель

Выпущен **2.6.101**: TOOL вычисляется из VERSION; релизный bump не трогает common.mjs и проверка остаётся selftest.

## Границы знания

Только версии и документация; код принят в main.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерии и verify.log.

## Коммит

Коммитится по правилам движка.

## Что не входит

1. Новый код сверх 0116.
2. Правки панели.
3. Правки чужих плагинов.

## Инварианты

1. Версии согласованы: VERSION, package.json, README, SPEC, CHANGELOG; TOOL читается из VERSION.
2. Публикация только tools/release.mjs; тег — commit.ps1.
3. Критерии не требуют тег.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `VERSION`, `package.json`, `plugin/package.json` | `2.6.101|2.6.101|0.9.38|0.9.38` |
| C2 | `node tools/check-version.mjs` | `VERSION OK: 2.6.101` |
| C3 | `node tools/release.mjs preflight 2.6.101` | `preflight: OK` |
| C4 | `node tools/check-tests.mjs --dry-run` и сам прогон | mode selftest, exit 0 |
| C5 | `node tools/release.mjs preflight 2.6.999` | exit 1 |
<!-- CRITERIA:END -->
