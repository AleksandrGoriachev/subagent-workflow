# Чек-лист выкатки пакета

Применяется к каждому релизу `subagent-workflow` — и в этом репозитории, и в любом
проекте, который выкатывает новую версию себе. Порядок важен: версия в файлах →
прогоны → архив и tarball → git → релиз → CI → развёрнутые копии → запись в память.

Причина существования файла: 2.4.2 вышла с README и `TOOL` на две версии ниже,
потому что версия жила в пяти местах, а проверялась в одном. С тех пор проверка
одна и машинная: `node tools/check-version.mjs`.

## 1. Версия в файлах (все пять)

- [ ] `VERSION` — новая версия, строго `X.Y.Z`
- [ ] `package.json` → `version`
- [ ] `README.md` — первая строка: `# subagent-workflow X.Y.Z — …`
- [ ] `spec/SPEC.md` — заголовок «Версия: X.Y.Z» **и** новый абзац «Версия X.Y.Z:»
      с тем, что изменилось по пунктам
- [ ] `spec/scripts/lib/common.mjs` — `TOOL = 'subagent-workflow/X.Y.Z'`
      (попадает только в поле `tool` замка `criteria.lock`; в записи приёмки и
      `verify.json` его нет)
- [ ] `CHANGELOG.md` — новая секция сверху: `## X.Y.Z — ГГГГ-ММ-ДД`, пункты по
      существу, строка с числами тестов

- [ ] `node tools/check-version.mjs` → `VERSION OK`

## 2. Прогоны

- [ ] Windows: `node spec/selftest.mjs`, `node spec/e2e.mjs`, `node spec/e2e-deploy.mjs`
- [ ] приёмочные проверки задания: `node spec/checks/guard-acceptance.mjs --all`
      (покрытие индекса, отказ вне задания, метка обхода и аудит, хуки, панель)
- [ ] схема записи: `node spec/checks/acceptance-schema.mjs` →
      `ACCEPTANCE SCHEMA OK` (она же проверяется в CI, джоба `test`)
- [ ] развёртывание из панели: `node spec/checks/panel-deploy.mjs` →
      `PANEL DEPLOY OK` (модуль, маршрут, кнопка, версия 0.7.0 и vendor в files;
      в CI — джоба `test`, сразу после приёмочных проверок; задание 0015)
- [ ] источники актора: `node spec/checks/actor-sources.mjs` → `ACTOR SOURCES OK`
      (runner/harness дают `separate-session`, ci/manual — `declared`, пустое
      окружение и неизвестный вид источника закрывают ворота; legacy-конфиг без
      `sources` ведёт себя как раньше)
- [ ] режим хуков в индексе: `git ls-files -s spec/hooks` — все три `100755`,
      `node spec/checks/hooks-mode.mjs` → `HOOKS MODE OK`. На Windows режим
      выставляется только git-ом (`git update-index --chmod=+x`): файловая
      система его не хранит, а `git add` берёт режим из рабочего дерева
- [ ] WSL Ubuntu: те же три из `spec/`
- [ ] `node plugin/tools/test.mjs` и `node --check plugin/lib/client.js` (если трогали панель)
- [ ] Новая правка покрыта проверкой, которая падает, если условие снять
- [ ] Гейты не трогают рабочие ключи: после `e2e-deploy` файлы
      `~/.wf-keys/*` не меняются (проверка — mtime до/после; урок 2.4.3, когда
      тест ротации дважды перевыпустил ключ в ws-school-app)

## 3. Архив и tarball

- [ ] `node tools/pack.mjs` → `dist/subagent-workflow-X.Y.Z.zip` + `.sha256`
- [ ] `node tools/pack-plugin.mjs` → `dist/dsh-workflow-console-X.Y.Z.tgz`,
      байт-в-байт `dist/dsh-workflow-console.tgz` и `.sha256` для обоих
- [ ] **каждый релиз** содержит `dsh-workflow-console.tgz` — стабильное имя для
      `workflowInstallSpec`
      (`releases/latest/download/dsh-workflow-console.tgz`), версионированную
      копию и оба `.sha256`. Tarball собирается из `plugin/` без копирования и
      без правки манифеста; `node tools/pack-plugin.mjs --plan` печатает имена,
      а `tar -tzf dist/dsh-workflow-console.tgz` содержит `package/package.json`,
      `package/lib/`, `package/cordis.patch.yml` и `package/README.md`
- [ ] **в tarball вложена спека** (0.7.0): `tar -tzf dist/dsh-workflow-console.tgz`
      содержит `package/vendor/spec/scripts/init.mjs` и `package/vendor/VERSION`;
      панель разворачивает движок из них офлайн, версия движка = версия tarball.
      `tools/pack-plugin.mjs` кладёт спеку перед `npm pack` и убирает после (в том
      числе при ошибке) — в `git status` каталога `plugin/vendor/` оставаться не
      должно; `--plan` не пишет ничего
- [ ] распаковать в пустой каталог, `node tools/verify.mjs` — число файлов и хеши
- [ ] из распакованного архива: `node spec/selftest.mjs` — зелёный
- [ ] `init --force` из архива на копию проекта: `VERSION` и `TOOL` новые,
      `workflow.config.json` и `acceptors.json` байт в байт

## 4. Git

- [ ] коммит(ы) в `main`, дерево чистое
- [ ] тег `vX.Y.Z` на этом коммите
- [ ] `git push origin main` и `git push origin vX.Y.Z`

## 5. Релиз GitHub

- [ ] тег `vX.Y.Z`, `name`: короткая строка «что изменилось»
- [ ] тело: разделы «Что нового», «Проверки» (числа тестов и sha256), «Обновление»
      (`init --force`; ключ и конфиг сохраняются)
- [ ] ассеты: zip и zip.sha256, `dsh-workflow-console.tgz` (стабильное имя),
      `dsh-workflow-console-X.Y.Z.tgz` и оба `.sha256`
- [ ] ссылка на релиз в ответе заказчику

## 6. CI

- [ ] 12/12 (test, plugin, deploy × ubuntu/windows × node 22/24) — зелёные
- [ ] в джобе `test` есть шаг `guard-acceptance --all` и он зелёный на ubuntu и
      windows: приёмочные кейсы обхода — часть CI, а не только заданий
- [ ] в джобе `test` сразу после `selftest` идёт
      `node spec/checks/acceptance-schema.mjs` и зелёный на ubuntu и windows:
      схема записи проверяется машиной при каждом пуше
- [ ] в джобе `test` сразу после `e2e` идёт шаг `node spec/checks/hooks-mode.mjs`
      и зелёный на ubuntu и windows; шага `chmod +x spec/hooks/*` нет — CI не
      подменяет права под тестами (2.5.2)
- [ ] в джобе `test` после приёмочных проверок идёт шаг
      `node spec/checks/panel-deploy.mjs` и зелёный на ubuntu и windows: кнопка
      развёртывания и сборка vendor проверяются на каждом пуше, а не только в
      задании (0.7.0)
- [ ] если красный: сначала причина (код или инфраструктура), потом пуш

## 7. Развёрнутые копии

- [ ] в проекте-потребителе: `node spec/scripts/init.mjs --repo <проект> --force`
      из распакованного архива
- [ ] `VERSION` = `TOOL` = `subagent-workflow/X.Y.Z`, ключ не менялся
- [ ] `selftest`/`e2e`/`e2e-deploy` в проекте — зелёные (в его окружении)
- [ ] `git status` после `init --force` показывает изменённые файлы пакета; пусто
      при новых `VERSION`/`TOOL` — время файлов не обновилось, `git add -A` молча
      оставит старый файл в индексе (2.4.5 ставит mtime сам, но сверять надо)
- [ ] `init --force` поставил хуки: `git config core.hooksPath` =
      `docs/subagent-workflow/hooks` (локально; глобальный конфиг не тронут), файлы
      `pre-commit`, `commit-msg`, `pre-push` на месте и исполняемые
- [ ] `guard.enabled` в проекте — осознанное решение: выключенный guard не меняет
      поведение репозитория; включённый отклоняет коммит вне задания, обход —
      метка `[workflow-bypass: причина]` (остаётся в аудите) или `--no-verify`
      (следа нет)
- [ ] проектные доки (README/DEPLOY проекта) называют новую версию
- [ ] если в проекте уже есть запертые задания — проверить, что их `protectedPaths`
      не накрывает пакет (`docs/subagent-workflow/**`): иначе обновление изменит
      защищённые файлы, замок покраснеет, а перезамок после красного запрещён (I-3).
      Уже покрасневший замок не перезамковывать: задание остаётся историей со своей
      версией в `tool`, новые задания выдаются на обновлённом пакете (2.4.6)
- [ ] одна задача пройдена **целиком** на развёрнутой копии: контракт → замок →
      красный → кандидат → приёмка отдельной сессией → `check-acceptance` →
      фиксация (`reset --hard` кандидат + metadata-коммит). Установка считается
      принятой, когда цикл прошёл на проекте, а не только на самом пакете

## 8. Запись

- [ ] память: версия, коммит, тег, sha256, ссылка на релиз, числа тестов
- [ ] handover обновлён (состояние + следующий шаг)
- [ ] если проект обновлялся — инструкция для агента проекта отражает **новый**
      ожидаемый дифф
