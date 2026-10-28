# dsh-workflow-console

Web panel for [subagent-workflow](../README.md) repositories inside DeepSeek
Harness. It reads task artifacts and `workflow.config.json`; there are exactly
two writes, both behind a confirmation: the commit-and-push guard flag and one
explicit deployment of the engine into the open workspace (0.7.0 → 0.7.1). It
never changes `policy`, never runs a gate, never signs and never accepts
anything.

## 0.7.1 — ключ проекта и защита POST-маршрутов

- **Ключ приёмщика создаётся в проекте.** `deployWorkflow` передаёт `init`
  явные `--key-out <repo>/.wf-keys` и `--key-id agent-judge`, а `.wf-keys/`
  попадает в `.gitignore` проекта. Глобальный `%USERPROFILE%\.wf-keys` не
  создаётся и не перезаписывается: развернули A, затем B — ключ A и его
  `acceptors.json` целы. Подтверждение кнопки называет `.wf-keys/` и прямо
  говорит, что глобальный ключ не трогается.
- **POST-маршруты защищены типом и Origin.** `/api/guard` и `/api/deploy`
  требуют `Content-Type: application/json` (иначе 415) и `Origin` своего хоста
  или его отсутствие (иначе 403); проверки идут до чтения тела и до любых
  записей, поэтому cross-site `text/plain` не выключает guard и не запускает
  развёртывание.
- **`VERSION` пишется последним.** `init` пишет версию после конфига, ключа и
  хуков: сломанный `workflow.config.json` не оставляет ложное
  «уже развёрнуто».
- Версия плагина 0.7.1, тестов 87: 415/403 на обоих маршрутах,
  ключ проекта и отсутствие глобального ключа, прежние сценарии развёртывания
  (успех, повтор, не-git, чужой корень, 404/405) не ослаблены.

## 0.7.0 — кнопка «Развернуть workflow здесь»

Пространство без движка больше не упирается в терминал: пустое состояние и
вкладка «Совместимость» показывают кнопку **«Развернуть workflow здесь»**.

- **Вторая явная запись панели.** `POST /workflow/api/deploy` с
  `{confirm: true, root}` запускает `init.mjs --force` из вложенной спеки
  (0.7.1 добавляет `--key-out <repo>/.wf-keys`) и отвечает
  `{ok, version, log}`; без `confirm: true` — 400 и ничего не пишется. Повтор в
  уже развёрнутом пространстве — 400 `already-deployed`: кнопкой движок не
  обновляется, это отдельное задание.
- **Корень — только из workspace.** `root` проходит через `selectRoot`
  (`runtime.roots` и зарегистрированные workspace), поэтому «разверни в
  C:\чужой-проект» из тела запроса не проходит. Несуществующий каталог — 404,
  не-git — 400 `not-a-repo`, нет движка в сборке, init упал или не уложился в
  таймаут — 400 `init-failed` с хвостом вывода.
- **Подтверждение перечисляет изменения.** `docs/subagent-workflow/` (движок,
  ворота, хуки, публичный ключ приёмщика), `docs/tasks/`, `.wf-keys/` проекта
  (0.7.1: приватный ключ, каталог в `.gitignore`; глобальный не трогается),
  строки журналов в `.gitignore`, локальный `git config core.hooksPath =
  docs/subagent-workflow/hooks`. Пока идёт запись, кнопка говорит
  «Разворачиваю…»; успех — с версией, отказ — с кодом и последними строками
  вывода init; после успеха панель перечитывает состояние и открывает доску.
- **Офлайн.** `tools/pack-plugin.mjs` кладёт `spec/` в `plugin/vendor/spec`, а
  `VERSION` — в `plugin/vendor/VERSION` перед `npm pack` и убирает после (даже
  при ошибке); `--plan` не пишет ничего. Сборка проверяет, что в tarball есть
  `vendor/spec/scripts/init.mjs` и `vendor/VERSION`, поэтому «панель без
  движка» не выпускается молча. Версия движка после развёртывания — версия
  сборки.
- Версия плагина 0.7.0, тестов 84: маршрут `/api/deploy` (успех в чистом
  репозитории, отказ без confirm, повтор, не-git, чужой корень, 404, 405),
  кнопка в пустом состоянии и на вкладке «Совместимость» (подтверждение,
  «Разворачиваю…», успех с версией, отказ с кодом) и `vendor` в манифесте.

## 0.6.0 — установка из tarball, схема записи 2.6.0

- **Ставится из tarball.** Релиз публикует `dsh-workflow-console.tgz` —
  стабильное имя для `workflowInstallSpec`
  (`releases/latest/download/dsh-workflow-console.tgz`) — и версионированную
  копию `dsh-workflow-console-<версия>.tgz`; рядом `.sha256` для обоих.
  Локально tarball собирает `npm run pack:plugin` (тот же
  `node tools/pack-plugin.mjs`): файлы ложатся в `dist/`.
- **Требуется DSH `>=0.2.0-0 <0.3.0`** — объявлено в `engines.dsh`.
- **Диапазон версий — `2.0.0 – 2.6.x`**, версия плагина 0.6.0: панель
  показывает запись 2.6.0 (`actor.source`, `actor.sourceKind`,
  `independence.basis`) так же, как `effect`, регресс-долг и guard.
- Тест манифеста проверяет, что `files` и `dsh` не потерялись после смены
  версии; тестов 79.

## 0.5.0 — кнопка guard: единственная запись панели

- **Проверка коммитов включается с панели.** Страница «Политика» показывает
  эффективные `guard.enabled`, `mode`, `allow` и `bypassMarker` и переключает
  флаг с подтверждением — для текущего workspace. `POST
  /workflow/api/guard` пишет ровно один ключ `guard.enabled` (остальные ключи
  конфигурации байт в байт) и дописывает строку `<ISO> enabled=true|false
  actor=<сессия|unknown>` в `docs/subagent-workflow/guard.log`: оба перехода
  фиксируются (I-29), отсутствие строки не означает «выключено».
- **Пределы названы в интерфейсе.** `git commit --no-verify` и
  `git push --no-verify` обходят локальные хуки целиком (следа в аудите нет);
  метка `[workflow-bypass: …]` в сообщении коммита разрешает и коммит, и пуш
  (при пушe сообщения читаются из коммитов диапазона) — и остаётся в
  `task-guard --audit`.
- **Диапазон версий — `2.0.0 – 2.5.x`**, версия плагина 0.5.0. Тесты: маршрут
  `/api/guard` (только `guard.enabled` + журнал, POST-only, проверка тела и
  корня) и кнопка в клиенте.

## 0.4.1 — панель повторяет ворота в эффекте, регресс в карточке

Закрыты замечания независимого ревью 0.4.0.

- **Правило «эффект требуется» взято у ворот.** `effectsView` больше не добавляет
  своих условий (`class: semantic|contract`, `evidence.kind=criterion`): эффект
  требуется для любого решения с `impact: user-visible|public-contract`, как в
  `userFacingDecisions` из `spec/scripts/lib/common.mjs`. Тест сверяет `required`
  и `missing` с `evaluateEffects`: решение `class: mechanical` с
  `impact: user-visible` и без `effect` даёт `missing`, а не «эффект не
  требуется».
- **Подсказки эффекта и регресса доступны с клавиатуры.** `aria-label` кнопки
  карточки на доске содержит подсказки бейджей «эффект» и «регресс» (сами бейджи
  внутри кнопки не фокусируются).
- **Карточка: раздел «Регресс».** Статус, `since`, `reviewBy` с пометкой «срок
  истёк» и причина из `regress.baseline.json`; без записи — «в
  regress.baseline.json записи по этому заданию нет».
- **«Не проверялось» вместо «ok».** При `checked: false` в `verify.json` и в
  записи приёмки панель пишет «не проверялось»; «ok» остаётся только после
  реальной проверки.
- **Цвет бейджа «эффект» — из политики.** `boardTask` проецирует строгость флага
  `effect-problem`: `decisions: fail` — error (красный), `warn` —
  предупреждение, `off` — нейтральный и без флага. Раньше цвет зависел от
  статуса, и при `off` бейдж был красным.
- **Карточка терпима к старому ответу и к проекции доски.** `effects: null` — это
  «данные об эффекте недоступны (старый ответ API)», а не «effect нет»; «нет ни
  одного effect» говорится только при `declared: 0` и `status: none`;
  `unlinked` числом не ломает карточку. Убраны мёртвая ветка `status: ok` в
  бейдже и дубль «не требуется».
- Тестов 74 (было 69).

## 0.4.0 — доказательство и эффект, регресс-долг (WC-5)

Закрыт пробел 2.3–2.4: панель читает то, что ворота этих версий пишут в файлы.

- **Карточка: раздел «Доказательство и эффект».** Цепь «критерий-носитель →
  измеритель» (`criteria.effect`: `observable`, `threshold`, `measuredBy`), какие
  решения обязаны на неё ссылаться (`decisions[].evidence.ref`), что записали
  `verify.json.effects` и `effectConsistency` приёмки. Шесть состояний названы
  словами: не требуется, цепь собрана, требуется но не объявлен, объявлен неверно,
  решение мимо цепи, ворота записали несогласованность.
- **Доска: бейджи «эффект» и «регресс».** Эффект виден без открытия карточки;
  регресс берётся из `regress.baseline.json` (единственный след регресса на диске —
  сам регресс запускают ворота). Просроченный `reviewBy` помечается, долг
  считается в строке сводки.
- **Проверка «Workflow 2.3–2.4: effect и регресс не показываются» снята** — она была
  честной, пока пробел был. `SUPPORTED_LABEL` снова `2.0.0 – 2.4.x`.
- **Флаг `effect-problem`** со строгостью из политики: при `decisions: fail` это
  ошибка, при `warn` — предупреждение, при `off` — молчание. Панель не выдумывает
  строгость, она берёт её у репозитория.
- Тестов 69 (было 61): случаи `effectsView`, `readBaseline` и проекции доски.

## 0.3.2 — баннер «функционал ограничен» только для устаревшей копии

Правило заказчика (2026-10-28): «Понятно, что будет работать, — такое уведомление
должно появляться для устаревшей версии с предложением обновиться».

- **Пакет новее панели — не ограничение.** `summary.limited` больше не выставляется
  из-за того, что workflow новее известного панели диапазона, поэтому полоса
  «Функционал ограничен: …» над каждой страницей не появляется. Для 2.3–2.4
  остаётся строка уровня `info` в «Совместимости» (`workflow-2.3-plus`): ворота
  работают полностью, панель просто не рисует `effect` и регресс.
- **Баннер остаётся там, где он по делу** — устаревшая развёрнутая копия (2.0/2.1,
  нет `task-attack`/`policy`) и отсутствующий workflow: это настоящая нехватка
  функций, и рекомендация «обновите развёрнутую копию» уместна.
- **Отставший плагин** (workflow новее 2.4): предупреждение с советом обновить
  панель, когда выйдет версия с поддержкой, — но без баннера: на работу ворот
  панель не влияет.

## 0.3.1 — версия панели не врёт, диапазон не пугает

- **`TOOL` больше не отстаёт.** В `/api/status` уезжала строка
  `dsh-workflow-console/0.2.1` при фактических 0.3.0: константа была вписана
  руками рядом с `PLUGIN_VERSION`. Теперь она собирается из `PLUGIN_VERSION`
  (`'dsh-workflow-console/' + PLUGIN_VERSION`), а тест сверяет её и с
  `package.json`. Ровно тот урок, который пакет закрыл в 2.4.2 для своего
  `TOOL`, — к панели он не был применён.
- **Диапазон назван честно: 2.0–2.4, но без `effect`/`regress`.** Проверка
  «Workflow новее 2.2.x» советовала обновить плагин владельцу 2.4.5, то есть
  вела в никуда. Для 2.3–2.4 теперь отдельная проверка
  `workflow-2.3-plus`: она перечисляет, чего панель не показывает
  (`criteria.effect`, `decisions[].evidence.measuredBy`, `effectConsistency`,
  регресс-базлайн, `summary.timeout`), и говорит прямо: действий не требуется,
  это вид, а не ворота. Общий совет «обновите плагин» остался только для
  версий новее 2.4.

## 0.3.0 — панель отвечает за своё пространство

- **Чужой проект больше не подставляется.** Раньше, если в текущем workspace не было
  `workflow.config.json`, панель молча открывала первый корень из настроек — в
  пространстве без workflow появлялась доска соседнего проекта. Теперь — пустое
  состояние с объяснением; настроенные корни из других пространств видны только по
  явной кнопке «Показать репозитории из настроек».
- **Список репозиториев ограничен текущим пространством:** в выборе остаются корни
  внутри текущего workspace, а не весь глобальный список профиля.
- **Проекты своего пространства находятся сами:** если workflow развёрнут не в корне
  workspace, а в подкаталоге (например `wf-project`), пустое состояние предлагает
  «Открыть wf-project» — без правки `roots` в профиле.
- **Версия в заголовке берётся из `package.json`**, а не из отдельной константы:
  раньше панель показывала `v0.2.1` при фактических 0.3.0 (тест сверяет их).
- **Пропущенные записи объясняются словами:** «Каталога заданий docs/tasks нет: похоже,
  workflow в этом проекте не развёрнут. Разверните пакет командой …», техническая
  причина — под раскрывашкой «подробности».
- **Диагностика названа по-человечески.** Кнопка `doctor` стала «Проверить настройку»
  с подсказкой «всё ли готово к работе: ворота, ключ приёмки, политика; ничего не
  меняет». В карточке — «Проверить задание» и «Проверить запись» вместо `lint` и
  `check-acceptance`. Результат начинается с человеческого итога («Всё готово» /
  «Чего-то не хватает: N»), технический лог остаётся ниже.

## What it shows

- **Board** — tasks from `config.tasksDir`, with the stage derived from files:
  `контракт`, `атака`, `замок`, `красный`, `зелёный`, `принято`, `замечания`.
- **Task card** — contract, decisions (with `assumed` highlighted), criteria and
  `covers`, coverage from `verify.json`, attack findings, acceptance record
  (v3/v4/v5/v6), and read-only `git log` for the task directory.
- **Policy** — effective `policy`, `models`, roles and warnings, in the same
  wording as `doctor`.

## Install

The plugin ships separately from the portable `subagent-workflow` archive
(decision 2026-10-26): the archive is copied into a repository, the plugin is a
DSH host package.

Release builds are installed from the tarball `dsh-workflow-console.tgz` (the
stable asset name; the versioned copy `dsh-workflow-console-<version>.tgz` and
both `.sha256` files sit next to it). The package requires DSH
`>=0.2.0-0 <0.3.0` — declared in `engines.dsh`. To build the tarball locally,
run `npm run pack:plugin` from the repository root; the asset lands in `dist/`.
The tarball carries the spec as `vendor/spec` plus `vendor/VERSION` (staged for
the `npm pack` run and removed afterwards), so the panel deploys the engine
offline and the deployed version is the tarball's version.

1. Put this `plugin/` directory where the DSH profile can link it, for example
   `~/.dsh/plugins/dsh-workflow-console`.
2. Add the package to `~/.dsh/profiles/<profile>/package.json` — both the
   dependency and the bundle list:

   ```json
   {
     "dsh": { "profile": { "bundles": ["dsh-workflow-console"] } },
     "dependencies": {
       "dsh-workflow-console": "link:C:/path/to/subagent-workflow/plugin"
     }
   }
   ```

3. Add the roots to `~/.dsh/profiles/<profile>/cordis.patch.yml` (the row
   overrides the package's default `roots: []`):

   ```yaml
   - id: dsh-workflow-console
     config:
       roots:
         - C:\src\my-project
   ```

4. Install profile dependencies and restart the host (the client bundle is read
   at activation).
5. Open a conversation and switch to the **Workflow** view.

`package.json` keeps `"private": true` so an accidental `npm publish` cannot
happen; remove it when the package gets its own release channel.

`cordis.patch.yml` in this package is the default layer: it inserts the plugin
with empty `roots`. `roots` must be absolute paths; relative paths are ignored.
If `roots` is empty, the plugin falls back to the workspace registry (read-only)
when that service is available.

## HTTP API (loopback only)

| Route | Answer |
| --- | --- |
| `GET /workflow/api/status` | roots, selected repository, package version, policy line |
| `GET /workflow/api/tasks` | board: tasks with stage and flags |
| `GET /workflow/api/task/:id` | one task card, including `git log` |
| `GET /workflow/api/policy` | effective policy, models, roles, warnings |
| `GET /workflow/api/compat` | version compatibility checks and manual recommendations |
| `GET /workflow/api/checks` | the three read-only gates and what they cover |
| `POST /workflow/api/run` | runs one gate, returns `{exitCode, ok, log, command, durationMs, logPath}` — no writes |
| `POST /workflow/api/guard` | flips `guard.enabled` (one config key) and appends `guard.log` |
| `POST /workflow/api/deploy` | deploys the bundled engine into the selected root; `confirm: true` is required |

All routes accept `?root=<configured root or registered workspace>`. The three
POST routes are the explicit writes described above; every other route is GET.
A wrong method answers 405 with `Allow`; a path outside both root lists answers
400.

## Version compatibility and the current workspace

The panel is a view of a repository, not of the DSH workspace. To make the
distinction visible:

- the client asks the DSH `uiWorkspace` service for the current workspace and
  opens that repository when it has `docs/subagent-workflow`;
- if the current workspace has no workflow, the panel falls back to the first
  configured root and says so in the location line;
- the header always shows **Текущий workspace** and **показан** (the displayed
  repository); a different root is labelled;
- every compact badge carries a human-readable hint (`title` + `aria-label`):
  risk, error and warning counts, `assumed`, attack and coverage flags, stage,
  policy values and flag codes. Hints use the native tooltip; badges inside a
  card button are not focusable — that button's `aria-label` carries the summary.

The **Совместимость** tab compares the plugin (0.7.1, supports workflow
2.0.0 – 2.6.x, включая `effect`, регресс-долг, guard и запись 2.6.0) with the deployed copy: VERSION/SPEC,
required scripts, lock and record versions. Checks carry a recommendation, but nothing is executed
automatically — commands are for a human. A limited compatibility state adds a
banner above every page.

## Diagnostics

The panel can run three gates and show their log:

| Check | Scope | Script |
| --- | --- | --- |
| `doctor` | repository | `scripts/doctor.mjs` |
| `lint` | task | `scripts/task-lint.mjs` |
| `check-acceptance` | task | `scripts/task-check-acceptance.mjs` |

Buttons sit in the header (`doctor`) and in the task card (`lint`,
`check-acceptance`). `POST /workflow/api/run` with `{check, root, task}` does
the work and returns `{exitCode, ok, log, command, durationMs, logPath}`;
`GET /workflow/api/checks` lists what is available.

All three only read the repository: none writes a lock, a record or the config,
and the panel never signs and never accepts. A non-zero exit code is a result,
not an HTTP error. Output goes to a log file under the system temp directory
instead of a pipe — inside the DSH sandbox a child with piped stdio fails with
`EPERM`, while file descriptors work — and the response carries the last 24 000
characters of that log. The command is spawned without a shell, so nothing from
the URL or the body reaches a command line unquoted.

## Development

```bash
node --test test/
node tools/dev-server.mjs --root <repository> --port 17872
curl -s http://127.0.0.1:17872/workflow/api/status
```

Inside the DSH sandbox `node --test test/` fails with `EPERM`: the runner spawns
children with piped stdio, which the sandbox forbids. Run the files directly —
`node test/state.test.mjs`, `node test/api.test.mjs` and so on; each file runs
its own suite in-process.

The dev server mounts the same handler as the host plugin; it is not a second
DSH. The client is plain classic JavaScript (no JSX, no bundler), served by the
DSH module loader from `lib/client.js`.

Product ideas and deferred UX work live in [BACKLOG.md](BACKLOG.md).

## Write guarantee

The plugin opens files for reading and runs only `git rev-parse`, `git log` and
`git ls-files`; the three diagnostics above are the only other read-only commands
it starts. There are exactly two write paths, and both need a human confirmation:

- `POST /workflow/api/guard` — one key `guard.enabled` plus a line in
  `docs/subagent-workflow/guard.log`;
- `POST /workflow/api/deploy` — the bundled `init.mjs --force` in the selected
  root, only with `confirm: true`. It creates the engine, `docs/tasks`,
  `.gitignore` lines and the local `core.hooksPath`; it does not change
  `policy`, tasks, locks or acceptance records, never signs, commits or accepts.

Nothing else writes. `test/api.test.mjs` snapshots the fixture's
`git status --porcelain` and tracked-file hashes before and after a full request
sweep and after a diagnostics run, and requires equality; the deploy tests check
that every refusal (no `confirm`, not a repository, foreign root) creates no
files at all.
