    /* ------------------------------------------------------------------ *
     * view
     * ------------------------------------------------------------------ */

    function createView(readWorkspace) {
      function WorkflowView() {
        const [status, setStatus] = React.useState(null);
        const [board, setBoard] = React.useState(null);
        const [card, setCard] = React.useState(null);
        const [policy, setPolicy] = React.useState(null);
        const [compat, setCompat] = React.useState(null);
        const [metrics, setMetrics] = React.useState(null);
        const [tab, setTab] = React.useState("overview");
        const [root, setRoot] = React.useState(null);
        const [currentWorkspace, setCurrentWorkspace] = React.useState(null);
        const [locationNote, setLocationNote] = React.useState(null);
        const [showEmpty, setShowEmpty] = React.useState(false);
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState(null);
        const [running, setRunning] = React.useState(null);
        const [runResult, setRunResult] = React.useState(null);
        const [showAllRoots, setShowAllRoots] = React.useState(false);
        const [guardBusy, setGuardBusy] = React.useState(false);
        const [guardNote, setGuardNote] = React.useState(null);
        const [deployBusy, setDeployBusy] = React.useState(false);
        const [deployNote, setDeployNote] = React.useState(null);
        const [updateOpen, setUpdateOpen] = React.useState(false);
        const [updateRisk, setUpdateRisk] = React.useState(false);
        const [updateBusy, setUpdateBusy] = React.useState(false);
        /*
         * 0088 (0.9.20): воркспейс без git. Сервер отказывает not-a-repo, но
         * решение «создать репозиторий» запоминается: следующее подтверждение
         * обновления уже несёт initGit, без охоты за второй кнопкой.
         */
        const [updateInitGit, setUpdateInitGit] = React.useState(false);
        /* 0102 (WC-65): проверка актуальности по требованию — сеть только по кнопке. */
        const [releaseCheck, setReleaseCheck] = React.useState(null);
        const [releaseCheckBusy, setReleaseCheckBusy] = React.useState(false);
        /* 0111 (WC-77): утверждение якорей — действие человека из панели, не из PowerShell. */
        const [anchors, setAnchors] = React.useState(null);
        const [anchorsBusy, setAnchorsBusy] = React.useState(false);
        /* 0120: результат действия должен быть виден — и успех, и причина отказа. */
        const [anchorsNote, setAnchorsNote] = React.useState(null);
        const [anchorsError, setAnchorsError] = React.useState(null);
        /* 2.6.82: какой набор человек видит в предпросмотре и подписывает — контур или проект. */
        const [anchorsLayer, setAnchorsLayer] = React.useState("contour");
        /*
         * 0090 (WC-4): первая запись из панели. Панель не пишет тексты — она
         * зовёт штатные task-hash.mjs / new-task.mjs и показывает их вывод.
         */
        const [lockBusy, setLockBusy] = React.useState(false);
        const [lockNote, setLockNote] = React.useState(null);
        const [newTaskOpen, setNewTaskOpen] = React.useState(false);
        const [newTaskBusy, setNewTaskBusy] = React.useState(false);
        const [newTaskNote, setNewTaskNote] = React.useState(null);
        const [newTaskId, setNewTaskId] = React.useState("");
        const [newTaskTitle, setNewTaskTitle] = React.useState("");
        const [newTaskRisk, setNewTaskRisk] = React.useState("low");
        const [updateNote, setUpdateNote] = React.useState(null);
        const [linkOpen, setLinkOpen] = React.useState(false);
        const [candidates, setCandidates] = React.useState(null);
        const [candidatesBusy, setCandidatesBusy] = React.useState(false);
        const [linkBusy, setLinkBusy] = React.useState(false);
        const [linkNote, setLinkNote] = React.useState(null);

        async function load(selectedRoot, explicit = false) {
          setBusy(true);
          setError(null);
          try {
            const current = workspaceInfo(readWorkspace ? readWorkspace() : null);
            setCurrentWorkspace(current);
            const preferred = selectedRoot || (current ? current.path : null);
            let nextStatus = await apiGet("/api/status", preferred);
            /* Пространство может быть вне разрешённых корней — тогда нужен просто список. */
            if (!explicit && nextStatus.error) nextStatus = await apiGet("/api/status");
            setStatus(nextStatus);
            /*
             * Панель показывает только то пространство, из которого её открыли.
             * Раньше здесь был молчаливый провал на первый настроенный корень: в
             * пространстве без workflow открывалась доска чужого проекта. Теперь
             * вместо чужого проекта — честное пустое состояние и выбор вручную.
             */
            const repo = nextStatus.repo;
            /* Готово к показу только когда конфиг реально прочитан. */
            const workflowReady = Boolean(repo && repo.configLoaded === true);
            /*
             * Без определённого workspace (не-web хост) показываем настроенный корень.
             * С workspace — только его самого: чужой проект не подставляем.
             */
            const showsCurrent = explicit
              ? Boolean(nextStatus.root)
              : current
                ? Boolean(nextStatus.root && sameFsPath(nextStatus.root, current.path))
                : Boolean(nextStatus.root);
            if (!workflowReady || !showsCurrent) {
              setRoot(null);
              setBoard(null);
              setTab("board");
              setLocationNote(current
                ? "В этом пространстве workflow не развёрнут: " + current.path
                : "Пространство не определено, а настроенные корни относятся к другим пространствам.");
              return;
            }
            setLocationNote(null);
            const nextRoot = nextStatus.root
              || preferred
              || (nextStatus.roots && nextStatus.roots.length > 0 ? nextStatus.roots[0].path : null);
            setRoot(nextRoot || null);
            setTab("board");
            setCard(null);
            setPolicy(null);
            setCompat(null);
            if (nextRoot) {
              setBoard(await apiGet("/api/tasks", nextRoot));
            } else {
              setBoard(null);
            }
          } catch (failure) {
            setError(errorText(failure));
          } finally {
            setBusy(false);
          }
        }

        React.useEffect(() => {
          void load(null);
          void loadAnchors();
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        async function openTask(id) {
          if (!root) return;
          setBusy(true);
          setError(null);
          try {
            const data = await apiGet("/api/task/" + encodeURIComponent(id), root);
            setCard(data.task);
          } catch (failure) {
            setError(errorText(failure));
          } finally {
            setBusy(false);
          }
        }

        async function openPolicy() {
          setCard(null);
          setTab("policy");
          if (!root || policy) return;
          setBusy(true);
          setError(null);
          try {
            setPolicy(await apiGet("/api/policy", root));
          } catch (failure) {
            setError(errorText(failure));
          } finally {
            setBusy(false);
          }
        }

        async function openCompat(force = false) {
          setCard(null);
          setTab("compat");
          if (!root || (compat && !force)) return;
          setBusy(true);
          setError(null);
          try {
            setCompat(await apiGet("/api/compat", root));
          } catch (failure) {
            setError(errorText(failure));
          } finally {
            setBusy(false);
          }
        }

        /*
         * 2.6.89: снимок метрик эффективности узлов публикует launch-metrics
         * (--publish <корень>), панель его только читает. Тяжёлый пересчёт
         * журналов в браузере не делается: снимок показывает автор и время.
         */
        async function openMetrics(force = false) {
          setCard(null);
          setTab("metrics");
          if (!root || (metrics && !force)) return;
          setBusy(true);
          setError(null);
          try {
            setMetrics(await apiGet("/api/metrics", root));
          } catch (failure) {
            setError(errorText(failure));
          } finally {
            setBusy(false);
          }
        }

        async function runCheckApi(id, taskId) {
          if (!root || running) return;
          setRunning(id);
          setRunResult(null);
          try {
            const response = await fetch(BASE + "/api/run", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ check: id, root: root, task: taskId || null }),
            });
            const data = await readJson(response);
            setRunResult(Object.assign({ check: id, task: taskId || null }, data));
          } catch (failure) {
            setRunResult({ check: id, task: taskId || null, ok: false, error: errorText(failure) });
          } finally {
            setRunning(null);
          }
        }

        /* 0090: замок контракта — штатный task-hash.mjs --write. */
        async function lockContract(taskId) {
          if (!root || lockBusy) return;
          setLockBusy(true);
          setLockNote(null);
          try {
            const response = await fetch(BASE + "/api/task-hash", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ root: root, task: taskId, confirm: true }),
            });
            const data = await readJson(response);
            setLockNote({
              ok: data.ok === true,
              text: data.ok
                ? "Замок собран: criteria.lock записан, критерии заморожены."
                : (data.error || "task-hash завершился с ошибкой"),
              log: data.stdout || data.stderr || "",
            });
            if (data.ok === true) await load(root, true);
          } catch (failure) {
            setLockNote({ ok: false, text: errorText(failure), log: "" });
          } finally {
            setLockBusy(false);
          }
        }

        /* 0090: новое задание — штатный new-task.mjs с проверенными аргументами. */
        async function createTask() {
          if (!root || newTaskBusy) return;
          setNewTaskBusy(true);
          setNewTaskNote(null);
          try {
            const response = await fetch(BASE + "/api/new-task", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({
                root: root,
                confirm: true,
                id: newTaskId,
                title: newTaskTitle,
                risk: newTaskRisk,
              }),
            });
            const data = await readJson(response);
            if (data.ok === true) {
              setNewTaskNote({ ok: true, text: "Задание " + newTaskId + " создано: " + (data.stdout || "").trim(), log: "" });
              setNewTaskId("");
              setNewTaskTitle("");
              setNewTaskOpen(false);
              await load(root, true);
            } else {
              setNewTaskNote({ ok: false, text: data.error || "new-task завершился с ошибкой", log: data.stdout || data.stderr || "" });
            }
          } catch (failure) {
            setNewTaskNote({ ok: false, text: errorText(failure), log: "" });
          } finally {
            setNewTaskBusy(false);
          }
        }

        /*
         * Первая из двух записей панели: guard.enabled для текущего пространства.
         * Подтверждение обязательно — включение меняет то, что происходит с
         * git commit и git push в этом репозитории. Журнал guard.log фиксирует
         * оба перехода.
         */
        async function setGuard(enabled) {
          if (!root || guardBusy) return;
          const question = enabled
            ? "Включить проверку коммитов для этого пространства?\n\n"
              + "Коммит или пуш с изменением вне активного задания будет отклонён. "
              + "Осознанный обход — метка [workflow-bypass: причина] в сообщении коммита "
              + "(её видно в аудите) или --no-verify (следа не остаётся)."
            : "Выключить проверку коммитов для этого пространства?\n\n"
              + "Коммиты и пуши снова проходят без активного задания. "
              + "Включение и выключение записываются в guard.log.";
          if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(question)) return;
          setGuardBusy(true);
          setError(null);
          setGuardNote(null);
          try {
            const response = await fetch(BASE + "/api/guard", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ root: root, enabled: enabled }),
            });
            const data = await readJson(response);
            const head = enabled ? "Проверка коммитов включена." : "Проверка коммитов выключена.";
            const tail = data.changed === false ? " Значение уже было таким — конфигурация не менялась." : "";
            const logNote = data.logPath ? " Строка добавлена в " + data.logPath + "." : "";
            setGuardNote(head + tail + logNote);
            setPolicy(await apiGet("/api/policy", root));
          } catch (failure) {
            setError(errorText(failure));
          } finally {
            setGuardBusy(false);
          }
        }

        /*
         * 0.7.0: развёртывание движка в это же пространство.
         *
         * Корень — только свой: показанный репозиторий, иначе текущий workspace,
         * иначе корень по умолчанию. Произвольный путь клиент не присылает, и
         * сервер всё равно сверяет его с runtime.roots (selectRoot).
         */
        function deployTarget() {
          if (root) return root;
          if (currentWorkspace && currentWorkspace.path) return currentWorkspace.path;
          if (status && status.root) return status.root;
          return null;
        }

        function deployConfirmation(target) {
          return [
            "Развернуть workflow в этом пространстве?",
            "",
            target,
            "",
            "Будут созданы:",
            ...DEPLOY_CHANGES.map((line) => "— " + line),
            "",
            "Ключ приёмщика создаётся в .wf-keys/ этого проекта. Глобальный ~/.wf-keys не трогается и не перезаписывается.",
            "",
            "Если это не git-репозиторий, сначала выполнится git init: ворота и хуки требуют git.",
            "",
            "Это вторая из двух записей панели (первая — guard.enabled); отменить её из панели нельзя. Продолжить?",
          ].join("\n");
        }

        async function deployWorkflowHere() {
          const target = deployTarget();
          if (!target || deployBusy) return;
          const question = deployConfirmation(target);
          if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(question)) return;
          setDeployBusy(true);
          setDeployNote(null);
          setError(null);
          try {
            const response = await fetch(BASE + DEPLOY_ROUTE, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              /*
               * 2.6.14 (0039): initGit — шаг git init для не-git воркспейса.
               * Сервер без флага по-прежнему отвечает not-a-repo.
               */
              body: JSON.stringify({ root: target, confirm: true, initGit: true }),
            });
            /*
             * Ответ читаем сами: у отказа (400) в теле code и хвост лога, а
             * readJson превратил бы их в одну строку ошибки.
             */
            const text = await response.text();
            let data = {};
            try {
              data = text.length > 0 ? JSON.parse(text) : {};
            } catch {
              data = { error: "ответ не JSON: HTTP " + response.status };
            }
            /* 0.9.0: внешний движок — 409 engine-external с подсказкой карты. */
            if (data.code === EXTERNAL_ENGINE_CODE) {
              setDeployNote({
                kind: "error",
                code: data.code,
                text: data.hint || data.error || "движок внешний: этот воркспейс не меняется",
                log: data.log || "",
              });
              return;
            }
            if (!response.ok || data.ok !== true) {
              setDeployNote({
                kind: "error",
                code: data.code || "http-" + response.status,
                text: data.error || "развёртывание не выполнено: HTTP " + response.status,
                log: data.log || "",
              });
              return;
            }
            setDeployNote({
              kind: "ok",
              code: null,
              text: "Workflow развёрнут: версия " + fmt(data.version) + ". Панель перечитала состояние.",
              log: "",
            });
            /* Перечитываем состояние: пустое состояние сменяется доской. */
            await load(target, true);
          } catch (failure) {
            setDeployNote({ kind: "error", code: "network", text: errorText(failure), log: "" });
          } finally {
            setDeployBusy(false);
          }
        }

        /*
         * 0.9.3 (0039): «Подключить существующий» — список зарегистрированных
         * воркспейсов, где движок реально есть (сервер отдаёт path и version).
         */
        async function openCandidates() {
          if (linkOpen) {
            setLinkOpen(false);
            setLinkNote(null);
            return;
          }
          setLinkOpen(true);
          setLinkNote(null);
          const target = deployTarget();
          if (!target || candidatesBusy) return;
          setCandidatesBusy(true);
          try {
            const data = await apiGet(ENGINE_CANDIDATES_ROUTE, target);
            setCandidates(Array.isArray(data && data.candidates) ? data.candidates : []);
          } catch (failure) {
            setCandidates([]);
            setLinkNote({ kind: "error", text: errorText(failure) });
          } finally {
            setCandidatesBusy(false);
          }
        }

        /*
         * Связь — только по подтверждению: POST /api/engine-link с confirm: true.
         * Конфиг профиля сильнее кнопки: 409 engine-config, карта не меняется.
         */
        async function linkEngine(candidate) {
          const target = deployTarget();
          if (!target || !candidate || !candidate.path || linkBusy) return;
          const versionText = engineVersionText({ version: candidate.version });
          const question = [
            "Подключить движок из другого репозитория?",
            "",
            "Воркспейс: " + target,
            "Движок: " + candidate.path + " (" + versionText + ")",
            "",
            "Это пространство не изменится: панель запишет только связь в карте движков.",
            "Если движок объявлен конфигом профиля, кнопка его не подменяет — сервер ответит 409.",
            "",
            "Продолжить?",
          ].join("\n");
          if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(question)) return;
          setLinkBusy(true);
          setLinkNote(null);
          setError(null);
          try {
            const response = await fetch(BASE + ENGINE_LINK_ROUTE, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ root: target, engine: candidate.path, confirm: true }),
            });
            const bodyText = await response.text();
            let data = {};
            try {
              data = bodyText.length > 0 ? JSON.parse(bodyText) : {};
            } catch {
              data = { error: "ответ не JSON: HTTP " + response.status };
            }
            if (data.code === "engine-config") {
              setLinkNote({
                kind: "error",
                code: data.code,
                text: data.hint || data.error || "связь задана конфигом профиля",
              });
              return;
            }
            if (!response.ok || data.ok !== true) {
              setLinkNote({
                kind: "error",
                code: data.code || "http-" + response.status,
                text: data.error || "связь не записана: HTTP " + response.status,
              });
              return;
            }
            setLinkNote({
              kind: "ok",
              code: null,
              text: "Движок подключён: " + (data.engine && data.engine.root ? data.engine.root : candidate.path)
                + ". Панель перечитала состояние.",
            });
            setLinkOpen(false);
            /* Перечитываем состояние: карточка называет новый источник. */
            await load(target, true);
          } catch (failure) {
            setLinkNote({ kind: "error", code: "network", text: errorText(failure) });
          } finally {
            setLinkBusy(false);
          }
        }

