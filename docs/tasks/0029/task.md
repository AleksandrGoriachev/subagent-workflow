# Задание 0029. Строгость covers: шаблоны — WARN, конкретные файлы — ERROR

<!-- TASK-META
{
  "id": "0029",
  "version": 1,
  "title": "строгость covers: шаблоны — WARN, конкретные файлы — ERROR",
  "risk": "medium",
  "created": "2026-10-31",
  "owner": "архитектор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "issuedBy": {
    "kind": "agent",
    "session": "session-b8721a2a-456c-48a2-94cd-8030d895a8e8",
    "model": "deepseek-v4.1-flash"
  },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/scripts/task-lint.mjs",
    "spec/checks/gate-rules.mjs",
    "spec/SPEC.md",
    "CHANGELOG.md",
    "docs/tasks/0029/**"
  ],
  "protectedPaths": [
    "spec/checks/covers-severity.mjs",
    "docs/tasks/0029/task.md",
    "docs/tasks/0029/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0029/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "impact": "internal",
      "question": "Строгость covers для шаблонов",
      "chosen": "glob/шаблон (содержит * или ?) — WARN и exit 0; конкретный файл — ERROR и exit 1; у принятого задания — WARN для обоих",
      "options": [
        "ERROR для всех",
        "WARN для всех",
        "разделить по шаблону"
      ],
      "reversible": true
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Привести `task-lint` в соответствие с SPEC 2.6.6 п.2 и решением D2 задания 0027: путь-**шаблон** в `allowedPaths` без покрытия — `WARN` и exit 0, конкретный файл — `ERROR` и exit 1.

## Зачем

Дефект 0027: `quality()` вызывается для обеих ветвей, поэтому `allowedPaths: ['src/*.js']` без `covers` даёт `ERROR` и exit 1, хотя SPEC/CHANGELOG обещают `WARN`. Шаблон — это декларация «могу менять», а не всегда изменение; валить контракт за него нельзя.

## Что не входит

1. Поведение для принятых заданий (остаётся WARN).
2. Прочие правила lint (F-7, F-5, F-6, F-8, пути из «Что сделать»).
3. Смена версии спеки (остаётся 2.6.6, релиз не выпущен).
4. Правки панели.

## Инварианты

1. **Шаблон — WARN.** Путь с `*`/`?`/`[` в `allowedPaths` без покрытия у открытого задания → `WARN`, exit 0.
2. **Конкретный файл — ERROR.** Путь без масок, не `*.md`, не под `docs/tasks/<id>/` → `ERROR`, exit 1.
3. **Принятое задание — WARN** для обоих случаев.
4. Фикстуры `gate-rules` покрывают оба уровня: шаблон → WARN/exit 0; файл → ERROR/exit 1.
5. `spec/checks/covers-severity.mjs`, `docs/tasks/0029/{task.md,criteria.json}` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/covers-severity.mjs`; полный набор — `selftest`, `e2e`, `gate-rules`, `check-version`.

## Среда

- Node.js, Windows; фикстуры создают одноразовые репозитории в temp.

## Что сделать

1. **`spec/scripts/task-lint.mjs`** — разделить строгость: для пути с маской (`*`, `?`, `[`) — `warn`; для конкретного файла — `error`; у принятого задания оба — `warn`. Тексты: «covers: шаблон из allowedPaths не покрыт…» и «covers: файл из allowedPaths не покрыт…».
2. **`spec/checks/gate-rules.mjs`** — добавить фикстуру: `allowedPaths ['src/*.js']` без covers → WARN и exit 0; существующая фикстура конкретного файла остаётся ERROR.
3. **`spec/SPEC.md`/`CHANGELOG.md`** — только если формулировки расходятся с поведением; иначе не менять.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/covers-severity.mjs | exit 0, в выводе COVERS SEVERITY OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node spec/checks/gate-rules.mjs | exit 0, в выводе GATE RULES OK |
| C5 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.6 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где.
2. Вывод каждой проверки целиком (C1–C5).
3. `git status --short`, `git diff --stat`.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт `task-accept`; пуш и теги — архитектор.
