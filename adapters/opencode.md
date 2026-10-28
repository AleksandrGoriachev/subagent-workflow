# OpenCode

OpenCode — открытый агентный клиент для терминала. Он не выдаёт воротам
собственный идентификатор сессии: в окружении инструментов нет переменной,
которую можно было бы честно назвать «сессией агента». Поэтому источник актора
задаёт обёртка проекта — вид `runner`. DSH для этого не нужен: пакет с 2.6.0
работает с любой обёрткой, которая выставляет переменную.

## Обёртка

`scripts/agent-session.sh` в проекте:

~~~bash
#!/usr/bin/env bash
set -euo pipefail

role="${1:?роль: issuer|executor|acceptor|critic}"
shift

# Одна сессия на запуск, своя у каждой роли.
export WF_ACTOR_SESSION="opencode-${role}-$(date +%s)-$$"

# Модель — для записи и проверки ролей; не обязательна.
export WF_ACTOR_MODEL="${WF_ACTOR_MODEL:-unknown}"

exec opencode "$@"
~~~

Запуск ролей — отдельными процессами обёртки:

~~~bash
./scripts/agent-session.sh issuer
./scripts/agent-session.sh executor
./scripts/agent-session.sh acceptor    # отдельная сессия: приёмка, а не отчёт
~~~

Разные роли — разные запуски. Если приёмщик унаследует сессию постановщика,
ворота откажут: это и есть проверка того, что роли разные.

## Конфигурация

`docs/subagent-workflow/workflow.config.json`:

~~~json
"actor": {
  "sources": [{ "env": "WF_ACTOR_SESSION", "kind": "runner" }],
  "modelSources": ["WF_ACTOR_MODEL"]
}
~~~

В шаблоне пакета `WF_ACTOR_SESSION` уже стоит видом `runner`, а DSH — первым
(вид `harness`). Если DSH в проекте не используется, оставьте только
runner-запись: иначе унаследованный `DSH_SESSION_ID` победит как первый
непустой источник — формально это корректно (сессия есть), но основание в
записи будет `harness`, а не `runner`.

## Проверка

~~~bash
node docs/subagent-workflow/scripts/actor.mjs --risk medium
node docs/subagent-workflow/scripts/doctor.mjs --repo .
~~~

Ожидаемо: exit 0, `attestedBy: "env"`, `source: "WF_ACTOR_SESSION"`,
`sourceKind: "runner"`, `basis: "runner"`, `level: "separate-session"`; у
`doctor` — PASS «актор виден окружению» с деталью `WF_ACTOR_SESSION (runner) /
<сессия>`. Пустое окружение даёт `none`/`declared`, и `doctor` красный — это
контроль, а не поломка.

## Приёмка

1. Контракт и красный прогон — в сессии постановщика/исполнителя.
2. Приёмка — отдельным запуском обёртки с ролью `acceptor` (новая сессия) и
   ключом приёмщика:

~~~bash
./scripts/agent-session.sh acceptor
node docs/subagent-workflow/scripts/task-accept.mjs --task docs/tasks/0001 \
  --acceptor judge --key ~/.wf-keys/agent-judge.key.pem --key-id agent-judge
~~~

3. Отчёт исполнителя приёмщику до прогона не показывать: `task-accept` сам
   запускает проверки, читает запись и создаёт кандидатный коммит.

## Модели ролей

`WF_ACTOR_MODEL` выставляется обёрткой (или берётся из окружения). Если модель
неизвестна, в записи будет `independence.modelLevel: "unknown"` — политику
`policy.roles.modelFamily: fail` в таком проекте включать нельзя: она откажет
честной приёмке.

## Если обёртки нет

Без переменной остаётся `manual`-источник (`TASK_ACTOR_SESSION`): ворота
честно запишут `attestedBy: declared`, и medium/high не пройдут. Это свойство
среды, а не ограничение пакета: `low` или человек с ключом `human-*` — рабочие
варианты.
