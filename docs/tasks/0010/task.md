# Задание 0010. Схема записи и сборка tarball плагина

<!-- TASK-META
{
  "id": "0010",
  "version": 1,
  "title": "схема записи и сборка tarball плагина",
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
    "spec/templates/**",
    "spec/checks/**",
    "spec/SPEC.md",
    ".github/**",
    "plugin/package.json",
    "plugin/lib/compat.js",
    "plugin/test/**",
    "plugin/tools/test.mjs",
    "plugin/README.md",
    "tools/pack-plugin.mjs",
    "package.json",
    "CHANGELOG.md",
    "README.md",
    "RELEASE-CHECKLIST.md",
    "docs/tasks/0010/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "docs/tasks/0010/task.md",
    "docs/tasks/0010/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0010/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как собирать tarball плагина",
      "chosen": "npm pack из plugin/ + стабильная копия dsh-workflow-console.tgz + .sha256 в dist/",
      "options": [
        "руками через pnpm pack",
        "скрипт tools/pack-plugin.mjs поверх npm pack"
      ],
      "impact": "internal",
      "reversible": true
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Где объявлена версия плагина",
      "chosen": "plugin/package.json (0.6.0), отдельно от версии спецификации (2.6.0)",
      "options": [
        "одна версия на всё",
        "отдельные версии"
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

Закрыть два долга перед релизом 2.6.0: опубликованная схема записи приёмки должна знать поля 2.6.0, а сборка пакета должна выпускать устанавливаемый tarball плагина со стабильным именем.

## Зачем

1. Задание 0008 добавило в запись приёмки `actor.source`, `actor.sourceKind`, `independence.basis`, но `spec/templates/acceptance.schema.json` объявляет `actor` и `independence` с `additionalProperties: false` и новых полей не знает. Скрипты репозитория схему не валидируют, поэтому ворота зелёные, но внешний потребитель отклонит корректную запись 2.6.0. Это дефект границ задания 0008 (файл не входил в `allowedPaths`), поэтому — отдельный ID, а не перезамок (I-3).
2. Схема установки плагина из панели Structure утверждена заказчиком: ставится tarball последнего релиза со стабильным именем `dsh-workflow-console.tgz`. Сейчас плагин нигде не собирается как устанавливаемый пакет, а `tools/pack.mjs` собирает только zip спецификации.

## Что не входит

1. Кнопка установки и `?root=` на стороне панели Structure — их репозиторий.
2. Кэш статуса, `?root=` и прочие изменения `plugin/lib/api.js` — не нужны для схемы; версия плагина поднимается только манифестом.
3. Публикация в npm и любые сетевые операции.
4. Выпуск релиза 2.6.0 (тег, ассеты, GitHub) — архитектор после приёмки.

## Инварианты

1. Старые записи приёмки остаются валидными по схеме: новые поля объявлены необязательными.
2. Схема по-прежнему отклоняет незнакомые поля (`additionalProperties: false`), иначе проверка «схема знает поле» ничего не доказывает.
3. Tarball собирается **из текущего каталога плагина**, без копирования и без правок манифеста: `files`, `dsh.bundle.patch`, `dsh.client.platform`, `engines.dsh` берутся из `plugin/package.json`.
4. Стабильное имя `dsh-workflow-console.tgz` и версионированное имя — байт в байт одинаковые файлы; рядом оба `.sha256`.
5. В tarball остаётся `private: true` (pnpm на флаг не смотрит; для npm снимут отдельно).
6. Версия спецификации не меняется (2.6.0); версия плагина — 0.6.0.
7. `spec/checks/**` защищены замком; `acceptance.json`, `criteria.lock`, `red.json`, `red.log` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/acceptance-schema.mjs`; полный набор — `node plugin/tools/test.mjs`, `node spec/selftest.mjs`, `node spec/e2e.mjs`, `node tools/check-version.mjs`.

## Среда

- Node.js 25 / npm 11 (в PATH, `npm.cmd` на Windows), git; `spec/e2e.mjs` идёт около двух минут.

## Что сделать

1. **`spec/templates/acceptance.schema.json`** — в `properties.actor.properties` добавить `source` (`{"type": ["string","null"]}`) и `sourceKind` (`{"enum": ["harness","runner","ci","manual",null]}`); в `properties.independence.properties` — `basis` (`{"enum": ["harness","runner","ci","manual","none",null]}`). Оба объекта остаются `additionalProperties: false`, поля необязательные. Пример:
   ```json
   "source": { "type": ["string", "null"] },
   "sourceKind": { "enum": ["harness", "runner", "ci", "manual", null] }
   ```
2. **`plugin/package.json`** — версия `0.6.0`; `engines.dsh`: `">=0.2.0-0 <0.3.0"`; `repository`: `{"type":"git","url":"https://github.com/AleksandrGoriachev/subagent-workflow"}`; остальное (`private: true`, `files`, `dsh`, `exports`) не менять.
3. **`plugin/lib/compat.js`** — `SUPPORTED_LABEL` = `'2.0.0 – 2.6.x'`; тексты, где упоминается 2.5, привести к 2.6, не меняя логику.
4. **`tools/pack-plugin.mjs`** (новый) — сборка tarball:
   - читает `plugin/package.json`, требует semver-версию;
   - `--plan` печатает `pack-plugin: <name>@<version>`, строки `versioned <dist>\dsh-workflow-console-<version>.tgz` и `stable <dist>\dsh-workflow-console.tgz`, выходит 0, ничего не собирая;
   - обычный запуск: `npm pack --pack-destination <dist>` из `plugin/` (на Windows — через `cmd.exe /d /s /c`, без `shell: true` с аргументами), проверяет, что файл создан, копирует его в стабильное имя, пишет `.sha256` для обоих, печатает размеры и суммы;
   - при ошибке — понятное сообщение и exit 1.
5. **`plugin/tools/test.mjs`** — обновить ожидания метки совместимости (2.6) и, если есть проверка версии манифеста, привести к 0.6.0; добавить тест, что `files` и `dsh` не потерялись.
6. **`package.json`** (корень) — скрипт `"pack:plugin": "node tools/pack-plugin.mjs"` (не менять версию спецификации).
7. **`RELEASE-CHECKLIST.md`** — в алгоритм сборки добавить шаг tarball и правило: **каждый релиз** содержит `dsh-workflow-console.tgz` (стабильное имя для `workflowInstallSpec`), версионированную копию и оба `.sha256`; добавить прогон `node spec/checks/acceptance-schema.mjs` и `node tools/pack-plugin.mjs`.
8. **`CHANGELOG.md`** — в секцию 2.6.0 добавить: схема записи знает новые поля; плагин 0.6.0 с `engines.dsh`; сборка tarball и стабильное имя ассета.
9. **`spec/SPEC.md`** — в абзац «Версия 2.6.0:» добавить пункт про схему записи и про установку плагина из tarball (без изменения версии).
10. **`plugin/README.md`** — короткая строка установки из tarball и требование DSH `>=0.2.0-0 <0.3.0`.
11. **`.github/workflows/ci.yml`** — шаг `node spec/checks/acceptance-schema.mjs` в джобе `test` сразу после `selftest`: схема записи должна проверяться машиной при каждом пуше, а не только руками.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/acceptance-schema.mjs | exit 0, в выводе ACCEPTANCE SCHEMA OK |
| C2 | node plugin/tools/test.mjs | exit 0 |
| C3 | node spec/selftest.mjs | exit 0 |
| C4 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.0 |
| C5 | node spec/e2e.mjs | exit 0 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где (файл + суть).
2. Вывод каждой проверки целиком (C1–C5).
3. Результат `node tools/pack-plugin.mjs`: имена, размеры, sha256, состав tarball (`tar -tzf`).
4. `git status --short`.
5. Что осталось незакрытым, если есть.

## Коммит

Не коммить. Изменения остаются в индексе и рабочем дереве; кандидатный коммит создаёт `task-accept` при приёмке. Пуш и тег — архитектор после записи о приёмке.