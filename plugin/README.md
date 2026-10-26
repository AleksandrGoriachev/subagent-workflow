# dsh-workflow-console

Read-only Web panel for [subagent-workflow](../README.md) repositories inside
DeepSeek Harness. It reads task artifacts and `workflow.config.json`, and never
runs a gate, writes a file, or changes `policy`.

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
  repository); a different root is labelled.

The **Совместимость** tab compares the plugin (0.1.0, supports workflow
2.0.0 – 2.2.x) with the deployed copy: VERSION/SPEC, required scripts, lock and
record versions. Checks carry a recommendation, but nothing is executed
automatically — commands are for a human. A limited compatibility state adds a
banner above every page.

## Development

```bash
node --test test/
node tools/dev-server.mjs --root <repository> --port 17872
curl -s http://127.0.0.1:17872/workflow/api/status
```

The dev server mounts the same handler as the host plugin; it is not a second
DSH. The client is plain classic JavaScript (no JSX, no bundler), served by the
DSH module loader from `lib/client.js`.

Product ideas and deferred UX work live in [BACKLOG.md](BACKLOG.md).

## Read-only guarantee

The plugin opens files for reading and runs only `git rev-parse`, `git log` and
`git ls-files`. It has no POST/PUT/DELETE route, no write API and no gate
runner. `test/api.test.mjs` snapshots the fixture's `git status --porcelain` and
tracked-file hashes before and after a full request sweep and requires equality.
