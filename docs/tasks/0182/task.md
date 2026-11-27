# Задание 0182. task-accept.mjs разложен: CLI тонкий, обслуживание в lib/accept

<!-- TASK-META
{
  "id": "0182",
  "version": 1,
  "title": "spec/scripts/task-accept.mjs (1091 строка) разложен: прогресс, кандидат, verify-вход и тень — в spec/scripts/lib/accept/*.mjs",
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
    "spec/scripts/task-accept.mjs",
    "spec/scripts/lib/accept/**",
    "docs/tasks/0182/**"
  ],
  "protectedPaths": [
    "spec/checks/accept-split.mjs",
    "spec/scripts/task-verify.mjs",
    "spec/scripts/task-red.mjs",
    "spec/scripts/task-hash.mjs",
    "spec/scripts/task-lint.mjs",
    "VERSION",
    "package.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0182/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Что выносить из CLI приёмки, а что оставить",
      "chosen": "Оркестрация (аргументы, замок, актор, независимость, свежий прогон, запись, кандидат) остаётся в task-accept.mjs; вынесены обслуживающие части: прогресс/fail, createCandidate, validateVerify, engineShadow. ignoredPaths, вызов createCandidate( и signRecord( остаются в CLI — их читают проверки candidate-ignored-delete и contract-discipline",
      "options": ["вынести всё в модули (правка проверок)", "вынести обслуживание, CLI и маркеры совместимости оставить"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "spec/scripts/lib/accept/*.mjs (4 модуля) + тонкий task-accept.mjs; spec/checks/accept-split.mjs c1|c2|c3", "format": "код+проверки", "criterion": "C2" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

CLI приёмки перестаёт быть файлом на 1091 строку: прогресс и fail, кандидатный коммит, проверка verify-входа
и теневой прогон живут в `spec/scripts/lib/accept/*.mjs`, а `task-accept.mjs` остаётся оркестрацией под
900 строк с прежними аргументами, поведением и маркерами совместимости.

## Что не входит

1. Изменение поведения приёмки: аргументы, коды выхода, тексты отказов, подпись записи — без изменений.
2. Вынос оркестрации (аргументы, замок, актор, независимость, запись) — она остаётся в CLI.
3. Правка проверок движка (они читают текст CLI и обязаны остаться зелёными).

## Инварианты

1. `node spec/scripts/task-accept.mjs --help` печатает прежнюю подсказку и выходит с кодом 0.
2. В task-accept.mjs остаются `export function ignoredPaths` (с git ls-files --others --ignored, без check-ignore), вызов `createCandidate(` и `signRecord(`.
3. Файл ≤ 900 строк, каждый модуль ≤ 200 строк; полный selftest и затронутые тесты зелёные.

## Границы знания

1. Дано: репозиторий пакета и это задание.
2. Менять можно только allowedPaths; проверка `spec/checks/accept-split.mjs` после контракта неприкосновенна.
3. Не коммитить, не пушить, не деплоить.

## Среда

- node 25, Windows. Тяжёлые прогоны — сторожем движка (`gate.mjs`, `job.mjs`).
- Полный набор: `node tools/check-tests.mjs` (правки `spec/**` — selftest и затронутые тесты).

## Отчёт

1. Что вынесено и что осталось в CLI.
2. Файлы — полными путями.
3. Каждый критерий — команда, exit код, дословный вердикт.

## Коммит

Кандидата создаёт `task-accept`; коммит — после записи о приёмке.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/accept-split.mjs c1` | `ACCEPT-SPLIT OK c1` (4 модуля на месте, каждый ≤ 200 строк) |
| C2 | `node spec/checks/accept-split.mjs c2` | `ACCEPT-SPLIT OK c2` (CLI ≤ 900 строк, ignoredPaths/createCandidate/signRecord на месте) |
| C3 | `node spec/checks/accept-split.mjs c3` | `ACCEPT-SPLIT OK c3` (компараторы отвергают потерю модуля и маркера) |
| C4 | `node tools/check-tests.mjs` | exit 0 (selftest и затронутые тесты) |
| C5 | `node spec/checks/candidate-ignored-delete.mjs c2` | `CANDIDATE-IGNORED OK c2` (CLI читается, фильтр путей на месте) |
<!-- CRITERIA:END -->
