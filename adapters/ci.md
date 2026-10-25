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
~~~

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
