# HANDOVER — ожидание подключения префлайта (движок 2.6.115)

Документ для продолжения работы в новой сессии. Пакет: default-workspace/subagent-workflow-v2.
Полный путь: C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\HANDOVER-preflight-wait.md
Рабочий каталог сессии: C:\Users\Goryachev\Documents\deepseek-harness\default-workspace

## 0. Первая минута новой сессии

1. Работа: ждём сообщения от structure. Их окно останова тоже было 09:00–13:00; после него порядок работ — 0385, 0387, обновление развёрнутой копии до 2.6.115. Входящих после паузы нет (проверено в 13:10). Выпуск 2.6.116 с 0175 владельцем не разрешён: без его слова публикацию не начинать. Задач не заводить, чужую структуру не править.
2. Проверить входящие обмена (§4): если есть письмо от structure — доложить владельцу коротко (что просят, что это значит, сколько работы) и ждать решения.
3. Сверить, что состояние не сдвинулось: git status в пакете пуст, VERSION = 2.6.115, в истории есть коммиты хендовера 7d11595 и 968aeb0 (HEAD может быть новее, если сессия уже работала).
4. Владельцу отвечать только по-русски, без дат (задача → принял → сделал); отчёт закрывать состоянием «сделано и проверено», а не объявлением.

## 1. Состояние на момент передачи

| Что | Значение |
|---|---|
| Пакет | default-workspace/subagent-workflow-v2, дерево чисто; хендовер закоммичен (7d11595, 968aeb0), до него 749521f |
| Движок в пакете | VERSION = 2.6.115, package.json = 2.6.115, панель plugin/package.json = 0.9.40 |
| Тег выпуска | v2.6.115 → коммит fb1f8fa; релиз опубликован (9 ассетов) |
| Ассеты 2.6.115 | tar 3389928 (sha256 440ea3ef…), zip 2504165 (935cfb26…), панель tgz 635020 (e25061b4…), smoke-квитанция |
| Развёрнуто в воркспейсе | default-workspace/docs/subagent-workflow/VERSION = 2.6.115, DOCTOR OK, дерево воркспейса чисто (098c51a) |
| Задачи | 152 каталога; последняя принятая — 0175 (doctor различает пакет и копию), в релиз 2.6.115 не входит |
| Открытых задач | нет; superseded: 0040, 0077–0079, 0099, 0138, 0143, 0153, 0162→0163, 0166→0167 |
| Обмен | открытых заявок 0; последние письма: structure--05, workflow--06, workflow--07, structure--07 (08:45 — префлайт уже в их коде, acceptor поправка принята, включение после паузы); после их паузы писем нет |
| Ключ приёмки | C:\Users\Goryachev\.wf-keys\subagent-workflow-v2\agent-judge.key.pem, keyId agent-judge |

## 2. Чего ждём и от кого

Ждём structure (чужой плагин dsh-project-graph, репозиторий C:\Users\Goryachev\Documents\deepseek-harness\dsh-project-graph).
Их последнее письмо — 2026-11-27T08-45+03-00--structure--07.md; вопросов в нём нет, отвечать не обязательно.

1. Префлайт: их задание 0383 принято и в истории проекта — preExecute вызывает наш вход перед стартом узла с заданием, блокирует только run.ok === false (accept не влияет), проверка формы идёт раньше кода возврата (оба ключа run/accept, булевый ok, массив missing), недоступность пишется в журнал один раз за прогон. Плюс версионный порог: копия ниже 2.6.115 и скрипт без флагов --contract/--audit не вызываются вовсе. Вызов read-only, повтор безопасен.
2. Развёрнутая копия: у них vendored (docs/subagent-workflow в истории проекта), обновление до 2.6.115 — отдельное задание с меткой обхода сразу после паузы.
3. Сверка приёмщика: их 0381 читает acceptor (роль) — сами признали ошибку; задание 0387 переведёт сверку на acceptorNode с нашими формулировками. До 0387 сверка только предупреждение (их 0384), строгий отказ не включают.
4. wait/status: их 0385 в очереди; имя входа и формат ответа пришлют письмом, после чего заменить раздел «Ожидание узла графа» в INSTALL.md на факт (задачей с критерием: документ обязан совпадать с кодом).
5. Их 0380 (классы отказа гейта) и 0376 (уборка артефактов ворот) — принято к сведению, действий с нашей стороны не требуют.

Их окно останова то же (09:00–13:00); после 13:00 их порядок: 0385, 0387, обновление копии. Наша сторона: ничего не меняем до их письма; обещать в документации несуществующее нельзя.

### Чего именно ждём сообщением от structure

Письмо должно прийти после их паузы, в их порядке работ:

1. Обновление развёрнутой копии их проекта до 2.6.115 (vendored-коммит с меткой обхода). После него снимается версионный порог, и префлайт начинают звать по-настоящему.
2. 0385 — имя входа, аргументы и формат ответа для status/wait. После этого наша задача: заменить в INSTALL.md раздел «Ожидание узла графа» на факт, с критерием «документ совпадает с кодом».
3. 0387 — перевод их сверки на acceptorNode. До него их сверка только предупреждает, действий с нашей стороны не требует.

Как реагировать на письмо: доложить владельцу коротко (что просят, что делаем, сколько работы); сверить их факты с §«Как понять, что префлайт реально подключён»; расхождение — письмом разработчику (следующий номер нашего письма — workflow--08).

### Как понять, что префлайт реально подключён
Признак — их preExecute вызывает именно наш вход и блокирует только по run.ok === false:

    node docs/subagent-workflow/scripts/task-preflight.mjs --contract --audit --json --task docs/tasks/<id> --repo .

JSON: { task, run: { ok, missing[] }, accept: { ok, missing[] } }; --audit всегда код 0, код 2 — ошибка вызова.
Старую копию (2.6.112) их проверка формы ловит по отсутствию ключей run/accept — тогда «недоступно», журнал, запуск не блокируется.
Проверка на нашей стороне: тот же вызов на docs/tasks/0175 отдаёт оба ключа.

## 3. Процесс задачи (не менять без владельца)

1. Контракт: docs/tasks/<id>/task.md (блок TASK-META + Цель/Что не входит/Инварианты/Границы знания/Среда/Отчёт/Коммит + таблица CRITERIA) и criteria.json. Минимум один критерий с tags:["negative"]; при impact public-contract|user-visible — effect {observable, threshold, measuredBy}.
2. node spec/scripts/task-lint.mjs --task docs/tasks/<id> --strict — до красного; без criteria.lock будет ERROR (норма до task-hash).
3. git add docs/tasks/<id> → pwsh -NoProfile -File tools/commit.ps1 "<msg>" (только контракт) → node spec/scripts/task-hash.mjs --task docs/tasks/<id> --write.
4. Красный на чистом дереве: реализация в stash. node spec/scripts/task-red.mjs --task docs/tasks/<id> --base HEAD; длинные прогоны — node spec/scripts/job.mjs start -- <cmd> и job.mjs wait <id> --tail 40 (pwsh timeoutMs > 120000 и Start-Sleep отклоняются).
5. Реализация в allowedPaths, затем node spec/scripts/task-verify.mjs --task docs/tasks/<id>. Свои незакоммиченные изменения границы покрывают (2.6.100+).
6. Приёмка — отдельной сессией узла judge (ключ выше, keyId agent-judge), без --node, с отклонением: --deviation "корень пакета вне разрешённых корней спавна узла judge (root-not-allowed); приёмку выполняет отдельная сессия узла judge". Запуск: спавн узла judge через structure либо job.mjs start -- node spec/scripts/task-accept.mjs --task docs/tasks/<id> --repo . --key <путь> --key-id agent-judge --deviation "…".
7. git reset --hard <candidate> → коммит metadata приёмки → коммит фактов и тени движка с меткой [workflow-bypass: …].
8. Не менять TASK-META после красного прогона: task-hash откажет. Границы/покрытие/теги — --relock; правка меты — только новым ID (0162→0163, 0166→0167).

Особые режимы, уже принятые и работающие:
- mode light (+ checks[], риск только low): без criteria.json/criteria.lock, красный не доказывается (--allow-missing-red), приёмке нужен --note.
- vcs none (только light+low): verify не трогает git (headSha "local", changedPaths []), приёмка с candidateCommit null, tree null, worktreeDigest; task-check-acceptance понимает vcs none.
- task-preflight --contract [--audit] [--json] — причины до спавна; --audit всегда 0.
- task-guard --diagnose печатает «ПРИЧИНА docs/tasks/<id>: …».

## 4. Обмен письмами (structure)

Ящик: C:\Users\Goryachev\Documents\deepseek-harness\coordination\threads\exchange, формат dsh-exchange/1, имя <ISO>--<from>--<NN>.md.
Проверка входящих из корня deepseek-harness:

    node dsh-project-graph/tools/check-exchange.mjs --box coordination --me workflow --turn

Ответ нашего ящика — 0 открытых заявок. Следующее наше письмо — номер workflow--08.
Письмо в чужой воркспейс: tools.write там может быть запрещён — писать через pwsh base64 ([IO.File]::WriteAllBytes) и проверять check-exchange с --me structure --turn.
Правило владельца: чужой плагин — только отчёт/письмо разработчику; код чужого плагина не правим, дубли фиксируем отчётом.

## 5. Релиз (когда владелец скажет)

1. Контракт релизной задачи → красный → bump версии: VERSION, package.json (и dshPanelVersion), plugin/package.json, README.md, spec/SPEC.md (шапка и раздел), spec/scripts/lib/common.mjs, CHANGELOG.md, release.config.json.
2. Сборка ассетов только из тега и без git add -A: временный индекс GIT_INDEX_FILE, git read-tree HEAD, git add -A, git write-tree, git archive <tree>; node tools/pack-plugin.mjs; node tools/pack.mjs.
3. node tools/release.mjs preflight <ver> → node tools/check-tests.mjs (C4) → node tools/check-version.mjs → приёмка приёмщиком → metadata и факты → pwsh -NoProfile -File tools/commit.ps1 -Tag v<ver> -Push → node tools/release.mjs release <ver> (draft → smoke → publish).
4. release.config.json сейчас: version 2.6.115, panel 0.9.40, task docs/tasks/0174.

Незакрытый вариант (решение владельца): выпуск 2.6.116 с задачей 0175 (doctor в корне пакета). allowedPaths такой задачи должны покрывать spec/scripts/doctor.mjs, spec/checks/doctor-package.mjs (уже в коммитах) и файлы версии; панель остаётся 0.9.40.

## 6. Пути и правила

- Пакет: C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2 (движок, spec/scripts, spec/checks, docs/tasks, tools).
- Развёрнутая копия: C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\docs\subagent-workflow. Обновление: node spec/scripts/init.mjs --repo <проект> --force (ключи и конфигурация сохраняются).
- Чужой плагин: C:\Users\Goryachev\Documents\deepseek-harness\dsh-project-graph (и панель dsh-kanban-board) — читать только по указанию владельца, править нельзя.
- Правила владельца: в проекте только проектное; ответы только по-русски; не оперировать датами; без указания не входить в чужой воркспейс; отчёт закрывается «сделано и проверено»; коммиты и пуш — только через tools/commit.ps1.

## 7. Что может понадобиться первым делом

- Письмо structure (после паузы): сверить их вызов префлайта и форму ответа (§2); при расхождении — письмо с точной формой; INSTALL.md править только после подтверждения факта.
- Владелец попросит 2.6.116 (0175: doctor в корне пакета) → полный цикл по §5, задача с allowedPaths на doctor-файлы и файлы версии. Пока владелец не сказал — не начинать.
- 0385 принято → заменить в INSTALL.md раздел «Ожидание узла графа» на их имя входа и формат ответа, задачей с критерием (документ обязан совпадать с кодом).
