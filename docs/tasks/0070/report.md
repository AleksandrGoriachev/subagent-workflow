# Отчёт по заданию 0070

Дефект 0069: `task-accept` подставлял `acceptorNode` из TASK-META в `actor.node`, и запись
утверждала приёмку узлом, которого не было. Узел в записи — доказательство, а не намерение контракта.

## 1. Что изменено

1. **`spec/scripts/lib/common.mjs`** — добавлена чистая функция `nodeConsistency(meta, record)`
   (рядом с `attributionGap`/`metaAttributionGap`, ничего в них не менялось):
   - `acceptorNode` не объявлен в контракте → `null`;
   - объявлен и совпал с `record.actor.node` → `null`;
   - объявлен, в записи узла нет, но есть `record.deviation` → `null` (отсутствие объяснено);
   - объявлен, узла нет и `deviation` нет → `{ level: 'warn', message }` с именем узла из
     контракта и подсказкой `--node`/`WF_ACTOR_NODE`/`--deviation`;
   - объявлен, а в записи другой узел → `{ level: 'warn', message }` о расхождении.
2. **`spec/scripts/task-accept.mjs`** — убрана подстановка узла из контракта:
   `actorNode = --node || WF_ACTOR_NODE`, переменная `contractNode` удалена; `meta.acceptorNode`
   больше не попадает в запись. Перед подписью (после сборки `body`, до `createCandidate`/
   `signRecord`) вызывается `nodeConsistency(meta, body)`; вердикт `warn` печатается строкой в
   stdout с префиксом `task-accept: WARN `, exit не меняет. Отказ за отсутствие узла при
   `risk` medium/high по-прежнему даёт `attributionGap` (не тронут). Подсказка `--node`/
   `--deviation` в `--help` осталась.

Правила `attributionGap`/`metaAttributionGap`, схема записи, `spec/checks/**`, `plugin/**`,
`package.json` не менялись. `docs/tasks/0070/task.md`, `criteria.json`, `criteria.lock` не
менялись.

## 2. Файлы

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\lib\common.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-accept.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0070\report.md`

## 3. Проверки

Все команды запускались из каталога пакета
`C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2`.
Вывод приведён дословно; `EXIT=` — код возврата команды.

### Красный до правки (подтверждение исходного состояния)

Команда: `node spec/checks/node-attribution.mjs c3`

```
NODEATTR FAIL c3: в common.mjs нет nodeConsistency(meta, record)
```

`EXIT=1`

### Итерации после правки

`node spec/checks/node-attribution.mjs c3` — `EXIT=0`

```
NODEATTR OK c3
```

`node spec/checks/node-attribution.mjs c1` — `EXIT=0`

```
NODEATTR OK c1
```

`node spec/checks/node-attribution.mjs c2` — `EXIT=0`

```
NODEATTR OK c2
```

### Критерии приёмки

**C1** — `node spec/checks/node-attribution.mjs c3` — `EXIT=0`

```
NODEATTR OK c3
```

**C2** — `node spec/e2e.mjs` — `EXIT=0`

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

**C3** — `node spec/selftest.mjs` — `EXIT=0`

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

**C4** — `node spec/checks/gate-rules.mjs` — `EXIT=0`

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

**C5** — `node spec/checks/pipe-free.mjs c1` — `EXIT=0`

```
PIPEFREE OK c1
```

### Дополнительно: поведение `task-accept` до и после (дифференциальный прогон)

Контракт 0070 объявляет `acceptorNode: "judge"`, в окружении `WF_ACTOR_NODE` пуст. Без `--node`
запись не получает узел — срабатывает `attributionGap` (medium), то есть подстановки из
контракта нет:

`node spec/scripts/task-accept.mjs --task docs/tasks/0070` — `EXIT=1`

```
task-accept: attribution: в записи нет actor.node, а risk=medium требует узла: укажите узел (--node <узел> или WF_ACTOR_NODE) или объясните отсутствие (--deviation "<причина>")
```

Тот же вызов с `--node judge` проходит стадию узла и останавливается на следующем предусловии
(ключ) — источник узла работает:

`node spec/scripts/task-accept.mjs --task docs/tasks/0070 --node judge` — `EXIT=1`

```
task-accept: нужны --key <private.pem> и --key-id <keyId>: запись подписывается Ed25519
```

Оба прогона ничего не записали: `verify.json` у задания нет, до подписи и записи дело не дошло.

## 4. Отклонения от задания

Нет. Правки — ровно в двух разрешённых файлах и в отчёте; проверки, контракт, схема и
`attributionGap`/`metaAttributionGap` не менялись.

Замечание (не отклонение): вердикт `nodeConsistency` печатается в stdout и в режиме `--json`,
как и существующее предупреждение `attributionGap` в этой же программе; потребителей
`task-accept --json` в пакете нет, поведение оставлено единообразным.

## 5. `git status --short`

```
 M spec/scripts/lib/common.mjs
 M spec/scripts/task-accept.mjs
?? docs/tasks/0070/criteria.lock
?? docs/tasks/0070/gates.jsonl
?? docs/tasks/0070/red.json
?? docs/tasks/0070/report.md
```
