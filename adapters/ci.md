# CI

CI проверяет записи, но не создаёт их для medium/high.

## Что делать в CI

~~~yaml
- name: verify acceptance records
  run: |
    for f in $(git diff --name-only origin/main...HEAD | grep 'acceptance.json$'); do
      node docs/subagent-workflow/scripts/task-check-acceptance.mjs --file "$f" --repo .
    done

- name: workflow self-check
  run: |
    node docs/subagent-workflow/selftest.mjs
    node docs/subagent-workflow/e2e.mjs
    node docs/subagent-workflow/e2e-deploy.mjs
~~~

## Regress закрытых заданий — по расписанию

Приёмка проверяет задачу один раз; общий код может сломать её позже. Поэтому
regress не ставят на каждый PR (дорого и шумно), а гоняют по расписанию:

~~~yaml
on:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch:

jobs:
  regress:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - name: regress accepted tasks
        run: node docs/subagent-workflow/scripts/task-regress.mjs --repo . --strict --baseline regress.baseline.json --out regress.json
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: regress, path: regress.json }
~~~

Что валит прогон: `regressed` (критерий закрытой задачи падает), `untrusted`
(подпись записи не сходится), `error`, `unproven-violation` (medium/high без
красного или low без записанного обхода). `unproven-lawful` (low + записанный
`allowMissingRed`) — предупреждение и кандидат в baseline; `legacy` (записи v1–v3)
— строка отчёта, не ошибка. `--strict` дополнительно валит `unproven-lawful` и
просроченный `reviewBy` в baseline.

Baseline — осознанный долг, который коммитится и ревьюится:

~~~bash
node docs/subagent-workflow/scripts/task-regress.mjs --repo . --write-baseline regress.baseline.json
~~~

`reviewBy` по умолчанию — через 30 дней: долг либо закрывается, либо продлевается
отдельным диффом.

Приватных ключей в CI нет: проверка идёт по публичным ключам из `acceptors.json`.

## Почему нельзя принимать в CI

Идентификатор джобы — это не отдельный агент, а та же машина и тот же конвейер.
Если прописать его как primary, ворота формально увидят «другую сессию», но
независимости это не добавит. Поэтому для CI оставляют `fallbackEnv` (уровень
`declared`) или не запускают `task-accept` вовсе.

## Что CI ловит

- самоприёмку (сессия = issuedBy);
- подпись чужим/незакреплённым ключом;
- запись без свежего прогона;
- metadata-коммит, меняющий код;
- `acceptance.json` внутри кандидата;
- расхождение хешей `task.md`/`criteria.json`/`verify.json`.
