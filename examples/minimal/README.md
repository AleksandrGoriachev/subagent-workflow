# Пример задания

Демонстрация полного цикла на одном дефекте: `add` возвращает разность вместо суммы.

## Как использовать

1. Скопируйте `task.md` и `criteria.json` в `docs/tasks/0001/` (замените `0001` на свой id).
2. Скопируйте `checks/` и `src/` в корень проекта (если там ещё нет таких файлов).
3. Поправьте `issuedBy` в `task.md` — поставьте сессию постановщика.
4. Дальше по циклу:

~~~bash
git add docs/tasks/0001 checks src && git commit -m "task 0001: контракт"
node docs/subagent-workflow/scripts/task-hash.mjs --task docs/tasks/0001 --write
node docs/subagent-workflow/scripts/task-lint.mjs --task docs/tasks/0001 --strict
node docs/subagent-workflow/scripts/task-red.mjs  --task docs/tasks/0001 --base HEAD
~~~

`task-red` обязан упасть на C1 с причиной «sum is wrong» и оставить C2 зелёным.
Затем исправьте `src/app.js`, прогоните `task-verify` и примите из другой сессии.

## Что здесь важно

- `C1` — поведенческий критерий (не «файл существует»).
- `C2` — негативный: проверка обязана отказать.
- `redExpect.reasons` фиксирует, по какой именно причине C1 падает на базе.
