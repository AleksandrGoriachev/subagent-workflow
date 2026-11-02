# Задание 0036. doctor заранее говорит, что закреплённым ключом подписывать нечем

<!-- TASK-META
{
  "id": "0036",
  "version": 1,
  "title": "doctor: предупреждение о закреплённом ключе без приватного",
  "risk": "medium",
  "created": "2026-11-02",
  "owner": "архитектор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-b8721a2a-456c-48a2-94cd-8030d895a8e8", "model": "unknown" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/scripts/doctor.mjs",
    "docs/tasks/0036/**"
  ],
  "protectedPaths": [
    "spec/checks/doctor-keys.mjs"
  ],
  "redAllowDirty": [
    "docs/tasks/0036/**"
  ],
  "hashExclude": [
    "artifacts/**"
  ],
  "decisions": [],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

`doctor` показывает, каким закреплённым ключом приёмка невозможна (приватного нет) и каким
подписывать можно, — до красного прогона и до `task-accept`, а не после отказа на подписи.

## Что не делает

1. Ключи не создаёт и не переносит.
2. `acceptors.json` не правит: нехватка ключа — предупреждение, а не повод менять пин.
3. Не отказывает, пока есть хотя бы один пригодный ключ.

## Инварианты

1. Нет пригодного ключа ни одного — `doctor` падает (exit 1) с текстом «ни один закреплённый ключ».
2. Есть пригодный, но не все — предупреждение с id недоступных и подсказкой, каким подписывать, exit 0.
3. Все пригодны — предупреждения нет, поведение остальных проверок не меняется.

## Границы знания

1. Менять можно только `spec/scripts/doctor.mjs` и файлы задания.
2. Проверка `spec/checks/doctor-keys.mjs` защищена: её не править.
3. Не коммить, не пушить, не деплоить.

## Среда

- `node spec/checks/doctor-keys.mjs` — сценарии A и B
- `node spec/checks/doctor-keys.mjs --no-signable` — сценарий C
- `node spec/checks/outside-package.mjs` — SKIP вне пакета для всех проверок

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/doctor-keys.mjs` | exit 0, в stdout `DOCTOR KEYS OK` |
| C2 | `node spec/checks/doctor-keys.mjs --no-signable` | exit 0, в stdout `NO-SIGNABLE OK` |
| C3 | `node spec/checks/outside-package.mjs` | exit 0, в stdout `OUTSIDE-PACKAGE OK` |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и какие сообщения печатает `doctor`.
2. Файлы — полными путями.
3. Дословный вывод трёх команд.
4. Отклонения и почему.
5. `git status --short`.

## Коммит

Только после записи о приёмке. Коммит делает архитектор по принятому кандидатному SHA.
