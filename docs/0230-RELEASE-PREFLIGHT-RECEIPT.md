# 0230 — preflight не должен выдумывать проверку квитанций в чужом корне

<!-- TASK-META
{
  "id": "0230",
  "version": 1,
  "title": "preflight: квитанции проверяются только там, где инструмент есть",
  "risk": "medium",
  "created": "2026-11-12",
  "owner": "заказчик",
  "executor": "subagent:worker",
  "executorNode": "worker",
  "acceptor": "subagent:judge",
  "acceptorNode": "judge",
  "issuedBy": {
    "kind": "agent",
    "session": "session-7204b195-9fd6-4c31-9de3-4912364e9532",
    "model": "deepseek-v4.1-flash"
  },
  "base": "9e74365",
  "criteria": "criteria.json",
  "allowedPaths": [
    "tools/release.mjs",
    "plugin/test/release-tool.test.mjs",
    "docs/0230-RELEASE-PREFLIGHT-RECEIPT.md"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "spec/scripts/**",
    "plugin/lib/**",
    "structure/**",
    "docs/anchors.json",
    "presets/**"
  ],
  "redAllowDirty": [
    "docs/0230-RELEASE-PREFLIGHT-RECEIPT.md"
  ],
  "decisions": [],
  "status": "working-tree"
}
-->

## Зачем

Тест `plugin/test/release-tool.test.mjs` c2 («preflight проходит на согласованных ассетах») падает двое
суток: 11.11 (275/295) и 12.11 (298/299). Первое падение полного набора 12.11 — именно оно.

Причина: `tools/release.mjs:53` в `preflight(version, {root})` запускает
`node spec/checks/release-receipt.mjs --online` с `cwd=root`. В тесте `root` — временный фейк-каталог
(VERSION, package.json, dist/); `spec/` в нём нет → MODULE_NOT_FOUND → `problems` → `ok=false`.
Дефект внесён 2.6.81 (0133 добавил квитанции в предполёт), тест на фейковом корне не обновили.

## Решение

Проверка квитанций описывает **этот** репозиторий, а не произвольный каталог. `options.root` задают
тесты и чужие корни. Поэтому preflight сначала смотрит, есть ли в корне
`spec/checks/release-receipt.mjs`:

- нет — проверять нечего, `receipts: 'skipped'` (c2 зелёный, ложного fail больше нет);
- есть — проверка обязательна, отказ инструмента красит preflight (это держит c7).

Не подходит: брать путь от `ROOT` — тогда проверка уходит в сеть GitHub на каждом юнит-тесте и c2
снова становится сетезависимым; `receipts:false` в тесте — подгонка критерия под код.

## Красный (до правки)

На базе `9e74365`:

```
node --test plugin/test/release-tool.test.mjs   → exit=1, tests 6 · pass 5 · fail 1
  ✖ c2: preflight проходит на согласованных ассетах
    false !== true
```

Мутационное подтверждение гейта: с новой проверкой c8 и старым `release.mjs` —
`exit=1`, `receipts: undefined !== 'skipped'`. После правки — c8 зелёный.

## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node --test plugin/test/release-tool.test.mjs` | exit=0, tests 8 · pass 8 · fail 0 |
| C2 | `cd plugin && node tools/test.mjs` | exit=0, tests 301 · pass 301 · fail 0 |
| C3 | c7 в `release-tool.test.mjs`: в корне есть инструмент квитанций и он отказывает | preflight `ok=false`, `receipts='checked'` |
| C4 | `node spec/checks/release-receipt.mjs` | `release-receipt: OK — публикует только release-publish.mjs` |

C3 — гейт на класс: запрещает «починить» c2 выключением проверки квитанций навсегда.

## Статус

Черновик контракта и рабочая правка в дереве на 12.11 14:00. Коммит контракта, `task-hash --write`,
`task-red`, `task-verify` и приёмка judge — следующие шаги; без них задача не принята.

## Границы

1. Менять только `tools/release.mjs`, `plugin/test/release-tool.test.mjs`, `docs/0230-RELEASE-PREFLIGHT-RECEIPT.md`.
2. Коммит и приёмку делает координатор/приёмщик; исполнитель не коммитит.
3. Непонятно — стоп и один вопрос.

## Отчёт

1. Каждая проверка — команда, exit, последняя строка.
2. `git status --short`.
3. Отклонения — отдельно.
