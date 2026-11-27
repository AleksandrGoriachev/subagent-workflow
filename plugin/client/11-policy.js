        function renderPolicy() {
          if (!root) return h("div", { style: S.empty }, "Корень не настроен: добавьте roots в cordis.patch.yml.");
          if (busy && !policy) return h("div", { style: S.empty }, "Загружаем состояние…");
          if (error && !policy) return h("div", { style: S.error }, "Не удалось получить политику. Остальные данные оставлены без изменений. Повторите обновление данных: " + error);
          if (busy) return h("div", { style: S.empty }, "Обновляем состояние панели… Прежние значения оставлены на экране.");
          if (!policy) return h("div", { style: S.empty }, "Данные ещё не загружены. Нажмите „Обновить данные“, чтобы запросить текущий статус.");
          const effective = policy.policy || {};
          const rows = [
            ["decisions", effective.decisions, "Насколько строго проверять решения, которые нельзя проверить командой."],
            ["coverage", effective.coverage, "Требовать, чтобы каждый изменённый файл кода был покрыт хотя бы одним критерием."],
            ["attack", effective.attack, "Проводить атаку задания критиком до фиксации контракта."],
            ["roles.modelFamily", effective.roles ? effective.roles.modelFamily : "—", "Требовать, чтобы приёмщик и критик были из другого семейства моделей."],
          ];
          return h(
            "div",
            null,
            h("h2", { style: S.summaryTitle }, "Политика"),
            h("div", { style: S.hint }, "Политика — действующие правила проверки задач. fail — запрещать, warn — предупреждать, off — не проверять. Панель только показывает настройки; без их просмотра можно не заметить, какие проверки отключены или только предупреждают. Править политику из панели нельзя: измените workflow.config.json в своём проекте и перечитайте данные. Исключение — флаг guard в разделе «Проверка коммитов»."),
            h("div", { style: S.pre }, policy.line || "—"),
            h("div", { style: S.kv }, h("span", { style: S.kvLabel }, "config"), h("span", { style: S.mono }, fmt(policy.configPath))),
            section(
              "Политика",
              table(["правило", "значение", "что означает"], rows.map((row) => [
                h("span", { style: S.mono }, row[0]),
                row[1] === "fail"
                  ? badge(row[1], T.danger, policyHint(row[1]))
                  : row[1] === "warn"
                    ? badge(row[1], T.warn, policyHint(row[1]))
                    : badge(row[1] || "—", T.tertiary, policyHint(row[1])),
                row[2],
              ])),
            ),
            /* 0081 (WC-56, S4): императив воркспейса виден целиком, а не по журналам. */
            section("Императив воркспейса", renderImperative(policy.imperative)),
            section("Проверка коммитов (guard)", renderGuard()),
            section(
              "Модели",
              Object.keys(policy.models || {}).length === 0
                ? h("div", { style: S.empty }, "Реестр моделей пуст: семейство модели проверить нельзя.")
                : table(["модель", "семейство"], Object.entries(policy.models).map(([model, family]) => [h("span", { style: S.mono }, model), family])),
            ),
            section(
              "Роли",
              (policy.roles || []).length === 0
                ? h("div", { style: S.empty }, "Роли не настроены: проверять семейство приёмщика и критика не с чем.")
                : table(["роль", "модель", "семейство", "должна отличаться"], policy.roles.map((role) => [
                    role.name,
                    role.model ? h("span", { style: S.mono }, role.model) : badge("нет model", T.warn, NO_MODEL_HINT),
                    role.family || "—",
                    role.mustDifferFromIssuer || "—",
                  ])),
            ),
            section(
              "Предупреждения",
              (policy.warnings || []).length === 0
                ? h("div", { style: S.empty }, "Предупреждений нет.")
                : h("ul", { style: S.list }, policy.warnings.map((warning, index) => h("li", { key: index }, warning))),
            ),
          );
        }

        /*
         * guard — единственная настройка, которую панель меняет. Показываем
         * эффективные значения и пределы честно: --no-verify обходит хуки
         * целиком, метка обхода остаётся в аудите.
         */

        /*
         * 0081 (WC-56, S4): сводка императива по корню. Зелёный/красный — это
         * пять проверок из docs/IMPERATIVE-workspaces.md §Г, а не текст: версия
         * движка, scripts/job.mjs, enforcement.waitPolicy, счётчик ожиданий и
         * последние отказы с атрибуцией корня.
         */
        function renderImperative(imperative) {
          if (!imperative) return h("div", { style: S.empty }, "Сводка императива не пришла: обновите панель.");
          const ok = imperative.ok === true;
          const reasons = Array.isArray(imperative.reasons) ? imperative.reasons : [];
          const enforcement = imperative.enforcement || {};
          const waits = imperative.waits || { total: 0, denied: 0, warn: 0, last: [] };
          const rows = [
            ["движок", imperative.engine && imperative.engine.version ? imperative.engine.version : "—",
              "минимум " + (imperative.minimumEngine || "2.6.31") + " — версия со сторожем W1"],
            ["scripts/job.mjs", imperative.checks && imperative.checks.job ? "есть" : "нет",
              "без него ожидать тяжёлый прогон нечем"],
            ["enforcement.waitPolicy", enforcement.waitPolicy || "—", "off | warn | fail"],
            ["enforcement.waitBudgetMs", enforcement.waitBudgetMs === null || enforcement.waitBudgetMs === undefined ? "—" : String(enforcement.waitBudgetMs), "порог долгого ожидания, мс"],
            ["enforcement.processPolicy", enforcement.processPolicy || "—", "порядок шагов движка"],
            ["enforcement.structurePolicy", enforcement.structurePolicy || "—", "обход структуры (читает плагин structure)"],
            ["долгие ожидания", String(waits.total) + " (отказов " + waits.denied + ", notice " + waits.warn + ")",
              "журнал " + fmt(waits.path)],
          ];
          return h(
            "div",
            null,
            h(
              "div",
              { style: { marginBottom: "8px" } },
              badge(ok ? "императив исполняется" : "императив нарушен", ok ? T.success : T.danger,
                ok ? "все проверки §Г зелёные" : reasons.join("; "), false),
              reasons.length > 0 ? h("div", { style: S.hint }, "причины: " + reasons.join("; ")) : null,
            ),
            table(["пункт", "значение", "что означает"], rows.map((row) => [
              h("span", { style: S.mono }, row[0]),
              String(row[1]) === "fail"
                ? badge(String(row[1]), T.danger, row[2])
                : String(row[1]) === "warn"
                  ? badge(String(row[1]), T.warn, row[2])
                  : String(row[1]) === "off"
                    ? badge("off", T.warn, row[2])
                    : h("span", { style: S.mono }, String(row[1])),
              row[2],
            ])),
            (waits.last || []).length === 0
              ? h("div", { style: S.empty }, "Срабатываний сторожа в этом корне ещё не было.")
              : table(
                  ["когда", "инструмент", "режим", "корень", "откуда корень", "ожидание"],
                  waits.last.map((row) => [
                    h("span", { style: S.mono }, fmt(row.at)),
                    h("span", { style: S.mono }, fmt(row.tool)),
                    row.denied === true ? badge("отказ", T.danger, "тело не исполнялось") : badge(fmt(row.mode), T.warn, "вызов прошёл"),
                    h("span", { style: S.mono }, fmt(row.root)),
                    h("span", { style: S.mono }, fmt(row.attribution)),
                    row.waitMs ? Math.round(row.waitMs / 1000) + " с" : "—",
                  ]),
                ),
          );
        }
        function renderGuard() {
          if (!root) return h("div", { style: S.empty }, "Корень не настроен.");
          const guard = (policy && policy.guard) || {};
          const on = guard.enabled === true;
          const external = externalEngine();
          const disabled = Boolean(guardBusy) || Boolean(busy) || !root || Boolean(external);
          return h(
            "div",
            null,
            h(
              "div",
              { style: S.hint },
              "guard отклоняет коммит и пуш, если изменённый путь не входит в активное задание "
                + "(allowedPaths задания с замком и без записи приёмки), в guard.allow или не помечен "
                + "меткой обхода. Выключенный guard не мешает ничем.",
            ),
            h("div", { style: S.kv }, h("span", { style: S.kvLabel }, "guard.enabled"), h("span", { style: S.mono }, on ? "true" : "false")),
            h("div", { style: S.kv }, h("span", { style: S.kvLabel }, "режим"), h("span", { style: S.mono }, fmt(guard.mode))),
            h("div", { style: S.kv }, h("span", { style: S.kvLabel }, "allow"), h("span", { style: S.mono }, guard.allow && guard.allow.length > 0 ? guard.allow.join(", ") : "—")),
            h("div", { style: S.kv }, h("span", { style: S.kvLabel }, "метка обхода"), h("span", { style: S.mono }, fmt(guard.bypassMarker))),
            h(
              "div",
              { style: Object.assign({}, S.actions, { marginTop: "8px" }) },
              h(
                "button",
                {
                  type: "button",
                  style: disabled ? Object.assign({}, S.button, S.buttonDisabled) : S.button,
                  disabled: disabled,
                  onClick: () => void setGuard(!on),
                  title: external
                    ? externalEngineHint(external)
                    : on ? "Выключить проверку коммитов" : "Включить проверку коммитов",
                },
                guardBusy ? "Запись…" : (on ? "Выключить проверку коммитов" : "Включить проверку коммитов"),
              ),
            ),
            external ? h("div", { style: S.hint }, externalEngineHint(external)) : null,
            guardNote ? h("div", { style: S.hint }, guardNote) : null,
            h(
              "div",
              { style: S.hint },
              "Пишется ровно один ключ guard.enabled; включение и выключение с временем и сессией "
                + "дописываются в " + fmt(guard.logPath) + ". Это одна из двух записей панели, "
                + "вторая — развёртывание движка по кнопке. "
                + "Пределы: git commit --no-verify и git push --no-verify пропускают хуки целиком "
                + "(следа в аудите нет), метка обхода остаётся в аудите task-guard --audit.",
            ),
          );
        }

        /*
         * 0.7.0: единственный тупик панели закрыт кнопкой. Раньше пространство
         * без движка показывало только совет идти в терминал.
         */
        function renderDeploy() {
          const target = deployTarget();
          if (!target) return null;
          const external = externalEngine();
          const disabled = Boolean(deployBusy) || Boolean(busy) || Boolean(external);
          return h(
            "section",
            { style: S.section },
            h("h3", { style: S.sectionTitle }, "Развёртывание движка"),
            h(
              "div",
              { style: S.stageText },
              "Кнопка ставит движок из этой сборки панели прямо в пространство " + target
                + " — офлайн, без скачивания. Ключ приёмщика создаётся в .wf-keys/ проекта "
                + "(глобальный не трогается). Развёртывание идёт только по подтверждению и не меняет "
                + "policy, задачи и записи приёмки: второй запуск вернёт already-deployed.",
            ),
            /* 0.9.0: в воркспейс с внешним движком развёртывание запрещено. */
            external
              ? h("div", { style: S.hint }, externalEngineHint(external))
              : h("ul", { style: S.list }, DEPLOY_CHANGES.map((line, index) => h("li", { key: index }, line))),
            /*
             * Пустой карты — не ошибка: два равноправных варианта, и оба видны.
             * Либо движка нет нигде (тогда кнопка ниже — правильный шаг), либо он
             * уже развёрнут в другом репозитории (тогда нужна запись в карте).
             */
            !external && !engineInstalled()
              ? h(
                  "div",
                  { style: S.hint },
                  "Если движок уже развёрнут в другом репозитории, добавьте запись в карту "
                    + "~/.dsh/workflow/engine-roots.json — панель будет читать его оттуда, "
                    + "а это пространство не изменится. Это альтернатива кнопке ниже, а не сообщение о проблеме.",
                )
              : null,
            h(
              "div",
              { style: Object.assign({}, S.actions, { marginTop: "8px" }) },
              h(
                "button",
                {
                  type: "button",
                  style: disabled ? Object.assign({}, S.button, S.buttonDisabled) : S.button,
                  disabled: disabled,
                  onClick: () => void deployWorkflowHere(),
                  title: external
                    ? externalEngineHint(external)
                    : "Развернуть движок subagent-workflow в " + target + ", спросив подтверждение",
                  "aria-label": DEPLOY_LABEL + ": " + target,
                },
                deployBusy ? "Разворачиваю…" : DEPLOY_LABEL,
              ),
            ),
            h(
              "div",
              { style: S.hint },
              "Версия движка — версия этой сборки панели. Закрытый ключ приёмки init кладёт в .wf-keys/ проекта (каталог в .gitignore); глобальный ~/.wf-keys не трогается.",
            ),
          );
        }

        /*
         * Итог развёртывания — отдельной плашкой над страницей: успех (с версией)
         * и отказ (с кодом и хвостом вывода init) должны быть видны и после
         * того, как панель перечитала состояние.
         */
        function renderDeployNote() {
          if (!deployNote) return null;
          const ok = deployNote.kind === "ok";
          const color = ok ? T.success : T.danger;
          const logText = tailText(deployNote.log, 3000);
          return h(
            "div",
            { style: Object.assign({}, S.runBox, { borderColor: color }) },
            h(
              "div",
              { style: S.runHead },
              h(
                "span",
                { style: Object.assign({}, S.runStatus, { color, borderColor: color }) },
                ok ? "ок" : deployNote.code || "отказ",
              ),
              h("span", { style: S.runTitle }, ok ? "Движок развёрнут" : "Развернуть не удалось"),
              h("span", { style: S.spacer }),
              h(
                "button",
                { type: "button", style: S.button, onClick: () => setDeployNote(null), title: "Скрыть сообщение" },
                "×",
              ),
            ),
            h("div", { style: { fontSize: "12px", whiteSpace: "pre-wrap" } }, deployNote.text),
            logText.length > 0 ? h("pre", { style: S.runLog }, logText) : null,
          );
        }

        /* 2.6.89: витрина эффективности — доли, а не абсолюты (объём журналов растёт). */
        function renderMetrics() {
          if (!root) return h("div", { style: S.empty }, "Корень не настроен: добавьте roots в cordis.patch.yml.");
          if (busy && !metrics) return h("div", { style: S.empty }, "Читаем снимок метрик…");
          if (!metrics) return h("div", { style: S.empty }, "Снимок метрик ещё не прочитан. Нажмите „Перечитать“.");
          if (metrics.error) {
            return h(
              "div",
              { style: S.empty },
              "Снимок метрик не опубликован: " + metrics.error + ". Публикация: node tools/launch-metrics.mjs --publish .",
            );
          }
          const snapshot = metrics.snapshot || {};
          const rows = (snapshot.workspaces || []).map((w) => [
            h("span", { style: S.mono }, String(w.workspace).slice(-42)),
            String(w.sessions),
            String(w.avgTurnMin) + " мин",
            String(w.p90TurnMin) + " мин",
            String(w.longTurnRate),
            String(w.killedRate),
            String(w.refusalsPerSession),
            String(w.loopsPerSession),
          ]);
          return h(
            "div",
            null,
            h("h2", { style: S.summaryTitle }, "Метрики эффективности узлов"),
            h(
              "div",
              { style: S.hint },
              "Снимок от " + (snapshot.generatedAt || "неизвестно") + ", сессий в срезе: "
                + (snapshot.sessionsScanned || 0) + ". Публикуется командой node tools/launch-metrics.mjs --publish . ;"
                + " сравнение с baseline — тот же инструмент с --compare docs/metrics/baseline-2.6.87.json.",
            ),
            h(
              "div",
              { style: S.actions },
              h("button", { type: "button", style: S.button, disabled: busy, onClick: () => void openMetrics(true) }, "Перечитать"),
            ),
            rows.length === 0
              ? h("div", { style: S.empty }, "В снимке нет воркспейсов.")
              : section("По воркспейсам", table(
                ["воркспейс", "сессий", "средний ход", "p90", "длинные", "killed", "отказы/сесс.", "петли/сесс."],
                rows,
              )),
          );
        }

        function renderCompat() {
          /*
           * В пространстве без движка вкладка «Совместимость» тоже не тупик:
           * здесь та же кнопка развёртывания.
           */
          if (!root) {
            if (!deployTarget()) {
              return h("div", { style: S.empty }, "Корень не настроен: добавьте roots в cordis.patch.yml.");
            }
            return h(
              "div",
              null,
              renderEngineCard(),
              h(
                "div",
                { style: S.empty },
                "Workflow в этом пространстве не развёрнут: совместимость станет доступна после развёртывания.",
              ),
              renderDeploy(),
            );
          }
          if (!compat) return h("div", { style: S.empty }, "Чтение совместимости…");
          const summary = compat.summary || {};
          const versions = compat.versions || {};
          const severityText = (severity) => severity === "error" ? "ошибка" : severity === "warn" ? "предупреждение" : "инфо";
          const severityColor = (severity) => severity === "error" ? T.danger : severity === "warn" ? T.warn : T.tertiary;
          return h(
            "div",
            null,
            h(
              "div",
              { style: summary.limited ? S.compatBanner : Object.assign({}, S.compatBanner, { borderColor: T.border1 }) },
              h(
                "div",
                { style: S.compatBannerText },
                h("strong", null, summary.headline || "Совместимость"),
                h("div", { style: S.stageText }, "Панель только диагностирует. Команды из рекомендаций нужно выполнять вручную — она ничего не запускает."),
              ),
              h("button", { type: "button", style: S.button, disabled: busy, onClick: () => void openCompat(true) }, "Перечитать"),
            ),
            h("div", { style: S.kv }, h("span", { style: S.kvLabel }, "config"), h("span", { style: S.mono }, fmt(compat.configPath))),
            section(
              "Версии",
              kvGrid([
                ["плагин", compat.pluginVersion],
                ["поддерживает workflow", compat.supported],
                ["workflow в репозитории", compat.workflowVersion || "не определена"],
                ["источник версии", compat.versionSource || "—"],
                ["VERSION", versions.package || "—"],
                ["SPEC", versions.spec || "—"],
              ]),
            ),
            section(
              "Проверки",
              (compat.checks || []).length === 0
                ? h("div", { style: S.empty }, "Проблем не найдено: версии и файлы совместимы.")
                : table(
                    ["статус", "проверка", "что не так", "рекомендация"],
                    compat.checks.map((item) => [
                      badge(
                        severityText(item.severity),
                        severityColor(item.severity),
                        item.severity === "error"
                          ? "Ошибка стыковки: часть проверок недоступна, состояние задачи может быть неполным."
                          : item.severity === "warn"
                            ? "Замечание: работать можно, но часть проверок не выполняется."
                            : "Сообщение о стыковке версий.",
                      ),
                      item.title,
                      item.message,
                      item.recommendation || "—",
                    ]),
                  ),
            ),
          );
        }

        function renderRun() {
          if (!runResult) return null;
          const color = runResult.error
            ? T.danger
            : runResult.timedOut
              ? T.warn
              : runResult.ok
                ? T.success
                : T.warn;
          const status = runResult.error
            ? "не запустилось"
            : runResult.timedOut
              ? "таймаут"
              : runResult.ok
                ? "ок"
                : "код " + fmt(runResult.exitCode);
          const seconds = runResult.durationMs ? String(Math.round(runResult.durationMs / 100) / 10) + " с" : "—";
          /*
           * Человеческий итог вместо PASS/FAIL: панель отвечает на вопрос «всё ли
           * готово», а технический лог остаётся ниже, для тех, кому нужны детали.
           */
          const logText = String(runResult.log || "");
          const countMarks = (mark) => (logText.match(new RegExp("^" + mark + "\\b", "gm")) || []).length;
          const passed = countMarks("PASS");
          const failed = countMarks("FAIL");
          const warned = countMarks("WARN");
          const headline = runResult.error
            ? "Проверка не запустилась — причина ниже."
            : runResult.ok
              ? "Всё готово." + (passed > 0 ? " Проверок пройдено: " + passed + "." : "")
              : "Чего-то не хватает: " + (failed > 0 ? failed + " строгих замечаний" : "проверка вернула код " + fmt(runResult.exitCode))
                + (warned > 0 ? ", предупреждений " + warned : "") + ". Ниже — что именно.";
          return h(
            "div",
            { style: S.runBox },
            h("div", { style: { padding: "6px 10px 0", fontSize: "12px", color } }, headline),
            h(
              "div",
              { style: S.runHead },
              h("span", { style: Object.assign({}, S.runStatus, { color, borderColor: color }) }, status),
              h("span", { style: S.runTitle }, (runResult.title || runResult.check) + (runResult.task ? " · " + runResult.task : "")),
              h("span", { style: S.spacer }),
              h("span", { style: S.runMeta }, seconds),
              h(
                "button",
                { type: "button", style: S.button, onClick: () => setRunResult(null), title: "Скрыть результат" },
                "×",
              ),
            ),
            runResult.error
              ? h("div", { style: S.error }, runResult.error)
              : null,
            runResult.command ? h("div", { style: S.runCommand }, runResult.command) : null,
            h("pre", { style: S.runLog }, runResult.log && runResult.log.length > 0 ? runResult.log : "(вывода нет)"),
            h(
              "div",
              { style: S.hint },
              "Только чтение: проверка не пишет в репозиторий, не подписывает и не принимает."
                + (runResult.logPath ? " Лог: " + runResult.logPath : ""),
            ),
          );
        }

        let body;
        if (card) body = renderCard();
        else if (tab === "policy") body = renderPolicy();
        else if (tab === "compat") body = renderCompat();
        else if (tab === "metrics") body = renderMetrics();
        else if (tab === "board") body = renderBoard();
        else if (tab === "anchors") body = renderAnchorsTab();
        else body = renderOverview();

        const compatSummary = status && status.repo && status.repo.compat ? status.repo.compat.summary : null;

        return h(
          "div",
          { style: S.root },
          h("style", { key: "tooltip-css" }, TOOLTIP_CSS),
          renderHeader(),
          renderTabs(),
          h(
            "div",
            { style: S.content },
            renderLocation(),
            renderRun(),
            renderDeployNote(),
            error && !root ? h("p", { style: S.error }, "Не удалось получить состояние движка. Остальные данные оставлены без изменений. Повторите обновление данных: " + error) : null,
            status && status.error && !status.repo
              ? h(
                  "p",
                  { style: S.hint },
                  status.error + "\n\ncordis.patch.yml:\n  config:\n    roots:\n      - C:\\path\\to\\repo",
                )
              : null,
            compatSummary && compatSummary.limited && tab !== "compat"
              ? h(
                  "div",
                  { style: S.compatBanner },
                  h("div", { style: S.compatBannerText }, compatSummary.headline),
                  h("button", { type: "button", style: S.button, onClick: () => void openCompat() }, "Открыть «Совместимость»"),
                )
              : null,
            body,
          ),
        );
      }
      return WorkflowView;
    }

