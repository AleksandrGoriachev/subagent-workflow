# Отчёт по заданию 0066

Исполнитель: узел worker (subagent). Задача: `c3` честно пропускает «node нет», когда среда этого не позволяет.

## 1. Что изменено

1. Добавлена портируемая функция `nodeDiscoverable(env)`: перебирает каталоги `PATH` из переданной среды
   и ищет исполняемый файл node — `node.exe` на Windows (проверка `F_OK`), `node`/`nodejs` на POSIX
   (проверка права `X_OK`); возвращает полный путь или `null`.
2. В `c3` до создания фикстуры:
   - при `--with-node` PATH не чистится вовсе и печатается
     `GATEDIAG SKIP c3: среда не позволяет изобразить «node нет» — PATH не чистился (--with-node)`, exit 0;
   - иначе среда собирается как раньше (`PATH = pathWithoutNode()`, `WF_NODE` удалён), и если после
     очистки node всё равно находится — печатается
     `GATEDIAG SKIP c3: среда не позволяет изобразить «node нет» — node найден в <путь>`, exit 0;
   - иначе выполняются прежние утверждения без изменений: блокировка через `.node-path`, одно
     предупреждение, маркер `workflow-node-missing`, второй коммит без предупреждения, `GATEDIAG OK c3`.
3. `c1`, `c2`, `c4`, `c5` не тронуты. `task.md`, `criteria.json`, `criteria.lock` не тронуты.
   Ничего не коммитилось, не пушилось, не деплоилось.

## 2. Файлы

- Изменён: `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\checks\gate-diagnostics.mjs`
- Добавлен (отчёт): `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0066\report.md`

## 3. Проверки

Все команды выполнены в каталоге `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2`.
Вывод приведён дословно; `$ ` — сама команда.

### 3.1 C1 (обязательная, была красной): `node spec/checks/gate-diagnostics.mjs c3 --with-node`

```text
$ node spec/checks/gate-diagnostics.mjs c3 --with-node
GATEDIAG SKIP c3: среда не позволяет изобразить «node нет» — PATH не чистился (--with-node)
[exit 0]
```

### 3.2 C2 (обязательная): `node spec/checks/gate-diagnostics.mjs c3`

```text
$ node spec/checks/gate-diagnostics.mjs c3
GATEDIAG OK c3
[exit 0]
```

### 3.3 C3 (обязательная): `node spec/selftest.mjs`

```text
$ node spec/selftest.mjs
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
[exit 0]
```

### 3.4 C4 (обязательная): `node spec/checks/gate-rules.mjs`

```text
$ node spec/checks/gate-rules.mjs
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
[exit 0]
```

### 3.5 Регресс прочих режимов (требование §4): `c1`, `c2`, `c4`, `c5`

```text
$ node spec/checks/gate-diagnostics.mjs c1
GATEDIAG OK c1
[exit 0]

$ node spec/checks/gate-diagnostics.mjs c2
GATEDIAG OK c2
[exit 0]

$ node spec/checks/gate-diagnostics.mjs c4
GATEDIAG OK c4
[exit 0]

$ node spec/checks/gate-diagnostics.mjs c5
GATEDIAG OK c5
[exit 0]
```

### 3.6 Дополнительно (сверх задания): ветка «node найден в PATH» вживую (аналог CI)

Сценарий: копия `node.exe` положена первой в PATH (как «второй node», аналог `/usr/bin` на раннере),
`pathWithoutNode()` вычищает каталог копии (он же `dirname(process.execPath)`), а настоящий node
остаётся в PATH — ровно linux-случай.

```text
$ $env:PATH = $tmp + ';' + $env:PATH; node spec/checks/gate-diagnostics.mjs c3
GATEDIAG SKIP c3: среда не позволяет изобразить «node нет» — node найден в C:\Users\Goryachev\NodeJs 25.4\node.exe
[exit 0]
```

`tmp` — временный каталог, удалён после прогона; репозиторий не затронут.

## 4. Отклонения от задания

Нет. Ни одно требование не ослаблено: там, где сценарий представим (Windows), `c3` выполняет
полный набор утверждений и печатает `GATEDIAG OK c3`; SKIP печатается только в двух оговорённых
случаях. `c1`, `c2`, `c4`, `c5` не изменялись — их `GATEDIAG OK` подтверждён прогоном.

## 5. `git status --short`

```text
 M spec/checks/gate-diagnostics.mjs
?? docs/tasks/0066/criteria.lock
?? docs/tasks/0066/gates.jsonl
?? docs/tasks/0066/red.json
?? docs/tasks/0066/report.md
```

Коммит не выполнялся (его делает архитектор по принятому кандидатному SHA).
