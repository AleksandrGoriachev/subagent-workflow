        async function runReleaseCheck() {
          if (releaseCheckBusy) return;
          setReleaseCheckBusy(true);
          try {
            const response = await fetch(BASE + "/api/release-check", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({}),
            });
            const data = await readJson(response);
            setReleaseCheck(data);
          } catch (failure) {
            setReleaseCheck({ ok: false, error: errorText(failure), latest: null, cached: false });
          } finally {
            setReleaseCheckBusy(false);
          }
        }

        function releaseCheckText() {
          if (!releaseCheck) {
            const cached = status && status.latestRelease ? status.latestRelease : null;
            return cached
              ? "последний релиз: движок " + fmt(cached.engine) + ", панель " + fmt(cached.plugin) + " (проверено " + fmt(cached.at) + ")"
              : null;
          }
          if (releaseCheck.ok === true && releaseCheck.latest) {
            return "последний релиз: движок " + fmt(releaseCheck.latest.engine)
              + ", панель " + fmt(releaseCheck.latest.plugin)
              + " (проверено " + fmt(releaseCheck.checkedAt) + ")";
          }
          const tail = releaseCheck.latest
            ? " · последняя удачная " + fmt(releaseCheck.checkedAt) + ": движок " + fmt(releaseCheck.latest.engine) + ", панель " + fmt(releaseCheck.latest.plugin)
            : "";
          return fmt(releaseCheck.error || "проверка не удалась") + tail;
        }

        /* 0067: действие «Обновить из релиза» с коротким объяснением источника версии. */
        function renderReleaseAction() {
          return h(
            "div",
            { style: Object.assign({}, S.actions, { marginTop: "6px" }) },
            h(
              "button",
              {
                type: "button",
                style: updateBusy ? Object.assign({}, S.button, S.buttonDisabled) : S.button,
                disabled: updateBusy,
                onClick: () => void runReleaseUpdate(),
                title: RELEASE_UPDATE_HINT,
                "aria-label": RELEASE_UPDATE_LABEL,
              },
              updateBusy ? "Обновляем движок…" : RELEASE_UPDATE_LABEL,
            ),
            h("span", { style: S.hint }, RELEASE_UPDATE_HINT),
          );
        }

        function renderUpdateNote() {
          if (!updateNote) return null;
          const ok = updateNote.kind === "ok";
          const color = ok ? T.success : T.danger;
          const logText = tailText(updateNote.log, 3000);
          return h(
            "div",
            { style: Object.assign({}, S.runBox, { borderColor: color, marginTop: "8px" }) },
            h(
              "div",
              { style: S.runHead },
              h(
                "span",
                { style: Object.assign({}, S.runStatus, { color, borderColor: color }) },
                ok ? "ок" : updateNote.code || "отказ",
              ),
              h("span", { style: S.runTitle }, ok ? "Обновление движка" : "Обновить не удалось"),
              h("span", { style: S.spacer }),
              h(
                "button",
                { type: "button", style: S.button, onClick: () => setUpdateNote(null), title: "Скрыть сообщение" },
                "×",
              ),
            ),
            h("div", { style: { fontSize: "12px", whiteSpace: "pre-wrap" } }, updateNote.text),
            updateNote.release ? renderReleaseAction() : null,
            /*
             * 0085: тупик «не git-репозиторий» закрывается кнопкой — тот же
             * confirm, но с initGit: сервер делает git init и продолжает init --force.
             */
            updateNote.code === "not-a-repo"
              ? h(
                  "button",
                  {
                    type: "button",
                    style: updateBusy ? Object.assign({}, S.button, S.buttonDisabled) : S.button,
                    disabled: updateBusy,
                    onClick: () => { setUpdateInitGit(true); void runUpdate({ initGit: true }); },
                    title: "Создать git-репозиторий в воркспейсе и повторить обновление",
                  },
                  "Сделать git init и обновить",
                )
              : null,
            logText.length > 0 ? h("pre", { style: S.runLog }, logText) : null,
          );
        }

        function renderUpdateDialog(pending) {
          /* 0041: подтверждение понижения не открывается даже из старого состояния. */
          if (panelOlder()) return null;
          const external = externalEngine();
          const installed = engineInstalled();
          const available = engineAvailable();
          const blocked = updateBusy || (pending.length > 0 && !updateRisk);
          return h(
            "div",
            { style: Object.assign({}, S.stageBox, { borderLeftColor: pending.length > 0 ? T.warn : T.business }) },
            h(
              "div",
              { style: S.stageBoxTitle },
              external
                ? "Обновление движка в репозитории движка: подтверждение"
                : "Обновление движка: подтверждение",
            ),
            h(
              "div",
              { style: S.stageText },
              "Установлена версия " + fmt(installed) + ", будет установлена " + fmt(available)
                + (external
                  ? ". Запись идёт в репозиторий движка: " + (external.root || "путь неизвестен")
                    + ". Сам воркспейс не меняется: его файлы, задачи и записи приёмки не трогаются. "
                    + "Обновление выполняет init --force из вложенной спеки; ключи .wf-keys/ и "
                    + "acceptors.json репозитория движка не перезаписываются."
                  : ". Обновление перезапишет файлы движка и workflow.config.json (policy/roles/models "
                    + "сохраняются), задачи и записи приёмки не меняются. Ключи .wf-keys/ и acceptors.json "
                    + "не трогаются, глобальный ~/.wf-keys не создаётся."),
            ),
            pending.length > 0
              ? h(
                  "div",
                  { style: { marginTop: "8px", borderTop: "1px solid " + T.border1, paddingTop: "8px" } },
                  h(
                    "div",
                    { style: { color: T.warn, fontSize: "12px", fontWeight: "600", whiteSpace: "pre-wrap" } },
                    "Незавершённые задания: " + pending.join(", "),
                  ),
                  h(
                    "div",
                    { style: Object.assign({}, S.stageText, { marginTop: "4px" }) },
                    "Обновление меняет ворота и workflow.config.json; проверка незавершённого задания "
                      + "может прочитать смешанные версии скриптов и сломаться на перепроверке. "
                      + "Перед обновлением не должно быть запущенных задач.",
                  ),
                  h(
                    "label",
                    { style: S.toggle },
                    h("input", {
                      type: "checkbox",
                      checked: updateRisk,
                      onChange: (event) => setUpdateRisk(Boolean(event.target.checked)),
                      "aria-label": UPDATE_RISK_LABEL,
                    }),
                    UPDATE_RISK_LABEL,
                  ),
                )
              : h(
                  "div",
                  { style: Object.assign({}, S.stageText, { marginTop: "6px" }) },
                  "Незавершённых заданий нет: обновление ничего не сломает.",
                ),
            updateInitGit
              ? h(
                  "div",
                  { style: Object.assign({}, S.stageText, { marginTop: "6px" }) },
                  "Воркспейс без git: обновление создаст репозиторий (git init) — подтверждение ниже означает согласие.",
                )
              : null,
            h(
              "div",
              { style: Object.assign({}, S.actions, { marginTop: "8px" }) },
              h(
                "button",
                {
                  type: "button",
                  style: blocked ? Object.assign({}, S.button, S.buttonDisabled) : S.button,
                  disabled: blocked,
                  onClick: () => void runUpdate(),
                  title: pending.length > 0 && !updateRisk
                    ? "Сначала подтвердите риск: есть незавершённые задания"
                    : "Обновить движок до версии сборки панели",
                },
                updateBusy ? "Обновляю…" : "Подтвердить обновление",
              ),
              h(
                "button",
                { type: "button", style: S.button, disabled: updateBusy, onClick: closeUpdate },
                "Отмена",
              ),
            ),
          );
        }

        /*
         * 0.9.3 (0039): карточка движка. При absent это не сообщение об ошибке,
         * а выбор из двух равноправных действий; при mapped — путь, версия и
         * источник словами («задано конфигом профиля» / «выбрано в панели»);
         * при local — «здесь». Тревожных цветов у карточки нет.
         */
        function renderEngineCard() {
          const target = deployTarget();
          if (!target) return null;
          const engine = engineState();
          if (!engine.installed) {
            const deployDisabled = Boolean(deployBusy) || Boolean(busy);
            return h(
              "section",
              { style: S.section },
              h("h3", { style: S.sectionTitle }, ENGINE_ABSENT_TITLE),
              h(
                "div",
                { style: S.stageText },
                "В этом пространстве движка workflow нет. Два равноправных варианта: развернуть движок "
                  + "здесь или подключить уже развёрнутый в другом репозитории — оба безопасны.",
              ),
              h(
                "div",
                { style: Object.assign({}, S.actions, { marginTop: "8px" }) },
                h(
                  "button",
                  {
                    type: "button",
                    style: deployDisabled ? Object.assign({}, S.button, S.buttonDisabled) : S.button,
                    disabled: deployDisabled,
                    onClick: () => void deployWorkflowHere(),
                    title: "Развернуть движок subagent-workflow в " + target + ", спросив подтверждение",
                    "aria-label": ENGINE_DEPLOY_LABEL,
                  },
                  deployBusy ? "Разворачиваю…" : ENGINE_DEPLOY_LABEL,
                ),
                h(
                  "button",
                  {
                    type: "button",
                    style: linkOpen ? Object.assign({}, S.button, { background: T.bg2, borderColor: T.border2 }) : S.button,
                    onClick: () => void openCandidates(),
                    title: "Выбрать зарегистрированный воркспейс, где движок уже развёрнут",
                    "aria-label": ENGINE_LINK_LABEL,
                    "aria-expanded": linkOpen ? "true" : "false",
                  },
                  candidatesBusy ? "Читаю список…" : ENGINE_LINK_LABEL,
                ),
              ),
              linkOpen ? renderCandidates() : null,
              linkNote ? h("div", { style: S.hint }, linkNote.text) : null,
              h(
                "div",
                { style: S.hint },
                "«" + ENGINE_DEPLOY_LABEL + "» ставит движок из этой сборки панели (офлайн, по подтверждению; "
                  + "на не-git воркспейсе сначала выполняется git init). «" + ENGINE_LINK_LABEL + "» пространство "
                  + "не меняет: связь записывается в карту движков и читается сразу после ответа.",
              ),
            );
          }
          const sourceText = engineSourceText(engine.source);
          /*
           * 0151: политика развёртывания видна в карточке движка — её выбирает
           * init, а не состояние дерева. Цена решения (что стало машинным и что
           * делать клону) печатается рядом: иначе «почему конфига нет в
           * истории» выясняется по диффу.
           */
          const notice = engineDeployNotice();
          return h(
            "section",
            { style: S.section },
            h("h3", { style: S.sectionTitle }, "Движок подключён"),
            h(
              "div",
              { style: S.stageText },
              "Источник: " + sourceText + ". " + (engine.source === "workspace"
                ? "Движок развёрнут в этом пространстве — здесь."
                : "Движок лежит в другом репозитории; это пространство только читает его. "
                  + "Обновление движка выполняется в репозитории движка; воркспейс не меняется."),
            ),
            kvGrid([
              ["путь", h("span", { style: S.mono }, fmt(engine.root))],
              ["версия", engineVersionText(engine)],
              ["источник", sourceText],
              ...(notice ? [["развёртывание", h("span", { style: S.mono }, deployNoticePolicyText(notice))]] : []),
            ]),
            notice ? h("div", { style: S.hint }, notice.notice + (notice.action ? " " + notice.action : "")) : null,
          );
        }

        /* Список для «Подключить существующий»: только воркспейсы с движком. */
        function renderCandidates() {
          const list = Array.isArray(candidates) ? candidates : [];
          if (candidatesBusy) return h("div", { style: S.empty }, "Читаю список зарегистрированных воркспейсов…");
          if (list.length === 0) {
            return h(
              "div",
              { style: S.hint },
              "Зарегистрированных воркспейсов с движком нет. Разверните движок здесь или в другом проекте — "
                + "после этого он появится в списке.",
            );
          }
          return h(
            "div",
            { style: { marginTop: "6px" } },
            h("div", { style: S.stageText }, "Выберите репозиторий, где движок уже развёрнут:"),
            list.map((item) => h(
              "button",
              {
                key: item.path,
                type: "button",
                style: Object.assign({}, S.button, { display: "block", width: "100%", textAlign: "left", marginTop: "4px" }),
                disabled: linkBusy,
                onClick: () => void linkEngine(item),
                title: item.path,
                "aria-label": "Подключить движок из " + item.path,
              },
              h("span", { style: S.cardTitle }, rootLabel(item.path) + (item.current ? " · текущий" : "")),
              h(
                "span",
                { style: S.cardMeta },
                h("span", { style: S.mono }, item.path),
                " · v" + fmt(item.version),
              ),
            )),
          );
        }

        function renderEngine() {
          if (!root) return null;
          const installed = engineInstalled();
          const available = engineAvailable();
          const pending = enginePending();
          const external = externalEngine();
          const upToDate = Boolean(!external && installed && available && installed === available);
          const older = panelOlder();
          const externalRepo = external && external.root ? external.root : null;
          return h(
            "section",
            { style: S.section },
            h("h3", { style: S.sectionTitle }, "Версия движка"),
            h("div", { style: S.stageText }, "Карточка показывает установленную и доступную версии движка. Обновление меняет файлы движка в его репозитории; без него останется текущая версия и могут сохраняться ограничения совместимости. Панель и движок нумеруются раздельно (панель 0.9.x, движок 2.6.x), совместимость проверяется отдельной строкой."),
            /*
             * 0136 (2.6.109): вложенный в сборку панели движок подписан как
             * движок, а не как «версия сборки панели»: линии версий разные.
             */
            h(
              "div",
              { style: S.stageText },
              "Установлено: " + (installed ? "v" + installed : "не развёрнут")
                + (external ? " (внешний движок: " + (externalRepo || "путь неизвестен") + ")" : "")
                + (external
                  ? ". Движок обновляется в репозитории движка: " + (externalRepo || "путь неизвестен") + "."
                  : older
                    ? ". В этой сборке панели: v" + fmt(available) + " — сборка панели старше движка."
                    : ". Движок в этой сборке панели: " + (available ? "v" + available : "неизвестно") + "."),
            ),
            upToDate
              ? h(
                  "div",
                  { style: Object.assign({}, S.stageText, { marginTop: "2px" }) },
                  "Версия совпадает со сборкой панели — обновление не требуется.",
                )
              : null,
            /* 0067: сборка не новее движка — свежий движок можно взять из релиза GitHub. */
            upToDate || older ? renderReleaseAction() : null,
            h("div", { style: S.stageText }, "«Обновить движок» устанавливает версию движка; без действия он останется прежним. «Обновить панель» меняет только пакет панели и требует перезапуска DSH; без действия интерфейс не обновится. Эти действия не обновляют данные, для этого есть «Обновить данные» в шапке."),
            h("div", { style: Object.assign({}, S.actions, { marginTop: "6px" }) }, h("button", { type: "button", style: updateBusy ? Object.assign({}, S.button, S.buttonDisabled) : S.button, disabled: updateBusy, onClick: () => void runPluginUpdate(), title: PLUGIN_UPDATE_HINT }, updateBusy ? "Обновляем панель…" : "Обновить панель"), h("span", { style: S.stageText }, PLUGIN_UPDATE_HINT)),
            /*
             * 2.6.16 (0042): для внешнего движка кнопка не «недоступна» — она
             * обновляет репозиторий движка. Недоступно только понижение (0041).
             */
            external
              ? h(
                  "div",
                  { style: Object.assign({}, S.hint, { marginTop: "4px" }) },
                  externalEngineHint(external),
                )
              : null,
            /* 0041: причина отказа видна на месте, а не только в tooltip. */
            older
              ? h(
                  "div",
                  { style: Object.assign({}, S.hint, { marginTop: "4px" }) },
                  panelOlderHint(),
                )
              : null,
            h(
              "div",
              { style: Object.assign({}, S.actions, { marginTop: "8px" }) },
              h(
                "button",
                Object.assign(
                  {
                    type: "button",
                    style: older || updateBusy || busy
                      ? Object.assign({}, S.button, S.buttonDisabled)
                      : S.button,
                    disabled: Boolean(older) || updateBusy || busy,
                    onClick: () => {
                      /* 0041: подтверждение не открывается, если понижение запрещено. */
                      if (older) return;
                      if (updateOpen) closeUpdate();
                      else openUpdate();
                    },
                    title: older
                      ? panelOlderHint()
                      : external
                        ? EXTERNAL_UPDATE_LABEL + ": " + (externalRepo || "путь неизвестен")
                        : "Обновить движок subagent-workflow до версии " + fmt(available),
                    "aria-label": external ? EXTERNAL_UPDATE_LABEL : UPDATE_LABEL,
                  },
                  /* 0038: недоступность объявлена и для доступности; 0041 добавляет
                     сборку панели старше движка — обычная кнопка атрибута не получает. */
                  older ? { "aria-disabled": "true" } : {},
                ),
                updateBusy ? "Обновляем движок…" : external ? EXTERNAL_UPDATE_LABEL : UPDATE_LABEL,
              ),
              /*
               * 0038: причину видно на месте, а не только в tooltip.
               * 0042: для внешнего движка причина изменилась — запись идёт в его репозиторий.
               */
              external && !older
                ? h("span", { style: S.hint }, "обновление в репозитории движка")
                : older
                  ? h("span", { style: S.hint }, "недоступно: сборка панели старше — понижение движка запрещено")
                  : null,
            ),
            updateOpen && !older ? renderUpdateDialog(pending) : null,
            updateNote ? renderUpdateNote() : null,
            h(
              "div",
              { style: S.hint },
              external
                ? "Обновление внешнего движка выполняется в его репозитории: " + (externalRepo || "путь неизвестен")
                  + ". Воркспейс не меняется; ключи и задачи репозитория движка сохраняются."
                : "Обновление выполняет init --force (принудительное обновление из сборки) из вложенной спеки. Версия движка берётся из сборки без сети. Ключи проекта не меняются; каждое обновление пишет строку в docs/subagent-workflow/deploy.log. Пока идёт обновление, остальные запросы панели живы.",
            ),
          );
        }

