# Задание 0101. Выпуск 2.6.93: гейт тестов без ложного красного (0098 + 0100)

<!-- TASK-META
{
  "id": "0101",
  "version": 1,
  "title": "Выпуск 2.6.93: 0098 и 0100 в релизе",
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
    "docs/tasks/0101/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "plugin/lib/**",
    "plugin/test/**",
    "tools/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0101/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Что входит в 2.6.93",
      "chosen": "Принятое в main: 0098 (последовательный прогон тестов, лог падения, WF_GIT_TIMEOUT_MS) и 0100 (повтор git в фикстурах при ETIMEDOUT). 0099 закрыто как superseded: его red не доказан из-за флейка. Панель 0.9.38.",
      "options": ["Только 0098", "0098 + 0100"],
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
    "после релиза проверить приёмку без повторов"
  ]
}
-->

## Цель

Выпущен **2.6.93**: гейт тестов плагина не даёт ложный красный — последовательный прогон, полный лог падения,
повтор идемпотентных git-команд в фикстурах при ETIMEDOUT.

## Что не входит

1. Новый код сверх принятого в main (0098, 0100).
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
| C1 | `VERSION`, `package.json`, `plugin/package.json` одной строкой | `2.6.93|2.6.93|0.9.38|0.9.38` |
| C2 | `node tools/check-version.mjs` | `VERSION OK: 2.6.93` |
| C3 | `node tools/release.mjs preflight 2.6.93` | `preflight: OK` |
| C4 | `node plugin/tools/test.mjs` | exit 0 |
| C5 | `node spec/selftest.mjs` | `SELFTEST OK` |
| C6 | `node tools/release.mjs preflight 2.6.999` | exit 1, `preflight: не пройден` |
<!-- CRITERIA:END -->
