# Переоценка якорей 2.6.82 — 2026-11-18

Повод: после выпусков 2.6.72–2.6.82 подтверждения контурных якорей устарели по релизам;
оставались в работе A7 и A14; проектный набор воркспейса не был заведён.

## 1. Прогоны (исполнением, не чтением)

| Якорь | Проверка | Команда | Результат |
| --- | --- | --- | --- |
| A1 | guard-acceptance | `node spec/checks/guard-acceptance.mjs --all` | exit 0 |
| A2 | relock-policy (c1–c2) | `node spec/checks/relock-policy.mjs c1`; `c2` | OK c1, OK c2 |
| A3 | model-source | `node spec/checks/model-source.mjs` | OK c1–c4 |
| A4 | release-check | `cd plugin && node --test test/release-check.test.mjs` | exit 0 |
| A5 | gates-journal (c1–c2) | `node spec/checks/gates-journal.mjs c1`; `c2` | OK c1, OK c2 |
| A6 | network-contract, outgoing-headers | `cd plugin && node --test test/network-contract.test.mjs`; `node spec/checks/outgoing-headers.mjs` | exit 0; OK |
| A7 | процедура (см. ниже) | — | полуавтомат |
| A8 | дефект → гейт → доказательство | живой случай 18.11: мёртвый сторож → `job-runner` c4/c5 | гейт добавлен и падает на старом поведении |
| A9 | release-publish, release-smoke | выпуск 2.6.82: `SMOKE-v2.6.82.json` ok, 8 ассетов | опубликовано |
| A10 | журнал exchange-decisions | разбор доставки (workflow--186) | три состояния различаются |
| A11 | report-honesty | отчёты 186/187/188 называют границы проверки | подтверждено |
| A12 | job-runner | `node spec/checks/job-runner.mjs c1…c5` | OK c1–c5 |
| A13 | stopline-accept | `tools/stopline-accept.mjs` | инструмент на месте |
| A14 | role-binding | `cd plugin && node --test test/c11-role-binding.test.mjs` | exit 0 |

## 2. Что изменено

- A1–A6, A8–A12: `confirmed.version = 2.6.82`, `confirmed.date = 2026-11-18`.
- A7: статус `inWork` → `semi`; проверка — человеческая процедура (перечень вызывающих общего
  модуля и ожиданий в отчёте задания). Машиной не считается: `spec/checks/shared-impact.mjs`
  нет, WC-69 не реализован.
- A14: статус `inWork` → `auto`; проверка — `plugin-test test/c11-role-binding.test.mjs` +
  критерий C11 в `spec/engine.mjs`.

## 3. Проектный набор воркспейса

Создан `default-workspace/docs/anchors.json`: P1 (закрытое без приёмки не расширяет allowedPaths),
P2 (мёртвый сторож → STALE), P3 (приёмка отдельной сессией с подписью). Все `layer: project`,
`enforcedBy: nodes`, `status: auto`, у каждого `proof` — команда и артефакт.

## 4. Подписи (владелец, не агент)

- контур: новый `docs/anchors.json` — sha256 `fe5c4e10…b61b11`, 8098 байт; черновик
  `docs/anchors.approval.draft.json`; требуется подпись владельца в `docs/anchors.approval.json`.
- проект: `default-workspace/docs/anchors.json` — sha256 `1db1f4aa…ee118`, 2211 байт; черновик
  `default-workspace/docs/anchors.approval.draft.json`; требуется подпись владельца.
- До подписи `anchor-freshness` (контур) и `anchor-freshness --project` красные по утверждению —
  это ожидаемое состояние, а не дефект содержимого.
