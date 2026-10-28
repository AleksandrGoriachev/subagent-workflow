# Отчёт исполнителя по заданию 0003

Задание: коммит без задания отклоняется — task-guard, хуки, флаг из панели.
Версия пакета 2.5.0. Работа оставлена в рабочем дереве, коммитов не делал.

## 1. Что изменено по смыслу

1. **Гейт `task-guard`** (`spec/scripts/task-guard.mjs`). Режимы `--staged
   [--message <text>]`, `--range <from..to>`, `--audit [--range]`. Настройка —
   блок `guard` в `workflow.config.json` (`enabled`, `mode`, `allow`,
   `bypassMarker`). При `enabled !== true` скрипт выходит 0 и молчит (для
   `--audit` — одна поясняющая строка). Непокрытый путь: exit 1, строки
   «не покрыт: <путь>» и подсказка (метка обхода, `--audit`, предел `--no-verify`).
2. **Покрытие (D3).** Активное задание — есть `criteria.lock` и нет
   `acceptance.json`; его `allowedPaths` покрывают пути. Каталог незакрытого
   задания `docs/tasks/<id>/**` покрывает себя сам (иначе контракт нового
   задания не закоммитить: замка у него ещё нет). Плюс `guard.allow` и метка
   обхода в сообщении коммита. `--audit` печатает метки обхода и нарушения и
   всегда exit 0.
3. **Хуки** (`spec/hooks/`). `pre-commit` — аудит индекса и не отказывает:
   git отдаёт сообщение коммита только `commit-msg`, поэтому решение принимает
   `commit-msg` (видит метку обхода). `pre-push` проверяет диапазон
   `remote..local`, для новой ветки — коммиты, которых нет ни в одном remote.
4. **`init`** копирует хуки, даёт им право исполнения и ставит ЛОКАЛЬНЫЙ
   `git config core.hooksPath docs/subagent-workflow/hooks`; глобальный конфиг
   не трогается, повторный `init` идемпотентен. `guard.log` добавлен в
   `.gitignore`.
5. **Панель.** `plugin/lib/guard.js: writeGuardEnabled(root, enabled)` меняет
   только `guard.enabled` (текстовая правка, остальные ключи байт в байт) и
   дописывает строку `<ISO> enabled=true|false actor=<DSH_SESSION_ID|unknown>
   source=panel` в `guard.log`. POST `/workflow/api/guard`; кнопка с
   подтверждением на странице «Политика»; `/workflow/api/policy` показывает
   эффективные значения guard. Плагин 0.5.0, диапазон `2.0.0 – 2.5.x`.
6. **Документация и версия.** Версия 2.5.0 в пяти местах, секция CHANGELOG,
   абзац «Версия 2.5.0:» и §6.1 в SPEC, разделы в README и `plugin/README.md`,
   пункты в `RELEASE-CHECKLIST.md`. Пределы названы: `--no-verify` обходит
   хуки целиком, аудит показывает только явные метки.
7. **e2e** дополнен сквозным случаем guard: выключен — коммит проходит;
   включён — коммит вне задания отклоняется (метка «не покрыт» и путь);
   метка `[workflow-bypass: …]` разрешает; `--audit` её показывает; push
   отклоняется/проходит так же; `init` выставил локальный `core.hooksPath`.

## 2. Файлы (полные пути)

Новые:

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-guard.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\hooks\pre-commit`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\hooks\commit-msg`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\hooks\pre-push`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\plugin\lib\guard.js`

Изменённые:

- `...\subagent-workflow-v2\spec\scripts\init.mjs`
- `...\subagent-workflow-v2\spec\workflow.config.json`
- `...\subagent-workflow-v2\spec\e2e.mjs`
- `...\subagent-workflow-v2\spec\scripts\lib\common.mjs`
- `...\subagent-workflow-v2\spec\SPEC.md`
- `...\subagent-workflow-v2\plugin\lib\api.js`
- `...\subagent-workflow-v2\plugin\lib\client.js`
- `...\subagent-workflow-v2\plugin\lib\compat.js`
- `...\subagent-workflow-v2\plugin\package.json`
- `...\subagent-workflow-v2\plugin\README.md`
- `...\subagent-workflow-v2\plugin\test\api.test.mjs`
- `...\subagent-workflow-v2\plugin\test\client.test.mjs`
- `...\subagent-workflow-v2\plugin\test\compat.test.mjs`
- `...\subagent-workflow-v2\VERSION`, `package.json`, `README.md`, `CHANGELOG.md`, `RELEASE-CHECKLIST.md`

`spec/checks/**` не тронут: sha256 `608b0ff116225d6ac5d06e7285776c41e34ba6c4fbeda06557a1f4eec9403fda`
совпадает с замком.

## 3. Проверки

`node spec/checks/guard-acceptance.mjs --all` → exit 0, 6 PASS / 0 FAIL:

- PASS allow — exit=0
- PASS deny — exit=1 path=true explains=true («не покрыт: notes.txt»)
- PASS bypass — allow=0 audit=0 mentions=true
- PASS disabled — exit=0
- PASS hooks — init=0 hooksPath="docs/subagent-workflow/hooks" global=1 preCommit=true prePush=true
- PASS panel — restSame=true logged=true toggled=true

`node spec/selftest.mjs` → exit 0, 53 PASS / 0 FAIL, `SELFTEST OK`.

`node spec/e2e.mjs` → exit 0, 57 PASS / 0 FAIL, `E2E OK` (было 49; +8 проверок guard).

`node spec/e2e-deploy.mjs` → exit 0, 25 PASS / 0 FAIL, `DEPLOY E2E OK`;
хеши `%USERPROFILE%\.wf-keys` до и после (sha256 + размер + mtime) не изменились.

`node plugin/tools/test.mjs` → exit 0, tests 78, pass 78, fail 0.

`node tools/check-version.mjs` → exit 0, 7 PASS, `VERSION OK: 2.5.0`.

`node C:/…/docs/subagent-workflow/scripts/task-lint.mjs --repo … --task docs/tasks/0003`
→ exit 0, `task-lint: 0003 — ок`.

## 4. Отклонения и спорное

1. **Решение принимает `commit-msg`, а не `pre-commit`.** Проверено
   эмпирически: на момент `pre-commit` файла сообщения (`COMMIT_EDITMSG`) ещё
   нет ни при `-m`, ни при `-F`, поэтому метку обхода в `pre-commit` увидеть
   нельзя. `pre-commit` остаётся обёрткой над `task-guard --audit`: печатает
   нарушения и не отказывает; отказ — в `commit-msg` (плюс ручной
   `task-guard --staged`). `pre-push` отказывает сам.
2. **Каталог незакрытого задания покрывает себя.** Буквальное D3 («allowedPaths
   задания с замком и без приёмки») не позволяет закоммитить контракт нового
   задания: замка ещё нет. Реализовано: `docs/tasks/<id>/**` покрыт, если у
   задания есть task.md и нет `acceptance.json`; это записано в SPEC §6.1,
   README и CHANGELOG. Если приёмка считает иначе — нужна правка одного условия.
3. **`mode: off` при `enabled: true`** — проверка не выполняется (семантика как
   у policy); `warn` печатает и выходит 0.
4. **Удаление файла — изменение**: непокрытое удаление отклоняется (как считает
   `diffPaths` в `task-verify`).
5. **`--audit` без `--range`** аудирует индекс; сообщения коммита там нет, это
   сказано в выводе.
6. **Плагин поднят до 0.5.0**, диапазон совместимости — `2.0.0 – 2.5.x`: иначе
   панель на своём же релизе 2.5.0 показывает «workflow новее поддерживаемого».
   Тесты плагина обновлены (2.5.0 — рабочее состояние; «отставший плагин» —
   2.6.0).
7. **Замок 0003 записан с `tool: subagent-workflow/2.4.9`** (ставился, пока
   правки исполнителя были в stash). `verifyLock` поле `tool` не сравнивает,
   перезамок после красного запрещён — оставлено как есть.
8. **Конфиг самого репозитория** `docs/subagent-workflow/workflow.config.json`
   вне `allowedPaths` и блока `guard` не имеет: включение проверки для этого
   репозитория — действие заказчика на панели.
9. **CI (`.github/**`) вне `allowedPaths`** — приёмочные проверки задания в CI
   не добавлены; это решение архитектора.
10. **Право исполнения хуков.** `init` выставляет `chmod 0o755` после копирования,
    потому что checkout на Windows хранит 644; на POSIX без этого git хук не
    запускает. Проверено только на Windows.
11. **`--no-verify`** пропускает хуки целиком, следа в аудите нет — названо в
    README, SPEC §6.1, CHANGELOG и в тексте отказа `task-guard`.

## 5. git status --short

```
 M CHANGELOG.md
 M README.md
 M RELEASE-CHECKLIST.md
 M VERSION
 M package.json
 M plugin/README.md
 M plugin/lib/api.js
 M plugin/lib/client.js
 M plugin/lib/compat.js
 M plugin/package.json
 M plugin/test/api.test.mjs
 M plugin/test/client.test.mjs
 M plugin/test/compat.test.mjs
 M spec/SPEC.md
 M spec/e2e.mjs
 M spec/scripts/init.mjs
 M spec/scripts/lib/common.mjs
 M spec/workflow.config.json
?? docs/tasks/0003/criteria.lock
?? docs/tasks/0003/red.json
?? docs/tasks/0003/verify.json
?? plugin/lib/guard.js
?? spec/hooks/
?? spec/scripts/task-guard.mjs
```

`git diff --stat`: 18 файлов, +625 / −35 (без новых файлов; `spec/hooks/`,
`spec/scripts/task-guard.mjs`, `plugin/lib/guard.js` — untracked).
