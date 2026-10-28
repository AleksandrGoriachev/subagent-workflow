# Задание 0014. Панель 0.7.0: кнопка «Развернуть workflow здесь»

<!-- TASK-META
{
  "id": "0014",
  "version": 1,
  "title": "панель 0.7.0: кнопка «Развернуть workflow здесь»",
  "risk": "medium",
  "created": "2026-10-28",
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
    "tools/pack-plugin.mjs",
    "spec/checks/**",
    ".github/workflows/ci.yml",
    "RELEASE-CHECKLIST.md",
    "docs/tasks/0014/**"
  ],
  "protectedPaths": [
    "spec/checks/panel-deploy.mjs",
    "docs/tasks/0014/task.md",
    "docs/tasks/0014/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0014/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "impact": "internal",
      "question": "Откуда панель берёт спеку для развёртывания",
      "chosen": "спека вкладывается в tarball плагина (vendor/spec) при сборке; установка без сети, версия движка = версия tarball",
      "options": [
        "скачивать zip последнего релиза",
        "вкладывать спеку в tarball",
        "брать путь из настроек"
      ],
      "reversible": true,
      "evidence": {
        "kind": "criterion",
        "ref": "C1"
      }
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Куда разворачивается движок",
      "chosen": "только в корень открытого workspace (selectRoot по runtime.roots), не из тела запроса",
      "options": [
        "любой путь из тела",
        "только разрешённые корни"
      ],
      "reversible": true,
      "impact": "internal"
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

В панели workflow, открытой в workspace A, должна быть кнопка, которая разворачивает движок **в этот же workspace A** — одна явная операция записи вместо ручного `init` в терминале.

## Зачем

Заказчик: «кнопка нужна обязательно — это must have». Сейчас панель в проекте без движка показывает «workflow не развёрнут» и отправляет в терминал; это единственный экран, где пользователь упирается в тупик.

## Что не входит

1. Кросс-пространственная запись (из A в B): корень берётся только из открытого workspace.
2. Обновление уже развёрнутого движка кнопкой: при наличии `docs/subagent-workflow/VERSION` — код `already-deployed`; обновление отдельным заданием.
3. Установка плагина (кнопка в карточке Structure, схема v2) — чужая зона.
4. Изменение спецификации: версия спеки остаётся 2.6.2, меняется только плагин (0.7.0).

## Инварианты

1. **Одна запись, явная.** Развёртывание выполняется только при `confirm: true`; без него — 400 и ничего не пишется.
2. **Корень — только из workspace.** `root` проходит через `selectRoot` (runtime.roots); произвольный путь из тела не принимается.
3. **Чужой проект не трогается.** `/api/deploy` пишет только в выбранный корень; `guard.enabled`, задачи, приёмка не меняются.
4. **Офлайн.** Спека вкладывается в tarball (`plugin/vendor/spec`), сеть не нужна.
5. **Повтор безопасен.** Второй вызов даёт `already-deployed` и ничего не меняет.
6. `spec/checks/**` (кроме нового `panel-deploy.mjs`), `acceptance.json`, `criteria.lock`, `red.json` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/panel-deploy.mjs`; полный набор — `node spec/selftest.mjs`, `node spec/e2e.mjs`, `node plugin/tools/test.mjs`, `node tools/check-version.mjs`.

## Среда

- Node.js, Windows; плагин — классический browser-модуль (`plugin/lib/client.js`), без сборщика.

## Что сделать

1. **`plugin/lib/deploy.js`** — `deployWorkflow(root, { specRoot, timeoutMs })`: нет корня → `not-found`; не git-репозиторий → `not-a-repo`; есть `docs/subagent-workflow/VERSION` → `already-deployed`; запуск `<specRoot>/scripts/init.mjs --repo <root> --force` через `spawnSync` с таймаутом и захватом вывода; ошибка/таймаут → `init-failed` с `log`; успех → `{ ok:true, version, log }`.
2. **`plugin/lib/api.js`** — `POST /workflow/api/deploy`: `confirm !== true` → 400; корень через `selectRoot` (как `/api/guard`), нет корня → 400, нет каталога → 404; спека `<package>/vendor/spec`, в dev — `<package>/../spec`; ответ 200 `{ ok, version, log }` или 400 с `code`.
3. **`plugin/lib/client.js`** — кнопка «Развернуть workflow здесь» в пустом состоянии и на вкладке «Совместимость»: диалог подтверждения со списком изменений (`docs/subagent-workflow/`, `docs/tasks/`, `.gitignore`, `core.hooksPath`), «Разворачиваю…», успех с версией или отказ с кодом и хвостом вывода, перечитывание состояния.
4. **`plugin/package.json`** — версия `0.7.0`, `files` включает `vendor`.
5. **`tools/pack-plugin.mjs`** — перед `npm pack` положить спеку в `plugin/vendor/spec` и `VERSION` в `plugin/vendor/VERSION`, после сборки убрать; `--plan` ничего не пишет.
6. **`plugin/test/api.test.mjs`** — успех в temp-репозитории без движка; без `confirm` — 400; повтор — `already-deployed`; не-git — отказ; корень вне `runtime.roots` — отказ; клиентский тест — кнопка в пустом состоянии.
7. **`.github/workflows/ci.yml`** — шаг `node spec/checks/panel-deploy.mjs` после `acceptance-p0`; `RELEASE-CHECKLIST.md` — пункт про vendor в tarball.
8. **`plugin/README.md`** — кнопка, подтверждение, коды отказов.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/panel-deploy.mjs | exit 0, в выводе PANEL DEPLOY OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node plugin/tools/test.mjs | exit 0, в выводе fail 0 |
| C5 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.2 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где (файл + суть).
2. Вывод каждой проверки целиком (C1–C5).
3. `git status --short` и `git diff --stat`.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт `task-accept` при приёмке; пуш и теги — архитектор после записи.
