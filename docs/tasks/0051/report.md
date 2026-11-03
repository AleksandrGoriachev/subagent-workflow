# Отчёт 0051 — журнал вердиктов ворот (gates.jsonl)

Исполнитель: subagent:executor (session-426e15361c1b). Дата: 2026-11-04.

## 1. Что изменено

1. **Журнал в общем модуле.** `spec/scripts/lib/common.mjs` — блок «журнал вердиктов ворот»:
   - `GATE_JOURNAL = 'gates.jsonl'` и `gateJournalFile(taskDir)` — единственное место, где назван файл;
   - `gateRecord(record)` — чистая нормализация записи
     `{ at, kind, task, head, criteria, verdict, bypasses?, exitSummary? }`:
     `at` — ISO со смещением `+03:00` (строка с явным смещением сохраняется дословно,
     отсутствие времени — «сейчас»), `criteria` — массив
     `{ id, exitCode, durationMs, passed, reasons? }`, пустой список причин не пишется
     (успешный критерий не выглядит как «причина была, но потерялась»);
     `gateCriteriaOf(results)` — строки результатов ворот → критерии записи;
     `gateAt(value)` — приведение времени;
   - `appendGateRecord(file, record)` — append-only JSONL: создаёт каталог и файл при первом
     прогоне, дописывает ровно одну строку, прежние строки не читает и не переписывает
     (если файл оборван без перевода строки — добавляется только разделитель);
     **ошибка записи не бросает**, возвращает `{ ok: false, error }`, успех — `{ ok: true, file, kind, at, bytes }`.
2. **Ворота пишут журнал.** После записи JSON-артефакта и лога:
   - `spec/scripts/task-red.mjs` — `kind: red`, `verdict: red-proven | red-not-proven`,
     критерии с причинами отказа, `bypasses`, `exitSummary`;
   - `spec/scripts/task-verify.mjs` — `kind: verify`, `verdict: passed | failed`,
     в `exitSummary` дополнительно число нарушений;
   - `spec/scripts/task-accept.mjs` — `kind: accept`, `verdict: accepted`, критерии из свежего
     прогона приёмщика. Строка пишется **до** сборки кандидата, чтобы журнал вошёл в кандидатное
     дерево вместе с остальными артефактами (иначе после `git reset --hard <candidate>` последняя
     строка терялась бы). Проверено исполнением: в кандидатном коммите 4 строки журнала.
3. **Сбой журнала не валит ворота.** Во всех трёх воротах ошибка записи печатается как
   `WARN журнал ворот: <текст>` в stdout и не меняет код возврата. Проверено исполнением:
   `gates.jsonl`, подменённый каталогом, даёт `WARN журнал ворот: EISDIR: …` при зелёном
   красном прогоне и `EXIT=0`.

## 2. Файлы (полные пути)

- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\lib\common.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-red.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-verify.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-accept.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0051\report.md (этот отчёт)

`spec/checks/**`, `plugin/**`, `package.json`, `spec/scripts/lib/policy.mjs` и прочие файлы не тронуты.

## 3. Проверки — команда и дословный вывод

```
$ node spec/checks/gates-journal.mjs c1
GATES OK c1
[exit 0]

$ node spec/checks/gates-journal.mjs c2
GATES OK c2
[exit 0]

$ node spec/selftest.mjs
PASS  regress: medium без красного — нарушение
PASS  regress: low без красного и без обхода — нарушение
… (все строки PASS, FAIL — 0)
PASS  TOOL совпадает с VERSION
PASS  doctor: без задач risk: high про ключ human-* молчит
PASS  doctor: задача risk: high включает предупреждение о human-*

SELFTEST OK
[exit 0]
```

Плюс `node --check` на всех четырёх изменённых файлах — exit 0 (это же делает c2 для трёх ворот).

## 4. Что гонялось и сколько раз

| Прогон | Раз |
| --- | --- |
| `node spec/checks/gates-journal.mjs c1` | 3 |
| `node spec/checks/gates-journal.mjs c2` | 3 |
| `node spec/selftest.mjs` (фоном) | 2 |
| `node --check` на изменённых файлах | 4 файла × 2 прохода + 1 для task-accept |
| Сквозной зонд во временном git-репо (red → verify → accept) | 3 запуска драйвера (1 — ошибка стенда: нет CRITERIA-блока; 1 — упёрся в дедлайн 120 с и был снят; 1 — успешный полный) + 2 ручных прогона ворот (verify, red с отказавшим журналом) |

Сквозной зонд (временный репозиторий вне пакета, задание 0001, low) дал журнал из четырёх строк:

```
{"at":"2026-11-04T02:09:03.140+03:00","kind":"red","task":"0001","head":"7abd46f7…","criteria":[{"id":"C1","exitCode":0,"durationMs":361,"passed":false,"reasons":["stdout не содержит: ok 3"]}],"verdict":"red-proven","bypasses":{"allowDirty":false,"allowBaseMismatch":false},"exitSummary":"exit=0; failed=1/1"}
{"at":"2026-11-04T02:09:09.551+03:00","kind":"verify","task":"0001",…,"criteria":[{"id":"C1","exitCode":0,"durationMs":411,"passed":true}],"verdict":"passed",…,"exitSummary":"exit=0; failed=0/1"}
{"at":"2026-11-04T02:09:18.637+03:00","kind":"verify","task":"0001",…,"verdict":"passed",…}
{"at":"2026-11-04T02:09:19.685+03:00","kind":"accept","task":"0001",…,"verdict":"accepted",…,"exitSummary":"exit=0; accepted; checks=1; releaseReady=true"}
```

Порядок строк = порядок прогонов (red → verify исполнителя → verify приёмщика → accept), прежние
строки на месте, `reasons` отказа сохранены, `at` — со смещением `+03:00`.

## 5. Отклонения от задания и границы, о которых надо знать

1. **Ранние отказы до прогона критериев строку не пишут.** Если ворота выходят до критериев
   (нет `criteria.lock`, грязное дерево вне разрешённых путей, `base ≠ HEAD`), журнал не
   дополняется: `criteria` были бы пустыми, а причина — не отказом критерия. Так же ведут себя
   `red.json`/`verify.json`/`acceptance.json` — они тоже не пишутся в этих случаях. Записать такие
   попытки (kind + verdict `blocked`, без критериев) — отдельное расширение контракта записи.
2. **`verdict` для accept — `accepted`** и пишется до `createCandidate`; если после этого упадёт
   сборка кандидата, строка останется, хотя `acceptance.json` не появится. Это осознанный выбор:
   иначе последняя строка не попадает в кандидатное дерево и теряется при финализации.
3. **`at` — фиксированное смещение `+03:00`** (Москва без перехода на летнее время с 2014), а не
   локальная зона машины: запись не должна зависеть от часового пояса того, кто гоняет ворота.
4. **`gates.jsonl` не добавлен в `TASK_ARTIFACTS` и `CLOSED_TASK_ARTIFACTS`** (`task-guard`):
   журнал `task-guard` по заданию — отдельная работа, а `task-guard` вне разрешённых путей.
   На текущие ворота это не влияет: файл лежит в каталоге задания, а он исключён из
   `computeWorktreeDigest` и разрешён в `allowedDiff`/допустимо-грязных путях.
5. Формат `red.json`/`verify.json`/`acceptance.json` не менялся; в `red.json` `dirtyPaths` может
   теперь содержать `docs/tasks/<id>/gates.jsonl` — это следствие того, что журнал лежит в
   каталоге задания (раньше так же попадали `criteria.lock` и `red.json`).

## 6. git status --short

```
 M spec/scripts/lib/common.mjs
 M spec/scripts/task-accept.mjs
 M spec/scripts/task-red.mjs
 M spec/scripts/task-verify.mjs
?? docs/tasks/0051/criteria.lock
?? docs/tasks/0051/red.json
```

`docs/tasks/0051/report.md` и `docs/tasks/0051/gates.jsonl` создаются при прогоне/отчёте; коммит и
пуш не выполнялись.
