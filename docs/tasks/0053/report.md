# Отчёт исполнителя — задание 0053

## Что изменено

1. **Шаблон задания, §Отчёт.** Пункт 3 теперь требует команду и exit код **каждой** проверки из
   `criteria.json`, включая регресс; список берётся из контракта целиком, а не из того, что успел
   прогнать исполнитель. Непрогнанная проверка пишется как `NOT RUN` — молчаливых пропусков нет.
   Остальные пункты §Отчёт (что изменено, файлы, отклонения, сумма критериев, `git status --short`)
   сохранены без изменений.
2. **`spec/scripts/lib/acceptance-policy.mjs`.** Новая чистая функция
   `reportReadRecord({ reportRead, reason })` → `{ reportRead: 'declared'|'not-declared',
   reportReadVerified: false, reportReadReason: <trim reason|''> }`. Модуль по-прежнему не читает fs,
   не ходит в сеть и не знает про argv. `reportReadGuard` не тронут.
3. **`spec/scripts/task-accept.mjs`.** После `reportReadGuard` вычисляется `reportReadProof`
   вызовом `reportReadRecord` и его поля попадают в `independence` записи `acceptance.json`
   (и в dry-run вывод) рядом с `reportWithheld`/`reportReadReason`. `reportWithheld` оставлен
   для совместимости (`plugin/lib/state.js` его читает), но доказательством чтения больше не
   подаётся: honest-пара — `reportRead` + `reportReadVerified: false`, причина рядом.

## Файлы

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\templates\task.md`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\lib\acceptance-policy.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-accept.mjs`

## Проверки

| ID | Команда | Exit | Дословный вывод |
| --- | --- | --- | --- |
| C1 | `node spec/checks/report-honesty.mjs c1` | 0 | `REPORT OK c1` |
| C2 | `node spec/checks/report-honesty.mjs c2` | 0 | `REPORT OK c2` |
| C3 | `node spec/selftest.mjs` | 0 | `SELFTEST OK` (последняя строка; фон, job `pwsh-18ceb21ef779485a`) |

Красный на базе (до правок, по одному прогону, чтобы зафиксировать исходное состояние):

- `node spec/checks/report-honesty.mjs c1` — exit 1: `REPORT FAIL c1: §Отчёт не ссылается на criteria.json`
- `node spec/checks/report-honesty.mjs c2` — exit 1: `REPORT FAIL c2: в acceptance-policy нет reportReadRecord`

## Что гонялось и сколько раз

- `node spec/checks/report-honesty.mjs c1` — 3 раза: 1 до правок (красный), 1 после, 1 финальная
  проверка после записи этого отчёта.
- `node spec/checks/report-honesty.mjs c2` — 3 раза: 1 до правок (красный), 1 после, 1 финальная.
- `node spec/selftest.mjs` — 1 раз, фоновым джобом, после всех правок исходников: `SELFTEST OK`.
- `node spec/checks/judge-discipline.mjs c2` и `c3` — по 1 разу (точечная страховка, что
  `reportReadGuard`/`actorModel` и импорт не сломаны): `JUDGE OK c2`, `JUDGE OK c3`.
- `node --check` для обоих изменённых `.mjs` — 1 раз, exit 0.
- Прямой вызов `reportReadRecord` на четырёх входах (declared/not-declared, причина с пробелами,
  не-строка, пустой вызов) — 1 раз, поля `reportRead`/`reportReadVerified`/`reportReadReason`
  ведут себя как в контракте.

## Отклонения от задания и почему

1. **`spec/templates/acceptance.schema.json` не обновлён.** Файл не входит в `allowedPaths`
   (разрешены только `spec/templates/task.md`, два скрипта и `docs/tasks/0053/**`). Схема объявляет
   `independence` с `additionalProperties: false` и уже не знает `reportReadReason`,
   добавленного в 0049; теперешние `reportRead`/`reportReadVerified` она так же не знает.
   Скрипты репозитория схему не валидируют (это была та же ситуация в 0010), поэтому ворота
   зелёные, но внешний потребитель отклонит корректную запись. Это дефект границ задания —
   кандидат на отдельный ID, а не на правку защищённой схемы из этой задачи.
2. **Размещение полей — внутри `independence`**, рядом с `reportWithheld`/`reportReadReason`:
   верхний уровень записи тоже `additionalProperties: false`, а смысл полей — свойство
   независимости приёмки, как и `reportWithheld`.
3. Больше отклонений нет: контракт, критерии, `spec/checks/**` и `plugin/**` не менялись.

## git status --short

```
 M spec/scripts/lib/acceptance-policy.mjs
 M spec/scripts/task-accept.mjs
 M spec/templates/task.md
?? docs/tasks/0053/criteria.lock
?? docs/tasks/0053/gates.jsonl
?? docs/tasks/0053/red.json
?? docs/tasks/0053/report.md
```
