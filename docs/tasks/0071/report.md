# Отчёт по заданию 0071 (WC-39). Проверки пакета без пайпов

## 0. Как получен отчёт

Сессия исполнителя (узел `worker`, child `24ceb7fc`) сделала все правки и ушла в проверки, но была
оборвана лимитом инструмента в 540 с — финальный отчёт исполнителя не получен. Отчёт сведён
архитектором по диффу исполнителя и по прогонам ворот; каждое утверждение ниже проверяемо командой.

## 1. Что изменено

1. **Контракт (коммит `04658e9`).** Сканер `spec/checks/pipe-free.mjs` больше не исключает
   `spec/checks` из c1: проверки стали примером правила. Комментарий функции дополнен, что c1
   покрывает и проверки. На контракте c1 красный: 37 спавнов с пайпами в 29 файлах.
2. **Работа исполнителя — 29 файлов `spec/checks/*.mjs`.** Локальные спавны переведены на
   `spawnSyncPipeFree` из `spec/scripts/lib/common.mjs` (вывод ребёнка — во временные файлы):
   `import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';` и замена вызова с теми же
   аргументами/опциями. Где была локальная обёртка `run()` — она сохранена, помощник вызывается внутри.
3. **Семантика сохранена:** `status`, `stdout`, `stderr`, `error`, режимы `encoding: 'utf8'` и
   Buffer, `cwd`, `env`, `timeout` — те же. Ожидания проверок не менялись: в диффе нет ни одной
   добавленной строки `SKIP` и ни одного удалённого `assert`/`expect(` (проверено `git diff -U0`).

Файлы (полные пути, корень `subagent-workflow-v2`): `spec/checks/acceptance-p0.mjs`,
`acceptance-record.mjs`, `acceptance-schema.mjs`, `actor-sources.mjs`, `ci-behavior.mjs`,
`contract-selfcheck.mjs`, `covers-severity.mjs`, `criteria-overlap.mjs`, `deploy-safety.mjs`,
`deployed-copy.mjs`, `doctor-keys.mjs`, `doctor-legacy-key.mjs`, `engine-root.mjs`,
`external-engine.mjs`, `gate-output.mjs`, `gate-rules.mjs`, `gates-journal.mjs`,
`guard-acceptance.mjs`, `hooks-mode.mjs`, `narrow-external.mjs`, `narrow-suite.mjs`,
`outside-package.mjs`, `panel-deploy.mjs`, `panel-doctor.mjs`, `panel-older.mjs`,
`parallel-criteria.mjs`, `release-hygiene.mjs`, `targeted-tests.mjs`, `update-flow.mjs`.

`git diff --stat`: 29 файлов, +85 / −80. `spec/checks/pipe-free.mjs` не менялся исполнителем
(protected): сканер уже расширен контрактом.

## 2. Проверки (ворота `task-verify`, прогон архитектора)

```
task-verify: 0071
PASS  C1  exit 0  1361 ms
PASS  C2  exit 0  5591 ms
PASS  C3  exit 0  108344 ms
PASS  C4  exit 0  252242 ms
PASS  C5  exit 0  200063 ms
PASS  C6  exit 0  1339 ms
PASS  C7  exit 0  40894 ms
Итог: C1 exit 0 1361 ms; C2 exit 0 5591 ms; C3 exit 0 108344 ms; C4 exit 0 252242 ms; C5 exit 0 200063 ms; C6 exit 0 1339 ms; C7 exit 0 40894 ms
Все проверки зелёные. Digest дерева: d1cb6fe4d66f0c1acaa6e6b8f717e79a5b66a6012a0a21d177cf4af388ef9ea3
```

Прямые прогоны до ворот: `node spec/checks/pipe-free.mjs c1` → `PIPEFREE OK c1` (exit 0);
`node spec/checks/gate-output.mjs c1` → `GATEOUT OK c1` (exit 0);
`node spec/checks/actor-sources.mjs c1` → `ACTOR SOURCES OK` (exit 0);
`node spec/checks/outside-package.mjs c1` → `OUTSIDE-PACKAGE OK: 44 проверок печатают SKIP вне пакета` (exit 0).

## 3. Отклонения

1. **Отчёт исполнителя не получен** — сессия узла `worker` прервана лимитом 540 с на этапе проверок
   (26 вызовов инструментов, все правки уже на диске). Отчёт сведён архитектором; правки не
   переписывались.
2. **Хвостовые переводы строк.** Исполнитель местами потерял/добавил финальный `\n`. Архитектор привёл
   файлы к исходной конвенции HEAD, чтобы дифф оставался чисто смысловым (`git diff` без маркеров
   «No newline at end of file»; проверено — 0 маркеров).
3. Ничего вне `allowedPaths` не изменено: `git status --short` содержит только 29 файлов проверок и
   артефакты задания (`criteria.lock`, `red.json`, `red.log`, `gates.jsonl`, `verify.*`).

## 4. git status --short

```
 M spec/checks/*.mjs            (29 файлов, см. §1)
?? docs/tasks/0071/criteria.lock
?? docs/tasks/0071/gates.jsonl
?? docs/tasks/0071/red.json
?? docs/tasks/0071/red.log
?? docs/tasks/0071/verify.json
?? docs/tasks/0071/verify.log
?? docs/tasks/0071/report.md
```
