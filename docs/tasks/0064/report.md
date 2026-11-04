# Отчёт по заданию 0064

Сумма критериев: `cc8da0cba3ea14669cabdfe695bf7bb48fcef9dd05831f1df0960581cd4772ea` (совпала; `node spec/scripts/task-hash.mjs --task docs/tasks/0064` → `lock совпадает`, exit 0).

## Что изменено

1. **WC-47, `lockOrderHint` различает причину сдвига HEAD.** Функция получила второй
   необязательный параметр `changedPaths` и печатает:
   три причины сдвига — артефакт задания (`criteria.lock`, `red.json`, `gates.jsonl`),
   код исполнителя, metadata приёмки (`acceptance.json`); правило для каждой
   (артефакты не коммитятся до приёмки; код не коммитится — кандидата создаёт
   `task-accept`, ветку двигает архитектор после metadata; metadata принятого
   задания — ожидаемый сдвиг); порядок коммитов и определение кандидата; фактически
   изменённые пути с меткой вида («артефакт задания» / «код исполнителя» /
   «metadata приёмки»). Решение «это сдвиг» по-прежнему только по ошибке
   `contractCommit:`; функция чистая — ничего не запускает и без переданного списка
   печатает те же три причины плюс правило.
2. **Вызывающие считают пути.** В `task-red.mjs` и `task-verify.mjs` добавлен локальный
   помощник `changedSinceContract(contractCommit)`: `git diff --name-only <contractCommit> HEAD`
   тем же pipe-free `git()` из `lib/common.mjs`; список передаётся в `lockOrderHint`
   во всех точках отказа, где раньше печаталась подсказка (в `task-red` их две).
   `verifyLock` не менялся — инвариант «diff считают вызывающие» соблюдён.
3. **WC-45, doctor: правило имени ключа — только для активных пинов.** Фильтр `bad`
   теперь `list.filter((key) => !key.revokedAt && !String(key.keyId).startsWith(key.kind + '-'))`:
   отозванный legacy-ключ без префикса (историческая подпись, переименование сломало бы
   резолв записей) — не FAIL; активный пин без префикса — по-прежнему FAIL с именем ключа.

## Файлы

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\lib\common.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-red.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-verify.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\doctor.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0064\report.md` (этот отчёт)

`task.md`, `criteria.json` и `criteria.lock` не изменялись. Коммитов, пушей и деплоя нет.

## Проверки

Красный до правки (для контекста, эти же команды):

```
node spec/checks/gate-diagnostics.mjs c5
GATEDIAG FAIL c5: code: в выводе нет /код/iu: task-red: lock: contractCommit: ожидалось 98352a56cae64310e706300d3c9750b9789d2433, сейчас faead3d3c49eaedc2822d879306900c12e6f2e28
Подсказка: не коммитьте критерии и артефакты после task-red — сдвиг HEAD отвязывает кандидата от contractCommit.
Порядок коммитов: контракт → task-hash --write → task-red → работа → task-verify → task-accept.
Кандидат — коммит, на котором task-red доказал красный; его
exit 1
```

```
node spec/checks/doctor-legacy-key.mjs c1
DOCTORLEGACY FAIL c1: doctor валит отозванный legacy-ключ: FAIL  ключи: kind совпадает с префиксом  — stable
exit 1
```

Финальные прогоны (после правки). C1–C4 гонялись несколько раз за задание;
C5–C6 дополнительно прогонялись фоновым джобом.

C1. `node spec/checks/gate-diagnostics.mjs c5` — exit 0 (4 прогона: красный exit 1 до правки, затем трижды exit 0)

```
GATEDIAG OK c5
```

C2. `node spec/checks/doctor-legacy-key.mjs c1` — exit 0 (4 прогона: красный exit 1 до правки, затем трижды exit 0)

```
DOCTORLEGACY OK c1
```

C3. `node spec/checks/gate-diagnostics.mjs c1` — exit 0 (3 прогона)

```
GATEDIAG OK c1
```

C4. `node spec/checks/pipe-free.mjs c1` — exit 0 (3 прогона)

```
PIPEFREE OK c1
```

C5. `node spec/selftest.mjs` — exit 0 (3 прогона)

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

C6. `node spec/checks/gate-rules.mjs` — exit 0 (3 прогона)

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

Дополнительно (чистая функция, без запуска ворот):

```
node -e "...lockOrderHint({ errors: ['contractCommit: ожидалось a, сейчас b'] }, [...]))..."
Подсказка: HEAD сдвинулся после замка — кандидат отвязан от contractCommit. Причина — один из трёх видов коммита:
  1) артефакт задания (criteria.lock, red.json, gates.jsonl) — артефакты не коммитятся до приёмки: они не кандидат.
  2) код исполнителя — код не коммитится: кандидата создаёт task-accept, ветку двигает архитектор после metadata приёмки.
  3) metadata приёмки (acceptance.json) — у принятого задания сдвиг HEAD ожидаем.
Порядок коммитов: контракт → task-hash --write → task-red → работа → task-verify → task-accept.
Кандидат — коммит, на котором task-red доказал красный; его SHA обязан совпадать с contractCommit в criteria.lock.
Изменённые пути (git diff --name-only <contractCommit> HEAD):
  src/app.js — код исполнителя — коммитить нельзя, кандидата создаёт task-accept
  docs/tasks/0001/notes.txt — артефакт задания — коммитить нельзя
  docs/tasks/0001/acceptance.json — metadata приёмки — ожидаемый сдвиг
```

## Отклонения

- Отклонений от задания нет: правки только в четырёх разрешённых файлах, `verifyLock` не тронут, `task.md`/`criteria.json`/`criteria.lock` не тронуты.
- Подсказка перечисляет все три причины всегда (так требует инвариант 1(a)); путь дополнительно классифицируется по виду. Поэтому в сценарии «закоммичен код» в выводе есть и слово «артефакт» из общего перечисления — критерий c5 этого не запрещает (проверяет наличие «код»+«task-accept»+путь).
- Организационное: во время финального пакетного прогона общий таймаут программы run_code прервал пакет на C6; поэтому финальный C6 и C5 сняты отдельными фоновыми прогонами с exit 0 (вывод выше — оттуда). На результат не влияет.
- Гонялось: C1 4, C2 4, C3 3, C4 3, C5 3, C6 3 раза; `task-hash --task docs/tasks/0064` — 1 раз (проверка суммы критериев).

## Git

```
 M spec/scripts/doctor.mjs
 M spec/scripts/lib/common.mjs
 M spec/scripts/task-red.mjs
 M spec/scripts/task-verify.mjs
?? docs/tasks/0064/criteria.lock
?? docs/tasks/0064/gates.jsonl
?? docs/tasks/0064/red.json
?? docs/tasks/0064/report.md
```

## Осталось / блокеры

- Блокеров нет. Коммит/приёмка — не роль исполнителя: кандидата создаёт `task-accept`, ветку двигает архитектор после metadata.
