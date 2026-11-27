# Задание 0181. common.mjs разложен на модули, баррель сохраняет 105 имён

<!-- TASK-META
{
  "id": "0181",
  "version": 1,
  "title": "spec/scripts/lib/common.mjs (2408 строк) разложен на spec/scripts/lib/common/*.mjs; common.mjs — баррель со 105 именами",
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
    "spec/scripts/lib/common.mjs",
    "spec/scripts/lib/common/**",
    "spec/checks/criteria-overlap.mjs",
    "spec/checks/gates-journal.mjs",
    "docs/tasks/0181/**"
  ],
  "protectedPaths": [
    "spec/checks/common-split.mjs",
    "VERSION",
    "package.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0181/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как разложить common.mjs, если его импортируют 106 файлов",
      "chosen": "Код уходит в spec/scripts/lib/common/*.mjs по 16 слоям; common.mjs остаётся баррелем с явным re-export 105 имён, путь импорта не меняется",
      "options": ["править 106 импортёров", "баррель без правки импортёров"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C1" },
      "reversible": true
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Две проверки читают ТЕКСТ common.mjs, а не импортируют его",
      "chosen": "criteria-overlap.mjs читает common/criteria.mjs, gates-journal.mjs — common/journal.mjs; проверки входят в allowedPaths и правятся этим же заданием",
      "options": ["оставить чтение старого файла (проверки станут ложными)", "перевести на новые модули"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C5" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "spec/scripts/lib/common/*.mjs (16 модулей) + баррель common.mjs; spec/checks/common-split.mjs c1|c2|c3", "format": "код+проверки", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Библиотека движка перестаёт быть одним файлом на 2408 строк: версия, CLI, файлы, процессы, git, контракт,
глобы, журнал, замок, секреты, критерии, решения, красный и конфиг живут отдельными модулями, а
`spec/scripts/lib/common.mjs` остаётся баррелем с прежними 105 именами. Ни один из 106 импортёров не правится.

## Что не входит

1. Правка поведения: функции переносятся без изменений.
2. Правка импортёров и остальных модулей lib (policy, attack, review, regress, preflight и др.).
3. Сборка релиза и обновление развёрнутой копии.

## Инварианты

1. `import ... from './lib/common.mjs'` работает: баррель отдаёт все 105 имён.
2. common.mjs — только шапка и re-export; модуль ≤ 450 строк; граф импортов без циклов.
3. Две проверки, читавшие текст common.mjs, читают новые модули и остаются зелёными.

## Границы знания

1. Дано: репозиторий пакета и это задание.
2. Менять можно только allowedPaths; проверка `spec/checks/common-split.mjs` после контракта неприкосновенна.
3. Не коммитить, не пушить, не деплоить.

## Среда

- node 25, Windows. Тяжёлые прогоны — сторожем движка (`gate.mjs`, `job.mjs`).
- Полный набор: `node tools/check-tests.mjs` (правки `spec/**` — selftest и затронутые тесты).

## Отчёт

1. Раскладка по слоям и что осталось в барреле.
2. Файлы — полными путями.
3. Каждый критерий — команда, exit код, дословный вердикт.

## Коммит

Кандидата создаёт `task-accept`; коммит — после записи о приёмке.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/common-split.mjs c1` | `COMMON-SPLIT OK c1` (16 модулей ≤ 450 строк, баррель отдаёт 105 имён) |
| C2 | `node spec/checks/common-split.mjs c2` | `COMMON-SPLIT OK c2` (common.mjs ≤ 150 строк, только re-export) |
| C3 | `node spec/checks/common-split.mjs c3` | `COMMON-SPLIT OK c3` (компараторы отвергают правку барреля и потерю имени) |
| C4 | `node tools/check-tests.mjs` | exit 0 (selftest и затронутые тесты) |
| C5 | `node spec/checks/criteria-overlap.mjs c3` | `OVERLAP OK c3` (проверка читает common/criteria.mjs) |
| C6 | `node spec/checks/gates-journal.mjs c2` | `GATES OK c2` (проверка читает common/journal.mjs) |
<!-- CRITERIA:END -->
