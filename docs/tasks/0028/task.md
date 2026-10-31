# Задание 0028. Гигиена релиза: фикстура gate-rules и версия плагина в check-version

<!-- TASK-META
{
  "id": "0028",
  "version": 1,
  "title": "гигиена релиза: фикстура gate-rules и версия плагина в check-version",
  "risk": "medium",
  "created": "2026-10-31",
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
    "spec/checks/gate-rules.mjs",
    "tools/check-version.mjs",
    "spec/SPEC.md",
    "CHANGELOG.md",
    "docs/tasks/0028/**"
  ],
  "protectedPaths": [
    "spec/checks/release-hygiene.mjs",
    "docs/tasks/0028/task.md",
    "docs/tasks/0028/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0028/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "impact": "internal",
      "question": "Где сверять версию плагина",
      "chosen": "tools/check-version.mjs: plugin/package.json ↔ compat.PLUGIN_VERSION (+ упоминание в README/CHANGELOG плагина)",
      "options": [
        "оставить только update-flow",
        "добавить в check-version"
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

Закрыть два долга, найденных при приёмке: фикстура `gate-rules` устарела после смены `covers` на ERROR, а `tools/check-version.mjs` не сверяет версию **плагина** — согласованный откат `package.json` и `compat.js` проходит незамеченным.

## Зачем

1. **Регресс от 0027.** `spec/checks/gate-rules.mjs` ждёт `WARN` для `covers`, а новое правило (0027) даёт `ERROR`; проверка красная (в CI не входит, но набор пакета должен быть зелёным).
2. **Долг приёмки 0026.** `tools/check-version.mjs` проверяет только версию спеки; версия плагина (`plugin/package.json`) и `compat.PLUGIN_VERSION` могут разойтись, и это ловит только `update-flow` — то есть случайно.

## Что не входит

1. Смена версии спеки (остаётся 2.6.6, релиз ещё не выпущен).
2. Правки панели.
3. `update-flow` «none/none» — отдельное задание.

## Инварианты

1. `gate-rules` зелёный и по-прежнему невакуумный: фикстура «файл без covers» ждёт ERROR.
2. `check-version` сверяет версию плагина: `plugin/package.json.version` == `compat.PLUGIN_VERSION`; расхождение — FAIL и exit 1; согласованный манифест — PASS.
3. Версия спеки 2.6.6 не меняется.
4. `spec/checks/release-hygiene.mjs`, `docs/tasks/0028/{task.md,criteria.json}` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/release-hygiene.mjs`; полный набор — `selftest`, `e2e`, `gate-rules`, `check-version`.

## Среда

- Node.js, Windows.

## Что сделать

1. **`spec/checks/gate-rules.mjs`** — фикстура `covers`: теперь ждать `ERROR` (exit 1) для конкретного файла из `allowedPaths` без покрытия; шаблоны каталогов — по-прежнему `WARN`.
2. **`tools/check-version.mjs`** — добавить проверку версии плагина: читать `plugin/package.json` и `plugin/lib/compat.js` (`PLUGIN_VERSION`), требовать равенства и semver; печатать строку вида «плагин — <версия>»; при расхождении — FAIL и exit 1.
3. **`spec/SPEC.md`** — строка в абзац «Версия 2.6.6:» про проверку версии плагина в `check-version` и про исправленную фикстуру.
4. **`CHANGELOG.md`** — дополнить секцию 2.6.6.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/release-hygiene.mjs | exit 0, в выводе RELEASE HYGIENE OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node spec/checks/gate-rules.mjs | exit 0, в выводе GATE RULES OK |
| C5 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.6 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где.
2. Вывод каждой проверки целиком (C1–C5).
3. `git status --short`, `git diff --stat`.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт `task-accept`; пуш и теги — архитектор.
