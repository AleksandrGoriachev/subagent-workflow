# Задание 0007. Право исполнения хуков: режим в git и в кандидате

<!-- TASK-META
{
  "id": "0007",
  "version": 1,
  "title": "право исполнения хуков: режим в git и в кандидате",
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
    ".github/**",
    "spec/hooks/**",
    "spec/checks/**",
    "spec/e2e.mjs",
    "spec/scripts/task-accept.mjs",
    "spec/scripts/lib/common.mjs",
    "spec/SPEC.md",
    "docs/tasks/0007/**",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "RELEASE-CHECKLIST.md"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "spec/e2e.mjs",
    "docs/tasks/0007/task.md",
    "docs/tasks/0007/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0007/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Откуда кандидат берёт право исполнения",
      "chosen": "из индекса репозитория: сборка кандидата восстанавливает режим 100755 для путей, помеченных в индексе",
      "options": [
        "chmod в copyTree приёмочных фикстур",
        "восстановление режима в createCandidate"
      ],
      "impact": "internal",
      "reversible": true
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Что делает CI с правами хуков",
      "chosen": "ничего не чинит: шаг chmod +x удалён, вместо него проверка режима hooks-mode.mjs",
      "options": [
        "оставить chmod как страховку",
        "убрать chmod и проверять режим"
      ],
      "impact": "internal",
      "reversible": true
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Право исполнения хуков перестаёт быть настройкой раннера и становится свойством поставки: `spec/hooks/*` лежат в git с режимом `100755`, сборка кандидата переносит режим из индекса, CI не чинит права под тестами.

## Зачем

2.5.1 показала, что дефект был не в хуках, а в трёх местах сразу:

1. Файлы `spec/hooks/*` создавались на Windows и попали в git с режимом `100644`. Linux молча игнорирует неисполняемый хук — на `ubuntu-latest` два push-кейса падали («хуки не активны»).
2. `createCandidate` собирает кандидата как `git read-tree HEAD` + `git add -A`: `git add` берёт режим из рабочего дерева, а Windows его не хранит. Даже если режим выставлен в индексе (`git update-index --chmod=+x`), кандидат получает `100644` — принятое дерево расходится с проверенным.
3. Шаг `chmod +x spec/hooks/*` в CI маскировал оба дефекта: локально без него проверки красные, в CI зелёные. Сломанная проверка хуже отсутствующей.

## Что не входит

1. `chmod` в `copyTree` приёмочных кейсов — не нужен: после исправления режим приезжает в checkout из индекса и `copyFileSync` его сохраняет; `init` и так ставит 755 развёрнутым копиям. Страховка в фикстуре скрыла бы регрессию режима — ровно то, что случилось в 2.5.1.
2. Учёт режимов в `worktreeDigest` — отдельный долг: digest считается по содержимому, режимы закрепляет кандидатный коммит.
3. Включение `guard` для этого пространства — задание 0008, решение заказчика.
4. Релиз 2.5.2 (архив, тег, GitHub, обновление развёрнутых копий) — архитектор после записи о приёмке.

## Инварианты

1. Кандидат — это HEAD + содержимое рабочего дерева + **режимы из индекса**. Никаких других прав сборка не выдумывает: путь, не помеченный в индексе исполняемым, остаётся `100644`.
2. Проверки `spec/checks/hooks-mode.mjs` и кейс `2.5.2` в `spec/e2e.mjs` защищены замком: менять их нельзя, ослабление видно в записи приёмки.
3. CI не подменяет права: шаг `chmod +x spec/hooks/*` удалён, вместо него шаг проверки режима.
4. `acceptance.json`, `criteria.lock`, `red.json`, `red.log` не трогать; не коммитить, не пушить, не ставить теги.
5. На Windows режим выставляется только через git (`git update-index --chmod=+x`): файловая система его не хранит.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. `spec/checks/**` и `spec/e2e.mjs` защищены замком — это приёмочные проверки, критерий их не переписывает.
4. Проверка задания: `node spec/checks/hooks-mode.mjs`; полный набор — `node spec/e2e.mjs`, `node spec/selftest.mjs`, `node tools/check-version.mjs`.

## Среда

- Node.js, Windows; git 2.51; `core.filemode=false`.
- `spec/e2e.mjs` идёт около двух минут и сам создаёт временные репозитории.

## Что сделать

1. `spec/hooks/pre-commit`, `commit-msg`, `pre-push`: режим `100755` в индексе.
   ```bash
   git add spec/hooks
   git update-index --chmod=+x spec/hooks/pre-commit spec/hooks/commit-msg spec/hooks/pre-push
   git ls-files -s spec/hooks   # все три — 100755
   ```
2. `spec/scripts/task-accept.mjs`: `createCandidate` восстанавливает в кандидате режим `100755` для тех путей, что помечены исполняемыми в индексе репозитория (режим читается `git ls-files -s` по реальному индексу, затем `git update-index --chmod=+x` в индекс кандидата). Содержимое кандидата не меняется — только режим; комментарий объясняет, почему `git add` его теряет на Windows.
3. `.github/workflows/ci.yml`: удалить шаг `хуки исполняемые (linux)` (`chmod +x spec/hooks/*`) и добавить шаг `node spec/checks/hooks-mode.mjs` сразу после `e2e`.
4. Версия 2.5.2 в пяти местах: `VERSION`, `package.json`, первая строка `README.md`, `Версия: 2.5.2` в `spec/SPEC.md`, `TOOL` в `spec/scripts/lib/common.mjs`; плюс раздел `Версия 2.5.2:` в SPEC и секция `## 2.5.2 ` в `CHANGELOG.md`.
5. `RELEASE-CHECKLIST.md`: пункт про режим хуков и `hooks-mode.mjs`.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/hooks-mode.mjs | exit 0, в выводе HOOKS MODE OK |
| C2 | node spec/e2e.mjs | exit 0 |
| C3 | node spec/selftest.mjs | exit 0 |
| C4 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.5.2 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где (файл + суть).
2. Вывод каждой проверки целиком (C1–C4).
3. `git status --short` и `git ls-files -s spec/hooks`.
4. Что осталось незакрытым, если есть.

## Коммит

Не коммить. Изменения остаются в индексе и рабочем дереве; кандидатный коммит создаёт `task-accept` при приёмке. Пуш и тег — архитектор после записи о приёмке.
