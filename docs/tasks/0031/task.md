# Задание 0031. hooks-mode проверяет поведение хуков

<!-- TASK-META
{
  "id": "0031",
  "version": 1,
  "title": "hooks-mode проверяет поведение хуков, а не только режим в индексе",
  "risk": "medium",
  "created": "2026-11-01",
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
    "spec/checks/hooks-mode.mjs",
    "spec/scripts/lib/common.mjs",
    "spec/SPEC.md",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    ".github/workflows/ci.yml",
    "docs/tasks/0031/**"
  ],
  "protectedPaths": [
    "spec/checks/ci-behavior.mjs",
    "docs/tasks/0031/task.md",
    "docs/tasks/0031/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0031/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "impact": "internal",
      "question": "Что считать доказательством работы хуков",
      "chosen": "реальный коммит во временном репозитории: с включённым guard коммит вне задания отклоняется, с меткой обхода — проходит; ослабленный хук ловится",
      "options": [
        "режим в индексе",
        "поведение коммита"
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

`spec/checks/hooks-mode.mjs` должен проверять **поведение** хуков: с включённым guard коммит вне задания отклоняется, с меткой обхода проходит. Режим `100755` в индексе и отсутствие `chmod` в CI остаются, но перестают быть единственным доказательством.

## Зачем

Сейчас проверка смотрит только режим в индексе и текст `ci.yml`. Если хук заменить на `exit 0` (права и CI при этом в порядке), все проверки зелёные, а защита не работает. Сломанная проверка хуже отсутствующей.

## Что не входит

1. `ci-guard-step` — структурный разбор `ci.yml` (проверка уже ловит шаг в комментарии; менять не нужно).
2. Установка хуков в чужие проекты.
3. Поведение `pre-push` против реального remote — только локальный сценарий.

## Инварианты

1. **Поведение**: во временном репозитории (движок развёрнут из `spec/`, guard включён) коммит вне задания отклоняется; коммит с меткой обхода проходит.
2. **Ослабленный хук ловится**: если `spec/hooks/pre-commit` заменить на `exit 0`, проверка краснеет.
3. **Старые свойства сохраняются**: режим `100755` в индексе; в CI нет шага `chmod +x spec/hooks/*`.
4. **Кроссплатформенность**: на Windows хуки запускаются через `sh` из Git for Windows, как в `e2e`; проверка не падает из-за отсутствия `sh`.
5. `spec/checks/ci-behavior.mjs`, `docs/tasks/0031/{task.md,criteria.json}` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/ci-behavior.mjs`; полный набор — `selftest`, `e2e`, `gate-rules`, `check-version`.

## Среда

- Node.js, Windows; временные репозитории в temp.

## Что сделать

1. **`spec/checks/hooks-mode.mjs`** — добавить поведенческий сценарий: временный репозиторий по образцу e2e (сценарий «включённый guard отклоняет коммит вне задания»), развернуть движок из спеки, включить guard, сделать коммит вне задания → ожидать отклонение (exit != 0, сообщение guard), затем коммит с меткой обхода → ожидать успех. Все временные каталоги удалять.
2. **`spec/checks/hooks-mode.mjs`** — проверять, что ослабленный хук (`exit 0`) приводит к красному: можно внутри проверки подменить хук в копии и убедиться, что коммит проходит (то есть проверка действительно смотрит на поведение). Достаточно, чтобы самопроверка была в `ci-behavior.mjs`; в hooks-mode — реальный сценарий.
3. **`spec/SPEC.md`** — абзац «Версия 2.6.8:» (поведение хуков) и `Версия: 2.6.8`.
4. **Версия 2.6.8 в пяти местах**: `VERSION`, `package.json`, первая строка `README.md`, SPEC, `TOOL` в `spec/scripts/lib/common.mjs`; секция `## 2.6.8` в `CHANGELOG.md`.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/ci-behavior.mjs | exit 0, в выводе CI BEHAVIOR OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node spec/checks/gate-rules.mjs | exit 0, в выводе GATE RULES OK |
| C5 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.8 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где.
2. Вывод каждой проверки целиком (C1–C5).
3. `git status --short`, `git diff --stat`.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт `task-accept`; пуш и теги — архитектор.
