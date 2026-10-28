# Задание 0006. Проверка обхода workflow в CI

<!-- TASK-META
{
  "id": "0006",
  "version": 1,
  "title": "проверка обхода workflow в CI",
  "risk": "medium",
  "created": "2026-10-28",
  "owner": "архитектор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "issuedBy": {
    "kind": "agent",
    "session": "session-2287b54f-ee61-4539-b719-67d6fe5f823e",
    "model": "deepseek-v4.1-flash"
  },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    ".github/**",
    "spec/checks/**",
    "spec/scripts/lib/common.mjs",
    "docs/tasks/0006/**",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "RELEASE-CHECKLIST.md",
    "spec/SPEC.md"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "docs/tasks/0006/task.md",
    "docs/tasks/0006/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0006/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Где запускать приёмочные кейсы guard",
      "chosen": "отдельным шагом в CI, а не внутри selftest",
      "options": [
        "внутри selftest",
        "отдельным шагом в ci.yml"
      ],
      "impact": "internal",
      "reversible": true
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Приёмочные кейсы `guard` проверяются в CI на каждый пуш: регрессию в самом механизме запрета обхода ловит машина, а не следующее задание.

## Что не входит

1. Задание 0005 аннулировано: в его allowedPaths не входил spec/scripts/lib/common.mjs (константа TOOL), без которой критерий версии невыполним — контракт был неисполним изнутри себя. I-3 запрещает перезамок после красного, поэтому новый ID.
1. Включение `guard` для конкретных воркспейсов — это решение заказчика на панели, отдельной задачей.
2. Новые кейсы `guard`: набор из восьми уже принят в 2.5.0, здесь только их запуск в CI.

## Инварианты

1. Шаг запускает именно `--all`, а не отдельный кейс: иначе проверка тихо сузится.
2. Существующие шаги CI не удаляются и не ослабляются.
3. Секреты не попадают в код и логи.

## Границы знания

1. Тебе дан этот файл и репозиторий. Не читай чужие проекты.
2. `spec/checks/**` защищён замком: менять приёмочные проверки нельзя.
3. Менять можно только пути из `allowedPaths`.
4. Не пушь и не ставь теги.

## Среда

- Node.js, Windows.
- Проверка задания: `node spec/checks/ci-guard-step.mjs`.
- Полный набор: `node spec/selftest.mjs`, `node spec/e2e.mjs`, `node plugin/tools/test.mjs`, `node tools/check-version.mjs`.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/ci-guard-step.mjs | exit 0, в выводе PASS шаг guard-acceptance |
| C2 | node spec/e2e.mjs | exit 0 |
| C3 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.5.1 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где.
2. Вывод каждой проверки.
3. `git status --short`.

## Коммит

Коммит — по принятому кандидату; пуш и тег — архитектор после записи о приёмке.