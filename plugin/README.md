# dsh-workflow-console

Read-only Web panel for [subagent-workflow](../README.md) repositories inside
DeepSeek Harness. It reads task artifacts and `workflow.config.json`, and never
runs a gate, writes a file, or changes `policy`.

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

## HTTP API (loopback only, GET only)

| Route | Answer |
| --- | --- |
| `GET /workflow/api/status` | roots, selected repository, package version, policy line |
| `GET /workflow/api/tasks` | board: tasks with stage and flags |
| `GET /workflow/api/task/:id` | one task card, including `git log` |
| `GET /workflow/api/policy` | effective policy, models, roles, warnings |
| `GET /workflow/api/compat` | version compatibility checks and manual recommendations |

All routes accept `?root=<configured root or registered workspace>`. Non-GET
methods answer 405; a path outside both lists answers 400.

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

The **Совместимость** tab compares the plugin (0.3.1, supports workflow
2.0.0 – 2.4.x — показанные поля; `effect`/`regress` см. ниже) with the deployed
copy: VERSION/SPEC, required scripts, lock and record versions. Checks carry a recommendation, but nothing is executed
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

## Read-only guarantee

The plugin opens files for reading and runs only `git rev-parse`, `git log` and
`git ls-files`; the three diagnostics above are the only other commands it
starts, and they read too. There is exactly one POST route (`/api/run`), no
write API, no signing and no acceptance path. `test/api.test.mjs` snapshots the
fixture's `git status --porcelain` and tracked-file hashes before and after a
full request sweep and after a diagnostics run, and requires equality.
