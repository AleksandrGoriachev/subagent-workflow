# Задание 0093. Выпуск 2.6.90: реестр задач и квитанция ревью уходят релизом

<!-- TASK-META
{
  "id": "0093",
  "version": 1,
  "title": "Выпуск 2.6.90: 0092 в релизе",
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
    "docs/tasks/0093/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "plugin/lib/**",
    "plugin/test/**",
    "tools/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0093/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Что входит в 2.6.90",
      "chosen": "Только принятое в main: 0092 (реестр задач в task-lint, квитанция ревью в task-accept, инструменты реестра). Панель 0.9.38.",
      "options": ["Только принятое в main", "Плюс новые правки"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" }
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Порядок выпуска",
      "chosen": "Двухфазный: ассеты без коммита → приёмка judge → коммит+тег → архив из тега → публикация release-1.",
      "options": ["Однофазный (отклонён на 0078)", "Двухфазный"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C3" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "структура и канбан обновятся после публикации; их локальный гейт 0330 останется вторым слоем"
  ]
}
-->

## Цель

Выпущен **2.6.90**: реестр задач проверяется движком, а приёмка с объявленным ревьюером требует квитанции.

## Что не входит

1. Новый код сверх принятого в main (0092).
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
| C1 | `VERSION`, `package.json`, `plugin/package.json` одной строкой | `2.6.90|2.6.90|0.9.38|0.9.38` |
| C2 | `node tools/check-version.mjs` | `VERSION OK: 2.6.90` |
| C3 | `node tools/release.mjs preflight 2.6.90` | `preflight: OK` |
| C4 | `node plugin/tools/test.mjs` | exit 0 |
| C5 | `node spec/selftest.mjs` | `SELFTEST OK` |
| C6 | `node tools/release.mjs preflight 2.6.999` | exit 1, `preflight: не пройден` |
<!-- CRITERIA:END -->
