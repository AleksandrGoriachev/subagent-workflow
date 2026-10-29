# Задание 0025. Панель 0.8.0: версии и обновление движка с защитой от незавершённых заданий

<!-- TASK-META
{
  "id": "0025",
  "version": 1,
  "title": "панель 0.8.0: версии движка, обновление с защитой от незавершённых заданий",
  "risk": "medium",
  "created": "2026-10-29",
  "owner": "архитектор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "issuedBy": {
    "kind": "agent",
    "session": "session-b8721a2a-456c-48a2-94cd-8030d895a8e8",
    "model": "deepseek-v4.1-flash"
  },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "plugin/**",
    "spec/checks/acceptance-schema.mjs",
    "spec/checks/panel-deploy.mjs",
    "spec/scripts/lib/common.mjs",
    "spec/SPEC.md",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "RELEASE-CHECKLIST.md",
    ".github/workflows/ci.yml",
    "tools/pack-plugin.mjs"
  ],
  "protectedPaths": [
    "spec/checks/update-flow.mjs",
    "docs/tasks/0025/task.md",
    "docs/tasks/0025/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0021/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "impact": "internal",
      "question": "Что делает панель при незавершённых заданиях",
      "chosen": "отказывает обновление с кодом tasks-in-progress и списком; продолжает только при явном allowInProgress (галочка «понимаю риск»)",
      "options": [
        "обновлять молча",
        "блокировать всегда",
        "блокировать с явным подтверждением"
      ],
      "reversible": true,
      "status": "confirmed",
      "confirmation": {
        "kind": "customer",
        "who": "заказчик",
        "at": "2026-10-29"
      }
    },
    {
      "id": "D2",
      "class": "mechanical",
      "impact": "internal",
      "question": "Как выполняется init при обновлении",
      "chosen": "асинхронный spawn с потоковым логом и таймаутом, без блокировки event loop; ключи проекта не трогаются",
      "options": [
        "spawnSync как сейчас",
        "асинхронный spawn"
      ],
      "reversible": true
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

> Заменяет аннулированные 0021/0022/0023/0024. Последний дефект: `tools/pack-plugin.mjs` менялся,
> но не был в `allowedPaths`.

## Цель

Панель должна показывать установленную версию движка и доступную (вложенную в плагин), уметь обновить движок в текущем workspace и **предупреждать, что при незавершённых заданиях обновление может сломать их проверку**.

## Зачем

1. Сейчас кнопка умеет только развернуть в пустой проект; на развёрнутом — `already-deployed`, обновиться из панели нельзя.
2. `spawnSync` блокирует event loop DSH до 180 с (ночное ревью, п. 2).
3. Обновление движка меняет гейты и `workflow.config.json`; у незавершённого задания `criteria.lock` помнит `tool`, а критерии могут зависеть от поведения ворот (`redExpect`, `covers`, правила эффекта). Проверка посреди обновления может читать смешанные версии скриптов. Поэтому обновление по умолчанию **блокируется**, пока есть задания без записи приёмки.

## Что не входит

1. Установка/обновление самого плагина (это карточка `structure`, схема v2).
2. Сверка `acceptance.json` с заданием и подписью — отдельное задание.
3. Изменение правил ворот — спека только получает номер 2.6.5 и абзац.

## Инварианты

1. **Незавершённое задание — стоп.** `updateWorkflow` возвращает `{ ok:false, code:'tasks-in-progress', tasks:[...] }`, если в `docs/tasks/<id>` есть `task.md`/`criteria.lock`/`red.json`/`verify.json` без валидной записи `acceptance.json` (`status: accepted`). Продолжение — только с `allowInProgress: true`.
2. **Ключи не трогаются.** `acceptors.json` и `<repo>/.wf-keys/` остаются байт в байт; глобальный `%USERPROFILE%\.wf-keys` не создаётся.
3. **Идемпотентность.** Если версия уже равна вложенной — `{ ok:false, code:'up-to-date', version }`.
4. **Журнал.** Каждое развёртывание/обновление пишет строку в `docs/subagent-workflow/deploy.log`: время, from → to, актор (если есть), результат.
5. **POST /api/update** — `confirm: true` обязателен, только `application/json` (415), только свой `Origin` (403), корень из `selectRoot`; `allowInProgress` — отдельное поле.
6. **Без блокировки event loop**: `init` запускается асинхронно, ответ отдаётся по завершении, остальные маршруты живы.
7. `spec/checks/update-flow.mjs`, `docs/tasks/0025/{task.md,criteria.json}`, `acceptance.json`, `criteria.lock`, `red.json` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/update-flow.mjs`; полный набор — `node spec/selftest.mjs`, `node spec/e2e.mjs`, `node plugin/tools/test.mjs`, `node spec/checks/acceptance-schema.mjs`, `node tools/check-version.mjs`.

## Среда

- Node.js, Windows; проверка подменяет `HOME`/`USERPROFILE`.

## Что сделать

1. **`plugin/lib/deploy.js`** — `tasksInProgress(root)` (список незавершённых заданий) и `updateWorkflow(root, { specRoot, allowInProgress, timeoutMs })`: коды `not-found`/`not-a-repo`/`not-deployed`/`up-to-date`/`tasks-in-progress`/`init-failed`; обновление через `init --force` с `--key-out <repo>/.wf-keys`; асинхронный spawn; строка в `deploy.log`; ключи не трогаются.
2. **`plugin/lib/api.js`** — `POST /api/update` по правилам инварианта 5; общие проверки content-type/Origin — те же, что у guard/deploy.
3. **`plugin/lib/client.js`** — в пустом состоянии «Развернуть», на развёрнутом — «Обновить движок» с текущей и доступной версией; диалог предупреждает о незавершённых заданиях (перечислить ID) и требует галочку «понимаю риск»; прогресс и результат с хвостом лога; версия в шапке панели.
4. **`plugin/package.json`** — версия `0.8.0`, `files` включает `LICENSE`; добавить `plugin/LICENSE` (MIT, текст пакета).
5. **`plugin/lib/compat.js`** — `PLUGIN_VERSION = '0.8.0'`.
6. **`tools/pack-plugin.mjs`** — vendor-спека берётся из `spec/` (уже), проверка tarball дополняется `LICENSE`.
7. **`spec/checks/acceptance-schema.mjs`, `panel-deploy.mjs`** — ожидания из манифеста (без литералов), плюс `LICENSE` в files.
8. **`spec/SPEC.md`** — «Версия: 2.6.5», абзац «Версия 2.6.5:» (обновление движка: версии, guard по незавершённым заданиям, журнал, асинхронность); версия 2.6.5 в `VERSION`, `package.json`, первой строке `README.md`, `TOOL` в `spec/scripts/lib/common.mjs`; секция `## 2.6.5` в `CHANGELOG.md`.
9. **`.github/workflows/ci.yml`** — шаг `node spec/checks/update-flow.mjs`; `RELEASE-CHECKLIST.md` — пункт про обновление и LICENSE.
10. **Тесты плагина** — `/api/update`: без confirm 400, 415, 403, `tasks-in-progress` 409 и `allowInProgress` 200, `up-to-date` 200/409; клиент — обе кнопки и текст предупреждения.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/update-flow.mjs | exit 0, в выводе UPDATE FLOW OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node plugin/tools/test.mjs | exit 0, в выводе fail 0 |
| C5 | node spec/checks/acceptance-schema.mjs | exit 0 |
| C6 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.5 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где.
2. Вывод каждой проверки целиком (C1–C6).
3. `git status --short`, `git diff --stat`.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт `task-accept`; пуш и теги — архитектор.
