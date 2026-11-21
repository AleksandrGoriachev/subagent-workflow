# Задание 0089. Выпуск 2.6.88: границы цикла узла уходят релизом

<!-- TASK-META
{
  "id": "0089",
  "version": 1,
  "title": "Выпуск 2.6.88: 0088 в релизе",
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
    "docs/tasks/0089/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "plugin/lib/**",
    "plugin/test/**",
    "tools/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0089/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Что входит в 2.6.88",
      "chosen": "Только принятое в main: 0088 (сторож повторов, бюджет узла, маршрут вместо отказа, resultShape в контракте, инструмент метрик). Панель не меняется — 0.9.38.",
      "options": ["Только принятое в main", "Плюс новые правки"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" }
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Порядок выпуска",
      "chosen": "Двухфазный: подготовка в рабочем дереве (ассеты без коммита) → приёмка узлом judge → коммит+тег → пересборка архива из тега → публикация узлом release-1.",
      "options": ["Однофазный (отклонён на 0078)", "Двухфазный"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C3" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "деплой 2.6.88 в default-workspace (docs/subagent-workflow) и коммит деплоя",
    "снимок «после» tools/launch-metrics.mjs и сравнение с docs/metrics/baseline-2.6.87.json"
  ]
}
-->

## Цель

Выпущен **2.6.88**: принятое в 0088 доступно пользователю — повтор вызова после отказа ограничен,
бюджет узла требует промежуточной сдачи, отказ сторожа несёт маршрут в фон, а контракт задачи
называет образ результата.

## Что не входит

1. Новый код сверх принятого в main (0088).
2. Правки панели: 0.9.38 не меняется.
3. Деплой в воркспейсы и снимок «после» — после публикации.

## Инварианты

1. Версии согласованы: VERSION, package.json (+dshPanelVersion=0.9.38), README, spec/SPEC.md, TOOL, CHANGELOG, панель 0.9.38.
2. Публикация — только `tools/release.mjs`; тег ставит `tools/commit.ps1`.
3. Критерии не требуют тег и «релиз опубликован» — они появляются после приёмки.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `VERSION`, `package.json`, `plugin/package.json` одной строкой | `2.6.88|2.6.88|0.9.38|0.9.38` |
| C2 | `node tools/check-version.mjs` | `VERSION OK: 2.6.88` |
| C3 | `node tools/release.mjs preflight 2.6.88` | `preflight: OK` |
| C4 | `node plugin/tools/test.mjs` | exit 0 |
| C5 | `node spec/selftest.mjs` | `SELFTEST OK` |
| C6 | `node tools/release.mjs preflight 2.6.999` | exit 1, `preflight: не пройден` |
<!-- CRITERIA:END -->
