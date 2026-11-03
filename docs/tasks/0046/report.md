# Задание 0046 — отчёт исполнителя

## 0. Контекст

Работа начата по 0045 (docs/tasks/0045/task.md), контракт которого ушёл в
docs/tasks/_superseded/0045 коммитом 68b1581 уже во время прогона. Реализация — та же
(пул критериев), проверяется новым критерием: spec/checks/criteria-overlap.mjs доказывает
перекрытие интервалов, а не настенную длительность. Ниже — отчёт по 0046; отчёт по 0045
остался в docs/tasks/_superseded/0045/report.md.

## 1. Что изменено

1. spec/scripts/lib/common.mjs: добавлены runCriteria(criteria, options) и
   criteriaConcurrency(options).
   - Параллелизм: options.concurrency → WF_CRITERIA_PARALLEL → 4; 1 — строго
     последовательно; нечисло/значение < 1 не валит ворота, берётся следующее по приоритету.
   - Каждый критерий идёт через существующий runCommand: cwd из c.cwd (относительно
     options.cwd/options.repo), timeoutMs из c.timeoutMs (иначе options.timeoutMs, иначе
     120000; множитель options.timeoutMultiplier сохраняет --timeout-multiplier), env из
     options.env + c.env.
   - Возвращает строки в порядке входного списка: { id, command, exitCode, output,
     durationMs } (+ stdout, stderr, timedOut для лога и причин). output — stdout и stderr
     через перевод строки.
   - Падение одного критерия не отменяет остальные: исключение runCommand становится строкой
     с exitCode: 127 и текстом ошибки, а не reject пула. Manual-критерии не исполняются и
     строк не дают.
2. spec/scripts/task-red.mjs: последовательный цикл по критериям заменён пулом; вывод
   (PASS/FAIL <ID> <мс>, причины, «Красный доказан») и вердикт прежние; setup/teardown
   остались последовательными до/после пула; сохранён --timeout-multiplier.
3. spec/scripts/task-verify.mjs: то же; manualSkipped считается по тому же списку, итоговая
   строка не изменилась.
4. spec/scripts/task-accept.mjs: своего цикла по критериям в этих воротах нет — приёмщик
   запускает свежий прогон task-verify, где критерии идут через runCriteria, а
   WF_CRITERIA_PARALLEL наследуется через process.env. В точке запуска свежего прогона
   добавлен комментарий-контракт; второй цикл здесь означал бы второй формат вывода и второй
   вердикт.

Контракт, критерии и spec/checks/** не менялись; plugin/**, package.json, pnpm-lock.yaml не
трогались. Не коммитил и не пушил.

## 2. Файлы

- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\lib\common.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-red.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-verify.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-accept.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0046\report.md

## 3. Проверки

### C1 — node spec/checks/criteria-overlap.mjs c1

    OVERLAP OK c1 (перекрытий 3 из 3)
    [exit 0]

### C2 — node spec/checks/criteria-overlap.mjs c2

    OVERLAP OK c2
    [exit 0]

### C3 — node spec/checks/criteria-overlap.mjs c3

    OVERLAP OK c3
    [exit 0]

### C4 — node spec/selftest.mjs

65 строк PASS, последняя:

    SELFTEST OK
    [exit 0]

node --check на common.mjs, task-red.mjs, task-verify.mjs, task-accept.mjs: все exit 0
(C3 проверяет это же изнутри).

### Полный набор node plugin/tools/test.mjs — один раз

122/122 pass, 0 fail, 114 446 мс (прогон сделан по той же реализации: после коммита 0046
дерево откатывалось для красного прогона и восстановлено один в один — git diff --stat
совпадает: 4 файла, +135/−8). node spec/scripts/tests-for.mjs по изменённым путям тестов не
находит (ворота не импортируются plugin-тестами).

## 4. Замер: параллелизм против WF_CRITERIA_PARALLEL=1

Одна и та же задача 0046, task-verify --task docs/tasks/0046 --repo ., две пары прогонов
подряд (машина общая: в это время в репозитории работал архитектор, поэтому шум велик).

| Прогон | C1 | C2 | C3 | C4 | Стена |
| --- | --- | --- | --- | --- | --- |
| WF_CRITERIA_PARALLEL=1 (последовательно) | 2,8 с | 2,0 с | 3,4 с | 47,1 с | 65 553 мс |
| по умолчанию (4) | 5,7 с | 7,3 с | 6,9 с | 59,3 с | 73 018 мс |
| WF_CRITERIA_PARALLEL=1 (повтор) | 3,8 с | 3,0 с | 2,7 с | 53,3 с | 72 279 мс |
| по умолчанию (4), повтор | 4,3 с | 4,2 с | 4,0 с | 50,0 с | 59 278 мс |

Читается не стеной, а суммой против max: в прогоне «по умолчанию» сумма C1..C4 = 79,2 с при
стене 73,0 с; в повторе — 62,5 с при стене 59,3 с. Экономия — ровно sum(C1..C3) ≈ 10–13 с,
но она тонет в разбросе C4: selftest под нагрузкой идёт 47–59 с вместо 38 с, и он же —
максимум прогона. У 0045 при более тихой машине тот же замер дал чистые 49 704 → 44 095 мс
(C4 38,3 → 37,5 с).

Механизм пула отдельно, вне ворот, 4 независимые команды по 800 мс:

    последовательно (concurrency=1): 4628 мс; exitCodes=0,0,0,0; ids=K1,K2,K3,K4
    пул (concurrency=4): 1480 мс; exitCodes=0,0,0,0; ids=K1,K2,K3,K4
    последовательно (concurrency=1): 4649 мс; exitCodes=0,0,0,0; ids=K1,K2,K3,K4
    пул (concurrency=4): 1563 мс; exitCodes=0,0,0,0; ids=K1,K2,K3,K4

Сумма → max: 4,63 с → 1,48 с (в 3,1 раза), порядок ID сохранён.

## 5. Отклонения от задания

1. task-accept.mjs: в этих воротах нет цикла по критериям — они целиком запускают свежий
   task-verify. Пул применяется транзитивно; вместо замены цикла — документированная
   делегация в точке запуска. C3 (текст + node --check) проходит.
2. Критерий C1 меряет перекрытие, а не время — следствие решения архитектора по 0046; на
   этой машине оно и снимает ложные красные (в 0045 тот же пул краснел по C1 из-за стоимости
   запуска процессов Windows: 1,7 с в одиночку против 2,7–3,3 с рядом с соседями).
3. Замер ворот на 0046 шумный из-за параллельной работы в репозитории; поэтому в п. 4
   приведены и стена, и сумма, и отдельный замер механизма.

## 6. git status --short

    M spec/scripts/lib/common.mjs
    M spec/scripts/task-accept.mjs
    M spec/scripts/task-red.mjs
    M spec/scripts/task-verify.mjs
    ?? docs/tasks/0046/criteria.lock
    ?? docs/tasks/0046/red.json
    ?? docs/tasks/0046/report.md
    ?? docs/tasks/0046/verify.json
