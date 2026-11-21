# Задание 0094. 2.6.91: writer квитанции ревью (writeReviewReceipt)

<!-- TASK-META
{
  "id": "0094",
  "version": 1,
  "title": "2.6.91: движок умеет писать квитанцию ревью",
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
    "plugin/test/review-receipt.test.mjs",
    "spec/SPEC.md",
    "docs/tasks/0094/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "tools/**",
    "plugin/lib/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0094/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Кто пишет квитанцию ревью",
      "chosen": "Движок: writeReviewReceipt({taskDir, reviewPath, reviewer, decision, at}) пишет review.receipt.json атомарно, поля ровно те, что проверяет validateReviewReceipt (artifactSha256, reviewer, decision); без review.json — ok:false с причиной.",
      "options": ["Оставить writer только в плагине structure", "Добавить writer в движок"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C1" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "релиз 2.6.91 отдельной задачей; после него 0198 c4 у structure зелёный"
  ]
}
-->

## Цель

Движок не только проверяет квитанцию ревью, но и умеет её создавать: `writeReviewReceipt` пишет
`review.receipt.json` с `artifactSha256` от байтов `review.json`, ревьюером и решением, атомарно.

## Что не входит

1. Правки валидатора: формат квитанции не меняется.
2. Правки плагина structure.
3. Релиз 2.6.91 — отдельной задачей.

## Инварианты

1. `writeReviewReceipt` и `validateReviewReceipt` — round-trip: writer → валидатор ok.
2. Нет `review.json` — `{ ok: false, problems: [...] }`, файл не создаётся.
3. Поля квитанции: `artifactSha256`, `reviewer`, `decision`, `at`, `review`.
4. Запись атомарная: временный файл → rename.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node --test --test-name-pattern="писатель" plugin/test/review-receipt.test.mjs` | PASS: round-trip и отказ без review |
| C2 | `review-receipt.mjs` экспортирует `writeReviewReceipt` | exit 0 |
| C3 | `node plugin/tools/test.mjs` | exit 0 |
| C4 | `node spec/selftest.mjs` | `SELFTEST OK` |
<!-- CRITERIA:END -->
