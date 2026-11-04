# Отчёт задания 0058

## 1. Что изменено

- `spec/scripts/task-verify.mjs` (строки 50–53): жёсткая проверка `red.version !== 4` заменена на приём
  версий **4 и 5** (4 — исторические записи, 5 — текущий формат `task-red`). Иные версии по-прежнему
  отвергаются до проверки полей чужого формата, сообщение содержит слово «версия».
- Остальные проверки `red.json` не менялись: `redProven`, `redExpectation.ok`, `baseSha`,
  `contractCommit`, `criteriaJsonSha256`.
- Код исполнителя 0057 (`lib/common.mjs`, `task-red.mjs`, `task-lint.mjs`, `templates/task.md`,
  `templates/criteria.json`) не переписывался: он уже лежал в рабочем дереве, проверен и весь зелёный.
  Мой диф — только `task-verify.mjs` (по `git diff --stat` 5 изменённых строк: `+4/-1` в одном месте, включая комментарий).
- `task.md`, `criteria.json`, `criteria.lock` не тронуты, замок не перезамыкался. `spec/selftest.mjs`
  не тронут (фикстура `red.json` v4 остаётся законной исторической записью).

## 2. Файлы (полные пути)

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-verify.mjs` — изменён.
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0058\report.md` — этот отчёт.

Диф `task-verify.mjs`:

```diff
-    if (red.version !== 4) fail('red.json: версия ' + red.version + ' устарела, нужна 4 — перезапустите task-red');
+    /* 0058 (WC-35): task-red пишет текущий формат 5, исторические артефакты — 4; остальные номера отвергаем. */
+    if (red.version !== 4 && red.version !== 5) {
+      fail('red.json: версия ' + red.version + ' неизвестна — принимаются версии 4 (исторические записи) и 5 (текущий формат); перезапустите task-red');
+    }
```

Синтаксис: `node --check spec/scripts/task-verify.mjs` → exit 0.

## 3. Проверки (команда и дословный вывод)

### 3.1. До правки — C7 красный (доказательство, что дефект был)

```
$ node spec/checks/verify-red-version.mjs c1
VERVER FAIL c1: task-verify отверг свежий red.json v5 (exit 1): task-verify: red.json: версия 5 устарела, нужна 4 — перезапустите task-red
exit=1
```

### 3.2. Финальный общий прогон (все 7 критериев, последовательно)

```
$ node spec/checks/red-reason.mjs c1
exit=0 (13s)
REDREASON OK c1

$ node spec/checks/red-reason.mjs c2
exit=0 (23.7s)
REDREASON OK c2

$ node spec/checks/red-reason.mjs c3
exit=0 (12.6s)
REDREASON OK c3

$ node spec/checks/red-reason.mjs c4
exit=0 (17.1s)
REDREASON OK c4

$ node spec/checks/red-reason.mjs c5
exit=0 (68.3s)
REDREASON OK c5

$ node spec/checks/gate-output.mjs c1
exit=0 (0.1s)
GATEOUT OK c1

$ node spec/checks/verify-red-version.mjs c1
exit=0 (36.6s)
VERVER OK c1

SUMMARY: cases=7 failed=0
```

Отдельный прогон C7 сразу после правки:

```
$ node spec/checks/verify-red-version.mjs c1
exit=0
VERVER OK c1
```

### 3.3. Число прогонов

- C1, C2, C3, C4 — по 2 прогона (первый промежуточный блок + финальный блок), оба зелёные.
- C5 — 2 прогона (отдельный + финальный), зелёные.
- C6 — 2 прогона (отдельный + финальный), зелёные.
- C7 — 3 прогона: 1 предфиксный (красный, см. 3.1) + 1 отдельный после правки + 1 финальный; оба после правки зелёные.
- Итог: 7 из 7 критериев зелёные, падений 0.

### 3.4. Проверки, которые в песочнице не идут (EPERM на пайпах `spawnSync`)

Запущены честно, зелёное не подделывалось.

```
$ node spec/selftest.mjs
exit=1
SELFTEST FAILED: 1
[stderr]
SELFTEST ERROR: Error: git init -q: undefined
    at git (file:///C:/Users/Goryachev/Documents/deepseek-harness/default-workspace/subagent-workflow-v2/spec/selftest.mjs:30:29)
    at file:///C:/Users/Goryachev/Documents/deepseek-harness/default-workspace/subagent-workflow-v2/spec/selftest.mjs:50:3
```

```
$ node spec/e2e.mjs
exit=1
E2E FAILED: 1
[stderr]
E2E ERROR: Error: git init -q: undefined
    at git (file:///C:/Users/Goryachev/Documents/deepseek-harness/default-workspace/subagent-workflow-v2/spec/e2e.mjs:46:29)
    at file:///C:/Users/Goryachev/Documents/deepseek-harness/default-workspace/subagent-workflow-v2/spec/e2e.mjs:57:3
```

```
$ node spec/checks/gate-rules.mjs c1
exit=1
FAIL F-7: пересечение allowedPaths/protectedPaths — ошибка — exit=null 
FAIL F-7 контроль: без пересечения — ок
FAIL F-7 узость: свои task.md/criteria.json — ок — exit=null 
FAIL F-7 узость: шаблон docs/tasks/0001/*.md — ошибка — exit=null 
FAIL covers: шаблон из allowedPaths без covers — WARN и exit 0 — exit=null 
FAIL covers: конкретный файл из allowedPaths без covers — ERROR и exit 1 — exit=null 
FAIL covers: файл из allowedPaths под шаблоном covers — ок, exit 0 — exit=null 
FAIL F-5: пустой mustFail без noRed — ошибка — exit=null 
FAIL F-5 контроль: noRed с причиной — ок
FAIL F-6: при несовпадении причина и вывод напечатаны — exit=null 
FAIL F-8: verify.json сохранён как verify.executor.json

GATE RULES FAIL: 11
```

Причина одна: дочерние `git`/`node` в этих раннерах запускаются через `spawnSync` с пайпами, а в
ограниченной песочнице пайп даёт `EPERM` (у `gate-rules` дочерние процессы завершаются `exit=null`).
Сама правка здесь ни при чём: приёмочные проверки `red-reason`/`gate-output`/`verify-red-version`
специально пишут вывод дочерних процессов в файлы и потому идут.

## 4. Отклонения от задания и почему

1. `spec/scripts/task-verify.mjs` — единственный файл, который я правил; это ровно недостающее звено
   из инварианта 7 (файл в `allowedPaths`). Объём правки минимальный.
2. `docs/tasks/0058/red.json` в рабочем дереве имеет `version: 4`: он снят **базовым** `task-red`
   (v4) при доказательстве красного, до появления кода 0057 в рабочем дереве. Текущий `task-red.mjs`
   пишет v5 — именно поэтому ворота теперь принимают обе версии. Red **не перезапускал**: задание
   запрещает перезамыкать замок и менять контракт, а красный уже доказан (C1, C2, C5, C7 падают на базе,
   см. `red.json`, `failedIds`). Проверка C7 доказывает приём свежего v5 на своей фикстуре.
3. `spec/selftest.mjs`, `spec/e2e.mjs`, `spec/checks/gate-rules.mjs` не идут из-за EPERM песочницы
   (см. 3.4); это ограничение среды, а не результат правки.
4. Не коммитил, не пушил, не деплоил. `task-accept.mjs` (проверка `verify.json.version`) не трогал —
   вне `allowedPaths` и вне объёма задания.

## 5. git status --short

```
 M spec/scripts/lib/common.mjs
 M spec/scripts/task-lint.mjs
 M spec/scripts/task-red.mjs
 M spec/scripts/task-verify.mjs
 M spec/templates/criteria.json
 M spec/templates/task.md
?? docs/tasks/0058/criteria.lock
?? docs/tasks/0058/gates.jsonl
?? docs/tasks/0058/red.json
?? docs/tasks/0058/report.md
```
