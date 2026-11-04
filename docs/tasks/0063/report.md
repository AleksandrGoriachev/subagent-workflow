# Отчёт 0063. `e2e-deploy` не считает локальный `.node-path` расхождением

Задача: [docs/tasks/0063/task.md](task.md) · Контракт: [criteria.json](criteria.json) · Красный:
[red.json](red.json). Коммит не делался.

## 1. Что изменено

1. **`STATE_FILES` пополнен `.node-path`** (`spec/e2e-deploy.mjs`): набор локальных файлов
   теперь `acceptors.json`, `workflow.config.json`, `VERSION`, `.node-path`. Сравнение не
   ослаблено: фильтр по-прежнему применяется к относительным путям из `STATE_FILES`, любой
   другой лишний файл даёт `extra` → FAIL (`missing`/`changed` не тронуты).
2. **Комментарий над `STATE_FILES` назван честно**: файлы принадлежат пространству или машине
   (состояние пространства + машинно-локальный путь к `process.execPath`), всё остальное
   сравнивается побайтно.
3. **Текст утверждения** сравнения перечисляет локальные файлы явно:
   `развёрнутое дерево совпадает с пакетом (кроме локальных acceptors.json, workflow.config.json, VERSION и .node-path)`.
4. Больше ничего не менялось: ни логика `diffTree`, ни другие утверждения, ни `init`/`hooks`/
   `spec/checks/**`.

Итоговый diff:

```diff
diff --git a/spec/e2e-deploy.mjs b/spec/e2e-deploy.mjs
index b9ee00c..f8006e2 100644
--- a/spec/e2e-deploy.mjs
+++ b/spec/e2e-deploy.mjs
@@ -79,8 +79,13 @@ function keyIds(repo) {
   return JSON.parse(fs.readFileSync(file, 'utf8')).acceptors;
 }
 
-/* Файлы дерева, без состояния конкретного пространства. */
-const STATE_FILES = new Set(['acceptors.json', 'workflow.config.json', 'VERSION']);
+/*
+ * Файлы дерева, которые принадлежат конкретному пространству или машине, а не
+ * пакету: состояние пространства (acceptors.json, workflow.config.json, VERSION)
+ * и машинно-локальный .node-path, который init пишет путём к process.execPath.
+ * Всё остальное сравнивается побайтно; лишний файл вне набора — FAIL.
+ */
+const STATE_FILES = new Set(['acceptors.json', 'workflow.config.json', 'VERSION', '.node-path']);
 
 function listFiles(dir, base = dir, out = []) {
   for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
@@ -125,7 +130,7 @@ try {
 
   const deployDiff = diffTree(HERE, path.join(repoA, WORKFLOW));
   report(
-    'развёрнутое дерево совпадает с пакетом (кроме acceptors.json и конфигурации)',
+    'развёрнутое дерево совпадает с пакетом (кроме локальных acceptors.json, workflow.config.json, VERSION и .node-path)',
     deployDiff.missing.length === 0 && deployDiff.extra.length === 0 && deployDiff.changed.length === 0,
     JSON.stringify(deployDiff),
   );
```

## 2. Файлы

Полные пути:

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\e2e-deploy.mjs` — изменён (единственный файл кода).
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0063\report.md` — этот отчёт.

Контракт не тронут: `task.md`, `criteria.json`, `criteria.lock` — без изменений (`git status` ниже
показывает их как untracked из-за красной фазы, а не как правку).

## 3. Проверки (каждая — команда, exit код, дословный вывод)

Рабочий каталог всех команд:
`C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2`.
Вывод ниже — из файлов, в которые он был перенаправлен при прогоне (без ручной правки).

### C1. `node spec/e2e-deploy.mjs`

Прогнана 3 раза после правки (все exit 0); ниже — последний прогон, уже на финальном
содержимом файла (после отката негативного контроля):

```
PASS  init из пакета разворачивает пространство
PASS  пространство A получает закреплённый публичный ключ и приватный ключ
PASS  развёрнутое дерево совпадает с пакетом (кроме локальных acceptors.json, workflow.config.json, VERSION и .node-path)
PASS  развёрнутые файлы получают свежий mtime (git увидит обновление)
PASS  развёрнутая копия знает версию пакета
PASS  конфигурация A: каталог заданий и logs по умолчанию
PASS  A игнорирует журналы прогонов
PASS  init из развёрнутого каталога разворачивает второе пространство
PASS  у B есть свой приватный ключ
PASS  приватный ключ B не скопирован из A
PASS  публичные ключи A и B разные (acceptors.json не скопирован)
PASS  init --force обновляет копию
PASS  init --force не меняет acceptors.json
PASS  init --force не меняет приватный ключ
PASS  init без --force не обновляет VERSION
PASS  init из пакета с --force возвращает VERSION пакета
PASS  init из пакета с --force не меняет ключ
PASS  init --force сохраняет policy/roles проекта
PASS  init --rotate-key перевыпускает ключ и предупреждает
PASS  ротация в тесте остаётся в каталоге ключей теста
PASS  в дереве B нет приватных ключей
PASS  скрипты B побайтно равны скриптам пакета (свежая копия)
PASS  повторный init в B не пересоздаёт закреплённый ключ
PASS  doctor в B зелёный
PASS  new-task в B создаёт задание с issuedBy из сессии

DEPLOY E2E OK
```

exit код: **0** (`DEPLOY E2E OK`).

### C2. `node spec/e2e.mjs`

Прогнана 2 раза (exit 0 оба); ниже — второй прогон:

```
PASS  init разворачивает рабочее пространство
PASS  init создаёт закреплённый ключ
PASS  e2e-deploy запускается из развёрнутой копии
PASS  init из развёрнутого каталога создаёт свой ключ, а не копирует acceptors.json
PASS  2.5.0: init выставил локальный core.hooksPath
PASS  2.5.0: выключенный guard не мешает коммиту вне задания
PASS  2.5.0: включённый guard отклоняет коммит вне задания
PASS  2.5.0: метка обхода в сообщении разрешает коммит
PASS  2.5.0: --audit показывает метку обхода
PASS  2.5.0: guard отклоняет push с изменением вне задания
PASS  2.5.0: выключенный guard не мешает push
PASS  2.5.0: guard выключен — рабочий цикл задачи не меняется
PASS  new-task создаёт задание с issuedBy
PASS  G6: C3 — самостоятельный сценарий, а не копия C1
PASS  lint требует covers для medium
PASS  lint требует критерий эффекта для решения с влиянием на пользователя
PASS  lint отклоняет effect.measuredBy на сам критерий
PASS  lint отклоняет семантическое решение без доказательства
PASS  G2: lint отклоняет решение вне цепи эффекта
PASS  hash без атаки отказывает при policy.attack=fail
PASS  hash не запирает контракт с нерешённой blocking-находкой
PASS  task-attack отклоняет нерешённый blocking
PASS  task-attack принимает закрытую находку
PASS  hash создаёт замок для закоммиченного контракта
PASS  lint --strict зелёный
PASS  red доказывает падение по ожиданию
PASS  verify зелёный после фикса
PASS  verify записывает эффект и цепь решения
PASS  verify валит изменённый файл без покрытия критерием
PASS  после удаления непокрытого файла verify снова зелёный
PASS  2.4.9: без acceptance.json сдвиг HEAD — ERROR contractCommit, а не WARN
PASS  2.4.9: пустой acceptance.json — не основание, ERROR остаётся
PASS  2.4.9: битый acceptance.json — не основание, ERROR остаётся
PASS  2.4.9: запись с чужим статусом — не основание, ERROR остаётся
PASS  2.4.9: task-verify не считает пустой acceptance.json приёмкой (lock строгий)
PASS  самоприёмка из сессии постановщика отклоняется
PASS  blocking-замечание без решения не принимается
PASS  2.6.0: источник runner настроен, окружение пустое — приёмка medium отказывает
PASS  2.6.0: приёмка medium без DSH — один WF_ACTOR_SESSION даёт отдельную сессию
PASS  2.5.2: кандидат сохраняет право исполнения из индекса
PASS  разбор замечаний и releaseReady в записи
PASS  запись v6 с актором и уровнем независимости
PASS  2.6.0: запись хранит источник актора и основание независимости
PASS  эффект записан в приёмку с измерителем
PASS  G3: запись хранит согласованность решения и эффекта
PASS  решения записаны с digest и без assumed
PASS  атака попала в запись с digest и без нерешённых находок
PASS  проверка ролей: приёмщик другого семейства, чем постановщик
PASS  check-acceptance принимает запись
PASS  check-acceptance проверяет metadata-коммит
PASS  2.4.8: у принятого задания сдвиг HEAD — предупреждение, не ошибка
PASS  G4: policy.decisions=fail отклоняет решение вне цепи
PASS  G4: policy.decisions=warn — предупреждение, exit 0
PASS  G5: policy.decisions=off — ни ошибки, ни предупреждения
PASS  G7: защита самого пакета в protectedPaths — именно WARN, не ERROR
PASS  G7: свои проверки в protectedPaths (checks/**) — предупреждения о пакете нет
PASS  regress принятой задачи зелёный
PASS  regress ловит сломанную проверку закрытой задачи
PASS  regress помечает таймаут отдельно
PASS  подмена записи ловится

E2E OK
```

exit код: **0** (`E2E OK`).

### C3. `node spec/selftest.mjs`

Прогнана 2 раза (exit 0 оба); ниже — второй прогон:

```
PASS  regress: medium без красного — нарушение
PASS  regress: low без красного и без обхода — нарушение
PASS  regress: low + allowMissingRed — законный долг
PASS  regress: запись v3 — legacy
PASS  regress: подпись не сходится — untrusted
PASS  regress: свежий красный — ok
PASS  regress: красный от другого контракта — нарушение
PASS  regress: baseline просрочен
PASS  regress: baseline находит запись по задаче и статусу
PASS  regress: задача из baseline с регрессом всё равно валит прогон
PASS  regress: погашенный долг валит только при --strict и просрочке
PASS  regress: нарушение не гасится baseline
PASS  regress: --write-baseline берёт только законный долг
PASS  regress: нарушения попадают в baseline только с --include-violations
PASS  запись medium с отдельной сессией принимается
PASS  подмена поля ломает подпись
PASS  запись v3 принимается как legacy
PASS  самоприёмка (сессия = issuedBy) отклоняется
PASS  medium без аттестованной сессии отклоняется
PASS  declared-актор не проходит для medium
PASS  high-risk с ключом агента отклоняется
PASS  high-risk с человеческим ключом принимается
PASS  low с declared-актором принимается
PASS  актор harness: env / separate-session
PASS  актор runner: env / separate-session
PASS  актор ci: declared / declared
PASS  актор manual: declared / declared
PASS  пустое окружение: none/declared, сессии и источника нет
PASS  legacy-конфиг: primary → harness, fallback → manual
PASS  legacy-конфиг не меняет поведения: env/separate-session и declared
PASS  конфиг без legacy-полей не падает: дефолты подставлены
PASS  неизвестный вид источника: ошибка конфига, а не сессия
PASS  модель берётся из modelSources, без них — unknown
PASS  запись с источником runner и separate-session принимается
PASS  источник ci с уровнем separate-session отклоняется
PASS  запись v5 с assumed-решением принимается, но releaseReady=false
PASS  releaseReady=true при assumed-решениях отклоняется
PASS  спрятанный assumed ловится по контракту
PASS  красный прогон от другого контракта отклоняется
PASS  запись со ссылкой на отсутствующий attack.json отклоняется
PASS  metadata-коммит с правкой кода отклоняется
PASS  acceptance внутри кандидата отклоняется
PASS  U1: решение ссылается на измеритель — связь есть
PASS  U2: решение ссылается на носитель — связь есть
PASS  U3: решение вне цепи эффекта — ошибка с именем решения и цепи
PASS  U4: наружу выходит только несвязанное решение
PASS  U5: внутреннее решение вне цепи — не нарушение
PASS  U6: доказательство спецификацией — не применимо
PASS  U7: manual-критерий — человеческое доказательство, не применимо
PASS  U8a: mechanical user-visible без эффекта — required ловит, consistency молчит
PASS  U8b: mechanical user-visible вне цепи — consistency не применяется
PASS  U9: решений нет — правило молчит, checked=false
PASS  U10: решение входит во вторую цепь — pass
PASS  U11: мусор в decisions не роняет проверку
PASS  U12: невалидный эффект не даёт каскада consistency
PASS  R1: согласованная запись принимается
PASS  R2: ok=false при согласованном контракте — расхождение записи
PASS  R4: links не совпадают с контрактом
PASS  R5: запись без блока (до 2.4.0) не ломается
PASS  R6: запись без блока и без флага не ломается
PASS  R3a: policy.decisions=fail валит несогласованную запись
PASS  R3b: policy.decisions=warn — предупреждение, запись принимается
PASS  TOOL совпадает с VERSION
PASS  doctor: без задач risk: high про ключ human-* молчит
PASS  doctor: задача risk: high включает предупреждение о human-*

SELFTEST OK
```

exit код: **0** (`SELFTEST OK`).

### C4. `node spec/checks/gate-rules.mjs`

Прогнана 2 раза (exit 0 оба); ниже — второй прогон:

```
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
```

exit код: **0** (`GATE RULES OK`).

## Негативный контроль (инвариант 3 задания)

Проверено, что сравнение не ослаблено: в `spec/e2e-deploy.mjs` **временно** вставлена строка,
кладущая посторонний файл в развёрнутую копию A до сравнения деревьев:

```js
fs.writeFileSync(path.join(repoA, WORKFLOW, 'stray-negative-control.txt'), 'stray\n');
```

Прогон `node spec/e2e-deploy.mjs`:

```
PASS  init из пакета разворачивает пространство
PASS  пространство A получает закреплённый публичный ключ и приватный ключ
FAIL  развёрнутое дерево совпадает с пакетом (кроме локальных acceptors.json, workflow.config.json, VERSION и .node-path)
      {"missing":[],"extra":["stray-negative-control.txt"],"changed":[]}
PASS  развёрнутые файлы получают свежий mtime (git увидит обновление)
PASS  развёрнутая копия знает версию пакета
PASS  конфигурация A: каталог заданий и logs по умолчанию
PASS  A игнорирует журналы прогонов
PASS  init из развёрнутого каталога разворачивает второе пространство
PASS  у B есть свой приватный ключ
PASS  приватный ключ B не скопирован из A
PASS  публичные ключи A и B разные (acceptors.json не скопирован)
PASS  init --force обновляет копию
PASS  init --force не меняет acceptors.json
PASS  init --force не меняет приватный ключ
PASS  init без --force не обновляет VERSION
PASS  init из пакета с --force возвращает VERSION пакета
PASS  init из пакета с --force не меняет ключ
PASS  init --force сохраняет policy/roles проекта
PASS  init --rotate-key перевыпускает ключ и предупреждает
PASS  ротация в тесте остаётся в каталоге ключей теста
PASS  в дереве B нет приватных ключей
PASS  скрипты B побайтно равны скриптам пакета (свежая копия)
PASS  повторный init в B не пересоздаёт закреплённый ключ
PASS  doctor в B зелёный
PASS  new-task в B создаёт задание с issuedBy из сессии

DEPLOY E2E FAILED: 1
```

exit код: **1** (`DEPLOY E2E FAILED: 1`, `extra:["stray-negative-control.txt"]`) — лишний файл
вне `STATE_FILES` по-прежнему валит проверку, а сам `.node-path` в `extra` не попадает.

После прогона строка удалена возвратом файла из побайтного снимка; sha256 файла до вставки и
после отката совпадает: `371c60eb5d3da70bdb7506a0ec3443ae3d222324149ae394c178a22c3851dfec`.
Посторонний файл жил только во временном каталоге `%TEMP%\wf2-deploy-*` внутри прогона и удалён
вместе с ним; в рабочем дереве его нет и коммитить нечего.

## 4. Отклонения от задания и почему

1. Негативный контроль выполнен **вставкой временной строки в сам `spec/e2e-deploy.mjs`**
   (единственный файл вне теста, куда разрешено писать), а не файлом в развёрнутой копии,
   положенным снаружи: развёрнутая копия создаётся и удаляется внутри прогона (`%TEMP%`), и
   подложить в неё файл можно только из самого прогона. Временная строка откачена побайтно
   (sha256 совпал), в дереве её нет — это и есть «временный прогон, файл не коммитить».
2. Дефолтный лимит времени инструмента (120 с) один раз прервал объединённый прогон
   четырёх проверок (C1 успел, C2 — нет). Это прерывание харнесса, а не падение проверки: те же
   команды затем прогнаны по отдельности с запасом времени, результаты выше. Молчаливых
   пропусков нет; прерванный прогон в результаты не зачтён.
3. Других отклонений нет.

## 5. Сумма критериев, которая исполнялась

Прогнаны все четыре критерия контракта — C1, C2, C3, C4 (по 2–3 прогона каждый, все зелёные)
плюс негативный контроль из инварианта 3 (красный, exit 1). Никаких проверок «частично» нет:
`NOT RUN` отсутствуют.

## 6. `git status --short`

```
 M spec/e2e-deploy.mjs
?? docs/tasks/0063/criteria.lock
?? docs/tasks/0063/gates.jsonl
?? docs/tasks/0063/red.json
?? docs/tasks/0063/report.md
```

`git diff --stat`:

```
 spec/e2e-deploy.mjs | 11 ++++++++---
 1 file changed, 8 insertions(+), 3 deletions(-)
```

`spec/e2e-deploy.mjs` — единственная изменённая дорожка; `criteria.lock`, `gates.jsonl`, `red.json`
появились в красной фазе до исполнителя (`redAllowDirty: docs/tasks/0063/**`), `report.md` — этот
отчёт. `git status` снят после записи отчёта. Коммита и пуша не было.
