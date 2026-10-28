# OpenCode

OpenCode — открытый агентный клиент для терминала. Сам по себе он не выставляет
воротам идентификатор сессии: в OpenCode V2 нет хука `shell.env`, который
подмешивал бы переменные в окружение запускаемых команд. Поэтому источник актора
задают одним из двух способов, и оба дают `attestedBy: env`:

1. **Плагин сессии (OpenCode V2).** `~/.config/opencode/plugins/wf-session.ts`
   перекладывает идентификатор сессии из события инструмента в окружение shell:
   хук `tool.execute.before` приносит `sessionID`, хук `shell.create.before`
   получает его в env создаваемой команды как `DSH_SESSION_ID` (вид
   `harness`). Имя переменной — конвенция пакета (2.6.0), DSH для неё не нужен.
2. **Обёртка проекта.** `scripts/agent-session.sh` выставляет
   `WF_ACTOR_SESSION` (вид `runner`). Годится и там, где плагин не установлен.

DSH для этого не нужен: пакет с 2.6.0 работает с любым механизмом, который
выставляет переменную.

## Плагин сессии (OpenCode V2)

Плагин кладут в глобальный каталог плагинов клиента:

~~~text
~/.config/opencode/plugins/wf-session.ts
~~~

Поток данных:

1. `tool.execute.before` получает вызов инструмента и его `sessionID` —
   идентификатор текущей сессии агента;
2. плагин запоминает идентификатор и в `shell.create.before` добавляет его в env
   создаваемой команды как `DSH_SESSION_ID`;
3. ворота, запущенные из этой команды (`node docs/subagent-workflow/scripts/…`),
   видят сессию источником `harness` — как если бы её выдал сам харнесс.

Конфигурация в этом варианте — harness-источник:

~~~json
"actor": {
  "sources": [{ "env": "DSH_SESSION_ID", "kind": "harness" }],
  "modelSources": ["DSH_MODEL", "WF_ACTOR_MODEL"]
}
~~~

Разные роли — разные сессии OpenCode: `sessionID` один на сессию, поэтому
приёмка в сессии постановщика или исполнителя будет отклонена как самоприёмка.
Это ожидаемое поведение, а не поломка плагина.

### Если `DSH_SESSION_ID` пуст

1. Посмотрите лог OpenCode: при неудачной загрузке плагина там есть WARN —
   опечатка в пути, синтаксическая ошибка TypeScript, недоступный каталог
   плагинов.
2. Перезагрузите плагины командой `/reload` в сессии или перезапустите
   приложение: правка файла плагина без перезагрузки не действует.
3. Проверьте, что видят ворота:

~~~bash
node docs/subagent-workflow/scripts/actor.mjs --risk medium
~~~

Ожидаемо: `source: "DSH_SESSION_ID"`, `sourceKind: "harness"`,
`attestedBy: "env"`, `level: "separate-session"`. Если по-прежнему `none`,
плагин не загрузился; до починки работает обёртка ниже.

## Обёртка (альтернатива)

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

Runner-вариант (обёртка):

~~~json
"actor": {
  "sources": [{ "env": "WF_ACTOR_SESSION", "kind": "runner" }],
  "modelSources": ["WF_ACTOR_MODEL"]
}
~~~

Порядок в `actor.sources` — это приоритет: побеждает первый непустой источник.
Если работает плагин, первым ставьте `DSH_SESSION_ID` (вид `harness`); если
только обёртка — `WF_ACTOR_SESSION` (вид `runner`). Иначе основание в записи
будет не тем, чем вы подтверждаете сессию: формально верно, но при разборе
`independence.basis` вводит в заблуждение.

## Проверка

~~~bash
node docs/subagent-workflow/scripts/actor.mjs --risk medium
node docs/subagent-workflow/scripts/doctor.mjs --repo .
~~~

Ожидаемо: exit 0, `attestedBy: "env"`, `basis` совпадает с видом источника
(`harness` для плагина, `runner` для обёртки), `level: "separate-session"`;
у `doctor` — PASS «актор виден окружению» с деталью `<переменная> (<вид>) /
<сессия>`. Пустое окружение даёт `none`/`declared`, и `doctor` красный — это
контроль, а не поломка. С 2.6.2 `doctor` в этом случае печатает ещё и WARN с
рецептом: источник в `actor.sources` или плагин сессии OpenCode V2.

## Приёмка

1. Контракт и красный прогон — в сессии постановщика/исполнителя.
2. Приёмка — в отдельной сессии: с плагином это новая сессия OpenCode, с
   обёрткой — отдельный процесс `./scripts/agent-session.sh acceptor`. Ключ
   приёмщика:

~~~bash
node docs/subagent-workflow/scripts/task-accept.mjs --task docs/tasks/0001 \
  --acceptor judge --key ~/.wf-keys/agent-judge.key.pem --key-id agent-judge
~~~

3. Отчёт исполнителя приёмщику до прогона не показывать: `task-accept` сам
   запускает проверки, читает запись и создаёт кандидатный коммит.

## Модели ролей

Модель берётся из `actor.modelSources` (первый непустой), иначе — `unknown`.
Плагин сессии мостит только идентификатор сессии; модель выставляет обёртка
(`WF_ACTOR_MODEL`) или окружение клиента. Если модель неизвестна, в записи будет
`independence.modelLevel: "unknown"` — политику `policy.roles.modelFamily: fail`
в таком проекте включать нельзя: она откажет честной приёмке.

## Если ничего не настроено

Без переменной остаётся `manual`-источник (`TASK_ACTOR_SESSION`): ворота
честно запишут `attestedBy: declared`, и medium/high не пройдут. Это свойство
среды, а не ограничение пакета: `low` или человек с ключом `human-*` — рабочие
варианты.
