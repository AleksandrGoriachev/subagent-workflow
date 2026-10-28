# Отчёт исполнителя по заданию 0004

Задание: коммит и пуш без задания отклоняются. Версия пакета 2.5.0.
Работа оставлена в рабочем дереве, коммитов не делал. Контракт 0003 не подписан:
найдены дефекты pre-push (P1, P2) — исправлены ниже.

## 1. Что изменено по смыслу

### P1. Покрытие оценивается на дереве коммита, а не на текущем рабочем дереве

Ошибка: `--range` брал пути диапазона и проверял их по текущему рабочему дереву.
После появления `acceptance.json` задание закрывалось задним числом, и коммит,
сделанный при открытом задании, при пуше выглядел «вне задания» — штатный порядок
«приёмка → коммит → пуш» блокировался собственным хуком.

Реализация (`spec/scripts/task-guard.mjs`):

1. `commitsInRange(repo, range)` — `git rev-list --reverse <range>`: каждый коммит
   диапазона оценивается отдельно.
2. `coverageFromCommit(repo, config, rev, cache)` — состояние заданий **в дереве
   коммита**: один `git ls-tree -r -z --full-tree <rev> -- docs/tasks` даёт список
   файлов задания с blob-хешами; `task.md` читается через `git cat-file blob <sha>`
   с кэшем по blob-хешу (соседние коммиты обычно делят один контракт), из
   `TASK-META` берутся `allowedPaths`; наличие `criteria.lock` и
   `acceptance.json` берётся из того же листинга. Активное задание — замок есть,
   записи приёмки нет; и это состояние **того** коммита.
3. Пути коммита — `git diff-tree --root --no-commit-id --name-only -r -z <sha>`
   (работает и для корневого коммита), без обращения к индексу или рабочему дереву.

Настройки (`enabled`, `mode`, `allow`, `bypassMarker`) по-прежнему читаются из
рабочего дерева: это действующая политика сейчас, а не исторический факт.

Дополнительно: каталог задания `docs/tasks/<id>/**` покрыт целиком, пока задание
открыто, и только своими артефактами (`acceptance.json`, `report.md`,
`report.json`, `verify.json`, `verify.log`, `red.json`, `red.log`,
`criteria.lock`, `attack.json`) после закрытия. Иначе metadata-коммит с
`acceptance.json` (штатный шаг «приёмка → коммит → пуш») блокировался бы сам.
`task.md` и `criteria.json` закрытого задания не покрыты: контракт молча менять
нельзя. Проверено вручную: metadata-коммит — exit 0; правка `task.md` закрытого
задания — exit 1 с «не покрыт».

### P2. Метка обхода действует на пуш

`--range` больше не полагается на `--message` (у push его нет): для каждого
коммита сообщение читается через `git show -s --format=%s%n%b <sha>`, маркер
`guard.bypassMarker` ищется подстрокой без учёта регистра. Найденная метка
разрешает коммит и печатается аудитом; `--audit --range` показывает её так же.
`--message` остаётся только у `--staged` (его передаёт `commit-msg`).

### Прочее

- `--audit --range` использует ту же пер-коммитную оценку (аудит не расходится с
  проверкой).
- Вывод отказа для push: заголовок «пуш отклонён…», диапазон и строки
  `<sha> <subject> — не покрыт: <пути>`; подсказки про метку, `--audit` и
  `--no-verify`.
- Документация: SPEC §6.1, README (раздел «Коммит без задания»), CHANGELOG 2.5.0,
  `plugin/README.md` и тексты панели (коммит и пуш).

## 2. Файлы (полные пути)

Новые (из 0003, без изменений по смыслу — кроме task-guard):

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-guard.mjs` (переписан под P1/P2)
- `...\spec\hooks\pre-commit`
- `...\spec\hooks\commit-msg`
- `...\spec\hooks\pre-push`
- `...\plugin\lib\guard.js`

Изменённые в этой итерации:

- `...\subagent-workflow-v2\spec\scripts\task-guard.mjs` — пер-коммитная оценка, чтение сообщений
- `...\subagent-workflow-v2\spec\SPEC.md` — §6.1: покрытие на дереве коммита, метка на push, артефакты закрытого задания
- `...\subagent-workflow-v2\README.md` — раздел «Коммит без задания»
- `...\subagent-workflow-v2\CHANGELOG.md` — 2.5.0: P1/P2
- `...\subagent-workflow-v2\plugin\lib\client.js` — тексты подтверждения и подсказок: коммит и пуш
- `...\subagent-workflow-v2\plugin\README.md` — пределы guard для пуша

Остальные изменённые файлы — реализация 2.5.0 из 0003 (init, хуки, панель, версия,
документация, e2e); `spec/checks/**` не тронут: sha256
`f2d8cc96bcc4f903636b5f5bd9d1cc7a3ebf92b5436195f3fa0bbffad57c737b` совпадает с
замком 0004.

## 3. Проверки

`node spec/checks/guard-acceptance.mjs --all` → exit 0, 8 PASS / 0 FAIL:

- PASS allow — exit=0
- PASS deny — exit=1 path=true explains=true («не покрыт: notes.txt»)
- PASS bypass — allow=0 audit=0 mentions=true
- PASS disabled — exit=0
- PASS hooks — init=0 hooksPath="docs/subagent-workflow/hooks" global=1 preCommit=true prePush=true
- PASS pushAfterAcceptance — commit=0 push=0 (контрольный коммит вне задания отклонён)
- PASS bypassOnPush — commit=0 push=0 (контрольный коммит вне задания отклонён)
- PASS panel — restSame=true logged=true toggled=true

`node spec/scripts/task-verify.mjs --task docs/tasks/0004` → exit 0, 10/10 PASS
(C1–C10), `violations=[]`, `coverage.uncovered=[]`, `allPassed=true`,
digest дерева `88c914cbfd86af8eb1657333f71d8ce2b037e4fd2a6706db746e074fd9586651`.

`node spec/selftest.mjs` → exit 0, 53 PASS / 0 FAIL, SELFTEST OK.
`node spec/e2e.mjs` → exit 0, 57 PASS / 0 FAIL, E2E OK.
`node spec/e2e-deploy.mjs` → exit 0, 25 PASS / 0 FAIL, DEPLOY E2E OK; хеши
`%USERPROFILE%\.wf-keys` (sha256 + размер + mtime) до и после не изменились.
`node plugin/tools/test.mjs` → exit 0, tests 78, pass 78, fail 0.
`node tools/check-version.mjs` → exit 0, 7 PASS, VERSION OK: 2.5.0.
Внешний `task-lint` по `docs/tasks/0004` → exit 0, `task-lint: 0004 — ок`.

Ручная проверка правила артефактов: metadata-коммит с `acceptance.json` закрытого
задания — exit 0; правка `task.md` закрытого задания — exit 1.

## 4. Отклонения и спорное

1. **Настройки читаются из рабочего дерева, состояние заданий — из коммита.** Это
   осознанное разделение: `guard.enabled` — действующая политика (иначе после
   выключения guard старые коммиты всё равно проверялись бы), а «открыто ли
   задание» — факт истории. Если приёмка ждёт иное — это одно место
   (`coverageFromCommit` vs `guardSettings`).
2. **Артефакты закрытого задания.** Без этого правила metadata-коммит приёмки
   блокируется собственным хуком, то есть предписанный порядок «приёмка → коммит →
   пуш» снова ломается. Список артефактов — `CLOSED_TASK_ARTIFACTS` в
   `task-guard.mjs`; `task.md`/`criteria.json` в него не входят.
3. **`--staged` по-прежнему сверяет индекс с рабочим деревом**, а не с деревом
   будущего коммита: в момент `commit-msg` они совпадают, а частичный индекс —
   отдельный сценарий, контрактом не заказанный.
4. `--audit --range` без `--range` (то есть аудит индекса) сообщения коммита не
   видит — сказано в выводе.
5. Замок 0004 записан при моих правках в дереве, `tool` в нём —
   `subagent-workflow/2.5.0`; `spec/checks/guard-acceptance.mjs` в замке совпадает
   с файлом.
6. Версия осталась 2.5.0 (C8), запись CHANGELOG 2.5.0 дополнена P1/P2 — отдельного
   релиза на перевыпуск контракта не делал.

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
?? docs/tasks/0004/criteria.lock
?? docs/tasks/0004/red.json
?? docs/tasks/0004/verify.json
?? plugin/lib/guard.js
?? spec/hooks/
?? spec/scripts/task-guard.mjs
```

`git diff --stat`: 18 файлов, +657 / −35 (без новых файлов; `spec/hooks/`,
`spec/scripts/task-guard.mjs`, `plugin/lib/guard.js` — untracked; `verify.json`/
`red.json`/`criteria.lock` — артефакты задания).
