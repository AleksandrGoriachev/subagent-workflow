# Задание 0033. Внешний движок для воркспейса без спеки

<!-- TASK-META
{
  "id": "0033",
  "version": 1,
  "title": "внешний движок: воркспейс без спеки читает движок по карте, запись запрещена",
  "risk": "medium",
  "created": "2026-11-01",
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
    "spec/scripts/lib/common.mjs",
    "spec/SPEC.md",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    ".github/workflows/ci.yml",
    "docs/tasks/0033/**"
  ],
  "protectedPaths": [
    "spec/checks/engine-root.mjs",
    "docs/tasks/0033/task.md",
    "docs/tasks/0033/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0033/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "impact": "user-visible",
      "question": "Как воркспейс без движка получает панель, не меняя себя",
      "chosen": "карта workspace→engine в ~/.dsh/workflow/engine-roots.json (env WF_ENGINE_ROOTS); чтение из внешнего движка, запись (guard/deploy/update) запрещена кодом engine-external",
      "options": [
        "git init в воркспейсе",
        "развернуть движок в воркспейс",
        "внешний движок по карте"
      ],
      "reversible": true
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Панель должна показывать задачи воркспейса, у которого **нет** движка, беря движок по карте из `~/.dsh/workflow/engine-roots.json`, и **не писать** в такой воркспейс.

## Зачем

`split-optimizer` — DSH-воркспейс без git и без кода (только `.dsh` и `structure`). Развернуть движок в него значит изменить его; открывать чужой воркспейс ради панели нельзя. Нужен режим «движок снаружи»: чтение разрешено, запись — нет.

## Что не входит

1. Изменение самого воркспейса (никаких `docs/`, `.gitignore`, `.git`).
2. Автосоздание карты панелью (карту пишет человек или установщик).
3. `engineRoot` для развёрнутого движка (он и так в воркспейсе).

## Инварианты

1. **Карта**: `~/.dsh/workflow/engine-roots.json` — объект `{ "<abs workspace>": "<abs engine repo>" }`; путь можно переопределить env `WF_ENGINE_ROOTS`. Ключи сравниваются без учёта регистра и хвостового слэша (Windows).
2. **Резолв**: если в воркспейсе есть `docs/subagent-workflow/VERSION` → источник `workspace`; иначе запись карты с существующим движком → `mapping`; иначе `installed:false`.
3. **Чтение** (`/api/status`, `/api/tasks`, `/api/task/:id`, `/api/policy`, `/api/checks`) идёт из резолвнутого движка.
4. **Запись запрещена**: `POST /api/guard`, `/api/deploy`, `/api/update` при источнике `mapping` → `409` с кодом `engine-external` и подсказкой; воркспейс не меняется (нет `docs/`, `.gitignore` не трогается).
5. **Панель**: в шапке видно «движок: внешний · <путь>»; кнопка «Развернуть»/«Обновить» неактивна с объяснением.
6. **Панель 0.9.0**: `plugin/package.json` и `compat.PLUGIN_VERSION` = `0.9.0`; спека 2.6.9.
7. `spec/checks/engine-root.mjs`, `docs/tasks/0033/{task.md,criteria.json}` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/engine-root.mjs`; полный набор — `plugin/tools/test.mjs`, `selftest`, `e2e`, `panel-deploy`, `check-version`.

## Среда

- Node.js, Windows; проверка подменяет HOME/USERPROFILE и WF_ENGINE_ROOTS.

## Что сделать

1. **`plugin/lib/deploy.js`** (или новый `plugin/lib/engine-root.js`) — `readEngineRoots()`, `resolveEngine(root)` → `{ installed, root, source }`; нормализация путей и безопасный разбор JSON (битый файл не роняет панель).
2. **`plugin/lib/api.js`** — резолв движка для чтения; `engine` в `/api/status`; для записи при `source==='mapping'` — 409 `engine-external` до любых действий; обновить существующие маршруты, не меняя их контракт для обычного случая.
3. **`plugin/lib/client.js`** — подпись «внешний движок» и путь; кнопки развёртывания/обновления недоступны с объяснением.
4. **`plugin/lib/compat.js`, `plugin/package.json`, `plugin/README.md`** — 0.9.0.
5. **`plugin/tools/test.mjs`** и `plugin/test/*.test.mjs` — тесты карты и 409 `engine-external`; сквозную проверку задания делает отдельный файл, его не трогай.
6. **`spec/SPEC.md`** — абзац «Версия 2.6.9:» (внешний движок) и `Версия: 2.6.9`; версия 2.6.9 в `VERSION`, `package.json`, `README.md`, `TOOL`; секция `## 2.6.9` в `CHANGELOG.md`.
7. **`.github/workflows/ci.yml`** — шаг `node spec/checks/engine-root.mjs`.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/engine-root.mjs | exit 0, в выводе ENGINE ROOT OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node plugin/tools/test.mjs | exit 0, в выводе fail 0 |
| C5 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.9 |
| C6 | node spec/checks/panel-deploy.mjs | exit 0, в выводе PANEL DEPLOY OK |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где.
2. Вывод каждой проверки целиком (C1–C6).
3. `git status --short`, `git diff --stat`.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт `task-accept`; пуш и теги — архитектор.
