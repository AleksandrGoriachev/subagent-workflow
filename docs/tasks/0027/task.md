# Задание 0027. Самопроверка контракта: пути из «Что сделать» и covers

<!-- TASK-META
{
  "id": "0027",
  "version": 1,
  "title": "самопроверка контракта: пути из «Что сделать» и covers",
  "risk": "medium",
  "created": "2026-10-30",
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
    "spec/scripts/task-lint.mjs",
    "spec/scripts/lib/common.mjs",
    "spec/SPEC.md",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    ".github/workflows/ci.yml",
    "docs/tasks/0027/**"
  ],
  "protectedPaths": [
    "spec/checks/contract-selfcheck.mjs",
    "docs/tasks/0027/task.md",
    "docs/tasks/0027/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0027/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "impact": "internal",
      "question": "Насколько строго сверять пути из «Что сделать»",
      "chosen": "ERROR для repo-путей в бэктиках из раздела «Что сделать», кроме строк с запретом («не трогай») и служебных токенов",
      "options": [
        "оставить ручную проверку",
        "WARN",
        "ERROR"
      ],
      "reversible": true
    },
    {
      "id": "D2",
      "class": "mechanical",
      "impact": "internal",
      "question": "Строгость covers для файлов allowedPaths",
      "chosen": "ERROR для конкретных файлов (не /** и не docs/tasks/<id>/**, не *.md) без covers; WARN остаётся для шаблонов",
      "options": [
        "оставить WARN",
        "ERROR для файлов"
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

Не давать архитектору выдать контракт, который заведомо упадёт на `task-verify`: lint должен сам сверять пути, названные в разделе «Что сделать», с `allowedPaths`, и требовать `covers` для каждого конкретного файла из `allowedPaths`.

## Зачем

За 0021–0026 пять контрактов были аннулированы из-за границ и покрытия: `spec/checks/**` пересекался с защищённым файлом, `tools/pack-plugin.mjs` менялся вне `allowedPaths`, а `.github/workflows/ci.yml` и `tools/pack-plugin.mjs` не были покрыты `covers`. Каждый раз это стоило полного цикла: контракт → красный → исполнитель → отказ на verify → аннулирование.

## Что не входит

1. Автогенерация контракта из текста задания — только проверка.
2. Ослабление F-7 (пересечение `allowedPaths`/`protectedPaths`) — правило остаётся.
3. Проверка ссылок в других разделах (`Отчёт`, `Коммит`, «Что не входит») — только «Что сделать».
4. Правки панели.

## Инварианты

1. **Путь из «Что сделать» обязан быть разрешён.** Repo-путь в бэктиках (содержит `/`, не абсолютный, без `%`, `~`, `*`, `<`) вне `allowedPaths` → `ERROR` в `task-lint`.
2. **Запреты не считаются требованиями.** Строки с «не трогай», «не меняй», «запрещено», «не коммить» игнорируются.
3. **Конкретный файл из allowedPaths обязан быть покрыт.** Путь без `/**`, не под `docs/tasks/<id>/` и не `*.md` без `covers` → `ERROR`; шаблоны каталогов остаются `WARN`.
4. **Без раздела «Что сделать» правила молчат** — исторические задания и фикстуры не краснеют.
5. `spec/checks/contract-selfcheck.mjs`, `docs/tasks/0027/{task.md,criteria.json}`, `acceptance.json`, `criteria.lock`, `red.json` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/contract-selfcheck.mjs`; полный набор — `node spec/selftest.mjs`, `node spec/e2e.mjs`, `node tools/check-version.mjs`.

## Среда

- Node.js, Windows; фикстуры проверки создают одноразовые репозитории в temp.

## Что сделать

1. **`spec/scripts/task-lint.mjs`** — извлекать пути из раздела «Что сделать»: бэктики, только repo-пути (есть `/`, не абсолютные, без `%`, `~`, `*`, `<`, без `..`); пропускать строки, где перед путём есть «не трогай/не меняй/запрещено/не коммить»; для каждого пути без покрытия `allowedPaths` — `ERROR` с текстом «путь из «Что сделать» не разрешён: <путь>» и подсказкой добавить в `allowedPaths`.
2. **`spec/scripts/task-lint.mjs`** — для `covers`: конкретный файл из `allowedPaths` (без `/**`, не под `docs/tasks/<id>/`, не `*.md`) без покрытия → `ERROR` вместо `WARN`; шаблоны каталогов остаются `WARN`.
3. **`spec/SPEC.md`** — абзац «Версия 2.6.6:» (самопроверка контракта) и `Версия: 2.6.6`.
4. **Версия 2.6.6 в пяти местах**: `VERSION`, `package.json`, первая строка `README.md`, `Версия: 2.6.6` в SPEC, `TOOL` в `spec/scripts/lib/common.mjs`; секция `## 2.6.6` в `CHANGELOG.md`.
5. **`.github/workflows/ci.yml`** — шаг `node spec/checks/contract-selfcheck.mjs`.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/contract-selfcheck.mjs | exit 0, в выводе CONTRACT SELFCHECK OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.6 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где.
2. Вывод каждой проверки целиком (C1–C4).
3. `git status --short`, `git diff --stat`.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт `task-accept`; пуш и теги — архитектор.
