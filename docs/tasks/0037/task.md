# Задание 0037. doctor говорит правду: «подписывать нечем» вместо «можно: никаким»

<!-- TASK-META
{
  "id": "0037",
  "version": 1,
  "title": "Честная формулировка doctor при чужом отпечатке ключа",
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
    "spec/SPEC.md",
    "docs/tasks/0037/**"
  ],
  "protectedPaths": [
    "spec/checks/doctor-keys.mjs"
  ],
  "redAllowDirty": [
    "docs/tasks/0037/**"
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

Когда закреплённым ключом подписывать нечем, doctor говорит это одной честной фразой
(«подписывать нечем», ключ можно передать явно в `--key`) и не выдаёт противоречивое
«подписывать можно: никаким из штатных каталогов».

## Что не входит

1. Поведение для полного отсутствия ключей (сценарий C) не меняется: там FAIL.
2. Поиск ключей в новых каталогах не добавляется.
3. Формат записей приёмки не меняется.

## Инварианты

1. FAIL остаётся только там, где подписывать нечем и ключа нет вовсе (сценарий C).
2. Чужой отпечаток под именем пина — WARN, exit 0: ключ может лежать вне штатных каталогов.
3. Текст предупреждения не содержит слова «никаким» и говорит, что делать.
4. Спецификация описывает правило явно (I-37) и не противоречит поведению.

## Границы знания

1. Менять можно: `spec/scripts/doctor.mjs`, `spec/SPEC.md`, файлы задания.
2. `spec/checks/doctor-keys.mjs` защищён: не править.
3. Не коммить, не пушить, не деплоить.

## Среда

- `node spec/checks/doctor-keys.mjs` — сценарии A, B, D
- `node spec/checks/doctor-keys.mjs --no-signable` — сценарий C

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/doctor-keys.mjs` | exit 0, в stdout `DOCTOR KEYS OK` |
| C2 | `node spec/checks/doctor-keys.mjs --no-signable` | exit 0, в stdout `NO-SIGNABLE OK` |
| C3 | проверка I-37 в `spec/SPEC.md` | exit 0, в stdout `SPEC I-37 OK` |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено: текст предупреждения и формулировка I-37.
2. Файлы — полными путями.
3. Дословный вывод трёх команд.
4. `git status --short`.

## Коммит

Только после записи о приёмке. Коммит делает архитектор по принятому кандидатному SHA.
