# Задание 0008. Актор без DSH: цепочка источников и вид основания

<!-- TASK-META
{
  "id": "0008",
  "version": 1,
  "title": "актор без DSH: цепочка источников и вид основания",
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
    "spec/scripts/actor.mjs",
    "spec/scripts/lib/common.mjs",
    "spec/scripts/doctor.mjs",
    "spec/scripts/new-task.mjs",
    "spec/scripts/task-attack.mjs",
    "spec/scripts/task-accept.mjs",
    "spec/scripts/task-check-acceptance.mjs",
    "spec/checks/**",
    "spec/workflow.config.json",
    "spec/selftest.mjs",
    "spec/e2e.mjs",
    "spec/SPEC.md",
    "adapters/**",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "RELEASE-CHECKLIST.md",
    "docs/tasks/0008/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "docs/tasks/0008/task.md",
    "docs/tasks/0008/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0008/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Где описаны источники актора",
      "chosen": "массив actor.sources в workflow.config.json; legacy primaryEnv/fallbackEnv синтезируется в sources и не меняет поведение",
      "options": [
        "жёстко два имени в коде",
        "массив источников в конфиге"
      ],
      "impact": "internal",
      "reversible": true
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Чем различаются уровни harness/runner и ci/manual",
      "chosen": "вид источника: harness и runner — env/separate-session, ci и manual — declared; вид пишется в запись",
      "options": [
        "все env-источники считать одинаково",
        "вид источника задаёт уровень"
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

Пакет перестаёт зависеть от DSH: источником идентификатора актора становится настраиваемая цепочка `actor.sources`, где DSH — один из источников, а не обязательный. Вид источника определяет уровень независимости и записывается в приёмку.

## Зачем

Сейчас зависимость номинальная, но с дефектом:

1. `actor.mjs` и `doctor.mjs` вызывают `detectActor(process.env)` **без конфига** — настроенный `primaryEnv` они не видят, поэтому честный проект вне DSH получает FAIL на `doctor`, даже если всё настроил.
2. Шаблон `spec/workflow.config.json` для новых проектов знает только DSH-имена.
3. Уровень `separate-session` выдаётся по одному признаку «переменная есть», без записи, откуда она и какой у неё вид. В записи приёмки нельзя отличить DSH-сессию от значения, которое выставил кто угодно.

Следствие: другие проекты вынуждены подделывать имя `DSH_SESSION_ID`, и это нигде не видно.

## Что не входит

1. Панель (`plugin/lib/guard.js`, `plugin/lib/state.js`) — отдельный патч: в записи и журнале панели поле `source` пока не отображается, чтение записей не ломается.
2. Независимость по ключам (уровень `different-key`) — вариант B, отдельное решение.
3. Обновление чужих проектов и релиз 2.6.0 (архив, тег, GitHub, развёрнутые копии) — архитектор после приёмки.
4. Включение `guard` для этого пространства — отдельное задание.

## Инварианты

1. **Ни один старый конфиг не меняет поведения.** Конфиг без `sources` синтезируется как раньше: `primaryEnv` → `harness` (env/separate-session), `fallbackEnv` → `manual` (declared). Это проверяется отдельным сценарием в `spec/checks/actor-sources.mjs`.
2. **Уровень не повышается молча.** `ci` и `manual` никогда не дают `separate-session`; неизвестный вид источника закрывает ворота (`doctor` красный), а не трактуется как разрешённый.
3. **Основание видно в записи.** Запись v6 получает `actor.source`, `actor.sourceKind` и `independence.basis`; `task-check-acceptance` сверяет вид с уровнем. Записи без новых полей принимаются как раньше.
4. **DSH не обязателен.** Проект без DSH с обёрткой, выставляющей `WF_ACTOR_SESSION`, проходит `doctor` и принимает medium отдельной сессией.
5. `spec/checks/**` защищены замком — приёмочные проверки не переписываются.
6. `acceptance.json`, `criteria.lock`, `red.json`, `red.log` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/actor-sources.mjs`; полный набор — `node spec/e2e.mjs`, `node spec/selftest.mjs`, `node tools/check-version.mjs`.

## Среда

- Node.js, Windows; git; `spec/e2e.mjs` идёт около двух минут.

## Что сделать

1. **`spec/scripts/lib/common.mjs` — нормализация `actor` в `loadConfig`.**
   - Если в файле есть непустой `actor.sources`: каждая запись `{ env: непустая строка, kind }`, `kind ∈ harness | runner | ci | manual`. Невалидные записи отбрасываются, текст ошибки складывается в `config.actor.errors` (массив строк).
   - Иначе синтезировать: `[{ env: actor.primaryEnv || 'DSH_SESSION_ID', kind: 'harness' }, { env: actor.fallbackEnv || 'TASK_ACTOR_SESSION', kind: 'manual' }]`.
   - `actor.modelSources`: непустой массив из конфига, иначе `[actor.modelEnv || 'DSH_MODEL', 'WF_ACTOR_MODEL']`.
   - Файла конфига нет — дефолт: `sources` = `[{DSH_SESSION_ID, harness}, {WF_ACTOR_SESSION, runner}]`, `modelSources` = `['DSH_MODEL', 'WF_ACTOR_MODEL']`; legacy-поля остаются как сейчас.
   - Старые поля `primaryEnv`/`fallbackEnv`/`modelEnv` сохраняются в объекте без изменений (их читает панель).
2. **`spec/scripts/actor.mjs` — резолвер по источникам.**
   - `detectActor(env, opts)` принимает `sources` и `modelSources`; без них — прежние `primaryEnv`/`fallbackEnv` (обратная совместимость для вызывающих).
   - Побеждает первый источник с непустым значением: `actor.session` = значение, `actor.source` = имя переменной, `actor.sourceKind` = вид.
   - `attestedBy`: `harness`/`runner` → `env`; `ci`/`manual` → `declared`; ни одного → `none` (session/source/sourceKind = null).
   - `model`: первый непустой из `modelSources`, иначе переданный `model`, иначе `unknown`.
   - `assessIndependence` дополнительно возвращает `basis` = `sourceKind` (или `'none'`); правила уровня не меняются.
   - CLI `actor.mjs` читает конфиг: корень через `findRepoRoot(process.cwd())`, затем `loadConfig`; в JSON и человекочитаемом выводе показывает `source`, `sourceKind`, `basis`; exit-правило прежнее.
3. **`spec/scripts/doctor.mjs`** — `detectActor` с `config.actor`; строка «актор виден окружению» с деталью `<source> (<sourceKind>) / <session>`; новый FAIL, если `config.actor.errors` непуст (текст ошибок в детали).
4. **`spec/scripts/new-task.mjs`, `spec/scripts/task-attack.mjs`** — сессия и модель через тот же резолвер с конфигом; `attestedBy` из результата; тексты-подсказки без утверждения, что источник только DSH.
5. **`spec/scripts/task-accept.mjs`** — `detectActor` с `config.actor`; в запись `actor` добавить `source` и `sourceKind`, в `independence` — `basis`. Версия записи остаётся 6, остальные поля не меняются.
6. **`spec/scripts/task-check-acceptance.mjs`** — если в записи есть `actor.sourceKind`: `harness`/`runner` требуют `independence.level === 'separate-session'`, `ci`/`manual` — `'declared'`; иначе ошибка «источник актора <kind> не соответствует уровню <level>». Записи без поля проверяются как раньше.
7. **`spec/workflow.config.json`** — шаблон новых проектов: `sources` = `[{DSH_SESSION_ID, harness}, {WF_ACTOR_SESSION, runner}]`, `modelSources`, legacy-поля сохранены.
8. **Тесты.** `spec/selftest.mjs`: кейс на каждый вид (`harness`, `runner`, `ci`, `manual`), пустое окружение, legacy-конфиг, неизвестный вид, сверка записи в `task-check-acceptance`. `spec/e2e.mjs`: сценарий «в окружении только `WF_ACTOR_SESSION`, DSH нет» — задание доходит до приёмки medium с `separate-session`; контроль — источник `runner` настроен, окружение пустое, `task-accept` отказывает.
9. **Документация.** `spec/SPEC.md` (раздел 13 — таблица источников; новый абзац «Версия 2.6.0:»), `CHANGELOG.md` (`## 2.6.0`), `adapters/dsh.md` (DSH как `harness`-источник), `adapters/generic.md` (`WF_ACTOR_SESSION` вместо ручной переменной), новый `adapters/opencode.md` (обёртка + конфиг), `RELEASE-CHECKLIST.md` (пункт про `actor-sources.mjs`), `README.md` — если перечисляет источники актора.
10. **Версия 2.6.0 в пяти местах**: `VERSION`, `package.json`, первая строка `README.md`, `Версия: 2.6.0` в `spec/SPEC.md`, `TOOL` в `spec/scripts/lib/common.mjs`.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/actor-sources.mjs | exit 0, в выводе ACTOR SOURCES OK |
| C2 | node spec/e2e.mjs | exit 0 |
| C3 | node spec/selftest.mjs | exit 0 |
| C4 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.0 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где (файл + суть).
2. Вывод каждой проверки целиком (C1–C4).
3. `git status --short`.
4. Что осталось незакрытым, если есть.

## Коммит

Не коммить. Изменения остаются в индексе и рабочем дереве; кандидатный коммит создаёт `task-accept` при приёмке. Пуш и тег — архитектор после записи о приёмке.
