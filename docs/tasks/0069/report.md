# Отчёт по заданию 0069. `--node` в фикстурах e2e

Исполнитель: узел `worker` (subagent:executor). База: HEAD `0c41b90`. Задание: `docs/tasks/0069/task.md`, критерии: `docs/tasks/0069/criteria.json` (не менялись).

Причина красного воспроизведена до правки: `node spec/e2e.mjs` — exit 1, `E2E FAILED: 5` (4 упавших утверждения + `E2E ERROR` на чтении несостоявшегося `acceptance.json`), все четыре — отказ правила 2.6.29 «medium требует узла». Ниже — дословные строки падений базового прогона (из его stdout):

```text
FAIL  самоприёмка из сессии постановщика отклоняется
      task-accept: attribution: в записи нет actor.node, а risk=medium требует узла: укажите узел (--node <узел> или WF_ACTOR_NODE) или объясните отсутствие (--deviation "<причина>")
FAIL  blocking-замечание без решения не принимается
      task-accept: attribution: в записи нет actor.node, а risk=medium требует узла: укажите узел (--node <узел> или WF_ACTOR_NODE) или объясните отсутствие (--deviation "<причина>")
FAIL  2.6.0: источник runner настроен, окружение пустое — приёмка medium отказывает
      task-accept: attribution: в записи нет actor.node, а risk=medium требует узла: укажите узел (--node <узел> или WF_ACTOR_NODE) или объясните отсутствие (--deviation "<причина>")
FAIL  2.6.0: приёмка medium без DSH — один WF_ACTOR_SESSION даёт отдельную сессию
      task-accept: attribution: в записи нет actor.node, а risk=medium требует узла: укажите узел (--node <узел> или WF_ACTOR_NODE) или объясните отсутствие (--deviation "<причина>")
E2E ERROR: Error: ENOENT: no such file or directory, open 'C:\Users\GORYAC~1\AppData\Local\Temp\wf2-e2e-9dSxBC\repo\docs\tasks\0001\acceptance.json'
E2E FAILED: 5
```

## 1. Что изменено

1. `spec/e2e.mjs`: четырём вызовам `task-accept.mjs` по фикстуре `docs/tasks/0001` (`risk: medium`) добавлен аргумент `--node judge`:
   - `selfAccept` — самоприёмка из сессии постановщика (строка 389);
   - `blockedAccept` — blocking-замечание без решения (строка 394);
   - `noSessionAccept` — пустое окружение, приёмка medium отказывает (строка 411);
   - `accept` — приёмка medium без DSH через `WF_ACTOR_SESSION` (строка 419).

   Узел `judge`, а не `worker`: во всех четырёх фикстурах проверяется роль **приёмщика** (acceptor — `judge`), узел исполнителя в них не участвует. `--deviation` не использован: узел в фикстуре имеет смысл и называется явно (правило требует «узел или объяснение», узел — сильнее).

2. `spec/e2e.mjs`: над первой из четырёх приёмок добавлен короткий комментарий (строки 384–388), объясняющий, почему у всех четырёх фикстур узел `judge` и почему без `--node` запись не создаётся. Комментарий ничего не исполняет и утверждений не касается.

3. Утверждения `report(...)` не менялись ни по смыслу, ни текстом; прочие аргументы приёмок (`--task`, `--acceptor`, `--key`, `--key-id`, `--review`, env/unsetEnv) не менялись. `spec/checks/**`, `plugin/**`, `package.json`, `task.md`, `criteria.json`, `criteria.lock` не тронуты.

4. `spec/e2e-deploy.mjs` и `spec/selftest.mjs` **не тронуты**: вызовов `task-accept.mjs` там нет (e2e-deploy использует `new-task.mjs`; selftest собирает запись через `signRecord` и проверяет её `task-check-acceptance.mjs`), и их прогоны на прежнем коде зелёные (C2, C3).

Запись приёмки в фикстуре остаётся валидной: e2e утверждает `PASS check-acceptance принимает запись` и `PASS check-acceptance проверяет metadata-коммит`; в записи теперь `actor.node = "judge"` (task-accept: `node: actorNode || null`), поэтому `task-check-acceptance` не печатает даже предупреждения attribution.

## 2. Файлы

- Изменён: `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\e2e.mjs`
- Создан: `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0069\report.md`

Других файлов репозитория правка не касалась. Временные логи прогонов (каталог `docs/tasks/0069/checks`) и логи вне пакета после сборки отчёта удалены: доказательства — в этом отчёте.

## 3. Проверки (на итоговом дереве, дословный вывод)

### C1

Команда: `node spec/e2e.mjs`
Рабочий каталог: `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2`
Exit code: **0**

```text
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

### C2

Команда: `node spec/e2e-deploy.mjs`
Рабочий каталог: `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2`
Exit code: **0**

```text
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

### C3

Команда: `node spec/selftest.mjs`
Рабочий каталог: `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2`
Exit code: **0**

```text
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

### C4

Команда: `node spec/checks/gate-rules.mjs`
Рабочий каталог: `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2`
Exit code: **0**

```text
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

### C5

Команда: `node spec/checks/pipe-free.mjs c1`
Рабочий каталог: `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2`
Exit code: **0**

```text
PIPEFREE OK c1
```


Все пять — exit code 0. C1 зелёный на итоговом содержимом файла (после последней правки отступа комментария прогон повторён); C2–C5 — на том же итоговом дереве.

## 4. Отклонения от задания и почему

- **Не использован `--deviation`** (задание допускало любой из двух вариантов): узел `judge` в фикстурах осмыслен, а узел — более сильное доказательство, чем объяснение отсутствия; это и записано комментарием.
- **Добавлен комментарий** сверх минимальной правки — чтобы следующий исполнитель не снял `--node` и не получил тот же `E2E FAILED: 5`. На поведение проверок не влияет.
- `spec/e2e-deploy.mjs` и `spec/selftest.mjs` не тронуты по результату проверки: той же ошибки там нет.
- Ничего не коммитилось, не пушилось, не деплоилось.

## 5. `git status --short`

```text
 M spec/e2e.mjs
?? docs/tasks/0069/criteria.lock
?? docs/tasks/0069/gates.jsonl
?? docs/tasks/0069/red.json
?? docs/tasks/0069/report.md
```

(Строки `criteria.lock`, `gates.jsonl`, `red.json` — рабочие артефакты задания, созданы до исполнителя; `report.md` — настоящий отчёт.)
