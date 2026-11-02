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
(Get-Item $tgz).Length            # ожидается ~261 КБ для 0.9.0
tar -tzf $tgz | Select-Object -First 6   # package/lib, package/vendor/spec, package/package.json
tar -xzOf $tgz package/package.json | Select-String '"version"'
```

### 7.2. Установка (ручной порядок, без CLI)

1. **Выйти из DSH** (трей → выход). Установка в работающем профиле падает на
   `EPERM` из-за занятых DLL (`onnxruntime-node`), и профиль остаётся неполным.
2. Распаковать в каталог плагинов:

```powershell
$dest = "$env:USERPROFILE\.dsh\plugins\dsh-workflow-console"
Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $dest -Force | Out-Null
tar -xzf $tgz -C $dest --strip-components=1
Test-Path "$dest\lib\index.js"   # True
```

3. Прописать в профиль `~/.dsh/profiles/<profile>/package.json` (сделать копию файла рядом):

```json
{
  "dsh": { "profile": { "bundles": [ "…", "dsh-workflow-console" ] } },
  "dependencies": {
    "dsh-workflow-console": "link:C:/Users/<you>/.dsh/plugins/dsh-workflow-console"
  }
}
```

4. `pnpm install` в каталоге профиля (DSH уже закрыт) — или, если позволяет sandbox,
   создать junction: `New-Item -ItemType Junction -Path node_modules\dsh-workflow-console -Target $dest`.
5. Запустить DSH.

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
5. **Версия в профиле статична**: `link:` указывает на каталог, поэтому обновление = заменить
   каталог и перезапустить DSH; `package.json` профиля править не нужно.

### 7.4. Проверка после старта

1. В разговоре появилась вкладка **Workflow**.
2. `GET /workflow/api/status` отдаёт `plugin.version` (ожидается 0.9.0) и `engine.installed`.
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
