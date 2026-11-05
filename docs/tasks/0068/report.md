# Отчёт по заданию 0068

WC-43: роль привязана к узлу — `actor.node` в записи, `acceptorNode` в контракте,
отказ без объяснения. Красный доказан до работы: C1/C2 падали, C3–C6 были зелёными.

## 1. Что изменено

1. **Схема записи.** В `actor` добавлено необязательное `node` (`type: string`,
   `pattern: ^[a-z][a-z0-9-]*$`), на верхнем уровне — необязательное `deviation`
   (`type: string`, `minLength: 10`). `additionalProperties: false` не тронут:
   лишние поля по-прежнему отклоняются.
2. **Чистые функции в `lib/common.mjs`:**
   - `attributionGap(record)` — `null`, если `actor.node` указан; `warn` с причиной из
     `deviation`, если узла нет, но отклонение объяснено; `error` для `risk`
     `medium`/`high` без узла и без `deviation`; `warn` для `low`.
   - `metaAttributionGap(meta)` — `null` при `acceptorNode` или `deviation`;
     `warn` для `acceptor`, начинающегося с `subagent`, без узла и отклонения;
     иначе `null`.
   - `parseTaskMeta` явно сохраняет и нормализует `executorNode`/`acceptorNode`
     (обрезка пробелов), чтобы пустая строка не выглядела указанным узлом.
3. **`task-accept`.** Флаги `--node <узел>` и `--deviation "<причина>"`. Узел
   резолвится по приоритету: флаг → env `WF_ACTOR_NODE` → `acceptorNode` из
   TASK-META. `actor.node` пишется в запись, `deviation` — на верхнем уровне.
   Перед подписью (и до прогона критериев) вызывается `attributionGap(record)`:
   `error` — отказ с подсказкой про `--node`/`--deviation`; `warn` — строка в stdout.
   Проверяются шаблон узла и `minLength` отклонения, чтобы запись не нарушала схему.
4. **`task-check-acceptance`.** Вердикт `attributionGap` печатается всегда: `warn`
   не меняет exit, `error` валит проверку, когда контракт объявил
   `acceptorNode`/`deviation` (см. «Отклонения», п. 1).
5. **`task-lint`.** `metaAttributionGap(meta)` печатается как `WARN`
   (`attribution: …`); exit не меняется.
6. **Документация.** `adapters/dsh.md`: роли переписаны под политику `warn` —
   исполнитель — узел `worker`, приёмщик — узел `judge`, нативный `subagent`
   допустим как альтернативный путь (виден в панели DSH, но не в журнале
   структуры), в шапке писем `Node: worker|judge`, без узла — `--deviation` и
   запись в `docs/DEVIATIONS.md`. Старая строка «Исполнитель — `subagent`…»
   удалена. `spec/SPEC.md`: короткий абзац про `actor.node`/`deviation` и правило
   «без узла — объяснение».

## 2. Файлы (полные пути)

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\templates\acceptance.schema.json`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\lib\common.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-accept.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-check-acceptance.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-lint.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\SPEC.md`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\adapters\dsh.md`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0068\report.md`

## 3. Проверки

Финальный прогон всех критериев в завершённом дереве. Команды выполнялись из корня
пакета `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2`.

### C1 — `node spec/checks/node-attribution.mjs c1`

```
NODEATTR OK c1
EXIT=0
```

### C2 — `node spec/checks/node-attribution.mjs c2`

```
NODEATTR OK c2
EXIT=0
```

### C3 — `node spec/checks/acceptance-schema.mjs`

```
PASS схема принимает actor.source и actor.sourceKind
PASS схема принимает записи без новых полей
PASS контроль: незнакомое поле в actor отклоняется
PASS схема принимает independence.basis
PASS схема принимает записи без basis
PASS имя плагина из манифеста: dsh-workflow-console
PASS версия плагина из манифеста: 0.9.8
PASS engines.dsh объявлен
PASS dsh.bundle.patch объявлен
PASS dsh.client.platform web
PASS files плагина: точки входа в архиве
PASS files плагина: пути на диске (кроме vendor — его создаёт сборщик)
PASS vendor в files: вложенная спека
PASS LICENSE в files: лицензия в архиве
PASS private: true в tarball
PASS сборщик печатает стабильное и версионированное имена из манифеста
PASS в CI есть шаг acceptance-schema.mjs

ACCEPTANCE SCHEMA OK
EXIT=0
```

### C4 — `node spec/selftest.mjs`

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
EXIT=0
```

### C5 — `node spec/checks/gate-rules.mjs`

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
EXIT=0
```

### C6 — `node spec/checks/pipe-free.mjs c1`

```
PIPEFREE OK c1
EXIT=0
```

## 4. Отклонения от задания и почему

1. **`task-check-acceptance`: `error` валит проверку только при объявленной
   привязке в контракте.** Задание говорит «error → exit 1» без оговорок, но
   `spec/selftest.mjs` (C4) строит синтетические записи `risk: medium` без
   `actor.node` и ожидает `status 0`; менять selftest нельзя (вне allowedPaths), а
   записи 0063–0067 по заданию не переписываются и живут в `docs/DEVIATIONS.md`.
   Поэтому вердикт `attributionGap` печатается всегда, а `error` становится
   ERROR только если контракт объявил `acceptorNode`/`deviation` (тогда правило
   применимо и запись ему противоречит). Для контрактов старше правила вердикт
   остаётся WARN со ссылкой на реестр. Проверено отдельно: подписанная запись
   `medium` без узла на контракте с `acceptorNode: judge` даёт exit 1 и
   `в записи нет actor.node…`; та же запись с `actor.node: judge` — exit 0.
2. **`task-accept` отказывает раньше прогона критериев.** `attributionGap`
   вызывается сразу после разбора флагов/контракта, до `task-verify`: отказ без
   узла не должен стоить полного прогона и не должен оставлять запись.
   Формально задание говорит «перед подписью»; проверка перед подписью сохранена,
   просто выполнена раньше.
3. **Валидация `--node`/`--deviation` в `task-accept`.** Шаблон узла
   `^[a-z][a-z0-9-]*$` и `minLength 10` для отклонения проверяются до записи,
   иначе `task-accept` мог бы создать запись, которую схема отклоняет.
4. **`parseTaskMeta` обрезает пробелы у `executorNode`/`acceptorNode`.** Это
   явное «сохранение» полей из задания: значение из одних пробелов не должно
   считаться указанным узлом.
5. **Первый прогон C5 был прерван внешним дедлайном инструмента (120 с), а не
   проверкой:** прогон перезапущен без изменений и завершился `EXIT=0`
   (см. вывод выше).
6. **`docs/DEVIATIONS.md` не создавался и не менялся:** его нет в allowedPaths;
   это follow-up задания. Версии пакета (`package.json`, `VERSION`) не двигались:
   номер релиза поднимает архитектор после приёмки.

## 5. Дополнительные проверки (вне критериев)

1. `node spec/checks/acceptance-p0.mjs` — `ACCEPTANCE P0 OK` (exit 0): низкий риск
   без узла принимается, checker на такой записи даёт только WARN.
2. Временный сценарий на `task-accept` (medium, без узла): exit 1,
   `task-accept: attribution: в записи нет actor.node, а risk=medium требует узла:
   укажите узел (--node <узел> или WF_ACTOR_NODE) или объясните отсутствие
   (--deviation "<причина>")`. С `--node judge` — attribution снят, отказ пришёл
   дальше по отсутствию `red.json`. С `--deviation "judge недоступен: проверка
   флага"` — в stdout `task-accept: WARN приёмка без actor.node объяснена
   отклонением: …`, attribution снят.
3. Временный сценарий на `task-check-acceptance` с подписанной записью: без
   `actor.node` при `acceptorNode: judge` — exit 1 с сообщением про `actor.node`;
   с `actor.node: judge` — `check-acceptance: запись корректна`, exit 0.
4. Временный сценарий на `task-lint` с `acceptor: subagent:judge` без
   `acceptorNode`: в выводе `WARN  attribution: acceptor subagent:judge — нативный
   subagent без acceptorNode: укажите acceptorNode (узел) или deviation (причина)`.

## 6. `git status --short`

Финальное состояние до добавления этого отчёта:

```
 M adapters/dsh.md
 M spec/SPEC.md
 M spec/scripts/lib/common.mjs
 M spec/scripts/task-accept.mjs
 M spec/scripts/task-check-acceptance.mjs
 M spec/scripts/task-lint.mjs
 M spec/templates/acceptance.schema.json
?? docs/tasks/0068/criteria.lock
?? docs/tasks/0068/gates.jsonl
?? docs/tasks/0068/red.json
```

Изменены только пути из `allowedPaths`. После записи отчёта добавится
`?? docs/tasks/0068/report.md` (тоже `docs/tasks/0068/**`). Коммит, push и деплой
не выполнялись.
