    /* ------------------------------------------------------------------ *
     * helpers
     * ------------------------------------------------------------------ */

    function errorText(error) {
      return error && error.message ? error.message : String(error);
    }

    /*
     * Хвост вывода для отказа: init печатает десятки строк, а панель показывает
     * последнее — по нему видно, на каком файле или ключе развёртывание встало.
     */
    function tailText(text, limit) {
      const value = String(text || "");
      if (value.length <= limit) return value;
      return "…\n" + value.slice(value.length - limit);
    }

    async function readJson(response) {
      const text = await response.text();
      let data = null;
      try {
        data = text.length > 0 ? JSON.parse(text) : {};
      } catch {
        data = null;
      }
      if (!response.ok) {
        throw new Error((data && data.error) || "Запрос не выполнен: HTTP " + response.status);
      }
      return data || {};
    }

    function apiGet(path, root) {
      const query = root ? "?root=" + encodeURIComponent(root) : "";
      return fetch(BASE + path + query, { headers: { Accept: "application/json" } }).then(readJson);
    }

    function fmt(value) {
      return value === null || value === undefined || value === "" ? "—" : String(value);
    }

    function fmtBool(value) {
      if (value === true) return "да";
      if (value === false) return "нет";
      return "—";
    }

    function fmtDate(value) {
      if (!value) return "—";
      return String(value).replace("T", " ").replace(/\.\d+Z$/, "Z");
    }

    function fmtIssuer(value) {
      if (!value || typeof value !== "object") return "—";
      const parts = [value.kind, value.session, value.model].filter(Boolean);
      return parts.length ? parts.join(" / ") : "—";
    }

    function stageLabel(code) {
      const stage = STAGE_BY_CODE[code];
      return stage ? stage.title : code;
    }

    function plural(count, one, few, many) {
      const value = Math.abs(Number(count) || 0);
      const mod10 = value % 10;
      const mod100 = value % 100;
      if (mod10 === 1 && mod100 !== 11) return one;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
      return many;
    }

    function taskNext(task) {
      const stage = STAGE_BY_CODE[task.stage];
      if (task.stage === "accepted") {
        if (task.record && task.record.releaseReady === false) {
          return "Принято, но выпуск закрыт: разберите замечания и assumed-решения.";
        }
        if (task.record && task.record.releaseReady === true) {
          return "Задача принята; выпуск разрешён по политике репозитория.";
        }
        return "Запись старого формата: проверьте releaseReady в записи приёмки.";
      }
      if (task.stage === "remarks") {
        return "Разобрать замечания и подтвердить решения — после этого releaseReady станет true.";
      }
      return stage ? stage.next : "";
    }

    function sameFsPath(left, right) {
      const normalize = (value) => String(value || "").replace(/[\\/]+$/u, "").toLowerCase();
      return normalize(left) === normalize(right);
    }

    function rootLabel(value) {
      const parts = String(value || "").split(/[\\/]/).filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : String(value || "");
    }

    /** Current workspace from the DSH client service, or null. */
    function workspaceInfo(service) {
      if (!service) return null;
      try {
        const sessions = service.sessions && service.sessions.list && service.sessions.list.getSnapshot();
        const workspaces = service.workspaces && service.workspaces.list && service.workspaces.list.getSnapshot();
        if (!sessions || !workspaces) return null;
        let sessionId = service.mainReference && service.mainReference.sessionId;
        if (!sessionId) {
          const active = Object.values(sessions.byId || {}).find(
            (session) => session && session.retainedBy && (session.retainedBy.mainView || 0) > 0,
          );
          sessionId = active && active.id;
        }
        const workspace = (workspaces.items || []).find(
          (item) => item && Array.isArray(item.sessionIds) && sessionId && item.sessionIds.includes(sessionId),
        );
        if (!workspace || typeof workspace.path !== "string" || workspace.path.length === 0) return null;
        return {
          path: workspace.path,
          title: workspace.title || rootLabel(workspace.path),
          id: workspace.workspaceId || null,
        };
      } catch {
        return null;
      }
    }

    /**
     * Компактная плашка. Подсказка — нативный title плюс aria-label (WC-1).
     * focusable=false — для плашек внутри кнопки-карточки: фокусируемое внутри
     * кнопки ломает клавиатуру, поэтому сводка уходит в aria-label самой кнопки.
     */
    function badge(text, color, title, focusable = true) {
      const hint = title || null;
      return h(
        "span",
        {
          style: Object.assign(
            {},
            S.badge,
            color ? { color, borderColor: color } : null,
            hint ? { cursor: "help" } : null,
          ),
          /*
           * 0098 (WC-2): title остаётся (наведение на десктопе и совместимость WC-1),
           * data-tip показывает ту же подсказку на :focus — тап на тач-экране и Tab.
           */
          title: hint,
          "data-tip": hint || undefined,
          "aria-label": hint || String(text),
          tabIndex: focusable && hint ? 0 : undefined,
        },
        text,
      );
    }

    /*
     * 0098 (WC-2): нативный title не показывается на фокусе и на тапе. CSS-подсказка
     * по data-tip работает на hover, на :focus (тап по плашке) и с клавиатуры
     * (Tab). Плашка фокусируема только когда есть подсказка — см. badge().
     */
    const TOOLTIP_CSS = [
      '[data-tip]{position:relative}',
      '[data-tip]:focus::after{content:attr(data-tip);position:absolute;left:0;top:100%;',
      'margin-top:4px;z-index:60;max-width:320px;white-space:normal;padding:6px 8px;border-radius:6px;',
      'background:#1f2430;color:#fff;font-size:12px;line-height:1.35;box-shadow:0 4px 14px rgba(0,0,0,.25);pointer-events:none}',
      '[data-tip]:focus-visible{outline:2px solid #6b8afd;outline-offset:2px}',
    ].join('');

    function dot(color) {
      return h("span", { style: Object.assign({}, S.dot, { background: color }) });
    }

    function chips(values) {
      if (!Array.isArray(values) || values.length === 0) return h("span", { style: S.kvValue }, "—");
      return h(
        "span",
        { style: S.chips },
        values.map((value, index) => h("span", { key: index, style: S.chip }, String(value))),
      );
    }

    function isElement(value) {
      if (value === null || typeof value !== "object") return false;
      if (typeof React.isValidElement === "function") return React.isValidElement(value);
      return Boolean(value.$$typeof);
    }

    /** Render a scalar or pass a React element through untouched. */
    function display(value) {
      if (value === null || value === undefined || value === "") return "—";
      if (isElement(value)) return value;
      return String(value);
    }

    function kvGrid(rows) {
      return h(
        "div",
        { style: S.kvGrid },
        rows.map((row, index) => h(
          "div",
          { key: index, style: S.kv },
          h("span", { style: S.kvLabel }, row[0]),
          h("span", { style: S.kvValue }, display(row[1])),
        )),
      );
    }

    function section(title, body) {
      return h("section", { key: title, style: S.section }, h("h3", { style: S.sectionTitle }, title), body);
    }

    function table(headers, rows) {
      return h(
        "table",
        { style: S.table },
        h("thead", null, h("tr", null, headers.map((header, index) => h("th", { key: index, style: S.th }, header)))),
        h(
          "tbody",
          null,
          rows.length === 0
            ? h("tr", null, h("td", { colSpan: headers.length, style: Object.assign({}, S.td, { color: T.tertiary }) }, "—"))
            : rows.map((row, index) => h(
                "tr",
                { key: index },
                row.map((cell, cellIndex) => h("td", { key: cellIndex, style: S.td }, display(cell))),
              )),
        ),
      );
    }

    function flagRow(flag, index) {
      const color = flag.severity === "error" ? T.danger : flag.severity === "warn" ? T.warn : T.tertiary;
      return h(
        "div",
        { key: flag.code + index, style: S.flagRow },
        h("span", { style: Object.assign({}, S.dot, { background: color, marginTop: "6px" }) }),
        h(
          "span",
          {
            style: S.flagCode,
            title: flag.message || flag.code,
            "aria-label": "Флаг " + flag.code + ": " + (flag.message || ""),
            tabIndex: 0,
          },
          flag.code,
        ),
        h("span", { style: S.flagText }, flag.message),
      );
    }

