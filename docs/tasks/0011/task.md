# Задание 0011. Повторная приёмка, подсказка и preflight обходов

<!-- TASK-META
{
  "id": "0011",
  "version": 1,
  "title": "повторная приёмка, подсказка и preflight обходов",
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
    "spec/scripts/task-accept.mjs",
    "spec/scripts/task-check-acceptance.mjs",
    "spec/checks/**",
    "spec/scripts/lib/common.mjs",
    "spec/SPEC.md",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "docs/tasks/0011/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "docs/tasks/0011/task.md",
    "docs/tasks/0011/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0011/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как избавить кандидата от ранее закоммиченной записи",
      "chosen": "git rm --cached --ignore-unmatch в индексе кандидата; запись не попадает в дерево, а не отказ до подписи",
      "options": [
        "отказывать до подписи с подсказкой",
        "убирать запись из индекса кандидата"
      ],
      "impact": "internal",
      "reversible": true
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Где проверяются требования обходов",
      "chosen": "preflight в task-accept до запуска task-verify; после прогона проверки остаются как защита",
      "options": [
        "только после прогона",
        "до прогона и после"
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

Закрыть P0 из обратной связи ws-school-app: повторная приёмка задания после metadata-коммита должна быть возможна, подсказка после приёмки должна указывать существующий путь, а требования обходов — проверяться до полного прогона критериев.

## Зачем

Реестр: `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\FEEDBACK-subagent-workflow-2.4.5-register.md`, пункты F-1, F-2, F-3.

1. **F-1.** Кандидат собирается как `git read-tree HEAD` + `git add -A`: если запись приёмки уже лежит в HEAD (metadata-коммит), она наследуется в кандидата, и `task-check-acceptance` отказывает «acceptance.json входит в кандидатный коммит». Обхода в CLI нет, повторная приёмка невозможна без ручного `git rm` и перезамка.
2. **F-2.** Печатаемая подсказка ссылается на `node scripts/task-check-acceptance.mjs`; в развёрнутой копии такого пути нет. Проверка `--metadata` после любого коммита поверх даёт «metadata-коммит не является потомком кандидата» без объяснения, что сверять надо по metadata-коммиту, а не по HEAD.
3. **F-3.** Требование `--note` при обходах проверяется **после** свежего прогона `task-verify`: забытый `--note` стоит полного прогона (у Playwright — минуты).

## Что не входит

1. `--supersedes` и цепочка записей (F-10) — отдельное решение, меняет модель записи.
2. Мутационная атака приёмщика (F-4/P2.3), `clarification.md` (F-9), `verify.executor.json` (F-8) — отдельные задания.
3. Изменение версии плагина: панель не меняется, плагин остаётся 0.6.0.
4. Релиз 2.6.1 (архив, tarball, тег, GitHub) — архитектор после приёмки.

## Инварианты

1. **Кандидат никогда не содержит `acceptance.json`** своего задания — ни нового, ни ранее закоммиченного. Запись другого задания в HEAD остаётся: она часть дерева.
2. **Никаких молчаливых послаблений.** Preflight только отказывает раньше; проверки после прогона остаются и продолжают действовать.
3. **Старые конфиги и записи не ломаются**; версия записи остаётся 6.
4. Подсказка печатает путь, который существует в том дереве, где запущен скрипт: и `spec/scripts/…` (пакет), и `docs/subagent-workflow/scripts/…` (развёрнутая копия).
5. `spec/checks/**`, `docs/tasks/0011/{task.md,criteria.json}`, `acceptance.json`, `criteria.lock`, `red.json`, `red.log` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/acceptance-p0.mjs`; полный набор — `node spec/selftest.mjs`, `node spec/e2e.mjs`, `node tools/check-version.mjs`.

## Среда

- Node.js, Windows; `e2e` около двух минут.

## Что сделать

1. **`spec/scripts/task-accept.mjs` — кандидат без записи (F-1).**
   - В `createCandidate` после `git read-tree HEAD` удалять из индекса кандидата путь `<taskRel>/acceptance.json` тем же временным `GIT_INDEX_FILE`: `git rm --cached --ignore-unmatch -q -- <путь>`. Если записи в индексе нет — команда не должна падать.
   - Путь передаётся в `createCandidate` явно (не угадывается внутри), чтобы удаление относилось только к текущему заданию.
   - Удаление работает и когда запись в HEAD есть, и когда её нет; запись другого задания не затрагивается.
2. **`spec/scripts/task-accept.mjs` — подсказка (F-2).**
   - Строка «Проверка записи» печатает реальный относительный путь к `task-check-acceptance.mjs`: вычисляется от `import.meta.url` относительно корня репозитория, разделители — `/`. В пакете это `spec/scripts/task-check-acceptance.mjs`, в развёрнутой копии — `docs/subagent-workflow/scripts/task-check-acceptance.mjs`.
3. **`spec/scripts/task-check-acceptance.mjs` — сообщение про `--metadata` (F-2).**
   - При несовпадении родителя с кандидатом сообщение объясняет: сверять нужно по metadata-коммиту (первому коммиту, который добавляет `acceptance.json` после кандидата), а не по `HEAD`; в тексте — ожидаемый кандидат и фактический коммит.
   - В usage добавить строку про это же.
4. **`spec/scripts/task-accept.mjs` — preflight (F-3).**
   - До запуска `task-verify` (до вычисления nonce и вызова скрипта) отказывать, если запрошен любой обход, а `--note` пуст: `--allow-missing-red`, `--allow-manual`, `--allow-declared-actor`, `--reuse-verify`.
   - Там же проверять существование файла `--review` (сейчас — после прогона).
   - Сообщения говорят, что проверка идёт до прогона критериев, и называют флаги.
   - Проверки после прогона (активные обходы, `--reuse-verify` без `--note`, отсутствующий review) остаются как защита.
5. **`spec/SPEC.md`** — абзац «Версия 2.6.1:»: повторная приёмка (кандидат не наследует запись), preflight обходов, путь в подсказке; `Версия: 2.6.1`.
6. **Версия 2.6.1 в пяти местах**: `VERSION`, `package.json`, первая строка `README.md`, `Версия: 2.6.1` в SPEC, `TOOL` в `spec/scripts/lib/common.mjs`; секция `## 2.6.1` в `CHANGELOG.md`.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/acceptance-p0.mjs | exit 0, в выводе ACCEPTANCE P0 OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.1 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где (файл + суть).
2. Вывод каждой проверки целиком (C1–C4).
3. `git status --short`.
4. Что осталось незакрытым, если есть.

## Коммит

Не коммить. Изменения остаются в индексе и рабочем дереве; кандидатный коммит создаёт `task-accept` при приёмке. Пуш и тег — архитектор после записи о приёмке.
