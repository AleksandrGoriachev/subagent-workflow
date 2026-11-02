# Обновление развёрнутого движка (runbook)

Когда: в проекте уже есть `docs/subagent-workflow/`, вышла новая версия пакета.
Кому: архитектор или релиз-инженер. Исполнитель движок не обновляет.

## 0. Предусловия

1. Дерево чистое: `git status --porcelain` пуст (или работайте в отдельном `git worktree`).
2. Известен каталог ключей проекта (`--key-out`): обычно `<repo>/.wf-keys` либо `~/.wf-keys`.
3. Бэкап ветки: `git branch backup-before-update`.

## 1. Скачать и сверить

```bash
curl -LO https://github.com/AleksandrGoriachev/subagent-workflow/releases/latest/download/subagent-workflow-<версия>.zip
sha256sum -c subagent-workflow-<версия>.zip.sha256
unzip subagent-workflow-<версия>.zip
```

## 2. Развернуть

```bash
node subagent-workflow-<версия>/spec/scripts/init.mjs --repo . --force --key-out <каталог ключей>
```

- `--force` обновляет файлы пакета и **не меняет ключ**;
- каталог ключей указывайте явно: без `--key-out` `init` пишет в глобальный
  `~/.wf-keys` и затирает ключ другого проекта (дефект B1);
- если в каталоге ключа нет, `init` создаст новый — это повод остановиться и
  проверить путь, а не продолжать.

## 3. Проверить

```bash
node docs/subagent-workflow/scripts/doctor.mjs --repo .
node docs/subagent-workflow/selftest.mjs
node docs/subagent-workflow/scripts/task-check-acceptance.mjs --file docs/tasks/<id>/acceptance.json --repo .
```

Ожидаемо: `DOCTOR OK`, `SELFTEST OK`, а исторические записи приёмки остаются
проверяемыми: сверка идёт по закреплённому ключу, а не по версии движка.

## 4. Коммит

```bash
git add docs/subagent-workflow
git commit -m "deploy the workflow engine <версия> into this workspace"
```

Делать это **до** замка следующего контракта или **после** приёмки текущего (I-36).
Коммит между `task-hash --write` и `task-accept` сдвигает `HEAD` с `contractCommit`,
и ворота откажут.

## 5. Откат

```bash
git reset --hard backup-before-update   # или git revert <коммит деплоя>
```

Ключи при откате не трогаются: они лежат вне репозитория.

## 6. Ловушки

1. **Не запускать `init` без `--key-out`** — глобальный `~/.wf-keys` перезаписывается,
   и ключи других проектов теряются безвозвратно.
2. **Не защищать `docs/subagent-workflow/**` в `protectedPaths`** — `init --force`
   изменит эти файлы, замок станет красным, а перезамок после красного запрещён (I-3).
   Движок защищён полем `tool` в `criteria.lock`.
3. **Ключи не коммитить.** Каталог `--key-out` — вне репозитория или в `.gitignore`.
4. **Пакетные `checks/*.mjs` в развёрнутой копии не запускать** — они для пакета и CI;
   в проекте работают `doctor`, `selftest` и ворота заданий.
