# Задание 0096. 2.6.92: validator принимает reviewer и читает review.json сам

<!-- TASK-META
{
  "id": "0096",
  "version": 1,
  "title": "2.6.92: validateReviewReceipt({taskDir, reviewer}) — declared reviewer и авто-чтение review.json",
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
    "docs/tasks/0096/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "tools/**",
    "plugin/lib/**"
  ],
  "redAllowDirty": [
    "docs/tasks/0096/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Откуда валидатор берёт объявленного ревьюера",
      "chosen": "Порядок: явный reviewer (строка) → meta.reviewer/reviewerNode → пусто (applicable:false). review.json читается из taskDir, если review не передан. Формат квитанции не меняется.",
      "options": ["Только meta", "Явный reviewer + meta + авто-чтение review.json"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "релиз 2.6.92 отдельной задачей; после него 0198 c4 зелёный"
  ]
}
-->

## Цель

`validateReviewReceipt({taskDir, reviewer})` работает без `meta` и без `review`: явный `reviewer` считается
объявленным, `review.json` читается из каталога задания. Внешняя проверка 0198 c4 проходит целиком.

## Что не входит

1. Формат квитанции и writer не меняются.
2. Правки плагина structure.
3. Релиз 2.6.92 — отдельной задачей.

## Инварианты

1. Явный `reviewer` сильнее `meta`; пусто у обоих — `applicable:false, ok:true`.
2. Без `review` валидатор читает `<taskDir>/review.json`; нет файла — `ok:false`.
3. Правка `review.json` после квитанции → `ok:false` (artifactSha256).

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node --test plugin/test/review-receipt.test.mjs` | все тесты PASS |
| C2 | `validateReviewReceipt({taskDir, reviewer})` без квитанции | `ok:false` |
| C3 | `node plugin/tools/test.mjs` | exit 0 |
| C4 | `node spec/selftest.mjs` | `SELFTEST OK` |
<!-- CRITERIA:END -->
