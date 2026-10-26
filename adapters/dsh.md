# DSH

## Идентификатор

DSH выставляет `DSH_SESSION_ID` каждому агенту, и переменная доходит до дочерних
процессов. Проверено экспериментом: у субагента свой UUID, у родителя — свой.

~~~bash
node docs/subagent-workflow/scripts/actor.mjs --json
~~~

Ожидаемо: `attestedBy: "env"`, непустой `session`.

## Как запускать роли

- Исполнитель — `subagent` с `cwd` репозитория; **не** `subagent_fork` (нужен свежий контекст).
- Приёмщик — отдельный `subagent`, которому дают задание, критерии, замок и
  репозиторий, но **не отчёт** исполнителя до прогона.
- Приёмка запускается внутри сессии приёмщика: `task-accept` увидит её
  `DSH_SESSION_ID` и откажется, если он совпал с `issuedBy`.

## Модели ролей (2.2.0)

Модель задаётся не воротами, а профилем DSH: `agent-default-model`
(`provider`, `model`) и список моделей провайдера. Чтобы приёмщик или критик
работал другой моделью:

1. **Отдельная сессия с выбранной моделью** — если GUI позволяет выбрать модель
   при создании сессии. У `subagent` параметра модели нет: субагент наследует
   модель родителя, поэтому «другой агент» — это отдельная сессия.
2. **Отдельный профиль** — `~/.dsh/profiles/<role>` с собственным
   `agent-default-model`; DSH запускается этим профилем, у роли своя модель и
   своя сессия.

В `workflow.config.json` роль описывается так:

~~~json
"models": { "deepseek-v4.1-flash": "deepseek", "glm-5.3-flash": "zhipu" },
"roles": {
  "acceptor": { "model": "glm-5.3-flash", "mustDifferFromIssuer": "family" },
  "critic":   { "model": "glm-5.3-flash", "mustDifferFromIssuer": "family" }
},
"policy": { "roles": { "modelFamily": "warn" } }
~~~

Ворота читают `DSH_MODEL` и сверяют семейство по реестру `models`. Это
декларация харнесса, а не доказательство: `DSH_MODEL` можно подделать так же,
как `DSH_SESSION_ID`. Поэтому факт записывается в запись (`actor.family`,
`independence.modelLevel`, `attack.*`), а строгость — `policy.roles.modelFamily`.

## Ключи

- `agent-*` — на машине приёмщика, в `~/.wf-keys` (вне репозитория).
- `human-*` — у человека, отдельная учётная запись/хранилище, не в окружении агента.

## Чего DSH не даёт

Разделения прав между агентами: субагент наследует каталог и права, родитель может
переписать его артефакты. Поэтому подпись — tamper-evidence, а не доказательство
независимости; настоящая граница только у ключа человека.

## Известная проблема: Kaspersky и «open in app»

Kaspersky Endpoint Security (Адаптивный контроль аномалий) может блокировать не ворота,
а сам DSH. При показе файлов плагин `open-in-app` создаёт
`%TEMP%\dsh-native-command-*\associations.ps1` и запускает `powershell.exe` 5.1 с
`Add-Type`/P-Invoke (`SHAssocEnumHandlers`). Правило «PowerShell обращается к Native API»
срабатывает на этот скрипт: в Kaspersky Event Log событие 501, исходный процесс —
`associations.ps1`.

К воротам это отношения не имеет: `task-accept` запускает Node и pwsh 7, `Add-Type`
не использует. Варианты:

- отключить `open-in-app` в профиле DSH (`- id: open-in-app` / `ui-open-in-app`,
  `disabled: true`) и перезапустить DSH;
- либо добавить `DeepSeek Harness.exe` в доверенные приложения Kaspersky, чтобы
  дочерние скрипты не контролировались (функция «open in app» сохранится).
