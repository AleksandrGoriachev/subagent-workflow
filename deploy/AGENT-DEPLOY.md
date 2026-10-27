# Инструкция агенту: развернуть subagent-workflow 2.3 с нуля

Кому: агенту-оркестратору, который впервые внедряет процесс делегирования.
Что на выходе: рабочее пространство с воротами, закреплённым ключом, CI-проверкой
записей и одной принятой пилотной задачей.

Пакет самодостаточен: все ворота, шаблоны и конфигурация уже внутри.

## 0. Четыре решения до команд

1. **Кто приёмщик для medium?** Отдельная сессия агента с ключом `agent-*` (по
   умолчанию `agent-judge`) или человек. Ключ живёт на машине приёмщика.
2. **Кто подписывает high-risk?** Человек с ключом `human-*`. Приватный ключ — в
   менеджере паролей, отдельной учётной записи или токене; не рядом с агентом.
3. **Логи — доказательство?** `logs: local` (не коммитятся, хешей в записи нет) или
   `commit`. Коммитить логи можно только с редакцией секретов.
4. **Где живёт пакет?** `docs/subagent-workflow/` в целевом репозитории (так делает `init`).

Зафиксируйте ответы в `docs/subagent-workflow/README.md` проекта.

## 0.1. Что нового в 2.2–2.3 и что придётся сделать

- **Атака спецификации** (`task-attack`) — шаг до замка контракта. По умолчанию
  выключена: `"policy": { "attack": "off" }`. Включается, когда готовы платить
  временем за разбор находок.
- **Реестр решений** — `TASK-META.decisions`; у заданий medium/high обязателен
  (пустой массив допустим).
- **Покрытие** — `criteria[].covers`; для medium/high нужен хотя бы один критерий
  с `covers`.
- **Политика** — `policy` в `workflow.config.json`: `fail` / `warn` / `off` для
  `decisions`, `coverage`, `attack`, `roles.modelFamily`. Целостность записи
  (самоприёмка, подпись, хеши) политикой не отключается.
- **Критерий эффекта (2.3.0)** — `criteria[].effect { observable, threshold,
  measuredBy }`. Если среди решений есть влияние на пользователя, критерий с
  эффектом обязателен: «команда вернула 0» не доказывает результат.
- **Свежесть красного (2.3.0)** — у записи версии 6 `red.baseSha` обязан совпадать
  с `contractCommit`: перевыпуск не наследует старый красный прогон.
- **Regress** — `node docs/subagent-workflow/scripts/task-regress.mjs --repo .
  --strict --baseline regress.baseline.json`. По расписанию, не на каждый PR;
  baseline фиксирует известный долг провенанса.
- **Миграция**: замок контракта — версия 3, у заданий в работе выполните
  `task-hash --write` заново. Записи о приёмке версий 4 и 5 остаются валидными;
  новые — версия 6.

- **Обновление (2.3.1)** — `init --force` обновляет файлы пакета и **не меняет
  ключ**; ротация — только `--rotate-key`. `VERSION` обновляется вместе с файлами:
  `init` без `--force` только добавляет отсутствующее и версию не трогает.
- **Regress (2.3.0, уточнён в 2.3.1)** — `task-regress` перезапускает критерии
  принятых заданий. Регресс (`regressed`) — ошибка всегда; `unproven-lawful` (low +
  записанный обход) — предупреждение; `unproven-violation` (medium/high без красного)
  — ошибка; записи v1–v3 — `legacy`. Известный долг — в `regress.baseline.json`
  (`--write-baseline`), `reviewBy` 30 дней.

Версия развёрнутой копии — в `docs/subagent-workflow/VERSION` (с 2.2.2).

## 0.2. Обновление уже развёрнутой копии

~~~bash
# из распакованного пакета новой версии
node spec/scripts/init.mjs --repo <проект> --force
node docs/subagent-workflow/scripts/doctor.mjs --repo .
~~~

- `--force` обновляет файлы пакета; `acceptors.json` и ключи не меняются.
- `init` **без** `--force` только добавляет отсутствующие файлы и **не** обновляет
  `VERSION` — это частичное добавление, а не обновление.
- Ротация ключа — отдельное действие: `init --rotate-key` (старые записи этим ключом
  станут `untrusted`).
- Замок v2 после обновления невалиден: `task-hash --write` по заданиям в работе.
  Записи 1–3 остаются историей (`legacy`), записи 4–6 валидны.

## 1. Развернуть пакет

Из каталога пакета:

~~~bash
node spec/scripts/init.mjs --repo <путь к проекту> --key-id agent-judge
# опционально: --tasks docs/tasks --logs commit --key-out <каталог ключей>
~~~

Что делает `init`:

- копирует в `<проект>/docs/subagent-workflow/` спецификацию, шаблоны, конфигурацию и все ворота;
- создаёт `docs/tasks/` и правило в `.gitignore` для журналов;
- генерирует ключ `agent-judge` (Ed25519) в `~/.wf-keys` и закрепляет публичную часть
  в `acceptors.json`;
- пишет `workflow.config.json`.

Проверка: `node docs/subagent-workflow/selftest.mjs` и `node docs/subagent-workflow/e2e.mjs`
(оба должны закончиться `OK`; e2e работает во временном каталоге).

Затем `node docs/subagent-workflow/scripts/doctor.mjs --repo .`: в выводе должны быть
строка политики (`decisions=…, coverage=…, attack=…, modelFamily=…`) и, если роли
настроены, строки ролей с моделями.

## 2. Ключи

~~~bash
# приёмщик-агент (уже создан init; можно сменить id)
node docs/subagent-workflow/scripts/sign.mjs keygen --id agent-judge --out-dir ~/.wf-keys

# человек для high-risk — на его машине
node docs/subagent-workflow/scripts/sign.mjs keygen --id human-owner --out-dir ~/.wf-keys
~~~

Публичный ключ — в `docs/subagent-workflow/acceptors.json`:

~~~json
{
  "acceptors": [
    { "keyId": "agent-judge", "kind": "agent", "owner": "judge",
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n" },
    { "keyId": "human-owner", "kind": "human", "owner": "Имя",
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n" }
  ]
}
~~~

Правила: приватный ключ не коммитится и не передаётся исполнителю; `kind` совпадает
с префиксом; отзыв — `revokedAt`, а не удаление.

## 3. Создать задание

~~~bash
node docs/subagent-workflow/scripts/new-task.mjs --repo . --id 0001 \
  --title "Краткий результат" --risk medium
~~~

`new-task` подставит `issuedBy` из `DSH_SESSION_ID` и `DSH_MODEL`. Дальше:

1. Заполнить цель, границы, инварианты.
2. Заполнить `decisions` в TASK-META: что выбрано сверх механической работы и чем
   подтверждено (критерием или человеком). Пустой массив — законный ответ.
3. Заполнить `criteria.json`: `redExpect`, причины падения, негативный критерий
   и `covers` — какие файлы покрывает критерий.
4. `git add docs/tasks/0001 checks && git commit -m "task 0001: контракт"`.
5. Если `policy.attack = fail` (или хотите проверить себя): атака до замка —

~~~bash
node docs/subagent-workflow/scripts/task-attack.mjs --task docs/tasks/0001 --prompt
node docs/subagent-workflow/scripts/task-attack.mjs --task docs/tasks/0001 --init
# критик в отдельной сессии заполняет attack.json
node docs/subagent-workflow/scripts/task-attack.mjs --task docs/tasks/0001 --check
~~~

6. `task-hash --write`, `task-lint --strict`, `task-red --base HEAD`.

Красный обязан упасть **по объявленной причине**: `mustFail` не пуст, `reasons`
содержит подстроку из вывода, `mustPass` зелёный на базе.

## 4. Работа и приёмка

1. Исполнитель — отдельная сессия (`subagent`, не `fork`), только задание и репозиторий.
2. После работы: `task-verify` (самопроверка).
3. Приёмщик — **другая сессия**, без отчёта исполнителя до прогона:

~~~bash
node docs/subagent-workflow/scripts/task-accept.mjs --task docs/tasks/0001 \
  --acceptor judge --key ~/.wf-keys/agent-judge.key.pem --key-id agent-judge \
  --expect-contract <contractCommit>
~~~

4. Проверка записи:

~~~bash
node docs/subagent-workflow/scripts/task-check-acceptance.mjs \
  --file docs/tasks/0001/acceptance.json --repo . --metadata <metadataCommit>
~~~

5. Фиксация: `git reset --hard <candidateCommit>`, затем коммит `acceptance.json`
   отдельным metadata-коммитом.

**Обязательная негативная проверка:** запустите `task-accept` из сессии постановщика.
Должен быть отказ «сессия приёмщика совпадает с issuedBy». Если принято — адаптер
актора не работает, дальше идти нельзя.

## 5. CI

~~~yaml
- name: workflow records
  run: |
    for f in $(git diff --name-only origin/main...HEAD | grep 'acceptance.json$'); do
      node docs/subagent-workflow/scripts/task-check-acceptance.mjs --file "$f" --repo .
    done

- name: workflow selftest
  run: |
    node docs/subagent-workflow/selftest.mjs
    node docs/subagent-workflow/e2e.mjs
~~~

Публичные ключи берутся из репозитория; приватных в CI нет. Нарушение — блокирующая
ошибка. Branch protection: `check`, `lint`, `selftest`; force-push запрещён.

## 6. Документация в проекте

- `AGENTS.md`: читать SPEC целиком; цикл команд; запрет самоприёмки; где ключи.
- `docs/tasks/README.md`: новые задачи по 2.0, таблица задач.
- `docs/subagent-workflow/README.md`: решения из шага 0.

## 7. Definition of Done

- [ ] `selftest.mjs` и `e2e.mjs` зелёные.
- [ ] `acceptors.json` закоммичен, приватных ключей в репозитории нет.
- [ ] `issuedBy` пишется в контракт, `lint` без него падает.
- [ ] Самоприёмка отклоняется (проверено руками).
- [ ] Приёмка из отдельной сессии создаёт запись v6 с `actor.session`, `decisions`
      и (если атака включена) `attack`.
- [ ] `task-check-acceptance` проходит по принятой записи и падает на подмене.
- [ ] CI проверяет изменённые записи и гоняет selftest/e2e.
- [ ] `task-regress` зелёный (или долг зафиксирован в `regress.baseline.json`).
- [ ] У задач с `impact: user-visible` есть критерий с `effect` и измеряющим его
      другим критерием; `lint`/accept это проверяют.
- [ ] `red.baseSha = contractCommit` у записей v6 (свежесть красного).
- [ ] Пилотная задача принята: кандидатный коммит + metadata-коммит.
- [ ] High-risk с ключом агента отклоняется, с ключом `human-*` — принимается.

## 8. Ротация и откат

- Ротация: `init --rotate-key` (новый материал для того же `keyId`) или новый
  `keyId`; старый публичный ключ остаётся, старые записи перестают проверяться —
  это осознанное действие.
- Компрометация: `revokedAt` + запись об инциденте + повторная приёмка затронутых задач.
- Откат внедрения: CI не блокирует merge, пока джоба не включена; записи не удаляются.

## 9. Частые сбои

| Симптом | Причина | Что делать |
| --- | --- | --- |
| «сессия приёмщика совпадает с issuedBy» | accept запущен из сессии постановщика | запустить из отдельной сессии |
| «нет сессии приёмщика» | не задан `DSH_SESSION_ID`/`TASK_ACTOR_SESSION` | настроить адаптер в config |
| «ключ не закреплён» | `keyId` нет в `acceptors.json` | добавить публичный ключ |
| «приватный ключ не соответствует» | перепутаны ключи | проверить fingerprint |
| «подпись не совпадает» | запись отредактирована | не править запись, пересоздать приёмку |
| «красный не по ожидаемой причине» | `reasons` не совпал | уточнить причину или формулировку теста |
| «metadata-коммит меняет не только acceptance.json» | в metadata попал код | разделить коммиты |
| «verify.json нет в кандидате» | хеш записан, файл не закоммичен | `logs: local` или коммитить артефакты |
| «нет attack.json» при `policy.attack=fail` | атака не проводилась | `task-attack --prompt/--init`, затем `--check` |
| «blocking-находки без resolution» | находки не закрыты | закрыть `resolution` или понизить severity с `reason` |
| «версия замка 2, нужна 3» | старый замок после обновления | `task-hash --write` заново |
| «записи стали untrusted после обновления» | старый пакет ротировал ключ при `--force` | обновиться до 2.3.1+; ключ восстановить из бэкапа/менеджера |
| regress: «unproven-violation» | medium/high без красного или low без обхода | перевыпуск с красным или разбор записи |
| regress: «legacy» | запись v1–v3 | это история, действий не требует |
| `git reset --hard` отклонён | незакоммиченные чужие правки | сначала убрать их: кандидат их не содержит |
