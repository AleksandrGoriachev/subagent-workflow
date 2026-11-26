# Установка пакета

Пакет — это каталог `subagent-workflow-<версия>/` (или zip с ним). Версию задаёт файл `VERSION` в корне архива. Зависимостей нет:
нужны Node.js 20+ и git. Сеть не требуется.

## 1. Проверить архив

~~~bash
sha256sum -c subagent-workflow-<версия>.zip.sha256
# Windows PowerShell 7:
Get-FileHash .\subagent-workflow-<версия>.zip -Algorithm SHA256
~~~

## 1a. Или клонировать

~~~bash
git clone https://github.com/AleksandrGoriachev/subagent-workflow.git
cd subagent-workflow
~~~

## 2. Распаковать

~~~bash
unzip subagent-workflow-<версия>.zip
cd subagent-workflow-<версия>
node tools/verify.mjs
~~~

Внутри: `spec/` (спецификация, ворота, шаблоны), `adapters/` (харнессы),
`deploy/` (runbook), `examples/` (пример задания), `tools/` (сборка пакета).

**Важно: архив — это пакет, а не развёрнутая копия.** В проекте движок живёт в
`docs/subagent-workflow/` и создаётся командой `init` из `spec/scripts/init.mjs`.
Запускать `init` из распакованного в `docs/` архива нельзя: там нет `scripts/init.mjs`
(есть только `spec/scripts/`).

## 3. Развернуть в проекте

~~~bash
node spec/scripts/init.mjs --repo ../my-project --key-id agent-judge
~~~

`init` создаёт `docs/subagent-workflow/` в проекте, каталог заданий, правило
`.gitignore`, конфигурацию и ключ приёмщика в `~/.wf-keys`.

### 3.1. Код движка не вендорится (по умолчанию с 2.6.113)

`init` по умолчанию пишет в `.gitignore` проекта строку `docs/subagent-workflow/`
(комментарий `# subagent-workflow: код движка разворачивается, а не вендорится`).
Развёрнутая копия — продукт развёртывания, а не история проекта: обновление движка
больше не появляется в чужих диффах и не требует обхода `task-guard`.

Цена решения называет само развёртывание: `workflow.config.json`, `acceptors.json`
и `hooks/` тоже стали машинными. Значит **клон обязан выполнить `init` до ворот и
до `check-acceptance` в CI** — иначе политика `enforcement`, пины ключей приёмки и
хуки на этой машине отсутствуют.

Координатор воркспейса получает три следа:

1. `docs/subagent-workflow/deploy-notice.json` — режим (`local`/`external`), политика
   (`gitignore`/`vendored`), что игнорируется, что стало машинным, что делать клону;
2. строка в `~/.dsh/workflow/deploy-notices.jsonl` (путь переопределяется
   `WF_DEPLOY_NOTICES`) — журнал переживает смену каталога и работает для внешнего движка;
3. одна строка `init: координатору — …` в выводе сессии, которая разворачивала.

Проект, который осознанно держит копию в своей истории, сохраняет прежнее поведение
явным флагом: `node spec/scripts/init.mjs --repo ../my-project --deploy-policy vendored`.
Тогда `docs/subagent-workflow/` не игнорируется, а уведомление всё равно пишется — с
политикой `vendored` и ценой «обновление движка требует коммита и обхода guard».

## 4. Проверить

~~~bash
cd ../my-project
node docs/subagent-workflow/scripts/doctor.mjs --repo .
node docs/subagent-workflow/scripts/actor.mjs --risk medium
~~~

Ожидаемо: `DOCTOR OK` и exit 0 у второго. Если актор `declared` — см.
`adapters/` и настройте `actor.primaryEnv`.

## 5. Первое задание

~~~bash
node docs/subagent-workflow/scripts/new-task.mjs --repo . --id 0001 \
  --title "Первый результат" --risk medium
# заполнить criteria.json, закоммитить контракт
~~~

Дальше — `deploy/AGENT-DEPLOY.md` или раздел 0.1 спецификации.


## 7. Панель `dsh-workflow-console` (плагин DSH)

Панель — отдельный пакет DSH (read-only консоль: доска задач, политика, диагностика,
развёртывание и обновление движка). Она **не входит** в архив движка и ставится отдельно.

### 7.1. Где взять

Только tarball из релиза:

```
https://github.com/AleksandrGoriachev/subagent-workflow/releases/latest/download/dsh-workflow-console.tgz
```

**URL репозитория ставить нельзя.** В корне репозитория лежит движок (`package.json` =
`subagent-workflow`, без `dsh.bundle`); бандл панели — в каталоге `plugin/` и собирается в
tarball. Попытка `pnpm`-установки по URL репозитория даст ошибку разрешения зависимостей.

Проверка скачанного (PowerShell):

```powershell
$tgz = "$env:TEMP\dsh-workflow-console.tgz"
Invoke-WebRequest \
  "https://github.com/AleksandrGoriachev/subagent-workflow/releases/latest/download/dsh-workflow-console.tgz" \
  -OutFile $tgz
(Get-Item $tgz).Length            # ожидается ~281 КБ для 0.9.4
tar -tzf $tgz | Select-Object -First 6   # package/lib, package/vendor/spec, package/package.json
tar -xzOf $tgz package/package.json | Select-String '"version"'
```

### 7.2. Установка и обновление

1. **Нативный путь — менеджер плагинов DSH.** Settings → Plugins → **Add plugin**: вставить
   абсолютный путь к tarball → Install → включить плагин. Обновление стороннего плагина —
   **Uninstall** и снова **Add plugin** с новым tarball (кнопка Update есть только у официальных
   записей). DSH закрывать не нужно: клиентская часть подхватывается перезагрузкой страницы,
   host-часть перезапускается как fiber при выключении/включении плагина (Loader `update`).
2. **Когда всё-таки закрыть DSH.** Только если установка падает `EPERM`: это pnpm упирается в
   занятые DLL нативного модуля профиля. Проверка —
   `Get-ChildItem "$env:USERPROFILE\.dsh\profiles\desktop\node_modules" -Recurse -Filter *.node`;
   если список пуст (в профиле `desktop` на 2026-11-03 таких файлов 0), закрывать не требуется.
   Прошлая редакция требовала выхода всегда — правило было шире причины.
3. **Ручной путь (если GUI недоступен).** Распаковать в каталог плагинов:

```powershell
$dest = "$env:USERPROFILE\.dsh\plugins\dsh-workflow-console"
Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $dest -Force | Out-Null
tar -xzf $tgz -C $dest --strip-components=1
Test-Path "$dest\lib\index.js"   # True
```

4. Прописать в профиль `~/.dsh/profiles/<profile>/package.json` (сделать копию файла рядом):

```json
{
  "dsh": { "profile": { "bundles": [ "…", "dsh-workflow-console" ] } },
  "dependencies": {
    "dsh-workflow-console": "link:C:/Users/<you>/.dsh/plugins/dsh-workflow-console"
  }
}
```

5. `pnpm install` в каталоге профиля (при закрытом DSH) — или, если позволяет sandbox,
   создать junction: `New-Item -ItemType Junction -Path node_modules\dsh-workflow-console -Target $dest`.
6. Запустить DSH.

### 7.3. Ловушки (каждая проверена на живой установке)

1. **Оборванный `pnpm install` не лечится сам.** DSH при старте не доустанавливает зависимости —
   он читает готовый `node_modules`. Если установка упала на `EPERM`, доделайте её при закрытом
   DSH, иначе после перезапуска отвалятся другие плагины (наблюдалось: пропала память).
2. **`roots` не оставляйте пустыми** (`roots: []`): панель тогда берёт корни из реестра
   воркспейсов, а их число меняется от загрузки к загрузке (наблюдалось 7 → 0 → 7), из-за чего
   письма обмена молча не доставляются. Пишите явно:

```yaml
    roots:
      - C:/path/to/workspace-with-engine
    exchangeWatch: false
```

3. **Список воркспейсов в панели** берётся из реестра DSH, а не из `roots`: архивный воркспейс
   не появится, даже если прописать его в `roots`.
4. **Воркспейс без движка** не разворачивает его сам: положите карту
   `~/.dsh/workflow/engine-roots.json` → `{ "<воркспейс>": "<репозиторий-движка>" }`
   (панель читает оттуда, запись запрещена — `409 engine-external`).
5. **Версия в профиле статична**: при `link:` файлы читаются из каталога, поэтому обновление =
   заменить каталог (или переустановить через менеджер плагинов) и перезагрузить страницу;
   `package.json` профиля править не нужно. Перезапуск DSH нужен только после ручной правки
   `package.json`/зависимостей профиля.

### 7.4. Проверка после старта

1. В разговоре появилась вкладка **Workflow**.
2. `GET /workflow/api/status` отдаёт `plugin.version` (ожидается 0.9.4) и `engine.installed`.
3. **Вернулись остальные бандлы** профиля (память, notify, message-gateway) — проверить списком,
   а не «по ощущению».
4. Кнопка «Доктор» отрабатывает, панель не пустая.
5. Только после этого настраивать `roots` и разворачивать движок.

### 7.5. Обновление панели

Скачать новый tarball → закрыть DSH → заменить содержимое каталога плагина (`tar -xzf … --strip-components=1`)
→ запустить DSH → сверить `plugin.version`. Ключи и движок не затрагиваются: панель читает их
через `docs/subagent-workflow/` в воркспейсе или карту внешнего движка.

## Обновление

Распакуйте новую версию и повторите:

~~~bash
node spec/scripts/init.mjs --repo ../my-project --force
~~~

`--force` перезаписывает скрипты и шаблоны, но не удаляет задания и записи.
`acceptors.json` можно сохранить: ключи не зависят от версии пакета.

С 2.1.0 `task-lint` требует у заданий medium/high поле `decisions` (пустой массив
допустим) и хотя бы один `covers` у критериев: допишите их в контракт задания до
следующего прогона. Записи о приёмке версий 4 и 5 продолжают проверяться.

С 2.2.0 замок контракта — версия 3 (в него входит digest `attack.json`): у заданий
в работе выполните `task-hash --write` заново. Атака по умолчанию выключена
(`policy.attack: "off"`) и включается в `workflow.config.json`, когда готова.

## Удаление

Удалите `docs/subagent-workflow/` и правила из `.gitignore`. Записи `acceptance.json`
остаются историей репозитория; их не удаляют.

## 6. Обновление уже развёрнутого проекта

Коротко: новый архив → `init --force` с `--key-out` в каталог ключей проекта →
`doctor` и `selftest` → проверить исторические `acceptance.json` → коммит деплоя.

Полный порядок, ловушки и откат — `deploy/UPDATE.md`. Ключи при обновлении не меняются:
`--force` обновляет файлы пакета и не трогает ключ.

## Контракт задания и два слоя

Один контракт читают два слоя, и вопросы у них разные: «почему узел не запускается» и «почему приёмка не проходит».

| Что | Слой workflow (этот пакет) | Слой structure (плагин графа) |
| --- | --- | --- |
| Задание | `docs/tasks/<id>/task.md`, блок `TASK-META` | тот же каталог: имя из четырёх цифр |
| Границы правки | `TASK-META.allowedPaths` | `TASK-META.allowedPaths` (гейт записи) |
| Кто принимает | поле `TASK-META.acceptor` (роль) | ребро приёмки в графе и `acceptorNode` (запущенный узел) |
| Проверки | `criteria.json` + `criteria.lock` (или `mode=light` + `checks`) | не читает |
| Красный | `red.json` (кроме low/light) | не читает |

Проверить оба слоя до работы:

```sh
node spec/scripts/task-preflight.mjs --contract --audit --task docs/tasks/0164
node spec/scripts/task-preflight.mjs --contract --audit --json --task docs/tasks/0164
```

Ответ называет недостающее по имени: «для запуска: …», «для приёмки: …». Structure может звать тот же вход
перед спавном узла и не держать второй валидатор; `--json` отдаёт `{ run: { ok, missing }, accept: { ok, missing } }`.

## Длинные прогоны и замеры

Политика воркспейса (`enforcement.waitPolicy=fail`) отклоняет паузы дольше 120 секунд внутри инструмента
и прямой `Start-Sleep`. Штатный способ длинной работы — сторож `scripts/job.mjs`:

```sh
# запустить тяжёлый прогон и получить id
node spec/scripts/job.mjs start -- node spec/selftest.mjs
# дождаться с хвостом лога
node spec/scripts/job.mjs wait <id> --tail 40
# прочитать лог позже
node spec/scripts/job.mjs log <id> --tail 100
```

Замеры с интервалом (heartbeat: два сэмпла по 60 секунд, watchdog-проверка) делаются тем же сторожем:
вместо паузы в инструменте запускается сэмплер, а результат забирается через `wait`.

Ворота задания удобнее одной командой: `node spec/scripts/gate.mjs <red|verify|accept|tests> --tail 20`.

Сторож — не способ ждать узел графа: `project_graph_spawn` запускает узел, а штатного `wait/status`
у плагина structure пока нет (см. раздел «Ожидание узла графа»).

## Ожидание узла графа

Проект-практика: узел запускается, а ждать его штатно нечем. Ниже — что есть на самом деле.

| Что нужно | Что есть |
| --- | --- |
| запустить узел | `project_graph_spawn(node, prompt, root)` возвращает `childId` |
| дождаться результата | результат приходит сообщением о завершении |
| узнать статус | `list_agents` и сообщения; паузы больше 120 с политика отклоняет |
| дождаться команды | `scripts/job.mjs start` и `wait <id>` (раздел «Длинные прогоны и замеры») |

`scripts/job.mjs` — сторож команд, а не узлов: он не знает `childId` и не вернёт результат узла.

Требование к structure (письмо отправлено): `wait`/`status` по `childId` — без сна внутри инструмента и без
таймаута инструмента, как у сторожа команд. Пока его нет, документ не обещает ожидания, которого не существует:
приёмка запускается через `project_graph_spawn`, результат забирается из сообщения о завершении.
