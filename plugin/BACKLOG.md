# Бэклог dsh-workflow-console

Статусы: `proposed` | `accepted` | `in-progress` | `done` | `rejected`.
Обновлено: 2026-11-07.

| ID | Статус | Приоритет | Тема |
| --- | --- | --- | --- |
| WC-1 | done | medium | Подсказки при наведении на поля и бейджи |
| WC-63 | done | high | **Установка плагина стирала рабочее дерево (0089, 0.9.21).** «Обновить панель» ставит tarball в каталог плагина, а он — junction на рабочий репозиторий: `installPluginFiles` уводил каталог в `.dsh-plugin-backup-*`, а на его место клал только файлы пакета, поэтому 16 отслеживаемых файлов (`plugin/BACKLOG.md`, `PLUGIN-PLAN.md`, все `plugin/test/*`) исчезли из дерева (восстановлено `git checkout -- plugin/`). Теперь: копия в бэкап, файлы пакета перезаписываются на месте, посторонние остаются (`leftovers` в отчёте); установка в git-рабочее дерево запрещена без `force` (код `plugin-dev-tree`, API отдаёт 409 `plugin-dev-install` с рецептом «git pull + перезапуск»). Тесты: `plugin-update.test.mjs` 9 (сохранение посторонних, отказ в дереве, force, маршрут) |
| WC-2 | proposed | low | Тултип на тач-экранах и по клавиатурному фокусу |
| WC-3 | done | high | Диагностика: запуск doctor/lint/check-acceptance из панели |
| WC-4 | done | high | **Первая запись из панели (0090, 0.9.22).** `POST /api/task-hash` (замок контракта: `task-hash.mjs --write`, `--relock --reason`) и `POST /api/new-task` (`new-task.mjs --id --title --risk [--executor --acceptor]`): панель не пишет тексты, а зовёт штатные скрипты движка и показывает их вывод. Валидация аргументов в `lib/tasks-write.mjs` (id 4 цифры, тема 5..200 без переводов строк, риск low/medium/high, роли по безопасному набору). В карточке задания — «Собрать замок», на доске — «Новое задание» (id, тема, риск). Тесты: `test/tasks-write.test.mjs` (6) |
| WC-5 | done | medium | Показ effect и регресса (workflow 2.3–2.4) |
| WC-6 | done | high | Внешний движок: кнопки видимо недоступны и объясняют причину (0038; выпущено в 0.9.1, сейчас 0.9.5) |
| WC-7 | done | high | INSTALL.md: раздел «Установка панели» и грабли установки в чужой DSH (нативный путь, EPERM, roots/participants) |
| WC-8 | done | medium | `join` теряет `exchange.threads` — закрыто их 0028 (`inheritFolderExchange` + регресс `invitation.test.mjs:286`); наш репрод был до 0028 |
| WC-9 | done | low | Стенд убран: split-optimizer на движке воркспейса (2.6.17, как reach-proxy), `.tmp\engine-2.6.11` удалён (63 файла, 760 КБ) |
| WC-15 | done | high | Профиль: участники папки в roots/participants (structure 0052, проверено в панели) |
| WC-17 | done | medium | Structure 0052 (WC-15) принят — предупреждение о неразрешённом участнике работает |
| WC-14 | done | high | Граф мигрирован на прямые `provider`+`model` (04.11 03:35): `models{}` удалён, все четыре ноды запущены — coordinator 1,4 с, worker 1,7 с, judge 1,9 с (opencode-go/glm-5.3-flash), Critic 2,6 с |
| WC-18 | done | high | Дисциплина оценки закодирована (0049): шаблон §Среда + reportReadGuard + actorModel; ручные дубли и обрывы уходят из брифа в контракт |
| WC-19 | done | medium | **Приёмка пачкой (0091, 2.6.45).** `scripts/task-accept-batch.mjs --tasks 0110,0111`: preflight (каталоги, id, аргументы) один раз, затем штатный `task-accept` по одному — подпись, запись и кандидатный коммит остаются персональными, пачка не смешивает доказательства. Итог PASS/FAIL и exit 1 при любом отказе; разбор списка и план — `scripts/lib/batch-tasks.mjs` (id 4 цифры, дубли убираются, пачка 2–3), проверка `spec/checks/batch-accept.mjs` c1–c4. Смоук на живом задании: task-accept отработал, FAIL/summary/exit напечатаны. Экономия — один «ход» агента на 2–3 задания вместо трёх церемоний |
| WC-20 | done | medium | **Контракт до красного (0092, 2.6.46).** `scripts/task-preflight.mjs` гоняет только mustPass на базе: дешёвые (timeoutMs ≤120000, без тега `expensive`) первыми, дорогие не запускаются после первого провала дешёвой. `task-red` вызывает preflight по умолчанию (`--skip-preflight` — осознанный обход) и при красном mustPass печатает «контракт сломан», не тратя красный прогон. Проверка `spec/checks/contract-preflight.mjs` c1–c4; живой прогон на 0110: C4/C5 зелёные за 568+304 мс |
| WC-21 | proposed | low | Уточнить C1 задания 0044: «ровно два файла» против транзитивного минимума |
| WC-22 | proposed | low | Флейк C1 в 0046: runner-процесс раз в ~11 прогонов убивается своим 60-с таймаутом (exit 124), к наложению не относится — остаётся |
| WC-26 | done | high | Re-lock границ после красного (0050): `task-hash --relock --reason`, запись `relock` в замке, `criteriaSha256` неизменен |
| WC-27 | done | high | Движок вне замка задания (0050): `protectedManifest`, `docs/subagent-workflow/**` не краснит чужой замок без `locksEngine` |
| WC-28 | done | high | Журнал вердиктов ворот (0051): `docs/tasks/<id>/gates.jsonl`, append-only, `kind=red|verify|accept`, причины отказов; сбой журнала — WARN |
| WC-30 | done | medium | Строка `accept` теперь после сборки кандидата и подписи (0052) |
| WC-31 | done | low | **Guard подписи срабатывает (0093).** `contract-discipline.mjs c2` искал `signAcceptance`, а функция — `signRecord`: проверка «строка accept после подписи» молча не выполнялась. Теперь ищется фактический вызов, отсутствие подписи — отказ, а не тихий пропуск. c1/c2 зелёные |
| WC-32 | proposed | low | Строка `accept` не попадает в репозиторий: пишется после сборки кандидата, `reset --hard` её теряет — дописывать при metadata-коммите |
| WC-33 | done | high | Схема записи отставала от кода: `reportReadReason` (0049) и `reportRead`/`reportReadVerified` (0053) отсутствовали в `acceptance.schema.json` — 0054 добавил, схема v7, проверка валидирует реальную запись |
| WC-34 | done | high | §Отчёт требует все проверки контракта (0053): команда и exit каждой, `NOT RUN` для непрогнанной |
| WC-24 | done | high | Ворота печатают `PASS  C1  exit 0  530 ms` и `Итог: …` (0056) — приёмщику не нужен ручной повтор (≈980 с дублей) |
| WC-35 | done | high | Красный доказывается причиной (0058, 2.6.22): отказ критерия с `ReferenceError`/`TypeError`/`SyntaxError` со стеком — дефект проверки (`checkDefects`, «Красный НЕ доказан»); `redExpect.reasons[id]` ищется только в вердиктной зоне — последних `reasonWindow` непустых строках вывода критерия (по умолчанию 25, расширение явное и валидируется lint); замер по 125 `red.log`: 115 причин в последних 5 строках, максимум 21. `task-verify` принимает `red.json` v4/v5 (0058; 0057 в `_superseded` — его контракт забыл `task-verify`) |
| WC-36 | done | low | **Чужое задание в allowedPaths (0096).** После копирования каталога 0055→0056 в TASK-META остались пути прошлого задания (docs/tasks/0055/**): исполнитель получал право править контракт прошлого задания. task-lint теперь даёт ERROR на docs/tasks/<чужой>/ в allowedPaths (своё — можно) и WARN на то же в redAllowDirty. Проверено синтетическим заданием 0056: ошибка печатается, exit 1 |
| WC-37 | done | high | Инструменты пакета без пайпов (0059, 2.6.23): `spawnSyncPipeFree` в `lib/common.mjs`, 18 спавнов в 7 файлах переведены на файловое stdio (`selftest`, `e2e`, `e2e-deploy`, `doctor`, `init`, `task-check-acceptance`, `pack-plugin`); правило держит `spec/checks/pipe-free.mjs` c1–c5. В `danger-full-access` те же скрипты шли и раньше — дефект проявлялся в confined-режиме |
| WC-48 | done | low | **Legacy-запись без подписи — WARN, а не 7 ERROR (0094).** Признак — отсутствие `keyId`/`signature`, а не номер версии: проверка ключа, подписи, fingerprint и acceptorRun пропускается, печатается один честный WARN «аудит неполон». Подписанные записи проверяются как раньше (ключ, Ed25519, nonce). Проверено на синтетической v5-записи: 4 ERROR → WARN, exit зависит только от настоящих дефектов |
| WC-50 | done | high | Релиз публикует tarball плагина (с 2.6.27/2.6.28): `dsh-workflow-console.tgz` + `.sha256` прикладываются к релизу, плагин везёт `vendor/spec` текущей версии. Правило: релиз движка без tarball плагина внешние харнессы не обновляет |
| WC-51 | done | high | Обновление движка из релиза GitHub штатной кнопкой (0067, 2.6.28): `/api/update` c `source: "release"` качает tarball движка из latest release, сверяет sha256, распаковывает и разворачивает; в состояниях `up-to-date`/`panel-older` панель показывает «Обновить из релиза». Плагин 0.9.8 |
| WC-49 | done | high | Публикация схемы на GitHub (2026-11-05): main до `d9d03d3`, теги `v2.6.22`–`v2.6.27`, релизы `v2.6.26`/`v2.6.27` с tarball-ассетом (`git archive`), CI зелёный — run 41922202564, 12 задач (ubuntu/windows × node 22/24 × test/plugin/deploy) |
| WC-45 | done | low | doctor: правило имени ключа только для активных пинов (0064, 2.6.25): отозванный legacy `stable` больше не FAIL, активный без префикса — FAIL. Вопрос structure (`--145` §4) закрыт; `aliasOf` не делали |
| WC-47 | done | medium | Подсказка при сдвиге HEAD называет причину (0064, 2.6.25): артефакт задания / код исполнителя (кандидата создаёт `task-accept`) / metadata приёмки + изменённые пути (`git diff --name-only <contractCommit> HEAD`). Найдено по оркестратору 0023, который собирался коммитить код до приёмки |
| WC-44 | done | high | **Гигиена деплоя (0082, 0.9.18).** sourceProvenance(specRoot): vendor | dev | other; для dev — git describe --dirty --always пакета; в deploy.log пишутся source= и describe=, в отчёт — provenance и warning («грязное рабочее дерево: деплой не воспроизводим по тегу», «источник — рабочее дерево, а не релизный tarball»). Тесты: test/provenance.test.mjs (2) |
| WC-43 | done | medium | Привязка ролей к узлам структуры (0068, 2.6.29): `executorNode`/`acceptorNode` в TASK-META, `actor.node` и `deviation` в записи приёмки, `task-accept` отказывает risk≥medium без узла и без причины, `task-check-acceptance` печатает `attributionGap` (legacy — warn, объявившие узел — error), `task-lint` предупреждает про acceptor-субагента без узла, `adapters/dsh.md` под политику warn, `Node: worker|judge` в письмах. Первая приёмка по схеме — сама 0068 (`actor.node: judge`) |
| WC-53 | done | low | **Строгость attribution по версии инструмента (0095).** Если `criteria.lock.tool >= subagent-workflow/2.6.29` и запись v6+, отсутствие `actor.node` без deviation — ERROR («движок знал правило»), а не WARN. Записи, замороженные старым движком, остаются предупреждением. Проверено: lock 2.6.40 без узла → ERROR; lock 2.4.3 → WARN, exit 0 |
| WC-54 | done | high | Сторож в пакете (0072, 2.6.31): `spec/scripts/job.mjs` — `start`/`wait`/`status`/`list`/`kill`, ожидание на файле состояния, вердикт в stdout (код фоновых заданий харнесс нормализует в 1). Кандидат `fd3ba71`, metadata `36c5411` |
| WC-56 | done | high | **Панель «Императив» (0081, 0.9.18, S4).** GET /workflow/api/policy отдаёт блок imperative: версия движка (и минимум 2.6.31), наличие scripts/job.mjs, enforcement.* (waitPolicy/waitBudgetMs/processPolicy/structurePolicy), счётчики журнала ожиданий (всего/отказы/notice), последние 3 записи с root и attribution; сводка ok + причины. В панели — раздел «Императив воркспейса» на вкладке «Политика»: таблица пяти пунктов §Г и зелёный/красный статус. Тесты: test/imperative.test.mjs (4) |
| WC-55 | done | high | Обязательность регламента (0073, 2.6.32): `plugin/lib/wait-guard.js` — детектор трёх антипаттернов ожидания и хук: `fail` через `ctx.tools.guard` (строка-причина со ссылкой на `scripts/job.mjs`), `warn` — notice полной формы v4; блок `enforcement` в шаблоне и добавление недостающих ключей в `init`. Кандидат `01fa9e66`, metadata `9f43da5` |
| WC-57 | done | high | Политика по воркспейсу (0075, 2.6.34): `registerWaitGuard` читает `enforcement` из `<root>/docs/subagent-workflow/workflow.config.json` каждого корня (`config.roots`), корень вызова — `exec.cwd`/`agent.cwd` по longest prefix, кэш по mtime; `off` сильнее профильного `fail`; журнал пишет фактический `root`/`mode`. Кандидат `7ecc493`, metadata `7c10f23`; приёмка — узел `coordinator` (judge инструменты не выполняет) |
| WC-58 | done | high | Наблюдаемость императива (0074, 2.6.33): журнал долгих ожиданий `{ at, root, tool, mode, denied, reason, waitMs, budgetMs }` в `~/.dsh/workflow/waits/<hash>.jsonl`; `spec/checks/workspace-imperative.mjs` c1–c4 (сторож, версия, `waitPolicy`/`processPolicy` по наличию заданий, блок `enforcement`). Кандидат `1991959`, metadata `4d02ac0` |
| WC-52 | done | high | **Обновление панели из релиза (0079, 0.9.17).** POST /workflow/api/plugin-update: последний релиз GitHub → стабильный ассет dsh-workflow-console.tgz + .sha256, проверка sha256, разбор tarball, замена каталога пакета в профиле с бэкапом .dsh-plugin-backup-<версия>-<время>; откат при ошибке записи. Для link/junction-установок — 409 plugin-dev-install с объяснением (код принадлежит рабочему дереву); локальный tarball (config.pluginUpdateFile / WF_PLUGIN_UPDATE_FILE) — для офлайна и тестов. Клиент: кнопка «Обновить панель» рядом с «Обновить из релиза» в том же блоке, где панель показывала тупик «сборка панели старше движка»; после успеха — «перезапустите DSH». Тесты: test/plugin-update.test.mjs (6: ассеты, tarball, установка с бэкапом, режимы dir/linked/missing, маршрут с локальным tgz, отказ link-установке) |
| WC-62 | done | high | **Атрибуция корня сторожа для вложенных вызовов (0080, 0.9.18).** У вызова из PTC-моста нет exec.cwd/agent.cwd — корень падал на roots[0]. Теперь сторож ведёт карту callId → cwd сессии из session/event (tool/call пишет, tool/result стирает), а resolveCall отдаёт attribution: cwd|agent|call|fallback; журнал пишет поле attribution. Тест: session/event → rootCallId → deny с root и attribution='call' |
| WC-61 | done | medium | «Обновить из релиза» при актуальной версии (0078, 0.9.16): сервер отвечает 409 `{ok:false, code:'up-to-date'}`, а клиент в `runReleaseUpdate` этот код не разбирал и показывал «обновление из релиза не выполнено: HTTP 409». Теперь up-to-date — информационное сообщение «Обновление не нужно: уже установлена версия X», как в сборке (там код разбирался с 0.8.x); `panel-older` по-прежнему показывает `hint`. Данные не меняются: это ответ «обновлять нечего» |
| WC-60 | done | high | Порядок регистрации сторожа (0077, 0.9.15): в `lib/wait-guard.js` подписка `tools/pre-execute` — первая операция, сервис `ctx.tools` читается ПОСЛЕ неё и внутри try/catch. Дефект 0.9.14: обращение к `ctx.tools` стояло выше подписки, и там, где сервис не инжектирован (Cordis бросает), регистрация падала целиком — `apply()` ловил исключение, панель работала, политика fail молчала (W1 не отклонял `Start-Sleep 61`; журнал `~/.dsh/workflow/waits` замер). `registerWaitGuard` теперь возвращает `registration: { preExecute, guard, postExecute, guardError }`, живое состояние видно в `/workflow/api/status` (поле `guard`); `probeApply` остаётся, но проверка больше не опирается на файл. Тесты: `test/wait-guard.test.mjs` (обычный ctx; бросающий `ctx.tools` — pre-execute подписан и отклоняет; короткий вызов проходит; второй слой guard) |
| WC-59 | done | high | Отказ сторожа через `tools/pre-execute` (0076, 2.6.35): `{kind:'deny', reason}` до исполнения (путь structure 0091, инъекция не нужна); `ctx.tools.guard` — второй слой; политика per-root и журнал сохранены. Кандидат `f08489a`, metadata `48ecd04` |
| WC-40 | done | medium | Подсказка порядка коммитов (0061, 2.6.24): `lockOrderHint` в `lib/common.mjs`, `task-red`/`task-verify` печатают «не коммить, артефакт входит в кандидатный коммит» и порядок контракт→hash→red→работа→verify→accept; строка в шаблоне задания. 0060 в `_superseded` (c3 без `guard.enabled` в фикстуре — дефект контракта) |
| WC-41 | done | medium | Причина в stdout (0061, 2.6.24): все фатальные пути `task-red`/`task-verify`/`task-hash`/`task-lint` печатают `<gate>: <причина>` в stdout, подробности в stderr; `PASS/FAIL`, `Итог:`, `--json` не менялись |
| WC-42 | done | high | Хуки находят node (0061, 2.6.24): `init` пишет `docs/subagent-workflow/.node-path` + идемпотентную строку `.gitignore`; хуки резолвят `$WF_NODE` → `.node-path` → PATH, при отсутствии — предупреждение один раз (маркер `workflow-node-missing`); `commit-msg` не пропускает блокировку там, где node есть по `.node-path`. Хвост — 0063: `e2e-deploy` исключает `.node-path` из сравнения (0062 в `_superseded`: C2 объявлен красным, а он зелёный) |
| WC-39 | done | medium | Проверки пакета без пайпов (0071, 2026-11-05): 29 файлов `spec/checks/*.mjs` переведены на `spawnSyncPipeFree`, `spec/checks` включён в сканер `pipe-free.mjs c1` — до работы 37 находок в 29 файлах, после 0; кандидат `18546ce`, metadata `d601f38`, приёмка нативным subagent с `deviation` (узел judge дважды вернул реплику без работы) |
| WC-38 | accepted | high | Обновление DSH до 0.2.2-rc.1 и рантайм-проверка (2026-11-04): статическая совместимость проверена — `COMPAT-DSH-0.2.2-rc1.md`; при установке применить 3 правки профиля (`tool-subagent` → `modelSelection`+`modelDiscovery`, `fs-observation-policy` → `disabled: false`, `tool-executor-ptc` если `run_code` пропадёт), затем чек-лист из §5 отчёта, включая `actor.attestedBy=env` и `DSH_SESSION_ID` |
| WC-29 | done | medium | Границы до красного (0052): правило в шаблоне §Среда «сверь файлы с allowedPaths до первой правки, иначе стоп» |
| WC-23 | done | low | `external-engine.mjs c2` сужен (0048): 121 → 78 с, живых спавнов полного набора в `spec/checks` не осталось |
| WC-25 | proposed | medium | `actor.model` у субагентов остаётся `unknown`: харнесс не передаёт `DSH_MODEL` спавну — просить/прокинуть в env |

## WC-5. Показ effect и регресса (workflow 2.3–2.4)

**Откуда.** 2026-10-28 панель 0.3.1 перестала называть 2.4.5 «новее поддерживаемого
диапазона» (совет «обновите плагин» вёл в никуда). Вместо этого она называет, чего
не показывает: ворота 2.3+ знают `effect`, а панель — нет.

**Что не читается сейчас:**

- `criteria.effect` (`criterion`, `measuredBy`) и цепь
  `decisions[].evidence.ref ∈ {criterion, measuredBy}` — правило I-34, 2.4.0;
- `effectConsistency` в записи приёмки (2.4.0) — пересчёт в `check`;
- регресс: `regress.baseline.json`, гейт `task-regress`, `summary.timeout`
  (2.3.0 / 2.4.1).

**Что сделать (read-only, без записи):**

- в карточке задачи — блок «Доказательство и эффект»: критерий → эффект
  (`criterion`/`measuredBy`), `effectConsistency` записи, расхождение — флагом;
- на доске — бейдж «регресс» со статусом из отчёта `task-regress`, если он есть;
- тесты: 2.3-запись без `effectConsistency` не считается сломанной (legacy).

**Приёмка:** задача с `impact: user-visible` и `effect` читается целиком; задача без
`effect` выглядит как раньше; `git status` до и после открытия карточки совпадает.

**Уточнение 0.4.1 (ревью 0.4.0).** Панель считает «эффект требуется» по правилу
ворот (любое решение с `impact: user-visible|public-contract`), а не по своему —
тест сверяет с `evaluateEffects`. Подсказки эффекта и регресса попали в
`aria-label` кнопки карточки, в карточке появился раздел «Регресс», «не
проверялось» заменило ложное «ok» при `checked: false`, цвет бейджа «эффект»
берётся из строгости флага `effect-problem` (policy), карточка понимает
`effects: null` как старый ответ API.

## WC-3. Диагностика: запуск проверок из панели

**Решение заказчика (2026-10-27):** «Начинаем с диагностики — только читающие».

**Сделано (плагин 0.2.0).** Кнопки `doctor` (шапка), `lint` и
`check-acceptance` (карточка задачи) запускают ворота и показывают лог: