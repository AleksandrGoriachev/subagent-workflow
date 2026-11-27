        function renderBoard() {
          if (!board) {
            if (status && status.error) return h("div", { style: S.empty }, status.error);
            const empty = h(
              "div",
              { style: S.empty },
              h("div", { style: { fontWeight: 600, marginBottom: "6px" } }, "В этом пространстве workflow не развёрнут"),
              h("div", { style: S.hint },
                "Панель показывает только то пространство, из которого её открыли. Чтобы включить его, "
                + "нажмите «Развернуть workflow здесь» ниже — движок встанет из этой сборки, без сети. "
                + "Альтернатива из терминала — из распакованного пакета: node spec/scripts/init.mjs --repo <проект> --force."),
              localProjects.length > 0
                ? h(
                    "div",
                    { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" } },
                    localProjects.map((item) => h(
                      "button",
                      {
                        key: item.path,
                        type: "button",
                        style: S.button,
                        title: item.path,
                        onClick: () => void load(item.path, true),
                      },
                      "Открыть " + rootLabel(item.path),
                    )),
                  )
                : null,
              foreignRoots.length > 0
                ? h(
                    "div",
                    { style: { marginTop: "10px" } },
                    h(
                      "button",
                      { type: "button", style: S.button, onClick: () => setShowAllRoots(!showAllRoots) },
                      showAllRoots
                        ? "Скрыть репозитории из настроек"
                        : "Показать репозитории из настроек (" + foreignRoots.length + ") — они из других пространств",
                    ),
                    showAllRoots
                      ? h(
                          "div",
                          { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" } },
                          foreignRoots.map((item) => h(
                            "button",
                            {
                              key: item.path,
                              type: "button",
                              style: S.button,
                              title: item.path,
                              onClick: () => void load(item.path, true),
                            },
                            rootLabel(item.path),
                          )),
                        )
                      : null,
                  )
                : null,
            );
            /* Тупик «workflow не развёрнут»: карточка движка предлагает два пути. */
            return h("div", null, renderNowSummary([], 0, 0, 0), renderEngineCard(), empty, renderDeploy());
          }
          const tasks = board.tasks || [];
          const skipped = board.skipped || [];
          const working = tasks.filter((task) => ["contract", "attack", "lock", "red", "green", "incomplete"].includes(task.stage)).length;
          const accepted = tasks.filter((task) => task.stage === "accepted").length;
          const remarks = tasks.filter((task) => task.stage === "remarks").length;
          const path = {
            contract: tasks.filter((task) => task.artifacts.task && task.artifacts.criteria).length,
            attack: tasks.filter((task) => task.artifacts.attack).length,
            lock: tasks.filter((task) => task.artifacts.lock).length,
            red: tasks.filter((task) => task.redProven).length,
            green: tasks.filter((task) => task.verifyPassed).length,
            accepted: tasks.filter((task) => task.artifacts.acceptance).length,
          };
          const attackPolicy = board.config && board.config.policy ? board.config.policy.attack : "off";
          const visible = STAGES
            .filter((stage) => stage.code !== "incomplete" || tasks.some((task) => task.stage === "incomplete"))
            .filter((stage) => showEmpty || tasks.some((task) => task.stage === stage.code));
          return h(
            "div",
            null,
            renderNowSummary(tasks, working, accepted, remarks),
            renderEngineCard(),
            renderEngine(),
            h("h2", { style: S.summaryTitle }, "Доска задач"),
            h("div", { style: S.stageText }, "Доска группирует задачи по текущим состояниям. Откройте карточку задачи, чтобы увидеть её поля и действия; без этого обзора нельзя быстро понять, на каком шаге работа остановилась."),
            h("div", { style: S.actions }, runButton("doctor", null), h("span", { style: Object.assign({}, S.stageText, { flex: "1 1 100%" }) }, "«Проверить настройку» читает готовность ворот, ключа и политики и ничего не меняет; без проверки можно не заметить неполадку настройки.")),
            /*
             * 0090: новое задание с доски. Панель не создаёт файлы сама —
             * вызывает new-task.mjs и показывает, что тот напечатал.
             */
            h(
              "div",
              { style: { margin: "8px 0" } },
              h(
                "button",
                { type: "button", style: S.button, onClick: () => { setNewTaskOpen(!newTaskOpen); setNewTaskNote(null); } },
                newTaskOpen ? "Скрыть форму" : "Новое задание",
              ),
              newTaskOpen
                ? h(
                    "div",
                    { style: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginTop: "8px" } },
                    h("input", {
                      type: "text",
                      value: newTaskId,
                      placeholder: "id, например 0112",
                      style: { width: "110px" },
                      onChange: (event) => setNewTaskId(event.target.value),
                    }),
                    h("input", {
                      type: "text",
                      value: newTaskTitle,
                      placeholder: "тема задания",
                      style: { width: "320px" },
                      onChange: (event) => setNewTaskTitle(event.target.value),
                    }),
                    h(
                      "select",
                      { value: newTaskRisk, onChange: (event) => setNewTaskRisk(event.target.value) },
                      h("option", { value: "low" }, "low"),
                      h("option", { value: "medium" }, "medium"),
                      h("option", { value: "high" }, "high"),
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        style: newTaskBusy ? Object.assign({}, S.button, S.buttonDisabled) : S.button,
                        disabled: newTaskBusy,
                        onClick: () => void createTask(),
                      },
                      newTaskBusy ? "Создаю…" : "Создать",
                    ),
                  )
                : null,
              newTaskNote
                ? h(
                    "div",
                    { style: Object.assign({}, S.hint, newTaskNote.ok ? null : { color: T.danger }) },
                    newTaskNote.text,
                    newTaskNote.log ? h("div", { style: S.pre }, newTaskNote.log) : null,
                  )
                : null,
            ),
            h(
              "div",
              { style: S.summary },
              (() => {
                const parts = [
                  tasks.length + " " + plural(tasks.length, "задача", "задачи", "задач"),
                  "в работе: " + working,
                  "принято: " + accepted,
                ];
                if (remarks > 0) parts.push("с замечаниями: " + remarks);
                if (skipped.length > 0) parts.push("пропущено файлов: " + skipped.length);
                /*
                 * 0.4.0 (WC-5): регресс-долг. Ворота запускаются в терминале, на
                 * диске от них остаётся только baseline — он и называется.
                 */
                const debt = board.regress;
                if (debt && debt.present) {
                  parts.push("регресс-долг: " + debt.entries + (debt.expired > 0 ? " (просрочено " + debt.expired + ")" : ""));
                }
                return parts.map((text, index) => h(
                  "span",
                  { key: index, style: index === 0 ? S.summaryStrong : S.summaryMuted },
                  (index > 0 ? "· " : "") + text,
                ));
              })(),
            ),
            h(
              "div",
              { style: Object.assign({}, S.hint, { marginTop: "0" }) },
              "Доска показывает, где задача находится сейчас. Принятая задача уже прошла ранние шаги, поэтому её колонки на доске пусты — она ушла в «Принято». Колонки без задач скрыты; переключатель ниже показывает их.",
            ),
            h(
              "details",
              { style: S.legend, open: true },
              h("summary", { style: S.legendSummary }, "Что означают стадии"),
              h(
                "div",
                { style: S.legendGrid },
                STAGES.map((stage) => h(
                  "div",
                  { key: stage.code, style: S.legendItem },
                  h("span", { style: Object.assign({}, S.columnDot, { background: STAGE_COLOR[stage.code] }) }),
                  h("span", { style: S.legendTitle }, stage.title + " —"),
                  h("span", { style: S.legendText }, stage.description),
                )),
              ),
            ),
            h(
              "div",
              { style: S.pathLine },
              h("span", { style: S.pathLabel }, "Прошли шаг (по файлам):"),
              [
                ["contract", "Контракт"],
                ["attack", "Атака"],
                ["lock", "Замок"],
                ["red", "Красный"],
                ["green", "Зелёный"],
                ["accepted", "Запись приёмки"],
              ].map(([code, title]) => h(
                "span",
                { key: code, style: S.pathItem },
                title + " " + (path[code] || 0) + (code === "attack" && attackPolicy === "off" ? " (выключено)" : ""),
              )),
            ),
            (() => {
              const notes = [];
              const acceptedWithoutRed = tasks.filter((task) => task.stage === "accepted" && !task.redProven).length;
              if (acceptedWithoutRed > 0) {
                notes.push("Красный: у " + acceptedWithoutRed + " принятых задач нет доказанного red.json — старые записи или перевыпуски.");
              }
              const lockDrift = tasks.filter((task) => task.lockInSync === false).length;
              if (lockDrift > 0) {
                notes.push("Замок: у " + lockDrift + " задач criteria.lock не совпадает с текущим контрактом — старая версия замка или изменённые защищённые файлы.");
              }
              return notes.length > 0
                ? h("div", { style: S.pathNotes }, notes.map((note, index) => h("div", { key: index }, "• " + note)))
                : null;
            })(),
            h(
              "label",
              { style: S.toggle },
              h("input", {
                type: "checkbox",
                checked: showEmpty,
                onChange: (event) => setShowEmpty(event.target.checked),
              }),
              "Показывать пустые стадии",
            ),
            visible.length > 0
              ? h("div", { style: S.board }, visible.map(stageColumn))
              : h("div", { style: S.empty }, "В этом репозитории нет задач workflow."),
            skipped.length > 0
              ? renderSkipped(skipped)
              : null,
          );
        }

