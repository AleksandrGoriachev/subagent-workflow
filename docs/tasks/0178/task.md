# Задание 0178. state.js разложен на модули, баррель сохраняет 55 имён

<!-- TASK-META
{
  "id": "0178",
  "version": 1,
  "title": "plugin/lib/state.js (1643 строки) разложен на plugin/lib/state/*.js по слоям; state.js — баррель (переиздание 0177)",
  "risk": "medium",
  "created": "2026-11-27",
  "owner": "координатор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "deviation": "корень пакета вне разрешённых корней спавна узла judge (root-not-allowed); приёмку выполняет отдельная сессия узла judge",
  "issuedBy": { "kind": "agent", "session": "session-eceafc45-4b60-4614-abe3-c21aa1a76432", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "plugin/lib/state.js",
    "plugin/lib/state/**",
    "docs/tasks/0178/**"
  ],
  "protectedPaths": [
    "spec/checks/state-split-0178.mjs",
    "spec/scripts/**",
    "VERSION",
    "package.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0178/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как разложить state.js, если его импортируют api.js, fixture.mjs и state.test.mjs",
      "chosen": "Код уходит в plugin/lib/state/*.js по слоям, state.js остаётся баррелем re-export: путь './state.js' и все 55 имён не меняются, импортёры не правятся",
      "options": ["править импортёров на подмодули", "баррель без правки импортёров"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C1" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "plugin/lib/state/*.js (11 модулей) + баррель state.js; spec/checks/state-split-0178.mjs c1|c2|c3", "format": "код+проверки", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["0177 закрыто как replaced: его C3 не падал на базе"]
}
-->

## Цель

Чтение состояния задачи перестаёт быть одним файлом на 1643 строки: чистые вычисления разложены по слоям
(константы, примитивы, контракт, политика, решения, атака, замок, приёмка, состояние, виды, адаптер
репозитория), а `plugin/lib/state.js` остаётся баррелем с прежним путём импорта и прежними 55 именами.
Поведение панели и API не меняется.

## Что не входит

1. `plugin/lib/api.js` — отдельное задание.
2. Любая правка семантики: правила стадий, флагов, покрытия и записи приёмки переносятся без изменений.
3. Правка импортёров (`api.js`, `test/fixture.mjs`, `test/state.test.mjs`).

## Инварианты

1. `import ... from './state.js'` продолжает работать: баррель отдаёт все 55 имён.
2. state.js — только шапка и `export * from './state/<модуль>.js'`, без кода.
3. Модуль не больше 500 строк; граф импортов без циклов (repository → task-state → acceptance → … → constants).

## Границы знания

1. Дано: репозиторий пакета и это задание.
2. Менять можно только allowedPaths; проверка `spec/checks/state-split-0178.mjs` после контракта неприкосновенна.
3. Не коммитить, не пушить, не деплоить.

## Среда

- node 25, Windows. Тяжёлые прогоны — сторожем движка (`gate.mjs`, `job.mjs`).
- Полный набор: `node tools/check-tests.mjs` (правки `plugin/**` — полный набор плагина).

## Отчёт

1. Раскладка по модулям и что осталось в барреле.
2. Файлы — полными путями.
3. Каждый критерий — команда, exit код, дословный вердикт.

## Коммит

Кандидата создаёт `task-accept`; коммит — после записи о приёмке.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/state-split-0178.mjs c1` | `STATE-SPLIT OK c1` (11 модулей ≤ 500 строк, баррель отдаёт все 55 имён) |
| C2 | `node spec/checks/state-split-0178.mjs c2` | `STATE-SPLIT OK c2` (state.js ≤ 150 строк, только re-export) |
| C3 | `node spec/checks/state-split-0178.mjs c3` | `STATE-SPLIT OK c3` (баррель уже разложен; компараторы отвергают правку и потерю имени) |
| C4 | `node tools/check-tests.mjs` | exit 0 (полный набор тестов плагина) |
<!-- CRITERIA:END -->
