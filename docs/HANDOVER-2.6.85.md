# ХЕНДОВЕР — 2.6.85 опубликован, приёмка 0080

## Состояние

- Пакет `subagent-workflow`: HEAD `d789043`, всё запушено в origin (main = `d789043`).
- Движок **2.6.85**, панель **0.9.38** — впервые вышли релизом вместе:
  https://github.com/AleksandrGoriachev/subagent-workflow/releases/tag/v2.6.85 (9 ассетов, SMOKE, HTTP 200,
  `release-receipt --online` зелёный). Коммит выпуска `0a59dc4`, тег `v2.6.85`.
- Внутри 2.6.85: hotfix `tools/release.mjs` (`panelVersionOf(root)` — версия панели из проверяемого корня),
  `dshPanelVersion: 0.9.38` в package.json, из `acceptors.json` убрана retired-запись `agent-judge`.
- Приёмка: задача **0080** `accepted` узлом `judge` (ключ `agent-judge`, separate-session, deviation без
  launch evidence); запись `docs/tasks/0080/acceptance.json` + `gates.jsonl`, metadata-коммит `d789043`.
- Владелец обновил узлы: `judge` и `reviewer-1` → `deepseek-official/deepseek-flash`. `opencode-go` недоступен
  (429, месячный лимит): `worker-1..3,5`, `Critic`, `tester-1` мертвы.
- Тег `v2.6.84` (`7b779a9`) остался без релиза — исторический след неудачной первой попытки.

## Что не сделано / открыто

1. `task-accept` не учитывает ротацию ключа (берёт первую запись по keyId) — лечить через
   `selectAcceptorEntry`, иначе каждая ротация будет требовать ручной чистки `acceptors.json`.
2. Для задач в корне пакета недостижимо launch evidence: корень `subagent-workflow-v2` не входит в список
   разрешённых корней спавна (`root-not-allowed`). Нужен либо корень пакета в конфиге спавна, либо штатный
   способ приёмки задач внутри пакета.
3. Артефакты задания нельзя коммитить до приёмки (сдвиг HEAD отвязывает кандидата), а выпускной коммит в
   движке создаётся до приёмки. Приём: ассеты собирать без коммита (`git write-tree` + `git archive <tree>`),
   после приёмки — коммит+тег и пересборка архива из тега. Это зафиксировано в `docs/DEVIATIONS.md`
   (воркспейс) и в followUps контрактов 0079/0080.
4. `docs/DEVIATIONS.md` воркспейса изменён, но не закоммичен — воркспейс коммитит владелец.
5. Панель: после обновления движка рекомендуется перезапуск DSH (клиентский бандл 0.9.38).

## Как проверить

```
cd subagent-workflow-v2
node tools/check-version.mjs          # VERSION OK: 2.6.85
node tools/release.mjs preflight 2.6.85   # preflight: OK
node spec/scripts/task-check-acceptance.mjs --file docs/tasks/0080/acceptance.json --repo .
node spec/checks/release-receipt.mjs --online     # OK
node plugin/tools/test.mjs            # 308/308 (около 4 минут; под песочницей workspace-write даёт ложные отказы)
```
## Дополнение (утро 20.11)

- Закрыты ещё три задачи: **0081** (task-accept берёт ключ по окну ротации через
  `lib/accept-key.mjs`), **0082** (`tools/commit.ps1 -DeleteTag`), **0083** (проверки сверяют коды
  выхода, а не кириллицу в выводе pwsh; `spec/checks/console-encoding.mjs` гоняет случаи под chcp 866).
  HEAD `bfb76dc`, тег `v2.6.84` удалён штатным путём.
- Воркспейс закоммичен (`5115585`); в нём появился штатный вход коммита `tools/commit.ps1`.
- Структуре отправлено письмо `--193`: объявление 2.6.85 и три просьбы — двухфазный порядок выпуска
  в спеке узла, launch evidence для корня пакета, кодировка в их проверках. Ответа пока нет.
- Открыто: `opencode-go` в месячном лимите (узлы `worker-1..3,5`, `Critic`, `tester-1`),
  `reviewer-1` и `judge` переведены владельцем на `deepseek-official`.
## 2.6.86 — выпущен (двухфазный порядок повторён)

- Релиз: https://github.com/AleksandrGoriachev/subagent-workflow/releases/tag/v2.6.86, тег `v2.6.86` → `1a32c34`,
  9 ассетов, SMOKE внутри, `release-receipt --online` зелёный; панель 0.9.38.
- Внутри: 0081 (ключ приёмщика по окну ротации), 0082 (`commit.ps1 -DeleteTag`), 0083 (коды выхода вместо
  кириллицы), 0084 (`tasksInProgress` учитывает `closure.json`).
- Задача выпуска `0085` принята узлом `judge` (separate-session, ключ `agent-judge`, deviation по launch
  evidence), коммит `1a32c34` включает и приёмку, и версию. Дерево чистое, HEAD = тег.
- Порядок отработан второй раз подряд: подготовка в рабочем дереве (`git write-tree` + `git archive <tree>`),
  приёмка, коммит+тег+пуш, пересборка архива из тега, публикация узлом `release-1` (23 с).
- Структуре отправлено объявление `--197`; ждём подтверждения, что их гвард после обновления на 2.6.86
  перестал требовать `allowInProgress`.
- Открыто: `opencode-go` в месячном лимите (`worker-1..3,5`, `Critic`, `tester-1`).
