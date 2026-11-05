# Бэклог dsh-workflow-console

Статусы: `proposed` | `accepted` | `in-progress` | `done` | `rejected`.
Обновлено: 2026-11-03.

| ID | Статус | Приоритет | Тема |
| --- | --- | --- | --- |
| WC-1 | done | medium | Подсказки при наведении на поля и бейджи |
| WC-2 | proposed | low | Тултип на тач-экранах и по клавиатурному фокусу |
| WC-3 | done | high | Диагностика: запуск doctor/lint/check-acceptance из панели |
| WC-4 | proposed | high | Первая запись: task-hash --write и new-task из панели |
| WC-5 | done | medium | Показ effect и регресса (workflow 2.3–2.4) |
| WC-6 | done | high | Внешний движок: кнопки видимо недоступны и объясняют причину (0038; выпущено в 0.9.1, сейчас 0.9.5) |
| WC-7 | done | high | INSTALL.md: раздел «Установка панели» и грабли установки в чужой DSH (нативный путь, EPERM, roots/participants) |
| WC-8 | done | medium | `join` теряет `exchange.threads` — закрыто их 0028 (`inheritFolderExchange` + регресс `invitation.test.mjs:286`); наш репрод был до 0028 |
| WC-9 | done | low | Стенд убран: split-optimizer на движке воркспейса (2.6.17, как reach-proxy), `.tmp\engine-2.6.11` удалён (63 файла, 760 КБ) |
| WC-15 | done | high | Профиль: участники папки в roots/participants (structure 0052, проверено в панели) |
| WC-17 | done | medium | Structure 0052 (WC-15) принят — предупреждение о неразрешённом участнике работает |
| WC-14 | done | high | Граф мигрирован на прямые `provider`+`model` (04.11 03:35): `models{}` удалён, все четыре ноды запущены — coordinator 1,4 с, worker 1,7 с, judge 1,9 с (opencode-go/glm-5.3-flash), Critic 2,6 с |
| WC-16 | done | medium | Передать structure WC-8 — письмо --119; они подтвердили 0028, край с несколькими ветками заводят как 0051 |
| WC-18 | done | high | Дисциплина оценки закодирована (0049): шаблон §Среда + reportReadGuard + actorModel; ручные дубли и обрывы уходят из брифа в контракт |
| WC-19 | proposed | medium | Релиз пачкой на 2–3 задачи: церемония после каждой задачи — 266/313/366 с (945 с на три) |
| WC-20 | proposed | medium | Контракт до красного: пробный прогон mustPass на базе, дешёвые проверки первыми, дорогие — только при необходимости |
| WC-21 | proposed | low | Уточнить C1 задания 0044: «ровно два файла» против транзитивного минимума |
| WC-22 | proposed | low | Флейк C1 в 0046: runner-процесс раз в ~11 прогонов убивается своим 60-с таймаутом (exit 124), к наложению не относится — остаётся |
| WC-26 | done | high | Re-lock границ после красного (0050): `task-hash --relock --reason`, запись `relock` в замке, `criteriaSha256` неизменен |
| WC-27 | done | high | Движок вне замка задания (0050): `protectedManifest`, `docs/subagent-workflow/**` не краснит чужой замок без `locksEngine` |
| WC-28 | done | high | Журнал вердиктов ворот (0051): `docs/tasks/<id>/gates.jsonl`, append-only, `kind=red|verify|accept`, причины отказов; сбой журнала — WARN |
| WC-30 | done | medium | Строка `accept` теперь после сборки кандидата и подписи (0052) |
| WC-31 | proposed | low | `contract-discipline.mjs c2` ищет подпись по имени `signAcceptance`, а функция — `signRecord`: guard подписи не срабатывает (приёмщик 0052) |
| WC-32 | proposed | low | Строка `accept` не попадает в репозиторий: пишется после сборки кандидата, `reset --hard` её теряет — дописывать при metadata-коммите |
| WC-33 | done | high | Схема записи отставала от кода: `reportReadReason` (0049) и `reportRead`/`reportReadVerified` (0053) отсутствовали в `acceptance.schema.json` — 0054 добавил, схема v7, проверка валидирует реальную запись |
| WC-34 | done | high | §Отчёт требует все проверки контракта (0053): команда и exit каждой, `NOT RUN` для непрогнанной |
| WC-24 | done | high | Ворота печатают `PASS  C1  exit 0  530 ms` и `Итог: …` (0056) — приёмщику не нужен ручной повтор (≈980 с дублей) |
| WC-35 | done | high | Красный доказывается причиной (0058, 2.6.22): отказ критерия с `ReferenceError`/`TypeError`/`SyntaxError` со стеком — дефект проверки (`checkDefects`, «Красный НЕ доказан»); `redExpect.reasons[id]` ищется только в вердиктной зоне — последних `reasonWindow` непустых строках вывода критерия (по умолчанию 25, расширение явное и валидируется lint); замер по 125 `red.log`: 115 причин в последних 5 строках, максимум 21. `task-verify` принимает `red.json` v4/v5 (0058; 0057 в `_superseded` — его контракт забыл `task-verify`) |
| WC-36 | proposed | low | TASK-META 0056 унаследовал `docs/tasks/0055/**` в allowedPaths после замены номера — проверить генератор/замену |
| WC-37 | done | high | Инструменты пакета без пайпов (0059, 2.6.23): `spawnSyncPipeFree` в `lib/common.mjs`, 18 спавнов в 7 файлах переведены на файловое stdio (`selftest`, `e2e`, `e2e-deploy`, `doctor`, `init`, `task-check-acceptance`, `pack-plugin`); правило держит `spec/checks/pipe-free.mjs` c1–c5. В `danger-full-access` те же скрипты шли и раньше — дефект проявлялся в confined-режиме |
| WC-48 | proposed | low | Просьба structure (`--146` §4): запись приёмки версии ниже 7 (legacy без `keyId`/nonce/подписи) сейчас даёт 7 ERROR в `task-check-acceptance` и валит партию проверок. Предложение: для `version < 7` печатать WARN «legacy-запись без подписи, аудит неполон» и не считать это ошибкой (exit 0), с явной пометкой в сводке. Решение за архитектором: ослабление строгости — только для записей старше формата, не для текущего |
| WC-50 | done | high | Релиз публикует tarball плагина (с 2.6.27/2.6.28): `dsh-workflow-console.tgz` + `.sha256` прикладываются к релизу, плагин везёт `vendor/spec` текущей версии. Правило: релиз движка без tarball плагина внешние харнессы не обновляет |
| WC-51 | done | high | Обновление движка из релиза GitHub штатной кнопкой (0067, 2.6.28): `/api/update` c `source: "release"` качает tarball движка из latest release, сверяет sha256, распаковывает и разворачивает; в состояниях `up-to-date`/`panel-older` панель показывает «Обновить из релиза». Плагин 0.9.8 |
| WC-52 | proposed | medium | Обновление самого плагина из панели (0067 вынес это из скоупа): скачать `dsh-workflow-console.tgz` из latest release, распаковать в `node_modules` профиля и попросить перезапуск DSH. Пока плагин обновляется руками (`dsh plugin add <latest/download/dsh-workflow-console.tgz>`) — это единственный оставшийся не-кнопочный шаг, и он нужен только при изменении кода панели, не движка |
| WC-49 | done | high | Публикация схемы на GitHub (2026-11-05): main до `d9d03d3`, теги `v2.6.22`–`v2.6.27`, релизы `v2.6.26`/`v2.6.27` с tarball-ассетом (`git archive`), CI зелёный — run 41922202564, 12 задач (ubuntu/windows × node 22/24 × test/plugin/deploy) |
| WC-44 | proposed | high | Деплой из рабочей копии: `/api/update` в dev-режиме берёт спеку из `<package>/../spec` (то есть из нашего дерева пакета), а не из релиза. 2026-11-04 structure развернул «2.6.23», получив дерево середины 0061 (VERSION 2.6.23 + `.node-path`/`gate-diagnostics` из незакоммиченной 2.6.24). Нужно: отказ/предупреждение при грязном источнике, `git describe --dirty` в `deploy.log`, и деплой только с тега |
| WC-45 | done | low | doctor: правило имени ключа только для активных пинов (0064, 2.6.25): отозванный legacy `stable` больше не FAIL, активный без префикса — FAIL. Вопрос structure (`--145` §4) закрыт; `aliasOf` не делали |
| WC-47 | done | medium | Подсказка при сдвиге HEAD называет причину (0064, 2.6.25): артефакт задания / код исполнителя (кандидата создаёт `task-accept`) / metadata приёмки + изменённые пути (`git diff --name-only <contractCommit> HEAD`). Найдено по оркестратору 0023, который собирался коммитить код до приёмки |
| WC-43 | done | medium | Привязка ролей к узлам структуры (0068, 2.6.29): `executorNode`/`acceptorNode` в TASK-META, `actor.node` и `deviation` в записи приёмки, `task-accept` отказывает risk≥medium без узла и без причины, `task-check-acceptance` печатает `attributionGap` (legacy — warn, объявившие узел — error), `task-lint` предупреждает про acceptor-субагента без узла, `adapters/dsh.md` под политику warn, `Node: worker|judge` в письмах. Первая приёмка по схеме — сама 0068 (`actor.node: judge`) |
| WC-53 | proposed | low | Строгость attribution по версии инструмента: сейчас `task-check-acceptance` даёт warn для записей без узла, если контракт не объявлял `acceptorNode`/`deviation`. Правильнее опираться на `criteria.lock.tool >= subagent-workflow/2.6.29`: записи, сделанные новым движком, должны требовать узел или deviation строго |
| WC-54 | done | high | Сторож в пакете (0072, 2.6.31): `spec/scripts/job.mjs` — `start`/`wait`/`status`/`list`/`kill`, ожидание на файле состояния, вердикт в stdout (код фоновых заданий харнесс нормализует в 1). Кандидат `fd3ba71`, metadata `36c5411` |
| WC-55 | proposed | high | Обязательность регламента (0073): хук `tools/pre-execute` в плагине — `warn`/`fail` на `Start-Sleep ≥ 60 с`, `job_output(wait, timeout_ms > 120000)`, `project_graph_run(timeoutMs > 240000)`; notice полной v4-формы (`id`, `role`, `source.kind = 'plugin:dsh-workflow-console'`), строка «долгое ожидание» в журнал панели |
| WC-55 | done | high | Обязательность регламента (0073, 2.6.32): `plugin/lib/wait-guard.js` — детектор трёх антипаттернов ожидания и хук: `fail` через `ctx.tools.guard` (строка-причина со ссылкой на `scripts/job.mjs`), `warn` — notice полной формы v4; блок `enforcement` в шаблоне и добавление недостающих ключей в `init`. Кандидат `01fa9e66`, metadata `9f43da5` |
| WC-56 | proposed | medium | Панель «Императив»: версии движка и плагина, значения `enforcement.*`, счётчики «вне структуры» и «долгих ожиданий», последние отклонения — зелёный/красный сводкой, а не текстом |
| WC-57 | proposed | high | Плагин читает `enforcement` из `workflow.config.json` воркспейса (по `roots`), а не только из конфига DSH: сейчас политика берётся из профиля и по умолчанию `fail`, поэтому ослабить её в одном воркспейсе нельзя |
| WC-58 | done | high | Наблюдаемость императива (0074, 2.6.33): журнал долгих ожиданий `{ at, root, tool, mode, denied, reason, waitMs, budgetMs }` в `~/.dsh/workflow/waits/<hash>.jsonl`; `spec/checks/workspace-imperative.mjs` c1–c4 (сторож, версия, `waitPolicy`/`processPolicy` по наличию заданий, блок `enforcement`). Кандидат `1991959`, metadata `4d02ac0` |
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