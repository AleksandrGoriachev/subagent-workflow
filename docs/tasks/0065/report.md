# Отчёт по заданию 0065

Сумма критериев: `afabab926f6ab6c59a4a5a489cdc26b64af4005ff722822d970aa8210bceebc5` — совпала
(`task-hash: 0065 … lock совпадает`, exit 0; `contractCommit` `be63728997eb4a512d53b39c1e493af7200cce94`).

## Что изменено

1. **`docs/EXTERNAL-ORCHESTRATION.md`** — инструкция тому, кто вызывает движок из чужой
   оркестрации. Таблица «кто что делает» (исполнитель / приёмщик / архитектор); порядок
   `task-hash → task-lint → task-red → task-verify → task-accept` с тем, кто выполняет и что
   получается на каждом шаге; три запрета (не коммитить код — кандидата создаёт `task-accept`,
   а ветку двигает архитектор после metadata; не коммитить артефакты задания до приёмки; не
   писать `acceptance.json` вручную); признаки доказательства (`contractCommit`,
   `criteria.lock`, `nonce`, `attestedBy`, подпись, кандидат) и команда
   `task-check-acceptance` для аудита; таблица типичных ошибок с последствием и исправлением.
2. **`docs/adr/0001-process-vs-harness.md`** — ADR о границе: контекст (DSH даёт исполнение,
   наш слой — процесс и доказательства), решение, следствия (что берём у DSH и что не
   дублируем), таблица «слой / что даёт / чего не даёт», граница сужения слоя, если у DSH
   появится нативный контракт и приёмка.
3. **`.github/workflows/ci.yml`** — в job `test` после `deploy-safety` добавлены шаги:
   `gate-rules`, `pipe-free c1`, `gate-diagnostics c1…c5` (пять отдельных шагов),
   `doctor-legacy-key c1`, `orchestration-doc c1`. Матрица, триггеры, джобы `plugin` и
   `deploy` и прежние шаги не тронуты, `continue-on-error` не добавлялся.

## Файлы

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\EXTERNAL-ORCHESTRATION.md`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\adr\0001-process-vs-harness.md`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\.github\workflows\ci.yml`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0065\report.md`

## Проверки

### C1 — инструкция внешнему оркестратору и ADR

```text
>>> node spec/checks/orchestration-doc.mjs c1
ORCHDOC OK c1
EXIT=0
```

### C2 — CI запускает новые проверки

```text
>>> node spec/checks/ci-config.mjs c1
CICONF OK c1
EXIT=0
```

### CI-шаги: gate-diagnostics c1

```text
>>> node spec/checks/gate-diagnostics.mjs c1
GATEDIAG OK c1
EXIT=0
```

### CI-шаги: gate-diagnostics c2

```text
>>> node spec/checks/gate-diagnostics.mjs c2
GATEDIAG OK c2
EXIT=0
```

### CI-шаги: gate-diagnostics c3

```text
>>> node spec/checks/gate-diagnostics.mjs c3
GATEDIAG OK c3
EXIT=0
```

### CI-шаги: gate-diagnostics c4

```text
>>> node spec/checks/gate-diagnostics.mjs c4
GATEDIAG OK c4
EXIT=0
```

### CI-шаги: gate-diagnostics c5

```text
>>> node spec/checks/gate-diagnostics.mjs c5
GATEDIAG OK c5
EXIT=0
```

### CI-шаги: doctor-legacy-key c1

```text
>>> node spec/checks/doctor-legacy-key.mjs c1
DOCTORLEGACY OK c1
EXIT=0
```

### C3 — регресс правил пакета (selftest)

```text
>>> node spec/selftest.mjs
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

### C4 — правила ворот не сломаны

```text
>>> node spec/checks/gate-rules.mjs
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

### C5 — пайпов не добавилось

```text
>>> node spec/checks/pipe-free.mjs c1
PIPEFREE OK c1
EXIT=0
```

## Отклонения

1. **Джоба `deploy` не дополнена.** В ней `e2e-deploy` проверяет развёртывание, а новые
   проверки относятся к тексту схемы и правилам ворот; дублировать их в матрице deploy значило
   бы гонять нерелевантное. Задание допускало «если уместно» — сочли неуместным.
2. **`ci-config.mjs` в CI не добавлен.** Контракт перечисляет ровно пять групп шагов; проверка
   конфигурации CI в список не входила, поэтому она не запускается в CI (сама себя не
   подтверждает). Отмечено как наблюдение, не как дефект задания.
3. **Правка до прогона C1:** в черновике инструкции было «`acceptance.json` версии 7»; по
   `spec/scripts/task-accept.mjs` (константа `version: 6`) и схеме записи текущая версия — 6.
   Исправлено до первого зелёного C1, на критерии не влияет.
4. **Артефакты красного прогона** (`docs/tasks/0065/criteria.lock`, `red.json`, `gates.jsonl`)
   созданы оркестратором до исполнителя; не трогались и не коммитились. Коммитов, пушей,
   тегов и деплоя не было.

## Git

```text
 M .github/workflows/ci.yml
?? docs/EXTERNAL-ORCHESTRATION.md
?? docs/adr/
?? docs/tasks/0065/criteria.lock
?? docs/tasks/0065/gates.jsonl
?? docs/tasks/0065/red.json
?? docs/tasks/0065/report.md
```

## Осталось / блокеры

- Задание не принято: кандидата создаёт `task-accept` из другой сессии и ключом приёмщика;
  коммит, metadata-коммит, движение ветки и публикация — шаг архитектора.
- Критерии C1–C5 зелёные, регресс (`selftest`, `gate-rules`, `pipe-free c1`) зелёный.
