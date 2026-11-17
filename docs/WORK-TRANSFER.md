# Передача работы: код — структуре, процесс — workflow

Дата: 2026-11-16. Основание: решение заказчика — «написание кода передаём в родной воркспейс структуры (dsh-project-graph), workflow занимается своим».

## 1. Граница владения

| артефакт | владелец | кто пишет |
| --- | --- | --- |
| `lib/**`, `test/**`, `tools/**`, `checks/**`, `structure/graph.json` | structure | узел `worker`; руками — никто, включая workflow |
| `docs/tasks/<id>/**` (task.md, criteria.json, check.mjs, red/verify, acceptance.json) | structure | coordinator структуры; приёмку подписывает `judge` ключом |
| `spec/**`, `spec/checks/**`, stopline, ночной T1, `reports/**`, `docs/REPORT-*`, `coordination/acceptance/**` | workflow | эта сессия в своём воркспейсе |

Два гейта, не подменяют друг друга: внутренняя приёмка (judge подписывает задачу) и межсторонняя (workflow — вердикт по артефактам, см. ACCEPTANCE-PROTOCOL.md). Workflow не подписывает код и не пишет в чужой воркспейс.

## 2. Формат письма-назначения

```
Format: dsh-exchange/1
From: workflow
To: structure
Thread: exchange
Status: request
Task: <id> | ContractSha: <sha после criteria.lock>
Criteria: C1..Cn — что доказывает каждый
RedExpect: mustFail [..], mustPass [..], причины
Paths: <allowedPaths>
DependsOn: <id|нет>
VerdictBy: judge (внутренняя), workflow (межсторонняя, по артефактам)
```

Причина формата: назначения `--06` (16.11) дважды не превратились в задачи — в них не было ни критериев, ни привязки к контракту.

## 3. Условия передачи (все обязательны)

1. Контракт закоммичен, SHA назван, `preflight.json` свежий.
2. Red доказан до кода; артефакты red/verify не коммитятся до приёмки.
3. Приёмка — только `judge` с ключом (`agent-judge-4`).
4. Обратная заявка — по §2 ACCEPTANCE-PROTOCOL (коммит контракта, критерии, сырой вывод, файлы, отступления, SHA кандидата/приёмки, сводка regress с `coversSkipped`).
5. Тяжёлое — `job.mjs`, не сном (`waitPolicy=fail`).
6. Задача, меняющая механизм приёмки: writer ≠ acceptor.
7. Возврат без доказательства = возврат.

## 4. Состояние передачи

- 2026-11-16 17:01 — письмо `coordination/threads/exchange/2026-11-16T17-01+03-00--workflow--175.md` отправлено и **доставлено** (`delivered:wake`, адресат `structure`, запись в `~/.dsh/project-graph/runs/exchange-decisions.jsonl`).
- Передано четыре задачи: **0276** (письмо-след при сбое расписания), **0277** (`extractTesterBody`), **0278** (данные covers 0013/C3, −168 с), **0279** (привязка запуск ↔ контракт: `project_graph_spawn/run` с `task` не читает контракт ни для какого задания).
- Ждём ответ структуры: подтверждение передачи и порядка, номера задач, SHA контрактов.
- Сканер со стороны структуры на момент отправки: «непрочитано 1, требуют хода 1» — это и есть переданное письмо; со стороны workflow — 0.

## 5. Что делает workflow, пока структура работает

1. Держит `spec/**`, stopline, ночной T1 и отчёты — без правок в dsh-project-graph.
2. Даёт вердикт по каждой заявке: письмо `Status: answer` + запись `coordination/acceptance/<дата>--<задача>--workflow.md`.
3. Проверка заявки — по артефактам; при их недостаточности — разовый read-only permit, как в протоколе.
4. Ночной T1 03:00 MSK: `task-regress --json --timeout 300000 --jobs 1` → evidence в `spec/checks/stopline/regress-schedule.json` → `t1-regress-gate.mjs`.
