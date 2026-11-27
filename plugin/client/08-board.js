        function runButton(id, taskId) {
          const active = running === id;
          return h(
            "button",
            {
              type: "button",
              style: running ? Object.assign({}, S.button, S.buttonDisabled) : S.button,
              disabled: Boolean(running) || busy || !root,
              onClick: () => void runCheckApi(id, taskId),
              title: CHECK_HINT[id] || "Запустить проверку",
              "aria-label": CHECK_HINT[id] || id,
            },
            active ? (RUN_LABELS[id] || id) + "…" : (RUN_LABELS[id] || id),
          );
        }

        const roots = status && Array.isArray(status.roots) ? status.roots : [];
        /* Путь родитель→ребёнок без учёта регистра и разделителей. */
        const insidePath = (parent, child) => {
          if (!parent || !child) return false;
          const a = String(parent).replace(/[\\/]+$/u, "").toLowerCase();
          const b = String(child).replace(/[\\/]+$/u, "").toLowerCase();
          return b === a || b.startsWith(a + "\\") || b.startsWith(a + "/");
        };
        /*
         * В списке — только проекты своего пространства. Корни из настроек,
         * лежащие в других пространствах, по умолчанию скрыты: панель отвечает
         * за то пространство, из которого её открыли, а не за соседние проекты.
         */
        const rootOptions = (() => {
          const list = [];
          const push = (item) => {
            if (!item || !item.path) return;
            if (list.some((existing) => sameFsPath(existing.path, item.path))) return;
            list.push(item);
          };
          if (currentWorkspace) push({ path: currentWorkspace.path, exists: true });
          if (root) push({ path: root, exists: true });
          for (const item of roots) {
            if (!currentWorkspace || insidePath(currentWorkspace.path, item.path)) push(item);
          }
          return list;
        })();
        const foreignRoots = roots.filter((item) => currentWorkspace && !insidePath(currentWorkspace.path, item.path));
        /* Проекты внутри своего пространства — законный выбор, а не «чужой» корень. */
        const localRoots = roots.filter((item) => currentWorkspace && insidePath(currentWorkspace.path, item.path));
        /* Проекты, найденные хостом прямо внутри пространства (например wf-project). */
        const discovered = (status && Array.isArray(status.projects) ? status.projects : [])
          .filter((item) => item && item.path)
          .filter((item) => !currentWorkspace || insidePath(currentWorkspace.path, item.path));
        const localProjects = (() => {
          const list = [];
          const push = (item) => {
            if (!item || !item.path) return;
            if (list.some((existing) => sameFsPath(existing.path, item.path))) return;
            list.push(item);
          };
          for (const item of localRoots) push(item);
          for (const item of discovered) push(item);
          return list;
        })();
        const title = status && status.plugin
          ? "Панель: v" + status.plugin.version
          : "Панель: версия не загружена";

        function optionLabel(item) {
          const isCurrent = Boolean(currentWorkspace && sameFsPath(item.path, currentWorkspace.path));
          const isShown = Boolean(root && sameFsPath(item.path, root));
          const tags = [];
          if (isCurrent) tags.push("текущий");
          if (isShown && !isCurrent) tags.push("показан");
          return rootLabel(item.path) + (tags.length > 0 ? " · " + tags.join(", ") : "");
        }

        function renderLocation() {
          const current = currentWorkspace;
          const mismatch = Boolean(current && root && !sameFsPath(current.path, root));
          const notes = [];
          if (locationNote) notes.push(locationNote);
          if (mismatch && !locationNote) notes.push("показан другой репозиторий, не текущий workspace");
          if (!current) notes.push("текущий workspace не определён — показан корень из настроек");
          return h(
            "div",
            { style: mismatch ? S.locationWarn : S.location },
            h("span", null, current
              ? "Текущий workspace: " + current.title + " (" + current.path + ")"
              : "Текущий workspace: не определён"),
            h("span", { style: S.locationSep }, "·"),
            h("span", null, "показан: " + (root || "—")),
            notes.length > 0 ? h("span", null, " · " + notes.join(" · ")) : null,
          );
        }

        function renderHeader() {
          return h(
            "div",
            { style: S.header },
            h("h1", { style: S.title }, "Консоль workflow"),
            h("span", { style: S.subtitle }, title),
            h("span", { style: S.subtitle }, "Движок: " + (engineInstalled() ? "v" + engineInstalled() : "не найден")),
            h("span", { style: S.subtitle }, "Последний выпуск: " + (status && status.latestRelease && status.latestRelease.engine
              ? fmt(status.latestRelease.at) + " · движок v" + fmt(status.latestRelease.engine) + (status.latestRelease.plugin ? ", панель " + fmt(status.latestRelease.plugin) : "")
              : "нет данных")),
            h(
              "span",
              { style: S.subtitle },
              externalEngine()
                ? externalEngineText(externalEngine())
                : "движок: " + (engineInstalled() ? "v" + engineInstalled() : "не развёрнут")
                  + (panelOlder()
                    ? " · сборка панели старше"
                    : engineAvailable() ? " · доступна v" + engineAvailable() : ""),
            ),
            /*
             * 0102 (WC-65): актуальность относительно релиза — по кнопке.
             * Строка та же, что в дайджесте обмена: сначала факт, потом команда.
             */
            h(
              "span",
              { style: S.subtitle, title: "Один запрос к API релиза; на сбое сети показывается последняя удачная проверка" },
              releaseCheckText() ? " · " + releaseCheckText() : "",
              h(
                "button",
                {
                  type: "button",
                  style: Object.assign({}, S.button, { marginLeft: "8px", padding: "1px 8px" }),
                  disabled: releaseCheckBusy,
                  title: "Проверяет версии движка и панели по данным релиза. Без проверки дата актуальности может быть неизвестна.",
                  onClick: () => void runReleaseCheck(),
                },
                releaseCheckBusy ? "Проверяем актуальность…" : "Проверить актуальность",
              ),
            ),
            h("span", { style: S.spacer }),
            rootOptions.length > 1
              ? h(
                  "select",
                  {
                    style: S.input,
                    value: root || "",
                    disabled: busy,
                    onChange: (event) => void load(event.target.value, true),
                    title: "Репозиторий workflow",
                  },
                  rootOptions.map((item) => h(
                    "option",
                    { key: item.path, value: item.path, style: S.option, title: item.path },
                    optionLabel(item),
                  )),
                )
              : null,
            runButton("doctor", null),
            h(
              "button",
              {
                type: "button",
                style: busy ? Object.assign({}, S.button, S.buttonDisabled) : S.button,
                disabled: busy,
                onClick: () => void load(root),
                title: "Обновляет данные панели из текущего пространства; без нажатия остаются показаны ранее загруженные сведения.",
              },
              busy ? "Обновляем данные…" : "Обновить данные",
            ),
          );
        }

        function renderTabs() {
          const overviewTab = h(
            "button",
            { type: "button", style: tab === "overview" ? S.tabActive : S.tab, onClick: () => { setTab("overview"); setCard(null); } },
            "Обзор",
          );
          const boardTab = h(
            "button",
            {
              type: "button",
              style: tab === "board" ? S.tabActive : S.tab,
              onClick: () => {
                setTab("board");
                setCard(null);
              },
            },
            "Доска",
            board ? " (" + board.tasks.length + ")" : "",
          );
          const anchorsAttention = Boolean(anchors && anchors.approved !== true);
          const anchorsTab = h(
            "button",
            {
              type: "button",
              style: tab === "anchors" ? S.tabActive : S.tab,
              onClick: () => { setTab("anchors"); setCard(null); },
              title: "Семантические якоря: состояние утверждения и список правил",
            },
            "Якоря",
            anchorsAttention ? h("span", { style: { color: T.warn } }, " !") : null,
          );
          const policyTab = h(
            "button",
            { type: "button", style: tab === "policy" ? S.tabActive : S.tab, onClick: () => void openPolicy() },
            "Политика",
          );
          const compatStatus = status && status.repo ? status.repo.compat : null;
          const compatSummary = compatStatus ? compatStatus.summary : null;
          const compatAttention = Boolean(compatSummary
            && (compatSummary.limited || compatSummary.errors > 0 || compatSummary.warnings > 0));
          const compatTab = h(
            "button",
            { type: "button", style: tab === "compat" ? S.tabActive : S.tab, onClick: () => void openCompat() },
            "Совместимость",
            compatAttention ? h("span", { style: { color: T.warn } }, " !") : null,
          );
          const metricsTab = h(
            "button",
            { type: "button", style: tab === "metrics" ? S.tabActive : S.tab, onClick: () => void openMetrics() },
            "Метрики",
          );
          return h("div", { style: S.tabs }, boardTab, overviewTab, anchorsTab, policyTab, compatTab, metricsTab);
        }

        function stageColumn(stage) {
          const items = board ? board.tasks.filter((task) => task.stage === stage.code) : [];
          const empty = items.length === 0;
          return h(
            "div",
            { key: stage.code, style: empty ? Object.assign({}, S.column, S.columnDim) : S.column },
            h(
              "div",
              { style: S.columnTitle, title: stage.description },
              h("span", { style: Object.assign({}, S.columnDot, { background: STAGE_COLOR[stage.code] }) }),
              stage.title,
              h("span", { style: S.count }, String(items.length)),
            ),
            empty
              ? h("div", { style: Object.assign({}, S.empty, { padding: "4px 0" }) }, "нет задач в этой стадии")
              : items.map((task) => h(
                  "button",
                  {
                    key: task.id,
                    type: "button",
                    style: S.card,
                    onClick: () => void openTask(task.id),
                    title: task.dir || task.id,
                    "aria-label": cardAriaLabel(task),
                  },
                  h("span", { style: S.cardId }, task.id),
                  h("span", { style: S.cardTitle }, task.title || "—"),
                  h(
                    "span",
                    { style: S.cardMeta },
                    task.risk ? badge(task.risk, RISK_COLOR[task.risk], riskHint(task.risk), false) : null,
                    task.errors > 0 ? badge("ошибок " + task.errors, T.danger, ERROR_HINT, false) : null,
                    task.warnings > 0 ? badge("предупр. " + task.warnings, T.warn, WARNING_HINT, false) : null,
                    task.assumed && task.assumed.length
                      ? badge("assumed " + task.assumed.length, T.warn, ASSUMED_HINT, false)
                      : null,
                    task.attackUnresolved > 0 ? badge("атака", T.danger, ATTACK_HINT, false) : null,
                    task.coverageUncovered > 0
                      ? badge("покрытие", T.warn, coverageHint(task.coverageUncovered), false)
                      : null,
                    task.effects && task.effects.status !== "none" && task.effects.status !== "ok"
                      ? badge(
                          "эффект",
                          effectSeverityColor(task.effects.severity),
                          effectHint(task.effects),
                          false,
                        )
                      : null,
                    task.regress
                      ? badge(
                          "регресс: " + fmt(task.regress.status),
                          task.regress.expired ? T.warn : T.tertiary,
                          regressHint(task.regress),
                          false,
                        )
                      : null,
                  ),
                )),
          );
        }

        /*
         * Пропущенные записи объясняем по-человечески: сначала — самый частый случай
         * (каталога заданий нет, значит workflow в этом проекте не развёрнут), потом —
         * старое содержимое каталога. Технические пути остаются в деталях.
         */
        function renderSkipped(skipped) {
          const tasksDirRel = (board && board.tasksDir) || "docs/tasks";
          const noDir = skipped.find((item) => item.path === tasksDirRel);
          const rest = skipped.filter((item) => item !== noDir);
          return h(
            "div",
            { style: Object.assign({}, S.hint, { marginTop: "10px" }) },
            noDir
              ? h("div", null,
                  "Каталога заданий " + tasksDirRel + " нет: похоже, workflow в этом проекте не развёрнут. "
                  + "Разверните пакет командой node docs/subagent-workflow/scripts/init.mjs --repo . --force.")
              : null,
            rest.length > 0
              ? h("div", { style: noDir ? { marginTop: "6px" } : null },
                  "Пропущено записей: " + rest.length + " — старый формат или каталог без task.md. "
                  + rest.slice(0, 5).map((item) => item.path).join("; "),
                  rest.length > 5 ? " …" : "")
              : null,
            noDir ? h("details", { style: { marginTop: "4px" } },
              h("summary", { style: { cursor: "pointer", fontSize: "11px" } }, "подробности"),
              h("div", { style: { fontSize: "11px" } }, noDir.reason)) : null,
          );
        }

        function renderNowSummary(tasks, working, accepted, remarks) {
          const engine = engineState();
          const engineLabel = engine.source === "mapping" ? "Обнаружен внешний движок. Панель не будет его изменять."
            : engine.installed ? "Движок: v" + fmt(engine.version || engineInstalled())
              : "Движок не найден. Установка движка не выполняется автоматически.";
          const panelLabel = status && status.plugin ? "Панель: v" + fmt(status.plugin.version) : "Загружаем состояние…";
          const anchorLabel = !anchors ? (anchorsError ? "Не удалось получить состояние якорей. Остальные данные оставлены без изменений. Повторите обновление данных." : "Загружаем состояние…")
            : anchors.approved ? "Якоря утверждены" : "Якоря требуют внимания";
          const taskLabel = board ? tasks.length + " задач · в работе: " + working + " · принято: " + accepted + (remarks ? " · с замечаниями: " + remarks : "")
            : "Данные ещё не загружены. Нажмите „Обновить данные“, чтобы запросить текущий статус.";
          const issue = engine.source === "mapping" ? "Обнаружен внешний движок. Панель не будет его изменять."
            : anchorsError && root ? "Не удалось получить состояние якорей. Остальные данные оставлены без изменений. Повторите обновление данных."
              : error && !root ? "Не удалось получить состояние движка. Остальные данные оставлены без изменений. Повторите обновление данных." : null;
          const item = (label, value, color) => h("div", { style: S.summaryItem }, h("b", { style: Object.assign({}, S.summaryStatus, color ? { color } : null) }, label), value);
          return h("section", { style: S.summaryCard },
            h("h2", { style: S.summaryTitle }, "Сейчас"),
            h("div", { style: S.summaryGrid },
              item("Движок", busy && engine.installed ? "Обновляем… · " + engineLabel : engineLabel, engine.source === "mapping" ? T.warn : engine.installed ? T.success : T.tertiary),
              h("div", { style: S.summaryItem },
                h("b", { style: Object.assign({}, S.summaryStatus, releaseCheck && releaseCheck.ok === false ? { color: T.warn } : null) }, "Панель / актуальность"),
                h("span", null, releaseCheckBusy ? "Проверяем актуальность…" : releaseCheckText() || panelLabel),
                h("button", {
                  type: "button",
                  style: Object.assign({}, S.button, { marginTop: "4px", padding: "1px 8px", fontSize: "11px" }),
                  disabled: releaseCheckBusy,
                  title: "Один запрос к API релиза: проверяет версии движка и панели. Без проверки дата актуальности может быть неизвестна.",
                  onClick: () => void runReleaseCheck(),
                }, releaseCheckBusy ? "Проверяем…" : "Проверить актуальность"),
              ),
              item("Якоря", anchorsBusy ? "Проверяем и утверждаем якоря…" : anchorLabel, anchors && anchors.approved ? T.success : anchors ? T.warn : T.tertiary),
              item("Задачи", busy && !board ? "Загружаем состояние…" : taskLabel, null),
              item("Сводка задач", remarks > 0 ? "Требует внимания · замечаний: " + remarks : "Всё актуально", remarks > 0 ? T.warn : T.success)),
            busy ? h("div", { style: S.stageText }, "Обновляем состояние панели… Прежние значения оставлены на экране.") : null,
            issue ? h("div", { style: Object.assign({}, S.hint, { margin: "8px 0 0", borderColor: engine.source === "mapping" ? T.warn : T.border1 }) }, issue) : null,
            h("div", { style: Object.assign({}, S.stageText, { marginTop: "6px" }) }, "Сводка показывает состояние движка, панели, якорей и задач. Обновление данных только перечитывает сведения; без него останутся прежние значения."));
        }

        function renderAnchorsTab() {
          /* Якоря — отдельная вкладка: на стартовой остаётся только строка актуальности. */
          return h("div", null, renderAnchorsCard());
        }

        function renderOverviewTasks(tasks) {
          const list = Array.isArray(tasks) ? tasks : [];
          const visible = list.slice(0, 12);
          /* 0106 (2.6.96): флаги здоровья из снимка монитора — по id задачи. */
          const healthRows = board && board.health && Array.isArray(board.health.tasks) ? board.health.tasks : [];
          const taskHealth = new Map(healthRows.map((row) => [String(row.id), Array.isArray(row.flags) ? row.flags : []]));
          return h(
            "section",
            null,
            h("h2", { style: S.summaryTitle }, "Карточки задач"),
            list.length === 0
              ? h("div", { style: S.empty }, "Задач нет: workflow не развёрнут или данные ещё не загружены.")
              : h("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
                  visible.map((task) => h("button", {
                    key: task.id,
                    type: "button",
                    style: S.card,
                    onClick: () => void openTask(task.id),
                    title: (task.dir || task.id) + ((taskHealth.get(String(task.id)) || []).length ? " · " + taskHealth.get(String(task.id)).join(", ") : ""),
                    "aria-label": cardAriaLabel(task),
                  },
                    h("span", { style: S.cardId }, task.id),
                    h("span", { style: S.cardTitle }, task.title || "—"),
                    h("span", { style: S.cardMeta },
                      task.risk ? badge(task.risk, RISK_COLOR[task.risk], riskHint(task.risk), false) : null,
                      task.errors > 0 ? badge("ошибок " + task.errors, T.danger, ERROR_HINT, false) : null,
                      task.warnings > 0 ? badge("предупр. " + task.warnings, T.warn, WARNING_HINT, false) : null,
                      (taskHealth.get(String(task.id)) || []).length
                        ? badge("здоровье: " + taskHealth.get(String(task.id)).join(", "), T.warn, "Флаги монитора задач: красный не доказан, verify красный, нет приёмки, зависло", false)
                        : null,
                    ),
                  )),
                ),
            list.length > visible.length ? h("div", { style: S.hint }, "Показаны первые " + visible.length + " из " + list.length + "; полный список — на вкладке «Доска».") : null,
            h("div", { style: S.actions }, h("button", { type: "button", style: S.button, onClick: () => { setTab("board"); setCard(null); } }, "Открыть доску")),
          );
        }

        function renderOverview() {
          const tasks = board && board.tasks ? board.tasks : [];
          const working = tasks.filter((task) => ["contract", "attack", "lock", "red", "green", "incomplete"].includes(task.stage)).length;
          const accepted = tasks.filter((task) => task.stage === "accepted").length;
          const remarks = tasks.filter((task) => task.stage === "remarks").length;
          /* 0126: блок «Версия движка» есть всегда — без выбранного корня он объясняет, чего не хватает, а не исчезает. */
          const engineBlock = renderEngine() || h(
            "section",
            { style: S.section },
            h("h3", { style: S.sectionTitle }, "Версия движка"),
            h("div", { style: S.stageText }, "Движок не подключён: выберите рабочее пространство, чтобы увидеть версии и обновление."),
          );
          return h(
            "div",
            null,
            renderNowSummary(tasks, working, accepted, remarks),
            engineBlock,
            renderEngineCard(),
            renderOverviewTasks(tasks),
          );
        }

