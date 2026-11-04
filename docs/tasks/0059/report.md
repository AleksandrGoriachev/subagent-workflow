# Отчёт по заданию 0059 (WC-37): инструменты пакета не зависят от пайпов

## 1. Что изменено

1. В `spec/scripts/lib/common.mjs` добавлен `export function spawnSyncPipeFree(command, args, options = {})` —
   синхронный запуск без пайпов. Вывод ребёнка пишется в два временных файла, они отдаются
   в `stdio: ['ignore', ofd, efd]`, после завершения читаются и удаляются. Результат совместим
   со `spawnSync`: `{ status, stdout, stderr, signal, error }`. Поддержаны `cwd`, `env`,
   `timeout`, `windowsHide`, `encoding` (`'utf8'` → строки, `'buffer'` или отсутствие
   encoding → Buffer). Отсутствующий бинарник не бросает: `status: null` и заполненный `error`.
2. На `spawnSyncPipeFree` переведены все 18 спавнов с пайпами в 7 файлах:
   `spec/selftest.mjs` (4), `spec/e2e.mjs` (7), `spec/e2e-deploy.mjs` (2),
   `spec/scripts/doctor.mjs` (1), `spec/scripts/init.mjs` (2),
   `spec/scripts/task-check-acceptance.mjs` (1), `tools/pack-plugin.mjs` (1).
3. `task-check-acceptance.mjs`: `git()` переписан с `execFileSync` (`stdio: 'pipe'`) на
   `spawnSyncPipeFree`; Buffer-режим (`encoding: 'buffer'`) сохранён для `git show`.
   Диагностика отказа прежняя: текст `git <args>: <stderr>`.
4. Импорты `node:child_process` в перечисленных файлах больше не нужны и удалены; помощник
   импортируется из `spec/scripts/lib/common.mjs`.
5. В `tools/pack-plugin.mjs` поправлен комментарий («spawn без shell не запускает .cmd») —
   он описывал прежний вызов `spawnSync`.

Части контракта не тронуты: `docs/tasks/0059/task.md`, `criteria.json`, `criteria.lock`
не менялись, замок не перезамыкался. Коммитов, пушей и деплоя не было.

## 2. Файлы (полные пути)

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\lib\common.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\selftest.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\e2e.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\e2e-deploy.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\doctor.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\init.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-check-acceptance.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\tools\pack-plugin.mjs`

## 3. Проверки

Рабочий каталог всех команд: `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2`.
Быстрые проверки (c1, c2, c4) гонялись по одному разу после правок; медленные (c3, c5, gate-rules) —
по одному разу в конце. Дополнительно один раз `node --check` по всем 8 изменённым файлам.

| Проверка | Команда | Прогонов | Exit |
| --- | --- | --- | --- |
| C1 | `node spec/checks/pipe-free.mjs c1` | 1 | 0 |
| C2 | `node spec/checks/pipe-free.mjs c2` | 1 | 0 |
| C3 | `node spec/checks/pipe-free.mjs c3` | 1 | 0 |
| C4 | `node spec/checks/pipe-free.mjs c4` | 1 | 0 |
| C5 | `node spec/checks/pipe-free.mjs c5` | 1 | 0 |
| C6 | `node spec/checks/gate-rules.mjs` | 1 | 0 |
| синтаксис | `node --check` по 8 файлам | 1 | 0 |

### C1

```
> node spec/checks/pipe-free.mjs c1
PIPEFREE OK c1
exit 0
```

### C2

```
> node spec/checks/pipe-free.mjs c2
PIPEFREE OK c2
exit 0
```

### C3 (selftest)

```
> node spec/checks/pipe-free.mjs c3
PIPEFREE OK c3
exit 0
```

### C4 (task-check-acceptance на записи 0058)

```
> node spec/checks/pipe-free.mjs c4
PIPEFREE OK c4
exit 0
```

### C5 (e2e)

```
> node spec/checks/pipe-free.mjs c5
PIPEFREE OK c5
exit 0
```

### C6 (gate-rules)

```
> node spec/checks/gate-rules.mjs
PASS F-7: пересечение allowedPaths/protectedPaths — ошибка
PASS F-7 контроль: без пересечения — ок
PASS F-7 узость: свои task.md/criteria.json — ок
PASS F-7 узость: шаблон docs/tasks/0001/*.md — ошибка
PASS covers: шаблон из allowedPaths без covers — WARN и exit 0
PASS covers: конкретный файл из allowedPaths без covers — ERROR и exit 1
PASS covers: файл из allowedPaths под шаблоном covers — ок, exit 0
PASS F-5: пустой mustFail без noRed — ошибка
PASS F-5 контроль: noRed с причиной — ок
PASS F-6: при несовпадении причина и вывод напечатаны
PASS F-8: verify.json сохранён как verify.executor.json

GATE RULES OK
exit 0
```

### Синтаксис изменённых файлов

```
> node --check spec/selftest.mjs; node --check spec/e2e.mjs; node --check spec/e2e-deploy.mjs;
  node --check spec/scripts/lib/common.mjs; node --check spec/scripts/doctor.mjs;
  node --check spec/scripts/init.mjs; node --check spec/scripts/task-check-acceptance.mjs;
  node --check tools/pack-plugin.mjs
(вывода нет)
exit 0
```

## 4. Отклонения от задания и заметки

1. `task-check-acceptance.mjs`: вместе с `execFileSync` убран `maxBuffer: 64 * 1024 * 1024`.
   При файловом stdio maxBuffer не применяется (вывод не идёт через канал), и помощник по
   контракту его не принимает. Для реальных `git show` предел 64 МиБ не достигался; поведение
   вывода не изменилось.
2. `spawnSyncPipeFree` ловит синхронное исключение `spawnSync` (например, неверные аргументы)
   и возвращает его в `error` при `status: null`, а не бросает. Контракт требует такого
   поведения для отсутствующего бинарника; ни один вызывающий не полагается на бросок.
3. Опции вне контракта (`stdio`, `maxBuffer`, `shell`) помощник игнорирует; среди 18 вызовов
   таких не осталось.
4. `windowsHide` по умолчанию `false`, как у `spawnSync`; `pack-plugin` передаёт `true`,
   как и раньше.
5. `tools/pack-plugin.mjs` — поправлен только комментарий, описывавший прежний `spawnSync`.

## 5. git status --short

```
 M spec/e2e-deploy.mjs
 M spec/e2e.mjs
 M spec/scripts/doctor.mjs
 M spec/scripts/init.mjs
 M spec/scripts/lib/common.mjs
 M spec/scripts/task-check-acceptance.mjs
 M spec/selftest.mjs
 M tools/pack-plugin.mjs
?? docs/tasks/0059/criteria.lock
?? docs/tasks/0059/gates.jsonl
?? docs/tasks/0059/red.json
?? docs/tasks/0059/report.md
```

`criteria.lock`, `gates.jsonl`, `red.json` — артефакты контракта и красного прогона, созданные до
работы (входят в `redAllowDirty`), исполнителем не менялись. `docs/tasks/0059/report.md` — этот отчёт.
