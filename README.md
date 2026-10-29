# subagent-workflow 2.6.5 — полный пакет делегирования и приёмки

[![ci](https://github.com/AleksandrGoriachev/subagent-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/AleksandrGoriachev/subagent-workflow/actions/workflows/ci.yml)


Спецификация, шаблоны, конфигурация, все ворота и загрузчик рабочего пространства.
Не привязан к предметной области, языку, git-хостингу и харнессу агентов.

Ключевая идея: приёмка — это запись, которую нельзя получить, не будучи тем, кем
назвался. Сессия приёмщика читается из окружения, ключ Ed25519 закреплён в
репозитории, самоприёмка отклоняется воротами и проверяется в CI.

## С нуля

~~~bash
# 0. взять пакет (этот каталог) и развернуть его в проекте
node spec/scripts/init.mjs --repo ../my-project --key-id agent-judge

# дальше — из каталога проекта
cd ../my-project
node docs/subagent-workflow/scripts/new-task.mjs --repo . --id 0001 --title "..." --risk medium
# заполнить task.md и criteria.json, затем:
git add docs/tasks/0001 checks && git commit -m "task 0001: контракт"
node docs/subagent-workflow/scripts/task-hash.mjs --task docs/tasks/0001 --write
node docs/subagent-workflow/scripts/task-lint.mjs --task docs/tasks/0001 --strict
node docs/subagent-workflow/scripts/task-red.mjs  --task docs/tasks/0001 --base HEAD
# работа исполнителя в отдельной сессии
node docs/subagent-workflow/scripts/task-verify.mjs --task docs/tasks/0001
# приёмка из ДРУГОЙ сессии
node docs/subagent-workflow/scripts/task-accept.mjs --task docs/tasks/0001 \
  --acceptor judge --key ~/.wf-keys/agent-judge.key.pem --key-id agent-judge
node docs/subagent-workflow/scripts/task-check-acceptance.mjs \
  --file docs/tasks/0001/acceptance.json --repo .
~~~

## Что внутри

| Путь | Что |
| --- | --- |
| `spec/SPEC.md` | Нормативная спецификация 2.0 |
| `spec/workflow.config.json` | Конфигурация по умолчанию (пути, логи, адаптер актора) |
| `spec/templates/` | Задание, критерии, схема записи, разбор замечаний, атака, отчёт, владение |
| `spec/scripts/init.mjs` | Развернуть пространство в проекте |
| `spec/scripts/new-task.mjs` | Создать задание |
| `spec/scripts/task-*.mjs` | Ворота: attack, hash, lint, red, verify, accept, check, regress |
| `spec/scripts/task-guard.mjs` | Коммит без задания: покрытие индекса и диапазона, аудит обходов (2.5.0) |
| `spec/hooks/` | Хуки git: `init` ставит их локальным `core.hooksPath` |
| `spec/scripts/actor.mjs` | Аттестация актора, уровень независимости |
| `spec/scripts/sign.mjs` | Ed25519, канонизация, подпись |
| `spec/scripts/lib/common.mjs` | Общая библиотека |
| `spec/selftest.mjs` | Проверка правил записи (65 проверок, включая regress-классификацию и источники актора) |
| `spec/e2e.mjs` | Полный цикл на временном репозитории |
| `spec/e2e-deploy.mjs` | Развёртывание из развёрнутого каталога (отдельная джоба CI) |
| `INSTALL.md` | Установка из архива, проверка целостности, обновление |
| `CHANGELOG.md`, `VERSION` | История и версия пакета |
| `adapters/` | Подключение харнессов: DSH, OpenCode, произвольный раннер, CI |
| `examples/minimal/` | Пример задания с намеренным дефектом |
| `tools/pack.mjs`, `tools/verify.mjs` | Сборка архива и проверка контрольных сумм |
| `deploy/AGENT-DEPLOY.md` | Инструкция агенту по разворачиванию |
| `reports/` | Локальные отчёты по проектам (в пакет и репозиторий не входят) |

## Плагин DSH (отдельный пакет)

`plugin/` — панель для DSH (`dsh-workflow-console`): доска задач, карточка,
политика. У панели ровно две записи, обе по явному подтверждению: кнопка
«Включить/выключить проверку коммитов» пишет `guard.enabled` в
`workflow.config.json` и строку в `guard.log` (оба перехода, с временем и
сессией), а кнопка «Развернуть workflow здесь» ставит движок в открытое
пространство и создаёт ключ приёмщика **проекта** в `<repo>/.wf-keys/`
(глобальный `~/.wf-keys` не трогается). `POST /api/guard` и `/api/deploy`
принимают только `application/json` и только свой `Origin`. В релизный архив не
входит, а `init` копирует только `spec/`, поэтому в развёрнутое пространство
плагин не попадает: это хост-пакет, а не часть переносимой спецификации.
Установка и границы — `plugin/README.md`.

## Конфигурация

`docs/subagent-workflow/workflow.config.json` после `init`:

| Поле | Смысл |
| --- | --- |
| `tasksDir` | Где лежат задания |
| `keysFile` | `acceptors.json` с публичными ключами |
| `logs` | `local` (логи не коммитятся, хешей нет) или `commit` |
| `actor.sources` | Цепочка источников актора: `[{ env, kind }]`, `kind` — `harness` / `runner` / `ci` / `manual`; первый непустой побеждает (2.6.0) |
| `actor.modelSources` | Цепочка переменных модели; первая непустая, иначе `unknown` (2.6.0) |
| `actor.primaryEnv` | Legacy: переменная с сессией агента (DSH: `DSH_SESSION_ID`); без `sources` — вид `harness` |
| `actor.fallbackEnv` | Legacy: запасная переменная (вид `manual`, уровень `declared`) |
| `policy` | `fail` / `warn` / `off` для `decisions`, `coverage`, `attack`, `roles.modelFamily` |
| `models` | Реестр «модель → семейство» для проверки «другой агент» |
| `roles` | Ожидаемые модели ролей: acceptor, critic, observer |
| `verifyTimeoutMs` | Бюджет свежего прогона при приёмке |
| `guard` | `enabled`, `mode`, `allow`, `bypassMarker`: проверка коммита без задания (2.5.0) |

С 2.6.0 источник актора — настраиваемая цепочка, а не два жёстких имени. DSH —
один из видов (`harness`), обёртка проекта — `runner`, джоба CI — `ci`, ручное
значение — `manual`. `harness` и `runner` дают `separate-session`,
`ci` и `manual` — только `declared`. Основание пишется в запись
(`actor.source`, `actor.sourceKind`, `independence.basis`), а
`task-check-acceptance` сверяет вид с уровнем. Legacy-поля
`primaryEnv`/`fallbackEnv` продолжают работать: без `sources` они
синтезируются как `harness` и `manual`.

## Атака спецификации и политика (2.2.0)

До замка контракта критик в отдельной сессии ищет в задании дыры: чего нет,
где критерий неоднозначен, какой режим отказа не объявлен. Находки — в
`attack.json`; `blocking` без `resolution` не даёт запереть контракт.

~~~json
"policy": { "decisions": "fail", "coverage": "fail", "attack": "off",
            "roles": { "modelFamily": "warn" } },
"models": { "deepseek-v4.1-flash": "deepseek", "glm-5.3-flash": "zhipu" },
"roles": { "acceptor": { "model": "glm-5.3-flash", "mustDifferFromIssuer": "family" } }
~~~

Строгость выбирает репозиторий: `off` — не проверять, `warn` — писать факт и
предупреждать, `fail` — отказывать. Факты о моделях (`actor.family`,
`independence.modelLevel`, `attack.*`) попадают в запись независимо от режима.
Целостность записи (самоприёмка, подпись, хеши) политикой не отключается.

Пример цикла с атакой:

~~~bash
node scripts/task-attack.mjs --task docs/tasks/0001 --prompt   # задание критику
node scripts/task-attack.mjs --task docs/tasks/0001 --init     # скелет
node scripts/task-attack.mjs --task docs/tasks/0001 --check    # проверка находок
node scripts/task-hash.mjs    --task docs/tasks/0001 --write
~~~

## Коммит без задания (2.5.0)

Ворота проверяют задание, но не мешают изменению попасть в историю мимо него.
`task-guard` стоит на границе коммита и пуша:

~~~bash
node docs/subagent-workflow/scripts/task-guard.mjs --repo . --staged
node docs/subagent-workflow/scripts/task-guard.mjs --repo . --staged --message "task 0003: ..."
node docs/subagent-workflow/scripts/task-guard.mjs --repo . --range origin/main..HEAD
node docs/subagent-workflow/scripts/task-guard.mjs --repo . --audit --range HEAD~3..HEAD
~~~

~~~json
"guard": { "enabled": true, "mode": "fail", "allow": ["docs/**"],
           "bypassMarker": "workflow-bypass" }
~~~

- **Покрытие считается по дереву того коммита, где лежит изменение, а не по
  текущему рабочему дереву.** Иначе после приёмки `acceptance.json` закрывал бы
  задание задним числом, и штатный порядок «приёмка → коммит → пуш» ломался бы
  собственным хуком (дефект P1 задания 0004).
- Путь покрыт, если он входит в `allowedPaths` задания, активного в этом коммите
  (`criteria.lock` есть, `acceptance.json` нет); лежит в каталоге задания
  `docs/tasks/<id>/**` (пока задание открыто — весь каталог, после закрытия —
  только его артефакты: `acceptance.json`, отчёты, `verify`/`red`,
  `criteria.lock`); входит в `guard.allow`; либо в сообщении коммита есть метка
  обхода.
- `--range` оценивает каждый коммит диапазона отдельно и читает метку обхода из
  его сообщения: у push нет `--message` (дефект P2). `--staged` сравнивает
  индекс с рабочим деревом, сообщение создаваемого коммита передаёт `commit-msg`.
- `enabled !== true` — скрипт молчит и выходит 0: выключенный guard не меняет
  поведение репозитория.
- Непокрытый путь: exit 1 и строка `не покрыт: <путь>` с подсказкой.
- `--audit` всегда exit 0 и печатает найденные метки обхода и нарушения.
- `init` ставит `pre-commit`, `commit-msg` и `pre-push` и **локальный**
  `core.hooksPath docs/subagent-workflow/hooks`; глобальный конфиг не трогается,
  повторный `init` идемпотентен. Решение принимает `commit-msg`: git отдаёт
  сообщение коммита только ему.
- Панель переключает флаг для текущего пространства с подтверждением и пишет
  строку в `guard.log`.

**Пределы.** `git commit --no-verify` и `git push --no-verify` пропускают хуки
целиком — в аудите этого следа не остаётся. Проверка локальная: это не
pre-receive и не защита от владельца машины. Метка обхода не запрещается —
`--audit` её печатает.

## Решения и покрытие (2.1.0)

Семантический выбор («что считается доставкой») нельзя проверить командой — значит,
он должен быть виден и либо подтверждён, либо закрывать выпуск:

~~~json
{ "id": "D1", "class": "semantic", "question": "что считается доставкой",
  "chosen": "квитанция о получении", "options": ["отправка", "квитанция"],
  "impact": "user-visible", "reversible": false,
  "evidence": { "kind": "criterion", "ref": "C3" }, "status": "confirmed" }
~~~

- `semantic`/`contract` без критерия и без `confirmation` человека — ошибка lint;
  с `status: "assumed"` — приёмка есть, `releaseReady=false`;
- `covers` у критерия говорит, какие файлы он покрывает; `verify` валит изменённый
  файл, на который критерия нет;
- user-visible решение с `evidence.kind=criterion` обязано ссылаться на носитель или
  измеритель эффекта (I-34); `spec`/`customer`/`human`/manual — исключения;
- запись версии 5 хранит digest решений, и `check` пересчитывает его по контракту.

## Замечания приёмщика (1.4.1)

«Принято с замечаниями» — не «готово к выкатке». Замечания классифицируются
(`blocking` / `non-blocking` / `follow-up`), решение фиксируется в `review.json`
и попадает в запись. `task-accept --review review.json` отказывает, если `blocking`
без `resolution`; `releaseReady` вычисляется и проверяется в CI.

## Уровни независимости

`declared` → `separate-session` → `human`. `low` допускает первый с записью
обхода, `medium` требует второй, `high` — третий с ключом `human-*`.

## Проверено

~~~bash
node spec/selftest.mjs     # SELFTEST OK (51 проверка)
node spec/e2e.mjs          # E2E OK (41): атака → init → задача → красный → фикс → приёмка → check
node spec/e2e-deploy.mjs   # DEPLOY E2E OK (23): init из развёрнутого каталога
~~~

E2E включает отказ самоприёмке из сессии постановщика и проверку metadata-коммита.

## Чего пакет не делает

Не доказывает, что за клавиатурой сидел человек, и не защищает от владельца машины:
если приватный ключ доступен процессу агента, подпись — tamper-evidence. Так же и
guard: `--no-verify` обходит локальные хуки целиком, а аудит показывает только
явные метки. Реальный
уровень независимости честно записывается в `independence.level` и проверяется
правилами риска.

## Лицензия

MIT — см. [LICENSE](LICENSE). Пакет можно брать, менять и разворачивать в своих
репозиториях; ссылка на исходный репозиторий приветствуется, но не требуется.
