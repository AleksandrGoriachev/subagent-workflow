# Отчёт 0061. Ворота говорят сами: порядок коммитов, причина в stdout, node для хуков

Задание 0061 заменяет 0060 (дефект контракта c3 найден исполнителем 0060 и переиздан вами).
Коммит 21d43c8 — контракт 0061 (тот же объём WC-40/41/42, в c3 фикстура включает guard.enabled).
Красный прогон 0061 доказан на базе 21d43c8: redProven=true, executed=6, failed=4 (C1–C4),
C5–C6 зелёные, checkDefects=[].
Код работы 0060 перенесён в 0061 без изменений (я его не переписывал после восстановления дерева).

## 1. Что изменено

1. **WC-40 — подсказка порядка коммитов в точке отказа.** В `spec/scripts/lib/common.mjs` добавлен
   чистый помощник `lockOrderHint(lockCheck)`: если среди ошибок замка есть `contractCommit:`,
   возвращает текст подсказки (слова «не коммитьте» и «кандидат», порядок
   контракт → task-hash --write → task-red → работа → task-verify → task-accept), иначе `null`.
   `task-red` и `task-verify` печатают подсказку после строк ошибок (в stderr и в stdout);
   в `task-red` она печатается и в ветке «контракт закоммичен в X, а HEAD Y» (это тот же сдвиг).
   `verifyLock` не менялся — остаётся чистой функцией (в диффе его нет).
2. **WC-41 — причина фатального отказа одной строкой в stdout.** В `common.mjs` добавлен
   `reportFatal(gate, message, { stderr, json })`: печатает `<gate>: <причина>` в stderr
   (подробности, как раньше) и одну строку `<gate>: <первая строка причины>` в stdout
   (`options.stderr:false` — когда вызывающий уже напечатал подробности сам).
   Переведены все фатальные пути `task-red`, `task-verify`, `task-hash`, `task-lint`
   (lock-отказ, base/HEAD, грязное дерево, изменения вне allowedPaths, setup, catch, отказы relock
   и attack). `task-lint` дополнительно печатает `task-lint: <первая ошибка>` в своей сводке.
   Формат строк `PASS/FAIL`, `Итог:` и вердикты не тронуты. В `--json` режиме stdout остаётся
   машинным: причина уходит объектом `{ ok: false, errors }` той же формы, что печатает catch ворот.
3. **WC-42 — `.node-path` и резолв node в хуках.** `init` пишет
   `<repo>/docs/subagent-workflow/.node-path` = `process.execPath` + перевод строки и идемпотентно
   добавляет в `<repo>/.gitignore` строку `docs/subagent-workflow/.node-path` (остальные строки
   не трогает). Хуки `pre-commit`, `commit-msg`, `pre-push` берут node в порядке
   `$WF_NODE` → `.node-path` → `command -v node`; несуществующий путь источником не считается.
   Не найден — предупреждение со словом «node» один раз на репозиторий и маркер
   `$(git rev-parse --git-path workflow-node-missing)`, дальше хуки молчат (exit 0). Найден —
   guard выполняется как раньше. Правила покрытия и поведение `task-guard` не менялись.
4. **Шаблон задания.** В `spec/templates/task.md` в комментарий контракта добавлен абзац о порядке
   коммитов и запрете коммитить артефакты после `task-red` (WC-40: «не только в точке отказа»).
5. **Windows-нормализация пути в хуках.** `.node-path` содержит `process.execPath` с обратными
   слэшами, а `sh` из Git for Windows не видит такой путь в `[ -f ]` (проверено: `C:\...\node.exe` —
   false, `C:/.../node.exe` — true). Хуки перед проверкой существования и запуском заменяют
   `\` на `/` (`tr`), поэтому резолв работает и на Windows, и на POSIX.

## 2. Файлы (полные пути)

1. C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\lib\common.mjs
2. C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-red.mjs
3. C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-verify.mjs
4. C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-hash.mjs
5. C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-lint.mjs
6. C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\init.mjs
7. C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\hooks\pre-commit
8. C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\hooks\commit-msg
9. C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\hooks\pre-push
10. C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\templates\task.md
11. C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0061\report.md (этот отчёт)

Диффстат (git diff --stat, до появления этого отчёта): 10 файлов, 202 вставки, 23 удаления.
`verifyLock` в common.mjs не изменён (в диффе нет); защищённые `spec/checks/**`, `plugin/**`,
`package.json` не тронуты; task.md/criteria.json/criteria.lock задания не тронуты.

## 3. Проверки

Что и сколько раз гонялось: C1–C4 — по 2 прогона каждый на дереве 0061 (первый сразу после
восстановления кода, второй — для дословного вывода ниже); оба зелёные. На дереве 0060 до переноса:
c1 — 1, c2 — 1, c3 — 1 (падал на дефекте контракта), c4 — 1. C5 — 1 прогон на 0061 (+1 на 0060),
C6 — 1 на 0061 (+1 на 0060), pipe-free c1 — 1 на 0061 (+1 на 0060). `e2e-deploy` — 1 прогон
(находка вне §Регресс, см. п.4).

### C1
```
$ node spec/checks/gate-diagnostics.mjs c1
GATEDIAG OK c1
exit=0
```

### C2
```
$ node spec/checks/gate-diagnostics.mjs c2
GATEDIAG OK c2
exit=0
```

### C3
```
$ node spec/checks/gate-diagnostics.mjs c3
GATEDIAG OK c3
exit=0
```

### C4
```
$ node spec/checks/gate-diagnostics.mjs c4
GATEDIAG OK c4
exit=0
```

### C5
```
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
exit=0
```

### C6
```
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
exit=0
```

### pipe-free c1 (инвариант 6)
```
$ node spec/checks/pipe-free.mjs c1
PIPEFREE OK c1
exit=0
```

### Дополнительно (сверх критериев, доказательства инвариантов 1–2)

Помощник подсказки — печатается только при сдвиге `contractCommit`:
```
$ node -e "import('./spec/scripts/lib/common.mjs').then((m) => { const shifted = m.lockOrderHint({ errors: ['contractCommit: ожидалось a, сейчас b'] }); const other = m.lockOrderHint({ errors: ['protected: защищённый файл изменён'] }); console.log('SHIFTED:', JSON.stringify(shifted)); console.log('OTHER:', JSON.stringify(other)); console.log('WORDS:', /не коммит/iu.test(shifted), /кандидат/iu.test(shifted)); })"
SHIFTED: "Подсказка: не коммитьте критерии и артефакты после task-red — сдвиг HEAD отвязывает кандидата от contractCommit.\nПорядок коммитов: контракт → task-hash --write → task-red → работа → task-verify → task-accept.\nКандидат — коммит, на котором task-red доказал красный; его SHA обязан совпадать с contractCommit в criteria.lock."
OTHER: null
WORDS: true true
exit=0
```

Фатальный путь `task-hash` (без `--reason`) — stdout не пуст, stderr дублирует:
```
$ node spec/scripts/task-hash.mjs --task docs/tasks/0061 --relock
STDOUT: task-hash: --relock требует --reason "<почему контракт правится после красного>"
STDERR: task-hash: --relock требует --reason "<почему контракт правится после красного>"
exit=1
```

Фатальный путь `task-lint` (нет task.md):
```
$ node spec/scripts/task-lint.mjs --task docs/tasks/9999
STDOUT: task-lint: Нет task.md в C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\9999
STDERR: task-lint: Нет task.md в C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\9999
exit=1
```

Идемпотентность `init` (инвариант 3, два прогона во временном репозитории):
```
$ node spec/scripts/init.mjs --repo <temp> --git-init --key-out <temp>/_keys
$ node spec/scripts/init.mjs --repo <temp> --key-out <temp>/_keys
init1 exit=0; init2 exit=0
node-path bytes=40 endsWithLF=True lines=1
node-path matches execPath=True
gitignore node-path lines:
docs/subagent-workflow/.node-path
count=1
```

## 4. Отклонения от задания и почему

1. **0060 → 0061.** Задание переиздано вами после моего стопа: c3 в 0060 требовала блокировки
   коммита, не включив `guard.enabled` в своей фикстуре (пакетный конфиг — `guard.enabled: false`,
   а поведение task-guard менять запрещено). Исправление внесено вами в контракт 0061;
   мой код перенесён без изменений, поэтому в комментариях остались метки 0060 (WC-40/41/42) —
   это история требования, а не ссылка на отменённое задание.
2. **Нормализация обратных слэшей в хуках** — не косметика: без неё на Windows `.node-path` с
   `process.execPath` не проходит `[ -f ]` в sh из Git for Windows, и WC-42 не работает
   (проверено прямой пробой). Ядро требования («находит node, guard выполняется как раньше») сохранено.
3. **JSON-режим на фатальных путях.** Инвариант 2 говорит «при фатальном отказе stdout не пуст» и
   «JSON-режимы не меняются». Совместил так: в `--json` stdout остаётся машинным и получает
   `{ ok: false, errors: [...] }` — та же форма, что уже печатает catch ворот; формат `PASS/FAIL`,
   `Итог:` и обычный вердиктный JSON не тронуты.
4. **`spec/e2e-deploy.mjs` краснеет на `.node-path` — находка вне §Регресс, требует вашего решения.**
   `init` теперь кладёт `.node-path` в развёрнутое дерево, а e2e-deploy сравнивает дерево с пакетом
   и фильтрует только `acceptors.json`, `workflow.config.json`, `VERSION`. Файл
   `spec/e2e-deploy.mjs` вне allowedPaths (и не защищён), поэтому я его не правил. Дословно:
```
$ node spec/e2e-deploy.mjs
FAIL  развёрнутое дерево совпадает с пакетом (кроме acceptors.json и конфигурации)
      {"missing":[],"extra":[".node-path"],"changed":[]}
...
DEPLOY E2E FAILED: 1
exit=1
```
   CI (`.github/workflows/ci.yml`, шаг «e2e-deploy — init из развёрнутого каталога») этот скрипт
   запускает, так что до релиза ему нужно добавить `.node-path` в `STATE_FILES` (одна строка,
   follow-up архитектора/релиз-инженера). Остальные 25 утверждений e2e-deploy зелёные.
5. Ничего не коммитил, не пушил, не деплоил. `task.md`, `criteria.json`, `criteria.lock` не менял.

## 5. git status --short

```
 M spec/hooks/commit-msg
 M spec/hooks/pre-commit
 M spec/hooks/pre-push
 M spec/scripts/init.mjs
 M spec/scripts/lib/common.mjs
 M spec/scripts/task-hash.mjs
 M spec/scripts/task-lint.mjs
 M spec/scripts/task-red.mjs
 M spec/scripts/task-verify.mjs
 M spec/templates/task.md
?? docs/tasks/0061/criteria.lock
?? docs/tasks/0061/gates.jsonl
?? docs/tasks/0061/red.json
?? docs/tasks/0061/report.md
```
