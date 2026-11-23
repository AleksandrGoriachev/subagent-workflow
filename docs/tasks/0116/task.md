# Задание 0116. 2.6.101: TOOL выводится из VERSION, а не из литерала

<!-- TASK-META
{
  "id": "0116",
  "version": 1,
  "title": "2.6.101: релизный bump не трогает common.mjs",
  "risk": "medium",
  "created": "2026-11-23",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/scripts/lib/common.mjs",
    "tools/check-version.mjs",
    "spec/SPEC.md",
    "docs/tasks/0116/**"
  ],
  "protectedPaths": ["plugin/lib/**", "plugin/tools/**", "spec/checks/**"],
  "redAllowDirty": ["docs/tasks/0116/**"],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Почему bump версии тащит почти весь набор тестов",
      "chosen": "TOOL — литерал в common.mjs, его импортируют почти все тесты, поэтому bump уходит в affected с 22 файлами. Выводим TOOL из VERSION (кандидаты ../../../VERSION в репозитории и ../../VERSION в развёрнутой копии). Релизный bump перестаёт менять common.mjs, проверка релиза сжимается до selftest.",
      "options": ["Оставить литерал", "Выводить из VERSION"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C1" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "docs/tasks/0116/report.json", "format": "json", "criterion": "C2" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["релиз 2.6.101 отдельной задачей"]
}
-->

## Цель

`TOOL` вычисляется из файла `VERSION` (репозиторий и развёрнутая копия), поэтому релизный bump не меняет
`common.mjs` и не тянет 22 файла тестов.

## Границы знания

Только `common.mjs` и документация; тесты не меняются.

## Среда

node 25, Windows, без сети.

## Отчёт

Отчёт — критерии и verify.log.

## Коммит

Коммитится по правилам движка.

## Что не входит

1. Правки тестов; check-version правится только в части чтения TOOL.
2. Правки панели.
3. Релиз 2.6.101 — отдельной задачей.

## Инварианты

1. `TOOL === 'subagent-workflow/' + version` из `package.json`.
2. В репозитории VERSION читается по `../../../VERSION`, в развёрнутой копии — по `../../VERSION`.
3. Литерал версии в `common.mjs` отсутствует.
4. `node tools/check-version.mjs` зелёный.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | в `common.mjs` нет литерала версии | exit 0 |
| C2 | `TOOL` совпадает с `package.json` | exit 0 |
| C3 | `node tools/check-version.mjs` | `VERSION OK` |
| C4 | `node spec/selftest.mjs` | `SELFTEST OK` |
<!-- CRITERIA:END -->
