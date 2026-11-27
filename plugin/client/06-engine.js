        /* ------------------------------------------------------------------ *
         * 0.8.0: версии движка и обновление
         * ------------------------------------------------------------------ */

        /*
         * 0.9.3 (0039): состояние связи из /api/status.engine. Сервер отдаёт
         * {installed, mode: local|mapped|absent, root, version, source}; карточка
         * не додумывает источник, а называет его.
         */
        function engineState() {
          const value = status && status.engine && typeof status.engine === "object" ? status.engine : null;
          const installed = Boolean(value && value.installed === true);
          const source = value && ENGINE_SOURCE_LABEL[value.source]
            ? value.source
            : installed ? "workspace" : "none";
          return {
            installed: installed,
            mode: value && value.mode
              ? String(value.mode)
              : installed ? (source === "workspace" ? "local" : "mapped") : "absent",
            source: source,
            root: value && value.root ? String(value.root) : null,
            version: value && value.version ? String(value.version) : null,
          };
        }

        function engineSourceText(source) {
          return ENGINE_SOURCE_LABEL[source] || "—";
        }

        function engineVersionText(engine) {
          const version = (engine && engine.version) || engineInstalled();
          return version ? "v" + version : "версия неизвестна";
        }

        function engineInstalled() {
          return status && status.repo && status.repo.packageVersion
            ? String(status.repo.packageVersion)
            : null;
        }

        function engineAvailable() {
          return status && status.availableVersion ? String(status.availableVersion) : null;
        }

        /*
         * 0.9.4 (0041): числовое сравнение версий по сегментам — как
         * deploy.compareVersions. Строковое сравнение неверно: 2.6.10 новее 2.6.9.
         */
        function compareVersions(a, b) {
          const segments = (value) => {
            const text = String(value === null || value === undefined ? "" : value).trim();
            if (text === "") return null;
            return text.replace(/^v/iu, "").split(".").map((part) => {
              const numeric = Number.parseInt(part, 10);
              return Number.isFinite(numeric) ? numeric : 0;
            });
          };
          const left = segments(a);
          const right = segments(b);
          if (left === null || right === null) return 0;
          const length = Math.max(left.length, right.length);
          for (let index = 0; index < length; index += 1) {
            const l = left[index] || 0;
            const r = right[index] || 0;
            if (l < r) return -1;
            if (l > r) return 1;
          }
          return 0;
        }

        /*
         * 0.9.4 (0041): сборка панели старше движка. Обновление до версии сборки
         * понизило бы движок, поэтому кнопка обновления не предлагает понижение,
         * а тексты панели говорят причину прямо.
         */
        function panelOlder() {
          const installed = engineInstalled();
          const available = engineAvailable();
          return Boolean(installed && available && compareVersions(available, installed) < 0);
        }

        function panelOlderHint() {
          const installed = engineInstalled();
          const available = engineAvailable();
          return "Эта сборка панели старше установленного движка: в сборке v" + fmt(available)
            + ", установлено v" + fmt(installed) + ". Обновление до версии сборки было бы понижением: "
            + "понижение движка запрещено. Обновите панель — возьмите tarball из latest release; "
            + "движок и его файлы при этом не меняются.";
        }

        /*
         * 0.9.0: движок снаружи. source 'mapping' — воркспейс не меняется:
         * файлы прочитаны из репозитория движка по карте.
         */
        function externalEngine() {
          const engine = status && status.engine;
          return engine && (engine.source === "mapping" || engine.source === "config") ? engine : null;
        }

        function externalEngineText(engine) {
          return "движок: внешний · " + (engine && engine.root ? engine.root : "путь неизвестен");
        }

        function externalEngineHint(engine) {
          const version = engineInstalled();
          const path = engine && engine.root ? engine.root : "путь неизвестен";
          return "Движок внешний" + (version ? " v" + version : "") + ": " + path
            + ". Этот воркспейс не меняется: развёртывание и guard выполняются "
            + "в репозитории движка (карта ~/.dsh/workflow/engine-roots.json), а не здесь."
            + " Обновление движка идёт в репозиторий движка: " + path
            + ", — и только по подтверждению."
            + " Если движка в том репозитории нет — уберите запись из карты, и панель снова "
            + "предложит развернуть движок здесь.";
        }

        /*
         * 0151: отметка развёртывания из status.deployNotice. Это решение, а не
         * состояние дерева: gitignore — код движка не вендорится, vendored —
         * копия живёт в истории проекта. Нет отметки — панель молчит.
         */
        function engineDeployNotice() {
          const notice = status && status.deployNotice;
          return notice && typeof notice === "object" && typeof notice.notice === "string" ? notice : null;
        }

        function deployNoticePolicyText(notice) {
          if (!notice) return "";
          if (notice.mode === "external") return "движок внешний: воркспейс не изменяется";
          if (notice.policy === "vendored") return "вендоринг: копия движка в истории проекта";
          const ignored = notice.ignored && notice.ignored.length > 0 ? notice.ignored.join(", ") : "docs/subagent-workflow/";
          return "код движка не вендорится: " + ignored + " в .gitignore";
        }

        /* Незавершённые задания приходят из /api/status (repo.tasksInProgress). */
        function enginePending() {
          const list = status && status.repo && status.repo.tasksInProgress;
          return Array.isArray(list) ? list.map(String) : [];
        }

        function openUpdate() {
          setUpdateOpen(true);
          setUpdateRisk(false);
          setUpdateNote(null);
        }

        function closeUpdate() {
          setUpdateOpen(false);
          setUpdateRisk(false);
        }

        /*
         * 0085 (0.9.19): initGit — обновление не-git воркспейса тем же шагом
         * git init, что и первичное развёртывание. Без флага сервер по-прежнему
         * отвечает not-a-repo.
         */
        async function runUpdate(options = {}) {
          const initGit = options.initGit === true;
          const target = deployTarget();
          /* 0042: внешний движок обновляется в своём репозитории — тем же запросом. */
          const external = externalEngine();
          if (!target || updateBusy) return;
          const pending = enginePending();
          if (pending.length > 0 && !updateRisk) return;
          setUpdateBusy(true);
          setUpdateNote(null);
          setError(null);
          try {
            const response = await fetch(BASE + UPDATE_ROUTE, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(Object.assign({
                root: target,
                confirm: true,
                allowInProgress: updateRisk === true,
                ...(initGit || updateInitGit ? { initGit: true } : {}),
              }, external ? { target: EXTERNAL_UPDATE_TARGET } : {})),
            });
            /*
             * Тело читаем сами: у 409 tasks-in-progress в нём список заданий, а
             * readJson превратил бы его в одну строку ошибки.
             */
            const text = await response.text();
            let data = {};
            try {
              data = text.length > 0 ? JSON.parse(text) : {};
            } catch {
              data = { error: "ответ не JSON: HTTP " + response.status };
            }
            if (data.code === "up-to-date") {
              setUpdateNote({
                kind: "ok",
                code: null,
                text: "Обновление не нужно: уже установлена версия " + fmt(data.version) + ".",
                log: data.log || "",
                /* 0067: в этой сборке новее нечего предложить — движок можно взять из релиза. */
                release: true,
              });
              return;
            }
            /*
             * 0041: сборка панели старше движка. Отказ сервера повторяет то же
             * объяснение, что и карточка: обновлять нужно панель, не движок.
             */
            if (data.code === PANEL_OLDER_CODE) {
              setUpdateNote({
                kind: "error",
                code: data.code,
                text: data.hint || panelOlderHint(),
                log: data.log || "",
                /* 0067: понижение из сборки запрещено, но релиз может быть новее движка. */
                release: true,
              });
              closeUpdate();
              return;
            }
            if (data.code === "tasks-in-progress") {
              const list = Array.isArray(data.tasks) && data.tasks.length > 0
                ? data.tasks.join(", ")
                : "есть";
              setUpdateNote({
                kind: "error",
                code: data.code,
                text: "Обновление остановлено: незавершённые задания " + list
                  + ". Поставьте галочку «" + UPDATE_RISK_LABEL + "», если готовы продолжить.",
                log: data.log || "",
              });
              setUpdateRisk(false);
              return;
            }
            /*
             * 0.9.0: внешний движок — 409 engine-external. Кнопка в таком
             * пространстве неактивна, но подсказка сервера понятнее общего
             * текста, если отказ всё же пришёл.
             */
            if (data.code === EXTERNAL_ENGINE_CODE) {
              setUpdateNote({
                kind: "error",
                code: data.code,
                text: data.hint || data.error || "движок внешний: этот воркспейс не меняется",
                log: data.log || "",
              });
              return;
            }
            /* 0042: у локального движка нет отдельного репозитория — отказ называет причину. */
            if (data.code === "engine-not-external") {
              setUpdateNote({
                kind: "error",
                code: data.code,
                text: data.hint || data.error || "у локального движка нет отдельного репозитория",
                log: data.log || "",
              });
              return;
            }
            if (data.code === "not-a-repo") {
              /* 0088: запоминаем решение, чтобы подтверждение работало одним нажатием. */
              setUpdateInitGit(true);
            }
            if (!response.ok || data.ok !== true) {
              setUpdateNote({
                kind: "error",
                code: data.code || "http-" + response.status,
                text: data.error || "обновление не выполнено: HTTP " + response.status,
                log: data.log || "",
              });
              return;
            }
            const repo = data.engineRepo || (external && external.root ? external.root : null);
            setUpdateNote({
              kind: "ok",
              code: null,
              text: "Движок обновлён" + (repo ? " в репозитории движка " + repo : "")
                + ": " + fmt(data.from) + " → " + fmt(data.version)
                + ". Панель перечитала состояние.",
              log: data.log || "",
            });
            setUpdateInitGit(false);
            closeUpdate();
            /* Перечитываем состояние: версии, журнал и список заданий обновились. */
            await load(target, true);
          } catch (failure) {
            setUpdateNote({ kind: "error", code: "network", text: errorText(failure), log: "" });
          } finally {
            setUpdateBusy(false);
          }
        }

        /*
         * 2.6.28 (0067): «Обновить из релиза». Тот же маршрут /api/update, но
         * source: "release": сервер сам скачивает tarball движка из последнего
         * релиза GitHub, сверяет sha256 и разворачивает его. Корень по-прежнему
         * выбирает сервер, поэтому клиент не может назвать чужой проект.
         */
        async function runReleaseUpdate() {
          const target = deployTarget();
          if (!target || updateBusy) return;
          setUpdateBusy(true);
          setUpdateNote(null);
          setError(null);
          try {
            const response = await fetch(BASE + UPDATE_ROUTE, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ root: target, confirm: true, source: RELEASE_UPDATE_SOURCE }),
            });
            const text = await response.text();
            let data = {};
            try {
              data = text.length > 0 ? JSON.parse(text) : {};
            } catch {
              data = { error: "ответ не JSON: HTTP " + response.status };
            }
            /*
             * 0078 (WC-61): up-to-date — не отказ. Сервер отвечает 409 с кодом
             * up-to-date, когда установленная версия уже равна последнему
             * релизу; до этой правки панель показывала «обновление из релиза не
             * выполнено: HTTP 409». Сборка это уже различала (см. выше), релиз —
             * нет.
             */
            if (data.code === "up-to-date") {
              setUpdateNote({
                kind: "ok",
                code: null,
                text: "Обновление не нужно: уже установлена версия "
                  + fmt(data.version || data.targetVersion) + ".",
                log: data.log || "",
              });
              closeUpdate();
              return;
            }
            if (!response.ok || data.ok !== true) {
              const unavailable = data.code === "release-unavailable";
              setUpdateNote({
                kind: "error",
                code: data.code || "http-" + response.status,
                text: unavailable
                  ? "Релиз недоступен: " + (data.error || "не удалось скачать движок из релиза GitHub")
                    + ". Воркспейс не изменён."
                  : (data.hint || data.error || "обновление из релиза не выполнено: HTTP " + response.status),
                log: data.log || "",
              });
              return;
            }
            setUpdateNote({
              kind: "ok",
              code: null,
              text: "Движок обновлён из релиза GitHub: " + fmt(data.from) + " → "
                + fmt(data.targetVersion || data.version) + ". Панель перечитала состояние.",
              log: data.log || "",
            });
            closeUpdate();
            await load(target, true);
          } catch (failure) {
            setUpdateNote({ kind: "error", code: "network", text: errorText(failure), log: "" });
          } finally {
            setUpdateBusy(false);
          }
        }

        /*
         * 0079 (WC-52): обновление самой панели пакетом из релиза. Отдельный
         * маршрут: замена каталога плагина — не обновление движка и не запись
         * воркспейса; после успеха нужен перезапуск DSH.
         */
        async function runPluginUpdate() {
          if (updateBusy) return;
          setUpdateBusy(true);
          setUpdateNote(null);
          setError(null);
          try {
            const response = await fetch(BASE + PLUGIN_UPDATE_ROUTE, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ confirm: true }),
            });
            const text = await response.text();
            let data = {};
            try {
              data = text.length > 0 ? JSON.parse(text) : {};
            } catch {
              data = { error: "ответ не JSON: HTTP " + response.status };
            }
            if (data.ok !== true) {
              const code = data.code || "http-" + response.status;
              let message = data.error || data.hint
                || "обновление панели не выполнено: HTTP " + response.status;
              if (code === "plugin-up-to-date") {
                message = "Обновление не нужно: панель уже версии " + fmt(data.version || data.current) + ".";
              } else if (code === "plugin-dev-install") {
                message = data.hint || data.error
                  || "Плагин установлен ссылкой на рабочее дерево: обновляйте его в репозитории.";
              }
              setUpdateNote({ kind: code === "plugin-up-to-date" ? "ok" : "error", code, text: message, log: data.log || "" });
              return;
            }
            setUpdateNote({
              kind: "ok",
              code: null,
              text: "Панель обновлена: " + fmt(data.from) + " → " + fmt(data.to)
                + ". Перезапустите DSH, чтобы новая версия загрузилась. Бэкап пакета: " + fmt(data.backup) + ".",
              log: "",
            });
          } catch (failure) {
            setUpdateNote({ kind: "error", code: "network", text: errorText(failure), log: "" });
          } finally {
            setUpdateBusy(false);
          }
        }

        /*
         * 0102 (WC-65): «Проверить актуальность». Один запрос к API релиза;
         * на сбое сети ответ всё равно 200 и несёт последнюю удачную пару —
         * поэтому панель показывает «последняя удачная 18:40», а не «aborted».
         */
        async function loadAnchors(layer = anchorsLayer) {
          setAnchorsError(null);
          try {
            const response = await fetch(BASE + "/api/anchors?layer=" + encodeURIComponent(layer), { headers: { Accept: "application/json" } });
            const next = await readJson(response);
            /*
             * В чужом воркспейсе контурного набора обычно нет (docs не уезжают в развёрнутую
             * копию): показываем проектный набор этого воркспейса, а не ошибку про контур.
             */
            if (layer === "contour" && next && next.available && next.available.contour === false && next.available.project === true) {
              setAnchorsLayer("project");
              void loadAnchors("project");
              return;
            }
            setAnchors(next);
          } catch (failure) {
            setAnchorsError(errorText(failure));
          }
        }

        async function approveAnchorsNow(layer = anchorsLayer) {
          if (anchorsBusy) return;
          setAnchorsBusy(true);
          setAnchorsError(null);
          try {
            const response = await fetch(BASE + "/api/anchors/approve?layer=" + encodeURIComponent(layer), {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ confirm: true }),
            });
            const next = await readJson(response);
            setAnchors(next);
            if (next.ok !== true) setAnchorsError((next.problems || ["Не удалось проверить и утвердить якоря."])[0]);
          } catch (failure) {
            setAnchorsError(errorText(failure));
          } finally {
            setAnchorsBusy(false);
          }
        }

        function anchorsText() {
          if (!anchors) return anchorsError
            ? "Не удалось получить список якорей. Остальные данные оставлены без изменений. Повторите обновление данных."
            : "Загружаем состояние…";
          if (anchors.approved === true) {
            return "Якоря утверждены: ключ " + fmt(anchors.keyId) + " · " + fmt(anchors.at) + " · хеш " + String(anchors.hash || "").slice(0, 12) + "…";
          }
          const reason = anchors.problems && anchors.problems.length ? anchors.problems[0] : "не утверждены";
          return "Якоря не утверждены: " + reason;
        }

        function anchorStatusLabel(status) {
          if (status === "auto") return "Проверяется автоматически";
          if (status === "semi") return "Проверяется частично";
          if (status === "inWork") return "В работе";
          return "Статус не указан";
        }

        function anchorStatusColor(status) {
          if (status === "auto") return T.success;
          if (status === "semi") return T.warn;
          return T.tertiary;
        }

        function anchorTermExplanation(claim) {
          let text = String(claim || "");
          const explanations = [
            [/commit\.ps1/gu, "commit.ps1 (скрипт безопасного коммита)"],
            [/release-publish/gu, "release-publish (сценарий публикации релиза)"],
            [/draft -> smoke -> publish/gu, "draft -> smoke -> publish (черновик -> проверка сборки -> публикация)"],
            [/Reply-To/gu, "Reply-To (адрес для ответа)"],
            [/Session/gu, "Session (идентификатор сессии)"],
          ];
          for (const [pattern, replacement] of explanations) text = text.replace(pattern, replacement);
          return text;
        }

        function renderAnchorsCard() {
          /* Кнопки и карточки называют предмет, результат действия и цену бездействия. */
          const approved = Boolean(anchors && anchors.approved === true);
          /* 2.6.82: переключатель только когда в корне есть оба набора. */
          const showLayerSwitch = Boolean(anchors && anchors.available && anchors.available.contour && anchors.available.project);
          const layerLabel = anchorsLayer === "project" ? "проект (этот воркспейс)" : "контур (движок workflow)";
          const isProjectLayer = anchorsLayer === "project";
          const hint = isProjectLayer
            ? (approved
              ? "Якоря проекта — правила этого воркспейса, по которым его задачи и выпуски проверяются узлами. Утверждение уже есть; повторное не требуется, пока файл правил не менялся."
              : "Якоря проекта — правила этого воркспейса, по которым его задачи и выпуски проверяются узлами. Кнопка проверяет docs/anchors.json и ставит вашу человеческую подпись под текущей редакцией; другие воркспейсы она не меняет. Без подписи проверки считают набор неутверждённым и релиз не проходит.")
            : (approved
              ? "Якоря контура — общие правила движка workflow, по которым проверяются задачи и выпуски во всех воркспейсах на этом движке. Утверждение уже есть; повторное не требуется, пока файл правил не менялся."
              : "Якоря контура — общие правила движка workflow, по которым проверяются задачи и выпуски во всех воркспейсах на этом движке. Кнопка проверяет список движка и ставит вашу человеческую подпись под текущей редакцией; формулировки и рабочие пространства не меняет. Без подписи проверки считают набор неутверждённым и релиз не проходит.");
          const list = anchors && Array.isArray(anchors.anchors) ? anchors.anchors : null;
          const approvalUnavailable = !anchors || anchors.ok !== true || !list || list.length === 0;
          const approvalHint = anchorsBusy ? "Проверяем список и подпись…" : anchorsError ? "Утверждение недоступно: " + (anchors && anchors.problems && anchors.problems.length ? anchors.problems[0] : anchorsError) : approvalUnavailable && anchors ? "Утверждение недоступно: сначала проверьте целостность списка и подпись." : approvalUnavailable ? "Загружаем состояние…" : approved ? "Кнопка перечитывает состояние подписи; без обновления может быть показано устаревшее подтверждение." : "Кнопка ставит подпись под видимым набором правил; без подписи проверка выпуска не проходит.";
          const approvedDate = approved && anchors.at ? anchors.at : "Нет данных";
          const integrity = anchors && anchors.hash ? "SHA-256 " + String(anchors.hash).slice(0, 12) + "…" : "Нет данных";
          const ruleRows = list && list.length > 0
            ? list.map((anchor) => h(
                "div",
                { key: anchor.id, style: S.anchorRow },
                h("div", null, h("b", { style: { marginRight: "6px" } }, anchor.id), anchorTermExplanation(anchor.claim)),
                h("span", { style: Object.assign({}, S.badge, { color: anchorStatusColor(anchor.status), borderColor: anchorStatusColor(anchor.status) }) }, anchorStatusLabel(anchor.status)),
                h(
                  "div",
                  { style: S.anchorMeta },
                  h("span", null, h("b", null, "Слой: "), anchor.layer === "contour" ? "контур (движок workflow)" : anchor.layer === "project" ? "проект (этот воркспейс)" : fmt(anchor.layer)),
                  h("span", null, h("b", null, "Проверяет: "), anchor.enforcedBy === "engine" ? "движок" : anchor.enforcedBy === "nodes" ? "узлы проекта" : anchor.enforcedBy === "both" ? "движок и узлы проекта" : fmt(anchor.enforcedBy)),
                  h("span", null, h("b", null, "Область: "), fmt(anchor.sides || anchor.scope)),
                  h("span", null, h("b", null, "Проверка: "), fmt(anchor.check)),
                  h("span", null, h("b", null, "Владелец: "), fmt(anchor.owner)),
                  h("span", null, h("b", null, "Подтверждено: "), anchor.confirmed && anchor.confirmed.version ? anchor.confirmed.version + (anchor.confirmed.date ? " · " + anchor.confirmed.date : "") : "Нет данных"),
                ),
              ))
            : h("div", { style: S.empty }, anchorsError
                ? "Не удалось получить список якорей. Остальные данные оставлены без изменений. Повторите обновление данных."
                : "Загружаем состояние…");
          return h(
            "section",
            { style: S.section },
            h("h3", { style: S.sectionTitle }, "Семантические якоря"),
            showLayerSwitch ? h(
              "div",
              { style: Object.assign({}, S.actions, { marginBottom: "4px", marginTop: 0 }) },
              ["contour", "project"].map((layer) => h(
                "button",
                {
                  key: layer,
                  type: "button",
                  style: anchorsLayer === layer ? S.button : Object.assign({}, S.button, { opacity: 0.6 }),
                  disabled: anchorsBusy,
                  onClick: () => {
                    if (anchorsLayer === layer) return;
                    setAnchorsLayer(layer);
                    setAnchors(null);
                    setAnchorsError(null);
                    void loadAnchors(layer);
                  },
                },
                layer === "contour" ? "Контур (движок)" : "Проект (этот воркспейс)",
              )),
            ) : null,
            h("div", { style: S.stageText }, hint + " Набор в предпросмотре: " + layerLabel + "."),
            h(
              "div",
              { style: Object.assign({}, S.summaryGrid, { margin: "8px 0" }) },
              h("div", { style: S.summaryItem }, h("b", { style: S.summaryStatus }, approved ? "Якоря утверждены" : anchors ? "Якоря требуют внимания" : "Загружаем состояние…"), "Подтверждено: " + fmt(approvedDate)),
              h("div", { style: S.summaryItem }, h("b", { style: S.summaryStatus }, "Целостность набора"), integrity),
            ),
            anchorsBusy ? h("div", { style: S.hint }, approved ? "Обновляем состояние подписи… Прежние данные оставлены на экране." : "Проверяем и утверждаем якоря… Прежние данные оставлены на экране.") : null,
            anchorsError ? h("div", { style: Object.assign({}, S.error, { marginBottom: "8px" }) }, "Не удалось получить или утвердить якоря. Остальные данные оставлены без изменений. Причина: " + (anchors && anchors.problems && anchors.problems.length ? anchors.problems[0] : anchorsError) + ". Повторите обновление данных.") : null,
            anchors && anchors.approved === true ? h("div", { style: Object.assign({}, S.hint, { borderColor: T.success, color: T.success, fontWeight: "600" }) }, "Якоря утверждены: ключ " + fmt(anchors.keyId) + " · " + fmt(anchors.at) + " · хеш " + String(anchors.hash || "").slice(0, 12) + "…") : null,
            h("div", { style: S.anchorList, role: "region", "aria-label": "Список правил семантических якорей" }, ruleRows),
            h("div", { style: Object.assign({}, S.stageText, { marginTop: "6px" }) }, "Набор: " + layerLabel + " · файл: " + fmt(anchors && anchors.file) + " · хеш: " + integrity),
            h(
              "div",
              { style: Object.assign({}, S.actions, { marginTop: "8px", marginBottom: 0 }) },
              h(
                "button",
                {
                  type: "button",
                  style: anchorsBusy || approvalUnavailable || anchorsError ? Object.assign({}, S.button, S.buttonDisabled) : S.button,
                  disabled: anchorsBusy || approvalUnavailable || Boolean(anchorsError),
                  onClick: () => {
                    if (approved) void loadAnchors(anchorsLayer);
                    else {
                      setAnchorsError(null);
                      setAnchors(null);
                      void approveAnchorsNow(anchorsLayer);
                    }
                  },
                  title: approvalUnavailable
                    ? anchors ? "Утверждение недоступно: сначала проверьте целостность списка и подпись." : "Загружаем состояние…"
                    : approved
                      ? "Якоря уже утверждены; сначала измените файл правил и затем проверьте его заново."
                      : "Подписывает текущий список правил человеческим ключом human-user; проверки требуют эту подпись.",
                },
                anchorsBusy ? "Подписываем…" : approved ? "Обновить состояние" : "Утвердить якоря",
              ),
              h("span", { style: anchorsError ? S.error : S.stageText }, approvalHint),
            ),
          );
        }

