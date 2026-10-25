# Установка пакета

Пакет — это каталог `subagent-workflow-2.0.0/` (или zip с ним). Зависимостей нет:
нужны Node.js 20+ и git. Сеть не требуется.

## 1. Проверить архив

~~~bash
sha256sum -c subagent-workflow-2.0.0.zip.sha256
# Windows PowerShell 7:
Get-FileHash .\subagent-workflow-2.0.0.zip -Algorithm SHA256
~~~

## 1a. Или клонировать

~~~bash
git clone https://github.com/AleksandrGoriachev/subagent-workflow.git
cd subagent-workflow
~~~

## 2. Распаковать

~~~bash
unzip subagent-workflow-2.0.0.zip
cd subagent-workflow-2.0.0
node tools/verify.mjs
~~~

Внутри: `spec/` (спецификация, ворота, шаблоны), `adapters/` (харнессы),
`deploy/` (runbook), `examples/` (пример задания), `tools/` (сборка пакета).

## 3. Развернуть в проекте

~~~bash
node spec/scripts/init.mjs --repo ../my-project --key-id agent-judge
~~~

`init` создаёт `docs/subagent-workflow/` в проекте, каталог заданий, правило
`.gitignore`, конфигурацию и ключ приёмщика в `~/.wf-keys`.

## 4. Проверить

~~~bash
cd ../my-project
node docs/subagent-workflow/scripts/doctor.mjs --repo .
node docs/subagent-workflow/scripts/actor.mjs --risk medium
~~~

Ожидаемо: `DOCTOR OK` и exit 0 у второго. Если актор `declared` — см.
`adapters/` и настройте `actor.primaryEnv`.

## 5. Первое задание

~~~bash
node docs/subagent-workflow/scripts/new-task.mjs --repo . --id 0001 \
  --title "Первый результат" --risk medium
# заполнить criteria.json, закоммитить контракт
~~~

Дальше — `deploy/AGENT-DEPLOY.md` или раздел 0.1 спецификации.

## Обновление

Распакуйте новую версию и повторите:

~~~bash
node spec/scripts/init.mjs --repo ../my-project --force
~~~

`--force` перезаписывает скрипты и шаблоны, но не удаляет задания и записи.
`acceptors.json` можно сохранить: ключи не зависят от версии пакета.

## Удаление

Удалите `docs/subagent-workflow/` и правила из `.gitignore`. Записи `acceptance.json`
остаются историей репозитория; их не удаляют.
