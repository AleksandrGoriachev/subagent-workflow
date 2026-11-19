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
