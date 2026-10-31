# Задание 0030. Запись приёмки принадлежит заданию

<!-- TASK-META
{
  "id": "0030",
  "version": 1,
  "title": "запись приёмки принадлежит заданию: hasAcceptedRecord сверяет record.task",
  "risk": "medium",
  "created": "2026-11-01",
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
    "spec/scripts/lib/common.mjs",
    "spec/scripts/task-lint.mjs",
    "spec/SPEC.md",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    ".github/workflows/ci.yml",
    "docs/tasks/0030/**"
  ],
  "protectedPaths": [
    "spec/checks/acceptance-record.mjs",
    "docs/tasks/0030/task.md",
    "docs/tasks/0030/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0030/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "impact": "internal",
      "question": "Что проверять в записи приёмки",
      "chosen": "status=accepted + record.task === id задания; без task — не основание; подпись отдельным заданием",
      "options": [
        "только status",
        "status + task",
        "status + task + подпись"
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

`hasAcceptedRecord(file, expectedTask)` должен сверять `record.task` с идентификатором задания: чужая или безымянная запись не снимает проверки и не смягчает lint.

## Зачем

Сейчас любой JSON с `{"status":"accepted"}` считается приёмкой: `verifyLock` ослабляет `contractCommit`, а lint переводит диагностику в WARN. Достаточно скопировать `acceptance.json` от другого задания (или записать пустой статус) — и задание выглядит принятым. Это последняя крупная дыра ночного ревью.

## Что не входит

1. Криптопроверка подписи Ed25519 — отдельное задание (нужен ключ и политика).
2. Схема полей записи (v6) — не меняется.
3. Панель и её отображение записи.

## Инварианты

1. **Своя запись.** `hasAcceptedRecord(file, '0001')` → `true` только если JSON, `status === 'accepted'` и `task === '0001'`.
2. **Чужая, безымянная, битая — не основание**: `false`.
3. **Вызов без id** работает как раньше (обратная совместимость для старых потребителей), но все внутренние вызовы передают id задания.
4. **Lint не смягчается**: при чужой записи и сдвинутом HEAD `task-lint --strict` по-прежнему `ERROR` `contractCommit`.
5. `spec/checks/acceptance-record.mjs`, `docs/tasks/0030/{task.md,criteria.json}` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/acceptance-record.mjs`; полный набор — `selftest`, `e2e`, `gate-rules`, `check-version`.

## Среда

- Node.js, Windows; фикстуры создают одноразовые репозитории в temp.

## Что сделать

1. **`spec/scripts/lib/common.mjs`** — `hasAcceptedRecord(file, expectedTask)`: проверять `status === 'accepted'` и, если `expectedTask` передан, `record.task === expectedTask` (строкой). Обновить комментарий-правило.
2. **`spec/scripts/lib/common.mjs`** — `verifyLock`: передавать `meta.id` в `hasAcceptedRecord`.
3. **`spec/scripts/task-lint.mjs`** — передавать id задания в `hasAcceptedRecord` (сейчас `acceptedRecord = hasAcceptedRecord(files.acceptance)`).
4. **`spec/SPEC.md`** — абзац «Версия 2.6.7:» (запись приёмки принадлежит заданию) и `Версия: 2.6.7`.
5. **Версия 2.6.7 в пяти местах**: `VERSION`, `package.json`, первая строка `README.md`, SPEC, `TOOL` в `spec/scripts/lib/common.mjs`; секция `## 2.6.7` в `CHANGELOG.md`.
6. **`.github/workflows/ci.yml`** — шаг `node spec/checks/acceptance-record.mjs`.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/acceptance-record.mjs | exit 0, в выводе ACCEPTANCE RECORD OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node spec/checks/gate-rules.mjs | exit 0, в выводе GATE RULES OK |
| C5 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.7 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где.
2. Вывод каждой проверки целиком (C1–C5).
3. `git status --short`, `git diff --stat`.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт `task-accept`; пуш и теги — архитектор.
