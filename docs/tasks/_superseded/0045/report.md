# Задание 0045 — отчёт исполнителя

## 1. Что изменено

1. `spec/scripts/lib/common.mjs`: добавлены `runCriteria(criteria, options)` и
   `criteriaConcurrency(options)`.
   - Параллелизм: `options.concurrency` → `WF_CRITERIA_PARALLEL` → 4; значение 1 — строго
     последовательно; нечисло/значение < 1 не валит ворота, берётся следующее по приоритету.
   - Каждый критерий запускается существующим `runCommand` с `cwd` из `c.cwd`
     (относительно `options.cwd`/`options.repo`), `timeoutMs` из `c.timeoutMs`
     (иначе `options.timeoutMs`, иначе 120000; множитель `options.timeoutMultiplier`
     сохраняет `--timeout-multiplier` ворот), env из `options.env` + `c.env`.
   - Возвращает массив строк в порядке входного списка: `{ id, command, exitCode, output,
     durationMs }` (+ `stdout`, `stderr`, `timedOut` — ворота пишут по ним лог и причины).
     `output` — stdout и stderr, склеенные через перевод строки.
   - Падение одного критерия не отменяет остальные: исключение `runCommand` превращается в
     строку с `exitCode: 127` и текстом ошибки в `output`/`stderr`, а не в reject пула.
     Ручные (manual) критерии не исполняются и строк не дают.
2. `spec/scripts/task-red.mjs`: последовательный цикл по критериям заменён пулом
   (`runCriteria`), вывод и вердикт прежние (`PASS/FAIL <ID> <мс>`, причины, «Красный доказан»);
   `setup`/`teardown` остались последовательными до/после пула. Сохранён `--timeout-multiplier`.
3. `spec/scripts/task-verify.mjs`: то же для ворот проверки; `manualSkipped` считается по
   тому же списку, вывод и итоговая строка не изменились.
4. `spec/scripts/task-accept.mjs`: собственного цикла по критериям в этих воротах нет —
   приёмщик запускает свежий прогон `task-verify` (там критерии идут через `runCriteria`),
   поэтому пул используется транзитивно; в месте запуска свежего прогона добавлен
   комментарий-контракт: `runCriteria` + `WF_CRITERIA_PARALLEL` наследуется через
   `process.env`. Второй цикл здесь означал бы второй формат вывода и второй вердикт.

Контракт, критерии и `spec/checks/**` не менялись; `plugin/**`, `package.json`,
`pnpm-lock.yaml` не трогались. Ничего не коммитилось и не пушилось.

## 2. Файлы

- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\lib\common.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-red.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-verify.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-accept.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0045\report.md (этот файл)

## 3. Проверки

Все команды — из корня репозитория, критерии прогонялись по одной (как в задании).

### C1 — `node spec/checks/parallel-criteria.mjs c1`

Три прогона подряд, standalone:

```
PARALLEL OK c1 (1712 мс на три по 1200 мс)
[exit 0]
PARALLEL OK c1 (1727 мс на три по 1200 мс)
[exit 0]
PARALLEL OK c1 (1757 мс на три по 1200 мс)
[exit 0]
```

### C2 — `node spec/checks/parallel-criteria.mjs c2`

```
PARALLEL OK c2
[exit 0]
```

### C3 — `node spec/checks/parallel-criteria.mjs c3`

```
PARALLEL OK c3
[exit 0]
```

### C4 — `node spec/selftest.mjs`

67 строк PASS, последние строки:

```
PASS  doctor: без задач risk: high про ключ human-* молчит
PASS  doctor: задача risk: high включает предупреждение о human-*

SELFTEST OK
[exit 0]
```

Синтаксис изменённых файлов — `node --check` на `common.mjs`, `task-red.mjs`,
`task-verify.mjs`, `task-accept.mjs`: все exit 0.

## 4. Замер «до/после»

### 4.1. Механизм пула, один и тот же набор (4 независимые команды по 800 мс)

```
последовательно (concurrency=1): 4628 мс; exitCodes=0,0,0,0; ids=K1,K2,K3,K4
пул (concurrency=4): 1480 мс; exitCodes=0,0,0,0; ids=K1,K2,K3,K4
последовательно (concurrency=1): 4649 мс; exitCodes=0,0,0,0; ids=K1,K2,K3,K4
пул (concurrency=4): 1563 мс; exitCodes=0,0,0,0; ids=K1,K2,K3,K4
```

Сумма → max: 4,63 с → 1,48 с (в 3,1 раза), порядок ID сохранён.

### 4.2. Ворота на одном и том же задании — 0045

| Прогон | Настройка | Стена | Критерии |
| --- | --- | --- | --- |
| `task-verify --task docs/tasks/0045` | `WF_CRITERIA_PARALLEL=1` (прежнее поведение) | 49 704 мс | C1 2,3 с; C2 1,4 с; C3 1,1 с; C4 38,3 с — всё зелёное |
| `task-verify --task docs/tasks/0045` | по умолчанию (4) | 44 095 мс | C1 3,8 с FAIL; C2 3,4 с; C3 3,2 с; C4 37,5 с |
| то же, повтор | по умолчанию (4) | 44 303 мс | C1 4,0 с FAIL; C2/C3/C4 зелёные |
| то же, повтор | по умолчанию (4) | 51 157 мс | C1 4,3 с FAIL (внутри 3366 мс); C4 43,5 с |

Выигрыш на 0045 ограничен самым долгим критерием (C4, 37–43 с): 49,7 с → 44,1 с (−5,6 с,
ровно сумма C1..C3). По форме задачи 0041 (189 с на прогон при max = 115 с) ожидаемый
выигрыш будет ≈74 с на каждом прогоне.

## 5. Отклонения от задания и находка

1. **`task-accept.mjs`**: в этих воротах нет последовательного цикла по критериям — они
   запускают свежий прогон `task-verify` целиком (`runSync`), где критерии уже идут через
   `runCriteria`. Заменить цикл вызовом пула нельзя: цикла нет. Сделана документированная
   делегация в точке запуска свежего прогона (`runCriteria` + `WF_CRITERIA_PARALLEL`
   наследуются через `process.env`); критерий C3 проверяет исполнением именно наличие
   `runCriteria` и `node --check` — проходит.
2. **Находка (нужно решение архитектора): критерий C1 несовместим с пулом на этой машине.**
   C1 — единственный критерий, который меряет стену (< 2500 мс на три команды по 1200 мс), и
   он же исполняется как один из критериев набора. Замеры:
   - standalone: 1712–1757 мс (стабильно зелёный);
   - рядом с одним соседним критерием: 2211–2434 мс (на границе);
   - рядом с двумя-тремя соседями: 2685–3105 мс (красный);
   - внутри ворот с C4 (selftest, десятки git-спавнов): 3105–3366 мс (красный).
   Причина — стоимость создания процессов на Windows (cmd.exe + node ~500–700 мс под
   нагрузкой), а не логика пула: сам пул параллелен (три по 1200 мс укладываются в 1712 мс
   вместе со стартом). Поэтому `task-verify`/`task-accept` с `WF_CRITERIA_PARALLEL` по
   умолчанию 4 краснеют по C1, а `task-red`-подобные прогоны на этой же машине при
   `WF_CRITERIA_PARALLEL=1` зелёные. Контракт требует «по умолчанию 4», поэтому поведение
   оставлено по контракту, а находка вынесена сюда.
   Предложения (вне границ этого задания): либо приёмка 0045 идёт по критериям, снятым по
   одному (как в разделе 3), либо отдельным заданием поднять бюджет C1/сделать для
   wall-clock критериев флаг «исполнять без соседей» (`exclusive: true`), который пул
   учитывает барьером.
3. Артефакты `docs/tasks/0045/verify.json`/`verify.log` — от последнего прогона с настройкой
   по умолчанию (C1 красный по причине из п. 2). Зелёный прогон — с `WF_CRITERIA_PARALLEL=1`,
   его вывод в таблице 4.2.

## 6. git status --short

(см. ниже в ответе; на момент отчёта)

```
 M spec/scripts/lib/common.mjs
 M spec/scripts/task-accept.mjs
 M spec/scripts/task-red.mjs
 M spec/scripts/task-verify.mjs
?? docs/tasks/0045/criteria.lock
?? docs/tasks/0045/red.json
?? docs/tasks/0045/report.md
?? docs/tasks/0045/verify.json
```
