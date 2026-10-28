# Задание 0013. Развёрнутая копия: проверки пакета и lint принятых заданий

<!-- TASK-META
{
  "id": "0013",
  "version": 1,
  "title": "развёрнутая копия: проверки пакета и lint принятых заданий",
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
    "spec/checks/**",
    "spec/scripts/task-lint.mjs",
    "spec/scripts/doctor.mjs",
    "spec/scripts/lib/common.mjs",
    "spec/SPEC.md",
    "adapters/**",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "docs/tasks/0013/**"
  ],
  "protectedPaths": [
    "spec/checks/deployed-copy.mjs",
    "docs/tasks/0013/task.md",
    "docs/tasks/0013/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0013/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Где решать, что проверка запущена вне пакета",
      "chosen": "внутри каждой проверки: нет spec/SPEC.md рядом с корнем — печатать SKIP и выходить 0",
      "options": [
        "исключить checks/** из init",
        "проверять корень внутри проверки"
      ],
      "impact": "internal",
      "reversible": true
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Что делать с диагностикой принятого задания",
      "chosen": "расхождения замка по защищённым файлам и нарушения решений/эффекта — WARN; открытые задания остаются ERROR",
      "options": [
        "оставить ERROR навсегда",
        "ослабить всё",
        "ослабить только для принятых"
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

> Заменяет аннулированное 0012 (дефект границ: `spec/checks/**` был в `protectedPaths`).
> Границы исправлены: защищён только приёмочный скрипт `spec/checks/deployed-copy.mjs`.

## Цель

Убрать ложные падения у проекта, где движок развёрнут: проверки пакета вне пакета должны честно говорить SKIP, а `task-lint --strict` по уже принятому заданию — не валить прогон из-за обновления пакета и правил, появившихся позже приёмки.

## Зачем

Обратная связь IDE-агента (opencode, WSL, workflow 2.6.1):

1. В развёрнутой копии лежат `docs/subagent-workflow/checks/*`: `acceptance-schema.mjs` ищет `docs/spec/templates/…`, `plugin/package.json`, `.github/…`; `actor-sources.mjs` падает с `ENOENT docs/spec`. Для проекта это выглядит как поломка движка, хотя проверки относятся к пакету.
2. `task-lint --strict` по принятому 0001 после обновления пакета даёт `ERROR criteria.lock: защищённый файл изменён: docs/subagent-workflow/…` на десятки файлов, а на исторической задаче — ещё и ERROR правила эффекта. Замок защищал движок; обновление пакета — штатное, а не дефект задания. Послабление 2.4.9 покрывало только `contractCommit`.
3. `doctor` при `attestedBy: none` не подсказывает, что делать в IDE (opencode V2: плагин сессии мостит `tool.execute.before → shell.create.before`, старого `shell.env` нет).

## Что не входит

1. Исключение `checks/**` из `init`: развёрнутое дерево обязано совпадать с пакетом (`e2e-deploy`), поэтому файлы остаются, меняется только их поведение вне пакета.
2. `task-verify` и `task-accept`: они остаются строгими; ослабление — только в диагностическом `task-lint` и только для принятых заданий.
3. `--supersedes`, `clarification.md`, `verify.executor.json` — отдельные задания (реестр обратной связи).
4. Релиз 2.6.2 (архив, tarball, тег, GitHub) — архитектор после приёмки.

## Инварианты

1. В корне пакета поведение проверок не меняется: ни одна из них не переходит в SKIP, если рядом есть `spec/SPEC.md`.
2. Для **открытого** задания `task-lint --strict` остаётся строгим: расхождения замка, решений и эффекта — `ERROR` и exit 1.
3. Для **принятого** (есть `acceptance.json` со `status: accepted`) — те же пункты становятся `WARN`, exit 0; структурные ошибки (нет разделов, битый criteria, секреты) остаются `ERROR`.
4. `doctor` только добавляет подсказку, логика проверок не меняется.
5. `spec/checks/**` защищены замком; `acceptance.json`, `criteria.lock`, `red.json`, `red.log` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/deployed-copy.mjs`; полный набор — `node spec/selftest.mjs`, `node spec/e2e.mjs`, `node tools/check-version.mjs`.

## Среда

- Node.js, Windows; `e2e` около двух минут.

## Что сделать

1. **Проверки пакета вне пакета (SKIP).** В каждом файле `spec/checks/*.mjs` (`acceptance-schema`, `actor-sources`, `acceptance-p0`, `guard-acceptance`, `hooks-mode`, `ci-guard-step`) после вычисления корня пакета добавить: если `<корень>/spec/SPEC.md` не существует — напечатать `SKIP: проверка относится к пакету (spec/checks), а не к развёрнутой копии` и выйти 0. Корень — та же переменная, что уже используется (`ROOT` или `PKG`).
2. **`spec/scripts/task-lint.mjs` — диагностика принятого задания.** Определить `acceptedRecord` по `files.acceptance` (`exists` + `readJson(...).status === 'accepted'`, ошибки чтения — не основание). Для принятого задания отправлять в `warnings` вместо `errors`: `decisionsApplied.errors`, `effectsApplied.errors` и ошибки `verifyLock` (включая «защищённый файл изменён»). Структурные ошибки и секреты остаются `errors`. Для открытого — как сейчас.
3. **`spec/scripts/doctor.mjs`** — при `actor.attestedBy !== 'env'` добавить WARN-строку с рецептом: задать источник в `actor.sources` (например `WF_ACTOR_SESSION`) или, в IDE (opencode V2), проверить плагин сессии и перезапустить приложение.
4. **`adapters/opencode.md`** — переписать раздел про сессию: OpenCode V2 не имеет `shell.env`; плагин `~/.config/opencode/plugins/wf-session.ts` мостит `tool.execute.before → sessionID` в `shell.create.before` env (`DSH_SESSION_ID`); при пустом значении — проверить WARN загрузки плагина в логе, `/reload` или перезапуск. Обёртка с `WF_ACTOR_SESSION` остаётся альтернативой.
5. **`spec/SPEC.md`** — абзац «Версия 2.6.2:» (SKIP проверок вне пакета, lint принятых заданий, подсказка doctor, V2-плагин в адаптере) и `Версия: 2.6.2`.
6. **Версия 2.6.2 в пяти местах**: `VERSION`, `package.json`, первая строка `README.md`, `Версия: 2.6.2` в SPEC, `TOOL` в `spec/scripts/lib/common.mjs`; секция `## 2.6.2` в `CHANGELOG.md`.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/deployed-copy.mjs | exit 0, в выводе DEPLOYED COPY OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.2 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где (файл + суть).
2. Вывод каждой проверки целиком (C1–C4).
3. `git status --short`.
4. Что осталось незакрытым, если есть.

## Коммит

Не коммить. Изменения остаются в индексе и рабочем дереве; кандидатный коммит создаёт `task-accept` при приёмке. Пуш и тег — архитектор после записи о приёмке.
