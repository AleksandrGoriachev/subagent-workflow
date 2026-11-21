# Задание 0092. 2.6.90: реестр задач в task-lint и квитанция ревью в task-accept

<!-- TASK-META
{
  "id": "0092",
  "version": 1,
  "title": "2.6.90: upstream-реестр задач и проверка квитанции ревью",
  "risk": "medium",
  "created": "2026-11-22",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/scripts/task-lint.mjs",
    "spec/scripts/task-accept.mjs",
    "spec/scripts/lib/registry.mjs",
    "spec/scripts/lib/review-receipt.mjs",
    "tools/task-register.mjs",
    "tools/task-next-id.mjs",
    "plugin/test/registry-lint.test.mjs",
    "plugin/test/review-receipt.test.mjs",
    "spec/SPEC.md",
    "docs/tasks/0092/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "tools/commit.ps1",
    "tools/release.mjs"
  ],
  "redAllowDirty": [
    "docs/tasks/0092/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "question": "Куда переносится реестр задач структуры",
      "chosen": "В движок как upstream-поведение по их спеке: docs/tasks/REGISTRY.json {version, tasks:[{id,subject,status,at}]}; task-lint проверяет номер и subject, tools/task-register.mjs и tools/task-next-id.mjs ведут реестр. Нет файла — прежнее поведение (фикстуры без реестра не краснеют).",
      "options": ["Оставить локальным гейтом structure", "Перенести в движок по их спеке"],
      "impact": "user-visible",
      "evidence": { "kind": "criterion", "ref": "C3" }
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Что проверяет квитанция ревью",
      "chosen": "Если task.md объявляет reviewer/reviewerNode, task-accept требует review.receipt.json: artifactSha256 = sha256(review.json), reviewer совпадает с объявленным, decision=accept. Нет ревьюера — not-applicable.",
      "options": ["Оставить только плагин-гейт 0330", "Проверять в движке"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C1" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "релиз 2.6.90 отдельной задачей",
    "structure/канбан обновятся после релиза; их локальный гейт 0330 останется вторым слоем"
  ]
}
-->

## Цель

В движке появляются два механизма, которые structure ведёт локально: реестр задач
(`docs/tasks/REGISTRY.json`) проверяется `task-lint`, а `task-accept` не принимает задачу с объявленным
ревьюером без квитанции `review.receipt.json`.

## Что не входит

1. Правки плагина structure (гейт 0330 остаётся вторым слоем).
2. Релиз 2.6.90 — отдельной задачей.
3. Изменение формата реестра: берём спеку structure как есть.

## Инварианты

1. Нет `REGISTRY.json` — смена поведения не наступает (фикстуры без реестра зелёные).
2. Номер не зарегистрирован → ERROR с «не зарегистрирован» и «REGISTRY».
3. `subject` ≠ `TASK-META.title` → ERROR с «subject» и «TASK-META.title».
4. Объявлен `reviewer`/`reviewerNode` → без валидной квитанции приёмка отклоняется; без объявления — not-applicable.
5. Квитанция: `artifactSha256 == sha256(review.json)`, `reviewer` совпадает, `decision == accept`.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node --test --test-name-pattern="квитанц" plugin/test/review-receipt.test.mjs` | PASS: 4 негатива и валидный кейс |
| C2 | `task-accept.mjs` вызывает `validateReviewReceipt` | exit 0 |
| C3 | `node --test --test-name-pattern="реестр" plugin/test/registry-lint.test.mjs` | PASS: 4 кейса |
| C4 | `task-lint.mjs` вызывает `checkRegistry` | exit 0 |
| C5 | `node spec/scripts/task-lint.mjs --task docs/tasks/0088/fixtures/with-shape` | exit 0 (совместимость) |
| C6 | `node plugin/tools/test.mjs` | exit 0 |
| C7 | `node spec/selftest.mjs` | `SELFTEST OK` |
<!-- CRITERIA:END -->
