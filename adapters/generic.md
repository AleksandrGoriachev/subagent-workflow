# Любой другой харнесс

Воротам нужен не API харнесса, а переменная окружения. Обёртка вокруг запуска агента:

~~~bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Уникальный идентификатор сессии агента. Один на запуск, разный у ролей.
export TASK_ACTOR_SESSION="agent-$1-$(date +%s)-$$"

# 2. Модель (для записи; не обязательна).
export TASK_ACTOR_MODEL="${TASK_ACTOR_MODEL:-unknown}"

exec "$@"
~~~

Пропишите `TASK_ACTOR_SESSION` как primary в конфигурации:

~~~json
{ "actor": { "primaryEnv": "TASK_ACTOR_SESSION", "modelEnv": "TASK_ACTOR_MODEL" } }
~~~

Важно: не назначайте одну переменную и постановщику, и приёмщику. Тогда ворота
честно откажут — это и есть проверка, что роли разные.

## Проверка

~~~bash
node docs/subagent-workflow/scripts/actor.mjs --risk medium
node docs/subagent-workflow/scripts/doctor.mjs --repo .
~~~

Первый должен вернуть exit 0 и `level: separate-session`.

## Если идентификатора нет

Оставьте `fallbackEnv`. Уровень будет `declared`, и medium/high не пройдут.
Это не ограничение пакета, а свойство среды: без различия сессий независимость
приёмки нечем подтвердить. Для таких проектов используйте `low` или человека с ключом.
