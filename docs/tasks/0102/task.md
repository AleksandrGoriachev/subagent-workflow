# Задание 0102. 2.6.94: нормализация reviewer и привязка review к контракту

<!-- TASK-META
{
  "id": "0102",
  "version": 1,
  "title": "2.6.94: reviewer без префикса subagent:, review привязан к контракту",
  "risk": "medium",
  "created": "2026-11-22",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/scripts/lib/review-receipt.mjs",
    "spec/scripts/task-accept.mjs",
    "spec/scripts/task-verify.mjs",
    "spec/scripts/task-lint.mjs",
    "plugin/test/review-receipt.test.mjs",
    "spec/SPEC.md",
    "docs/tasks/0102/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "tools/**",
    "plugin/lib/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0102/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "question": "Как движок сверяет ревьюера и привязку review к контракту",
      "chosen": "Объявленный ревьюер нормализуется (снять subagent:), сравнение по голому id; task-accept сверяет review.contractCommit/taskFileSha256 с lock и отказывает при расхождении; без привязки — deny, кроме явного --allow-unbound-review с записью reviewBinding в acceptance.",
      "options": ["Литеральное сравнение (текущее)", "Нормализация + привязка к контракту"],
      "impact": "public-contract",
      "reversible": false,
      "evidence": { "kind": "criterion", "ref": "C1" }
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Раннее обнаружение и исторические задания",
      "chosen": "task-verify проверяет квитанцию и привязку, если review.json уже есть (до judge); task-lint даёт WARN на subagent:-префикс и не требует resultShape у принятых заданий.",
      "options": ["Оставить только приёмку", "Ранняя проверка + WARN + исключение для принятых"],
      "impact": "internal",
      "reversible": true,
      "evidence": { "kind": "criterion", "ref": "C3" }
    }
  ],
  "resultShape": { "artifact": "docs/tasks/0102/report.json", "format": "json", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "релиз 2.6.94 отдельной задачей",
    "structure прогонит 0331-подобный контракт с subagent:-префиксом"
  ]
}
-->

## Цель

Контракт с `reviewer: "subagent:reviewer-1"` проходит приёмку, а review, выпущенный на старую редакцию контракта,
приёмкой отклоняется. Ранний контроль — в `task-verify`, до judge.

## Границы знания

Только код движка, перечисленный в allowedPaths; чужие воркспейсы не трогаем.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерии и verify.log; отдельный отчёт не требуется.

## Коммит

Коммитится контракт и реализация по правилам движка.

## Что не входит

1. Формат квитанции не меняется.
2. Новые поля review (`reviewedAt`) не требуются.
3. Релиз 2.6.94 — отдельной задачей.

## Инварианты

1. Объявленный ревьюер: `reviewer` → `reviewerNode` → снять префикс `subagent:`; сравнение по голому id, квитанция принимается в обеих формах.
2. `review.contractCommit`/`review.taskFileSha256` при наличии обязаны совпасть с lock; иначе deny.
3. Review без привязки → deny, кроме `--allow-unbound-review --note`; факт обхода виден в `acceptance.reviewBinding`.
4. `task-lint`: WARN на `subagent:`; `resultShape` не требуется у принятых заданий.
5. `task-verify` ловит mismatch квитанции/привязки, если review уже выпущен.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node docs/tasks/0102/check.mjs c1` — обе формы ревьюера | `ok` |
| C2 | `node docs/tasks/0102/check.mjs c2` — привязка review к контракту | `ok` |
| C3 | `node docs/tasks/0102/check.mjs c3` — ранняя проверка в verify | `ok` |
| C4 | `node docs/tasks/0102/check.mjs c4` — WARN на subagent: | `ok` |
| C5 | `node docs/tasks/0102/check.mjs c5` — принятое без resultShape | `ok` |
| C6 | `node --test plugin/test/review-receipt.test.mjs` | все PASS |
| C7 | `node spec/selftest.mjs` | `SELFTEST OK` |
<!-- CRITERIA:END -->
