# Задание 0016. Безопасность развёртывания: ключи проекта, порядок init, POST-маршруты

<!-- TASK-META
{
  "id": "0016",
  "version": 1,
  "title": "безопасность развёртывания: ключи проекта, порядок init, POST-маршруты",
  "risk": "high",
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
    "spec/scripts/init.mjs",
    "plugin/**",
    "spec/checks/**",
    "spec/SPEC.md",
    "VERSION",
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "RELEASE-CHECKLIST.md",
    ".github/workflows/ci.yml",
    "docs/tasks/0016/**"
  ],
  "protectedPaths": [
    "spec/checks/deploy-safety.mjs",
    "docs/tasks/0016/task.md",
    "docs/tasks/0016/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0016/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "impact": "public-contract",
      "question": "Где хранится ключ приёмщика, созданный при развёртывании",
      "chosen": "в корне проекта: <repo>/.wf-keys/, каталог добавлен в .gitignore; глобальный %USERPROFILE%\\.wf-keys не трогается",
      "options": [
        "глобальный ключ как сейчас",
        "ключ проекта в репозитории"
      ],
      "reversible": true,
      "evidence": {
        "kind": "criterion",
        "ref": "C1"
      }
    },
    {
      "id": "D2",
      "class": "mechanical",
      "impact": "internal",
      "question": "Порядок записи VERSION в init",
      "chosen": "VERSION пишется последним, после конфига, ключа и хуков; при падении раньше VERSION не появляется",
      "options": [
        "как сейчас",
        "последним"
      ],
      "reversible": true
    },
    {
      "id": "D3",
      "class": "mechanical",
      "impact": "internal",
      "question": "Защита POST-маршрутов панели",
      "chosen": "только Content-Type application/json и Origin своего хоста (или отсутствующий); иначе 415/403",
      "options": [
        "как сейчас",
        "проверять тип и Origin"
      ],
      "reversible": true
    }
  ],
  "securityReview": true,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Убрать три дефекта, найденных ночным ревью: развёртывание из панели уничтожает глобальный ключ приёмщика, `init` оставляет `VERSION` при падении, POST-маршруты панели принимают `text/plain` и чужой `Origin`. Плюс привести документы и версии в соответствие с панелью 0.7.1.

## Зачем

Отчёт `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\REVIEW-2026-10-29.md`, блокирующие B1–B4 (проверено критиком на копиях с подменённым HOME):

1. **B1.** `plugin/lib/deploy.js:110` запускает `init` без `--key-out` → `spec/scripts/init.mjs:197,216-226` перезаписывают `%USERPROFILE%\.wf-keys\agent-judge.key.pem`. Развернули A, потом B → ключ A уничтожен, его `acceptors.json` не сходится с подписью. То же делает `spec/checks/panel-deploy.mjs` (шаг CI), хотя `RELEASE-CHECKLIST.md` требует обратного.
2. **B2.** `init` пишет `VERSION` раньше конфига, ключа и хуков. При сломанном `workflow.config.json` `init` падает, `VERSION` остаётся → кнопка навсегда отдаёт `already-deployed`, проект без ключа и хуков.
3. **B3.** SPEC 2.6.2, CHANGELOG и README отрицают вторую запись панели и версию плагина 0.7.0, тогда как проверки уже ждут 0.7.0.
4. **B4.** `POST /api/guard` и `POST /api/deploy` принимают `text/plain` и не проверяют `Origin`; `root` по умолчанию — первый workspace. Cross-site запрос может выключить guard или запустить развёртывание.

## Что не входит

1. Смена модели записи (`--supersedes`, `clarification.md`) — отдельные задания 2.7.0.
2. Кнопка «Обновить движок» для уже развёрнутого пространства — панель 0.8.0.
3. Аутентификация панели токеном: сейчас достаточно loopback + Origin + тип, полноценный токен — отдельно.
4. Правки чужих проектов.

## Инварианты

1. **Глобальный ключ неприкосновенен.** Развёртывание и проверки не создают и не меняют `<HOME>/.wf-keys/agent-judge.key.pem`; ключ проекта лежит в `<repo>/.wf-keys/` и игнорируется git.
2. **Два проекта — два ключа.** Развёртывание B не влияет на ключи A.
3. **Нет ложного `already-deployed`.** `VERSION` появляется только после успешных конфига, ключа и хуков; при падении раньше — `VERSION` нет.
4. **POST только JSON и только свой Origin.** `text/plain` → 415, чужой `Origin` → 403; отсутствие `Origin` (curl) допустимо; GET-маршруты не меняются.
5. Отказы по-прежнему ничего не пишут; `confirm: true` остаётся обязательным для deploy.
6. `spec/checks/deploy-safety.mjs`, `docs/tasks/0016/{task.md,criteria.json}`, `acceptance.json`, `criteria.lock`, `red.json` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/deploy-safety.mjs`; полный набор — `node spec/selftest.mjs`, `node spec/e2e.mjs`, `node plugin/tools/test.mjs`, `node spec/checks/acceptance-schema.mjs`, `node tools/check-version.mjs`.

## Среда

- Node.js, Windows. Проверка подменяет `HOME`/`USERPROFILE` на временный каталог — настоящий профиль не затрагивается.

## Что сделать

1. **`plugin/lib/deploy.js`** — передавать `--key-out <repo>/.wf-keys` (и `--key-id agent-judge`, если нужно) в `init.mjs`; ключ становится проектным. Если `init` не добавляет `.wf-keys/` в `.gitignore` проекта — добавлять (одна строка, идемпотентно).
2. **`spec/scripts/init.mjs`** — писать `VERSION` последним, после конфига, ключа и хуков; при падении раньше `VERSION` не создаётся. При `--key-out` каталог ключей должен попадать в `.gitignore` проекта.
3. **`plugin/lib/api.js`** — для `POST /api/guard` и `POST /api/deploy`: требовать `Content-Type: application/json` (иначе 415) и `Origin` своего хоста или его отсутствие (иначе 403). Проверки — до чтения тела и любых записей.
4. **`plugin/lib/client.js`** — в подтверждении развёртывания показать, что ключ создаётся в проекте (`.wf-keys/`), и что глобальный не трогается; тексты про «две записи» привести в соответствие.
5. **`spec/checks/panel-deploy.mjs`** — ожидание плагина 0.7.1 и ключа проекта (обновить сценарии под новый контракт).
6. **Версия 2.6.3 (спека)**: `VERSION`, `package.json`, первая строка `README.md`, `Версия: 2.6.3` и абзац «Версия 2.6.3:» в `spec/SPEC.md`, `TOOL` в `spec/scripts/lib/common.mjs`, секция `## 2.6.3` в `CHANGELOG.md`.
7. **Плагин 0.7.1**: `plugin/package.json`, `plugin/lib/compat.js`, ожидание в `spec/checks/acceptance-schema.mjs`, счёт тестов и раздел в `plugin/README.md`.
8. **SPEC** — явно описать две записи панели (`guard.enabled` и развёртывание), безопасность ключей и правило Origin/content-type.
9. **CI** — добавить шаги `acceptance-p0`, `deployed-copy`, `actor-sources` (сейчас их нет), `RELEASE-CHECKLIST.md` — пункты про ключ проекта и POST-защиту.
10. **Тесты плагина** — на 415, 403, ключ проекта и отсутствие глобального ключа; существующие не ослаблять.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/deploy-safety.mjs | exit 0, в выводе DEPLOY SAFETY OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node plugin/tools/test.mjs | exit 0, в выводе fail 0 |
| C5 | node spec/checks/acceptance-schema.mjs | exit 0 |
| C6 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.3 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где.
2. Вывод каждой проверки целиком (C1–C6).
3. `git status --short`, `git diff --stat`.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт `task-accept`; пуш и теги — архитектор.
