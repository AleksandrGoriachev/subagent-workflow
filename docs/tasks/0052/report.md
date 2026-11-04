# Отчёт 0052. Границы до первой правки и правдивый журнал приёмки

Исполнитель: subagent:executor (сессия-исполнитель, deepseek-v4.1-flash). База: eb6a4b5.
Задание: docs/tasks/0052/task.md. Коммит не делался.

## 1. Что изменено

1. `spec/templates/task.md`, §Среда — первым пунктом добавлено правило границ: до первой правки
   сверить список файлов, которые собираешься менять, с `allowedPaths`; файл вне границ — стоп и
   один вопрос постановщику, а не «поправлю и посмотрим» (0046→0054: 20 мин 30 с выброшенной
   работы). Остальные строки раздела не тронуты, `node plugin/tools/test.mjs` упомянут ровно один
   раз (строка «Полный набор — …»).
2. `spec/scripts/task-accept.mjs` — блок записи строки `kind: 'accept'` в `gates.jsonl` перенесён из
   места до `createCandidate` в место после `const candidate = createCandidate(...)`, после
   `signRecord(...)` и после `writeJson(files.acceptance, record)`. Формат строки, поля,
   `exitSummary` и WARN при сбое журнала (`if (!journal.ok) console.log('WARN журнал ворот: …')`) не
   изменены. Комментарий 0051 заменён на объяснение 0052 (WC-30) и явно назван размен: после
   `reset --hard` кандидата последняя строка журнала не восстанавливается (файл попадает в индекс
   до записи) — принято, потому что журнал не должен утверждать «принято» без кандидата.

## 2. Файлы

- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\templates\task.md
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-accept.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0052\report.md

## 3. Проверки — дословно

### C1 — `node spec/checks/contract-discipline.mjs c1`

Красный до правки (1-й прогон, база eb6a4b5), exit 1:

```
DISCIPLINE FAIL c1: §Среда не требует сверки с allowedPaths
```

Зелёный после правки (2-й прогон), exit 0:

```
DISCIPLINE OK c1
```

### C2 — `node spec/checks/contract-discipline.mjs c2`

Красный до правки (1-й прогон), exit 1:

```
DISCIPLINE FAIL c2: строка accept пишется до сборки кандидата (индекс 28928 < 29597) — при сбое сборки в журнале останется ложный accepted
```

Зелёный после правки (2-й прогон), exit 0:

```
DISCIPLINE OK c2
```

### C3 — `node spec/selftest.mjs`

1 прогон, фоновый джоб (`run_in_background`), exit code 0; хвост вывода:

```
PASS  doctor: без задач risk: high про ключ human-* молчит
PASS  doctor: задача risk: high включает предупреждение о human-*

SELFTEST OK
```

Строк `FAIL` в выводе нет; `SELFTEST OK` печатается только при `failed === 0`, затем exit 0.

### Дополнительно (по 1 прогону, чтобы убедиться, что перенос не задел соседние проверки)

- `node spec/checks/targeted-tests.mjs c3` → `TARGETED OK c3` (exit 0) — §Среда всё ещё называет
  `tests-for.mjs`, «затронут», «полный набор», `tools/test.mjs` ровно один раз, «отчёт».
- `node spec/checks/gates-journal.mjs c2` → `GATES OK c2` (exit 0).
- `node spec/checks/judge-discipline.mjs c3` → `JUDGE OK c3` (exit 0).
- `node spec/checks/criteria-overlap.mjs c3` → `OVERLAP OK c3` (exit 0).
- `node --check spec/scripts/task-accept.mjs` → exit 0.

## 4. Отклонения от задания

1. В задании названа подпись `signAcceptance`; в `task-accept.mjs` такой функции нет — запись
   подписывает `signRecord(body, { privateKeyPem, keyId })`, затем `writeJson(files.acceptance, record)`.
   Строка `accept` поставлена после обоих вызовов и после `createCandidate`, поэтому инвариант
   (после кандидата и после подписи) выполнен; проверка c2 проверяет `signAcceptance` только если
   такое имя в файле есть.
2. Осознанный размен, прямо названный в комментарии кода: журнальная строка кандидата больше не
   попадает в кандидатное дерево (её нет на момент `git add` в `createCandidate`). Это цена
   правдивости журнала при сбое сборки; формат и поведение WARN не изменились.
3. Больше ничего не менялось: `spec/checks/**`, `plugin/**`, `package.json` не тронуты, коммита и
   пуша нет.

## 5. git status --short

```
 M spec/scripts/task-accept.mjs
 M spec/templates/task.md
?? docs/tasks/0052/criteria.lock
?? docs/tasks/0052/gates.jsonl
?? docs/tasks/0052/report.md
?? docs/tasks/0052/red.json
```

(criteria.lock, gates.jsonl и red.json — артефакты контракта и красного прогона постановщика, не
правились.)
