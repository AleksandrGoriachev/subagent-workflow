# Задание 0091. Выпуск 2.6.89: стоп по тишине и витрина метрик уходят релизом

<!-- TASK-META
{
  "id": "0091",
  "version": 1,
  "title": "Выпуск 2.6.89: 0090 в релизе",
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
    "docs/tasks/0091/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "plugin/lib/**",
    "plugin/test/**",
    "tools/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0091/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Что входит в 2.6.89",
      "chosen": "Только принятое в main: 0090 (стоп по тишине, маршрут и повторы сохранены, витрина метрик в панели, публикация снимка). Панель 0.9.38.",
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
    "деплой 2.6.89 в default-workspace, включить enforcement.silenceMs=600000, опубликовать снимок метрик"
  ]
}
-->

## Цель

Выпущен **2.6.89**: стоп по тишине, витрина метрик на доске и публикация снимка доступны пользователю.

## Что не входит

1. Новый код сверх принятого в main (0090).
2. Часовой бюджет: `nodeBudgetMs` остаётся выключенным.
3. Правки структуры и чужих плагинов.

## Инварианты

1. Версии согласованы: VERSION, package.json (+dshPanelVersion=0.9.38), README, spec/SPEC.md, TOOL, CHANGELOG, панель 0.9.38.
2. Публикация — только `tools/release.mjs`; тег ставит `tools/commit.ps1`.
3. Критерии не требуют тег и «релиз опубликован».

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `VERSION`, `package.json`, `plugin/package.json` одной строкой | `2.6.89|2.6.89|0.9.38|0.9.38` |
| C2 | `node tools/check-version.mjs` | `VERSION OK: 2.6.89` |
| C3 | `node tools/release.mjs preflight 2.6.89` | `preflight: OK` |
| C4 | `node plugin/tools/test.mjs` | exit 0 |
| C5 | `node spec/selftest.mjs` | `SELFTEST OK` |
| C6 | `node tools/release.mjs preflight 2.6.999` | exit 1, `preflight: не пройден` |
<!-- CRITERIA:END -->
