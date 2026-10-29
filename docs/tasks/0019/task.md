# Задание 0019. Правила ворот: границы, noRed, причины красного, verify.executor

<!-- TASK-META
{
  "id": "0019",
  "version": 1,
  "title": "правила ворот: пересечение границ, noRed, причины красного, verify.executor",
  "risk": "medium",
  "created": "2026-10-29",
  "owner": "архитектор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "issuedBy": {
    "kind": "agent",
    "session": "session-b8721a2a-456c-48a2-94cd-8030d895a8e8",
    "model": "deepseek-v4.1-flash"
  },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/scripts/task-lint.mjs",
    "spec/scripts/task-red.mjs",
    "spec/scripts/task-accept.mjs",
    "spec/scripts/lib/common.mjs",
    "spec/templates/**",
    "spec/SPEC.md",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "docs/tasks/0019/**"
  ],
  "protectedPaths": [
    "spec/checks/gate-rules.mjs",
    "docs/tasks/0019/task.md",
    "docs/tasks/0019/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0019/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "impact": "internal",
      "question": "Как ловить пересечение границ на контракте",
      "chosen": "task-lint: путь из allowedPaths, покрытый protectedPaths, — ошибка; плюс WARN о путях allowedPaths без covers",
      "options": [
        "только вручную",
        "ошибка lint"
      ],
      "reversible": true
    },
    {
      "id": "D2",
      "class": "mechanical",
      "impact": "internal",
      "question": "Как разрешить low без красного",
      "chosen": "явный redExpect.noRed { reason } вместо пустого mustFail; пустой mustFail без noRed — ошибка",
      "options": [
        "оставить пустой mustFail",
        "явный noRed"
      ],
      "reversible": true
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Закрыть P1 из реестра обратной связи и добавить машинную проверку границ контракта: пересечение `allowedPaths`/`protectedPaths` должно быть ошибкой lint, `low` без красного — только явным маркером, причины красного — дословной подстрокой с печатью вывода, `verify.json` исполнителя — сохраняться.

## Зачем

1. **F-7 (реестр).** `task-lint` не замечает, что путь из `allowedPaths` защищён `protectedPaths`. На этом мы аннулировали 0012 (весь `spec/checks/**` в защищённых) и почти 0014/0017 — ошибка видна только на `task-verify` после работы исполнителя.
2. **F-5.** Пустой `mustFail` для `low` разрешён молча, хотя SPEC требует красного; нужен явный `redExpect.noRed { reason }`.
3. **F-6.** `redExpect.reasons` — дословная подстрока stdout+stderr, но в шаблоне это не сказано, а `task-red` при несовпадении не печатает, что именно пришло.
4. **F-8.** `task-accept` перезаписывает `verify.json` исполнителя своим прогоном; исходный результат теряется.
5. **Новое.** Lint должен предупреждать о путях из `allowedPaths`, не покрытых ни одним `covers` — это наш самый частый дефект контракта (0014, 0017).

## Что не входит

1. Сверка `acceptance.json` с заданием и подписью — отдельное задание (ночное ревью, п. 3).
2. Ослабление lint для принятых заданий не расширяется.
3. Поведенческая проверка кнопки панели — отдельное задание.
4. Правки `spec/checks/gate-rules.mjs` (критерий C1) и файлов контракта.

## Инварианты

1. **Пересечение — ошибка.** Если путь из `allowedPaths` покрыт `protectedPaths`, `task-lint --strict` выходит с кодом 1 и называет путь.
2. **Контроль не ломается.** Контракт без пересечения проходит lint.
3. **Красный без «тихих» послаблений.** Пустой `mustFail` у `low` — ошибка, пока нет `noRed.reason`; с причиной — ок.
4. **Причина красного — дословная подстрока.** При несовпадении `task-red` печатает причину и первые строки вывода критерия.
5. **`verify.json` исполнителя не теряется.** При любом исходе `task-accept` (включая отказ preflight) исходный файл сохраняется как `verify.executor.json`.
6. Защищённые файлы и `verify.json` запуска не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/gate-rules.mjs`; полный набор — `node spec/selftest.mjs`, `node spec/e2e.mjs`, `node tools/check-version.mjs`.

## Среда

- Node.js, Windows; фикстуры проверки создают одноразовые репозитории в temp.

## Что сделать

1. **`spec/scripts/task-lint.mjs`** — F-7: если какой-либо путь из `allowedPaths` покрыт шаблоном из `protectedPaths` (для точных путей — совпадение, для шаблонов — по существующему матчеру), это `ERROR` с именем пути. Плюс `WARN`, если путь из `allowedPaths` (не `/**`-шаблон каталога) не покрыт ни одним `covers` критериев.
2. **`spec/scripts/task-lint.mjs`** — F-5: пустой `mustFail` при `risk=low` разрешён только при `redExpect.noRed.reason` (непустая строка); иначе `ERROR` с подсказкой про `noRed`.
3. **`spec/scripts/task-red.mjs`** — F-6: при несовпадении ожидаемой причины с выводом печатать причину, первые строки stdout+stderr критерия и путь к `red.log`.
4. **`spec/scripts/task-accept.mjs`** — F-8: в начале работы (до preflight и до нового прогона) сохранять существующий `verify.json` как `verify.executor.json`; не перезаписывать, если файла нет; при повторном приёме — обновлять сохранённую копию.
5. **`spec/templates/**`** — в шаблоне `criteria.json`/SPEC переименовать формулировку «причина» в «дословная подстрока stdout+stderr» и показать `noRed` для low.
6. **`spec/SPEC.md`** — абзац «Версия 2.6.4:» (F-7/F-5/F-6/F-8, WARN по covers), `Версия: 2.6.4`.
7. **Версия 2.6.4 в пяти местах**: `VERSION`, `package.json`, первая строка `README.md`, `Версия: 2.6.4` в SPEC, `TOOL` в `spec/scripts/lib/common.mjs`; секция `## 2.6.4` в `CHANGELOG.md`.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/gate-rules.mjs | exit 0, в выводе GATE RULES OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.4 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где.
2. Вывод каждой проверки целиком (C1–C4).
3. `git status --short`, `git diff --stat`.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт `task-accept`; пуш и теги — архитектор.
