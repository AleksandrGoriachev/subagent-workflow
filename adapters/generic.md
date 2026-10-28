# Любой другой харнесс

Воротам нужен не API харнесса, а переменная окружения. Обёртка вокруг запуска агента:

~~~bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Уникальный идентификатор сессии агента. Один на запуск, разный у ролей.
export WF_ACTOR_SESSION="agent-$1-$(date +%s)-$$"

# 2. Модель (для записи; не обязательна).
export WF_ACTOR_MODEL="${WF_ACTOR_MODEL:-unknown}"

exec "$@"
~~~

Пропишите источник в конфигурации — вид `runner` даёт `separate-session` без DSH:

~~~json
{ "actor": {
    "sources": [{ "env": "WF_ACTOR_SESSION", "kind": "runner" }],
    "modelSources": ["WF_ACTOR_MODEL"] } }
~~~

Имя переменной выбираете вы: `WF_ACTOR_SESSION` — лишь пример, совпадающий с
шаблоном пакета. Одна и та же переменная у постановщика и приёмщика запрещена:
тогда ворота честно откажут — это и есть проверка, что роли разные.

## Виды источника

| `kind` | Что даёт | `attestedBy` | Уровень |
| --- | --- | --- | --- |
| `harness` | харнесс сам выдаёт сессию (DSH) | `env` | `separate-session` |
| `runner` | обёртка проекта выдаёт сессию | `env` | `separate-session` |
| `ci` | идентификатор джобы | `declared` | `declared` |
| `manual` | значение выставлено руками или скриптом | `declared` | `declared` |

Вид — это заявление о границе доверия, а не ярлык. `ci` и `manual` никогда не
дают `separate-session`: medium/high ими не принимаются. Неизвестный вид —
ошибка конфигурации (`doctor` красный, `task-accept` отказывает).

## Проверка

~~~bash
node docs/subagent-workflow/scripts/actor.mjs --risk medium
node docs/subagent-workflow/scripts/doctor.mjs --repo .
~~~

Первый должен вернуть exit 0, `level: separate-session`, `source` с именем вашей
переменной, `sourceKind: "runner"` и `basis: "runner"`.

## Если идентификатора нет

Оставьте `manual`-источник (например `TASK_ACTOR_SESSION`) или legacy
`fallbackEnv`. Уровень будет `declared`, и medium/high не пройдут. Это не
ограничение пакета, а свойство среды: без различия сессий независимость приёмки
нечем подтвердить. Для таких проектов используйте `low` или человека с ключом.

## Legacy-конфиг

Конфиг без `sources` поведения не меняет: `primaryEnv` считается `harness`,
`fallbackEnv` — `manual`. Переход на `sources` можно делать постепенно.
