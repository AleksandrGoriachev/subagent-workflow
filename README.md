# subagent-workflow 2.0.1 — полный пакет делегирования и приёмки

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
| `spec/templates/` | Задание, критерии, схема записи, разбор замечаний, отчёт, владение |
| `spec/scripts/init.mjs` | Развернуть пространство в проекте |
| `spec/scripts/new-task.mjs` | Создать задание |
| `spec/scripts/task-*.mjs` | Ворота: hash, lint, red, verify, accept, check |
| `spec/scripts/actor.mjs` | Аттестация актора, уровень независимости |
| `spec/scripts/sign.mjs` | Ed25519, канонизация, подпись |
| `spec/scripts/lib/common.mjs` | Общая библиотека |
| `spec/selftest.mjs` | Проверка правил записи (10 сценариев) |
| `spec/e2e.mjs` | Полный цикл на временном репозитории |
| `INSTALL.md` | Установка из архива, проверка целостности, обновление |
| `CHANGELOG.md`, `VERSION` | История и версия пакета |
| `adapters/` | Подключение харнессов: DSH, произвольный раннер, CI |
| `examples/minimal/` | Пример задания с намеренным дефектом |
| `tools/pack.mjs`, `tools/verify.mjs` | Сборка архива и проверка контрольных сумм |
| `deploy/AGENT-DEPLOY.md` | Инструкция агенту по разворачиванию |
| `reports/` | Локальные отчёты по проектам (в пакет и репозиторий не входят) |

## Конфигурация

`docs/subagent-workflow/workflow.config.json` после `init`:

| Поле | Смысл |
| --- | --- |
| `tasksDir` | Где лежат задания |
| `keysFile` | `acceptors.json` с публичными ключами |
| `logs` | `local` (логи не коммитятся, хешей нет) или `commit` |
| `actor.primaryEnv` | Переменная с сессией агента (DSH: `DSH_SESSION_ID`) |
| `actor.fallbackEnv` | Запасная переменная (уровень `declared`) |
| `verifyTimeoutMs` | Бюджет свежего прогона при приёмке |

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
node spec/selftest.mjs   # SELFTEST OK
node spec/e2e.mjs        # E2E OK: init → задача → красный → фикс → приёмка → check
~~~

E2E включает отказ самоприёмке из сессии постановщика и проверку metadata-коммита.

## Чего пакет не делает

Не доказывает, что за клавиатурой сидел человек, и не защищает от владельца машины:
если приватный ключ доступен процессу агента, подпись — tamper-evidence. Реальный
уровень независимости честно записывается в `independence.level` и проверяется
правилами риска.
