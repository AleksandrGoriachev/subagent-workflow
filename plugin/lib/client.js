/**
 * dsh-workflow-console client half (classic browser module).
 *
 * Registered through the DSH module loader as a conversation view: a board of
 * workflow tasks, a task card and the policy page. Read-mostly: POST routes are
 * the read-only gates of /api/run, the guard flag (/api/guard) and one explicit
 * deployment of the engine into the open workspace (/api/deploy, only with
 * confirm: true) — the panel's two writes, both behind a confirmation.
 *
 * Kept as plain classic JS on purpose — DSH serves lib/client.js directly and
 * third-party plugin clients have no bundler (same approach as dsh-llm-memory).
 */
window.__ModuleLoader__.load({
  id: "dsh-workflow-console",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;

    const BASE = "/workflow";
    const VIEW_ID = "workflow";
    const VIEW_LABEL = "Workflow";
    const ORDER = 40;

    /*
     * 0.7.0: развёртывание движка. Кнопка ставит вложенную в tarball спеку в
     * открытое пространство; корень выбирает сервер (selectRoot), поэтому
     * клиент не может «развернуть в чужой проект».
     *
     * 0.7.1: ключ приёмщика создаётся В ПРОЕКТЕ (<repo>/.wf-keys/), каталог
     * попадает в .gitignore. Глобальный %USERPROFILE%\.wf-keys не трогается —
     * подтверждение говорит это прямо, до записи.
     */
    const DEPLOY_LABEL = "Развернуть workflow здесь";
    const DEPLOY_ROUTE = "/api/deploy";
    /* Что именно появится в проекте: этот список показывает подтверждение. */
    const DEPLOY_CHANGES = [
      "docs/subagent-workflow/ — движок, ворота, шаблоны, хуки и публичный ключ приёмщика;",
      "docs/tasks/ — каталог заданий (пустой, если его ещё нет);",
      ".wf-keys/ — приватный ключ приёмщика этого проекта (каталог в .gitignore);",
      ".gitignore — строки журналов прогонов, guard.log и .wf-keys/;",
      "git config core.hooksPath = docs/subagent-workflow/hooks (локально, не глобально).",
    ];

    const STAGES = [
      {
        code: "contract",
        title: "Контракт",
        color: "link",
        description: "Задание и критерии приёмки готовы, но контракт ещё не зафиксирован хешами.",
        next: "Зафиксировать контракт (замок) и доказать красный прогон.",
      },
      {
        code: "attack",
        title: "Атака задания",
        color: "warn",
        description: "Критик ищет пропущенные случаи и неоднозначные критерии. Blocking-находка без решения не даёт запереть контракт; шаг включается policy.attack.",
        next: "Провести атаку и закрыть blocking-находки.",
      },
      {
        code: "lock",
        title: "Замок контракта",
        color: "secondary",
        description: "Хеши задания, критериев и защищённых файлов записаны в criteria.lock. Критерии заморожены.",
        next: "Прогнать проверки на исходном коде — красный прогон.",
      },
      {
        code: "red",
        title: "Красный прогон",
        color: "danger",
        description: "Проверки падают на исходном коде по ожиданию задания: задача действительно что-то исправляет.",
        next: "Исправить код и прогнать проверки на кандидате.",
      },
      {
        code: "green",
        title: "Зелёный прогон",
        color: "success",
        description: "Проверки проходят на кандидате, границы и секреты чистые. Не хватает записи о приёмке.",
        next: "Принять задачу из отдельной сессии.",
      },
      {
        code: "accepted",
        title: "Принято",
        color: "business",
        description: "Есть подписанная запись приёмщика из другой сессии.",
        next: "Проверить releaseReady: если false — выпуск закрыт.",
      },
      {
        code: "remarks",
        title: "Замечания",
        color: "warn",
        description: "Запись есть, но releaseReady=false: остались assumed-решения или неразобранные замечания.",
        next: "Разобрать замечания и подтвердить решения.",
      },
      {
        code: "incomplete",
        title: "Неполный",
        color: "tertiary",
        description: "Не читаются task.md или criteria.json — стадию определить нельзя.",
        next: "Проверить контрактные файлы задачи.",
      },
    ];

    const STAGE_BY_CODE = {};
    for (const stage of STAGES) STAGE_BY_CODE[stage.code] = stage;

    const T = {
      text: "var(--dsw-alias-label-primary, inherit)",
      secondary: "var(--dsw-alias-label-secondary, rgba(127,127,127,0.95))",
      tertiary: "var(--dsw-alias-label-tertiary, rgba(127,127,127,0.78))",
      caption: "var(--dsw-alias-label-caption, rgba(127,127,127,0.62))",
      bg1: "var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06))",
      bg2: "var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))",
      bg3: "var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.14))",
      border1: "var(--dsw-alias-border-l1, rgba(127,127,127,0.24))",
      border2: "var(--dsw-alias-border-l2, rgba(127,127,127,0.36))",
      link: "var(--dsw-alias-link, #4176e6)",
      business: "var(--dsw-alias-state-business-primary, #4176e6)",
      success: "var(--dsw-alias-state-success-primary, #22c55e)",
      warn: "var(--dsw-alias-state-warn-primary, #f59e0b)",
      danger: "var(--dsw-alias-state-error-primary, #ec1313)",
      menu: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-3, rgba(40,40,40,0.98)))",
      code: "var(--dsw-alias-markdown-code-block, rgba(127,127,127,0.12))",
      mono: "var(--dsw-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
    };

    const STAGE_COLOR = {
      contract: T.link,
      attack: T.warn,
      lock: T.secondary,
      red: T.danger,
      green: T.success,
      accepted: T.business,
      remarks: T.warn,
      incomplete: T.tertiary,
    };

    const RISK_COLOR = { low: T.success, medium: T.warn, high: T.danger };

    /* ------------------------------------------------------------------ *
     * подсказки к бейджам (WC-1): нативный title + aria-label, без своих
     * тултипов и зависимостей. Текст — человеческая фраза, не код поля.
     * ------------------------------------------------------------------ */

    const RISK_HINT = {
      low: "Риск задания: низкий. securityReview и humanSignoff не требуются, атака задания — по политике репозитория.",
      medium: "Риск задания: средний. securityReview и humanSignoff не требуются, атака задания — по политике репозитория.",
      high: "Риск задания: высокий. Обязательны securityReview=true, humanSignoff=true и приёмщик-человек (ключ human-*).",
    };

    function riskHint(risk) {
      return RISK_HINT[risk] || "Риск задания: " + fmt(risk) + ".";
    }

    function stageHint(code) {
      const stage = STAGE_BY_CODE[code];
      return stage ? stage.title + " — " + stage.description : "Стадия: " + fmt(code) + ".";
    }

    const ERROR_HINT = "Блокирующие замечания. Список — в карточке задачи, раздел «Флаги»; приёмка или выпуск могут быть закрыты.";
    const WARNING_HINT = "Некритичные предупреждения: assumed-решения, старые версии замка или записи, непокрытые файлы. Не блокируют, но видны в карточке.";
    const ASSUMED_HINT = "Решения без доказательства: нет ни исполнимого критерия, ни подтверждения человека. Пока такие есть, releaseReady=false.";
    const ATTACK_HINT = "Атака задания: есть blocking-находки без решения. Контракт не запирается, пока они не закрыты.";
const EFFECT_HINT = "Эффект решения (I-34): у решения с impact user-visible его доказательство должно ссылаться на критерий-носитель эффекта или на его измеритель. Проблема — в карточке, раздел «Доказательство и эффект».";
const REGRESS_HINT = "Регресс-долг из regress.baseline.json: задание записано туда при приёмке. Панель только читает файл — сам регресс запускают ворота.";
    const MANUAL_HINT = "Ручная проверка: критерий подтверждает человек, команды у него нет.";
    const NO_RESOLUTION_HINT = "Находка без решения: пока она не закрыта, контракт не запирается.";
    const BLOCKING_HINT = "Blocking: находка закрывает замок контракта, пока у неё нет resolution.";
    const FOLLOW_UP_HINT = "Follow-up: не блокирует, но требует отдельного решения.";
    const NO_MODEL_HINT = "У роли не задана модель: проверить семейство и запустить роль нечем.";

    /**
     * Диагностика (v2, шаг 1): панель запускает скрипт ворот и показывает лог.
     * Только чтение — команда ничего не пишет, не подписывает и не принимает.
     */
    const CHECK_HINT = {
      doctor: "Проверим, всё ли готово к работе: ворота на месте, ключ приёмки заведён, политика не ослаблена. Ничего не меняет и никаких задач не запускает — только читает.",
      lint: "Проверить задание: контракт и критерии против правил ворот. Только чтение.",
      "check-acceptance": "Проверить запись о приёмке: подпись и полнота. Только чтение.",
    };

    /* Как действия называются для человека; id проверки остаётся внутренним. */
    const RUN_LABELS = {
      doctor: "Проверить настройку",
      lint: "Проверить задание",
      "check-acceptance": "Проверить запись",
    };

    function coverageHint(count) {
      return "Изменённых файлов без покрытия: " + fmt(count) + ". Список — в карточке, coverage.uncovered.";
    }

    function decisionStatusHint(item) {
      if (item.assumed) return ASSUMED_HINT;
      if (item.status === "confirmed") return "Решение подтверждено: есть исполнимый критерий или подтверждение человека.";
      return "Статус решения в реестре: " + fmt(item.status) + ".";
    }

    function policyHint(value) {
      if (value === "fail") return "fail — запрещать: нарушение правила останавливает ворота.";
      if (value === "warn") return "warn — предупреждать: видно в отчёте, но ворота не останавливает.";
      if (value === "off") return "off — не проверять: правило выключено в workflow.config.json.";
      return "Значение политики: " + fmt(value) + ".";
    }

    function effectHint(effects) {
      /* На доске unlinked — число, в карточке — список решений. */
      const unlinkedText = Array.isArray(effects.unlinked)
        ? effects.unlinked.map((item) => item.decision + "→" + item.ref).join(", ")
        : "без связи: " + (Number(effects.unlinked) || 0);
      const text = {
        missing: "решение с impact user-visible/public-contract требует эффекта, но ни один критерий его не объявляет",
        invalid: "объявление effect некорректно: " + (Array.isArray(effects.issues) ? effects.issues.join("; ") : "смотрите карточку"),
        unlinked: "решение ссылается мимо цепи эффекта: " + unlinkedText,
        mismatch: "ворота записали несогласованность эффекта решения",
      }[effects.status] || "состояние эффекта: " + fmt(effects.status);
      /* 0.4.1: при decisions=off флаг не поднимается — говорим это словами. */
      const policyNote = "severity" in effects && !effects.severity
        ? " Политика decisions=off — панель флаг не поднимает."
        : "";
      return EFFECT_HINT + " Сейчас: " + text + "." + policyNote;
    }

    /* 0.4.1: цвет бейджа «эффект» — строгость флага effect-problem, не статус. */
    function effectSeverityColor(severity) {
      if (severity === "error") return T.danger;
      if (severity === "warn") return T.warn;
      return T.tertiary;
    }

    function regressHint(entry) {
      const parts = ["статус " + fmt(entry.status)];
      if (entry.reviewBy) parts.push("пересмотр до " + entry.reviewBy + (entry.expired ? " — срок истёк" : ""));
      if (entry.since) parts.push("с " + entry.since);
      if (entry.reason) parts.push(entry.reason);
      return REGRESS_HINT + " " + parts.join("; ") + ".";
    }

    function cardAriaLabel(task) {
      const parts = ["Задача " + task.id];
      if (task.title) parts.push(task.title);
      parts.push("стадия: " + stageLabel(task.stage));
      if (task.risk) parts.push("риск " + task.risk);
      if (task.errors > 0) parts.push("блокирующих " + task.errors);
      if (task.warnings > 0) parts.push("предупреждений " + task.warnings);
      /*
       * 0.4.1: бейджи внутри кнопки-карточки не фокусируются, поэтому их
       * подсказки (эффект и регресс) попадают в aria-label самой кнопки.
       */
      if (task.effects && task.effects.status !== "none" && task.effects.status !== "ok") {
        parts.push(effectHint(task.effects));
      }
      if (task.regress) parts.push(regressHint(task.regress));
      return parts.join(", ") + ". Открыть карточку.";
    }

    const S = {
      root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: "420px",
        overflow: "hidden",
        color: T.text,
        font: "inherit",
        background: "transparent",
      },
      header: {
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        alignItems: "center",
        padding: "10px 12px",
        borderBottom: "1px solid " + T.border1,
        flex: "0 0 auto",
      },
      title: { margin: 0, fontSize: "15px", fontWeight: "600" },
      subtitle: { fontSize: "11px", color: T.tertiary, marginLeft: "4px" },
      spacer: { flex: "1 1 auto" },
      input: {
        background: T.bg1,
        color: T.text,
        border: "1px solid " + T.border2,
        borderRadius: "6px",
        padding: "5px 8px",
        fontSize: "12px",
        minWidth: "180px",
        maxWidth: "520px",
        font: "inherit",
      },
      option: { background: T.menu, color: T.text },
      button: {
        background: "transparent",
        color: T.text,
        border: "1px solid " + T.border2,
        borderRadius: "6px",
        padding: "5px 10px",
        fontSize: "12px",
        cursor: "pointer",
        font: "inherit",
      },
      buttonDisabled: { opacity: 0.55, cursor: "default" },
      tabs: {
        display: "flex",
        gap: "2px",
        padding: "6px 8px 0",
        borderBottom: "1px solid " + T.border1,
        flex: "0 0 auto",
      },
      tab: {
        background: "transparent",
        color: T.secondary,
        border: "1px solid transparent",
        borderBottom: "none",
        borderRadius: "8px 8px 0 0",
        padding: "6px 12px",
        fontSize: "12px",
        cursor: "pointer",
        font: "inherit",
      },
      tabActive: {
        background: T.bg2,
        color: T.text,
        border: "1px solid " + T.border1,
        borderBottom: "none",
        borderRadius: "8px 8px 0 0",
        padding: "6px 12px",
        fontSize: "12px",
        cursor: "pointer",
        font: "inherit",
      },
      content: { flex: "1 1 auto", overflow: "auto", padding: "12px" },
      error: {
        margin: "0 0 10px",
        padding: "8px 10px",
        border: "1px solid " + T.danger,
        borderRadius: "6px",
        color: T.danger,
        fontSize: "12px",
        whiteSpace: "pre-wrap",
      },
      hint: {
        margin: "0 0 10px",
        padding: "8px 10px",
        border: "1px solid " + T.border1,
        borderRadius: "6px",
        background: T.bg1,
        color: T.secondary,
        fontSize: "12px",
        whiteSpace: "pre-wrap",
      },
      board: { display: "flex", gap: "10px", alignItems: "flex-start", minHeight: "200px" },
      column: {
        flex: "0 0 252px",
        maxWidth: "252px",
        background: T.bg1,
        border: "1px solid " + T.border1,
        borderRadius: "8px",
        padding: "8px",
      },
      columnTitle: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: "600", marginBottom: "6px" },
      columnDot: { width: "8px", height: "8px", borderRadius: "50%", display: "inline-block" },
      count: { color: T.tertiary, fontWeight: "400", marginLeft: "auto" },
      card: {
        display: "block",
        width: "100%",
        textAlign: "left",
        background: T.bg2,
        color: T.text,
        border: "1px solid " + T.border1,
        borderRadius: "6px",
        padding: "7px 8px",
        marginBottom: "6px",
        cursor: "pointer",
        font: "inherit",
      },
      cardId: { fontSize: "11px", color: T.tertiary, fontFamily: T.mono },
      cardTitle: { display: "block", fontSize: "12px", margin: "2px 0 4px", lineHeight: "1.35" },
      cardMeta: { display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" },
      badge: {
        display: "inline-block",
        border: "1px solid " + T.border2,
        borderRadius: "999px",
        padding: "0 6px",
        fontSize: "10px",
        lineHeight: "16px",
        whiteSpace: "nowrap",
      },
      dot: { width: "6px", height: "6px", borderRadius: "50%", display: "inline-block" },
      section: {
        border: "1px solid " + T.border1,
        borderRadius: "8px",
        padding: "10px",
        marginBottom: "10px",
        background: T.bg1,
      },
      sectionTitle: { margin: "0 0 8px", fontSize: "13px", fontWeight: "600" },
      kvGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "4px 14px" },
      kv: { display: "flex", gap: "8px", fontSize: "12px", lineHeight: "18px" },
      kvLabel: { color: T.tertiary, minWidth: "110px", flex: "0 0 auto" },
      kvValue: { color: T.text, wordBreak: "break-word", flex: "1 1 auto" },
      mono: { fontFamily: T.mono, fontSize: "11px" },
      chips: { display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" },
      chip: {
        border: "1px solid " + T.border1,
        borderRadius: "4px",
        padding: "0 5px",
        fontSize: "10px",
        lineHeight: "16px",
        background: T.bg2,
        fontFamily: T.mono,
        wordBreak: "break-all",
      },
      table: { width: "100%", borderCollapse: "collapse", fontSize: "12px" },
      th: {
        textAlign: "left",
        fontWeight: "600",
        color: T.secondary,
        borderBottom: "1px solid " + T.border1,
        padding: "4px 6px",
        whiteSpace: "nowrap",
      },
      td: { borderBottom: "1px solid " + T.border1, padding: "4px 6px", verticalAlign: "top" },
      flagRow: { display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", padding: "3px 0" },
      flagCode: { fontFamily: T.mono, fontSize: "10px", color: T.tertiary, minWidth: "150px", flex: "0 0 auto" },
      flagText: { flex: "1 1 auto", whiteSpace: "pre-wrap" },
      pre: {
        margin: "6px 0 0",
        padding: "8px",
        background: T.code,
        borderRadius: "6px",
        fontFamily: T.mono,
        fontSize: "11px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      },
      empty: { color: T.tertiary, fontSize: "12px", padding: "12px 0" },
      back: { marginBottom: "8px" },
      cardHead: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "baseline", marginBottom: "10px" },
      cardHeadTitle: { margin: 0, fontSize: "16px" },
      list: { margin: "4px 0 0", paddingLeft: "18px", fontSize: "12px", lineHeight: "18px" },
      summary: { display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "baseline", fontSize: "12px", marginBottom: "6px" },
      summaryStrong: { fontSize: "13px", fontWeight: "600" },
      summaryMuted: { color: T.secondary },
      legend: {
        border: "1px solid " + T.border1,
        borderRadius: "8px",
        background: T.bg1,
        padding: "8px 10px",
        margin: "8px 0",
      },
      legendSummary: { cursor: "pointer", fontSize: "12px", fontWeight: "600", color: T.text },
      legendGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "6px 16px",
        marginTop: "8px",
      },
      legendItem: { display: "flex", gap: "6px", alignItems: "baseline", fontSize: "12px", lineHeight: "17px" },
      legendTitle: { fontWeight: "600", flex: "0 0 auto" },
      legendText: { color: T.secondary, flex: "1 1 auto" },
      pathLine: { display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline", fontSize: "12px", margin: "6px 0", color: T.secondary },
      pathLabel: { color: T.tertiary },
      pathItem: { whiteSpace: "nowrap" },
      pathNotes: { fontSize: "11px", color: T.secondary, lineHeight: "16px", margin: "2px 0 6px" },
      toggle: { display: "inline-flex", gap: "6px", alignItems: "center", fontSize: "12px", color: T.secondary, cursor: "pointer", margin: "4px 0 10px" },
      columnDim: { opacity: 0.55 },
      stageBox: {
        border: "1px solid " + T.border1,
        borderLeft: "3px solid " + T.business,
        borderRadius: "8px",
        background: T.bg1,
        padding: "8px 10px",
        marginBottom: "10px",
      },
      stageBoxTitle: { fontSize: "12px", fontWeight: "600", marginBottom: "2px" },
      stageText: { fontSize: "12px", color: T.secondary, lineHeight: "17px" },
      stageNext: { fontSize: "12px", color: T.text, marginTop: "4px" },
      location: {
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 8px",
        fontSize: "11px",
        color: T.secondary,
        padding: "5px 8px",
        background: T.bg1,
        border: "1px solid " + T.border1,
        borderRadius: "6px",
        marginBottom: "8px",
      },
      locationWarn: {
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 8px",
        fontSize: "11px",
        color: T.warn,
        padding: "5px 8px",
        background: T.bg1,
        border: "1px solid " + T.warn,
        borderRadius: "6px",
        marginBottom: "8px",
      },
      locationSep: { color: T.tertiary },
      compatBanner: {
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        alignItems: "center",
        justifyContent: "space-between",
        border: "1px solid " + T.warn,
        borderRadius: "8px",
        background: T.bg1,
        padding: "8px 10px",
        marginBottom: "10px",
      },
      compatBannerText: { fontSize: "12px", color: T.text, lineHeight: "17px", flex: "1 1 420px" },
      actions: { display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "8px" },
      runBox: {
        border: "1px solid " + T.border1,
        borderRadius: "8px",
        background: T.bg1,
        padding: "8px 10px",
        marginBottom: "10px",
      },
      runHead: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "6px" },
      runStatus: {
        border: "1px solid",
        borderRadius: "999px",
        padding: "1px 8px",
        fontSize: "11px",
        fontWeight: "600",
        whiteSpace: "nowrap",
      },
      runTitle: { fontSize: "12px", fontWeight: "600" },
      runMeta: { fontSize: "11px", color: T.tertiary },
      runCommand: {
        fontFamily: T.mono,
        fontSize: "11px",
        color: T.secondary,
        wordBreak: "break-all",
        marginBottom: "6px",
      },
      runLog: {
        margin: 0,
        maxHeight: "260px",
        overflow: "auto",
        background: T.code,
        borderRadius: "6px",
        padding: "8px",
        fontFamily: T.mono,
        fontSize: "11px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      },
    };

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
          title: hint,
          "aria-label": hint || String(text),
          tabIndex: focusable && hint ? 0 : undefined,
        },
        text,
      );
    }

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
        const [tab, setTab] = React.useState("board");
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
              body: JSON.stringify({ root: target, confirm: true }),
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
          ? "Workflow · v" + status.plugin.version
          : "Workflow";

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
            h("h1", { style: S.title }, "Workflow"),
            h("span", { style: S.subtitle }, title),
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
                title: "Перечитать артефакты; ничего не запускается и не пишется",
              },
              busy ? "Чтение…" : "Обновить",
            ),
          );
        }

        function renderTabs() {
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
          return h("div", { style: S.tabs }, boardTab, policyTab, compatTab);
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
            /* Тупик «workflow не развёрнут»: кнопка ставит движок здесь же. */
            return h("div", null, empty, renderDeploy());
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

        function renderFlags(flags) {
          if (!flags || flags.length === 0) return h("div", { style: S.empty }, "Флагов нет.");
          return h("div", null, flags.map(flagRow));
        }

        function renderContract(contract) {
          if (!contract) return h("div", { style: S.empty }, "Контракт не читается.");
          return h(
            "div",
            null,
            kvGrid([
              ["id", contract.id],
              ["версия", contract.version],
              ["риск", contract.risk],
              ["владелец", contract.owner],
              ["исполнитель", contract.executor],
              ["приёмщик", contract.acceptor],
              ["выдан", fmtIssuer(contract.issuedBy)],
              ["создано", contract.created],
              ["база", contract.base],
              ["securityReview", fmtBool(contract.securityReview)],
              ["humanSignoff", fmtBool(contract.humanSignoff)],
            ]),
            h("div", { style: { marginTop: "8px" } }, h("div", { style: S.kvLabel }, "allowedPaths"), chips(contract.allowedPaths)),
            h("div", { style: { marginTop: "8px" } }, h("div", { style: S.kvLabel }, "protectedPaths"), chips(contract.protectedPaths)),
          );
        }

        function renderDecisions(decisions) {
          if (!decisions || !decisions.items || decisions.items.length === 0) {
            return h("div", { style: S.empty }, "Решений нет (реестр пуст).");
          }
          return h(
            "div",
            null,
            table(
              ["id", "class", "impact", "статус", "доказательство"],
              decisions.items.map((item) => [
                item.id,
                item.class,
                item.impact,
                item.assumed
                  ? badge("assumed", T.warn, ASSUMED_HINT)
                  : badge(item.status || "—", item.status === "confirmed" ? T.success : T.tertiary, decisionStatusHint(item)),
                item.evidenceKind === "executable"
                  ? "критерий " + (item.evidence && item.evidence.ref)
                  : item.evidenceKind === "human"
                    ? "человек" + (item.confirmation && item.confirmation.who ? " (" + item.confirmation.who + ")" : "")
                    : "нет",
              ]),
            ),
            decisions.assumed && decisions.assumed.length
              ? h("div", { style: Object.assign({}, S.hint, { marginTop: "8px" }) }, "assumed: " + decisions.assumed.join(", ") + " — выпуск закрыт до подтверждения.")
              : null,
          );
        }

        function renderCriteria(criteria) {
          if (!criteria || criteria.length === 0) return h("div", { style: S.empty }, "Критериев нет.");
          return table(
            ["id", "критерий", "команда", "covers", "теги"],
            criteria.map((item) => [
              item.id,
              h("span", null, item.title || "—", item.manual ? badge(" manual", T.warn, MANUAL_HINT) : null),
              h("span", { style: S.mono }, item.command || "—"),
              Array.isArray(item.covers) && item.covers.length ? chips(item.covers) : "—",
              Array.isArray(item.tags) && item.tags.length ? item.tags.join(", ") : "—",
            ]),
          );
        }

        function renderCoverage(coverage) {
          if (!coverage) return h("div", { style: S.empty }, "Нет verify.json — покрытие неизвестно.");
          return h(
            "div",
            null,
            kvGrid([
              ["объявлено", coverage.declared],
              ["покрыто", coverage.covered.length],
              ["не покрыто", coverage.uncovered.length],
              ["режим", coverage.mode],
            ]),
            coverage.uncovered.length
              ? h("div", { style: Object.assign({}, S.hint, { marginTop: "8px", color: T.danger }) }, "Без покрытия: " + coverage.uncovered.join(", "))
              : null,
            coverage.covered.length
              ? h("ul", { style: S.list }, coverage.covered.map((item, index) => h("li", { key: index }, item.path + " ← " + item.criterion)))
              : null,
          );
        }

        /*
         * 0.4.1: null — это не «effect нет», а старый/неполный ответ сервера;
         * отсутствие effect называется словами только при declared=0 и status=none.
         * Одна формулировка вместо дубля «не требуется» (kvGrid + строка ниже).
         */
        function renderEffects(effects) {
          if (!effects) {
            return h("div", { style: S.empty }, "Данные об эффекте недоступны: в ответе API нет раздела effects (старый сервер или старая панель).");
          }
          const declared = Array.isArray(effects.declared) ? effects.declared : [];
          const links = Array.isArray(effects.links) ? effects.links : [];
          const unlinked = Array.isArray(effects.unlinked) ? effects.unlinked : [];
          /* 0.4.1: проекция доски присылает unlinked числом — не падаем и показываем его. */
          const unlinkedCount = Array.isArray(effects.unlinked)
            ? effects.unlinked.length
            : Number(effects.unlinked) || 0;
          const statusText = {
            none: "нет ни одного effect — и ни одно решение не требует эффекта",
            ok: "цепь собрана",
            missing: "требуется, но не объявлен",
            invalid: "объявлен неверно",
            unlinked: "решение мимо цепи",
            mismatch: "ворота записали несогласованность",
          }[effects.status] || fmt(effects.status);
          /*
           * 0.4.1: checked=false — проверка не проводилась; «ok» показываем только
           * тогда, когда ворота действительно её провели.
           */
          const proofText = (value) => {
            if (!value) return "—";
            if (!value.checked) return "не проверялось";
            return value.ok ? "ok" : "несогласовано";
          };
          const rows = [
            ["состояние", statusText],
            ["требуется решением", effects.required ? "да" : "нет"],
            ["критериев с effect", declared.length],
            ["связей", links.length],
            ["без связи", unlinkedCount],
            ["verify.json", proofText(effects.verify)],
            ["запись приёмки", proofText(effects.record)],
          ];
          if (effects.status !== "none" && effects.status !== "ok" && effects.severity === null) {
            rows.push(["флаг", "не поднимается: policy decisions=off"]);
          }
          return h(
            "div",
            null,
            kvGrid(rows),
            declared.length
              ? table(
                  ["критерий", "наблюдаемо", "порог", "измеритель"],
                  declared.map((item) => [
                    item.criterion,
                    item.observable || "—",
                    item.threshold || "—",
                    item.measuredBy || "—",
                  ]),
                )
              : null,
            links.length
              ? h(
                  "ul",
                  { style: S.list },
                  links.map((link, index) => h(
                    "li",
                    { key: index },
                    "решение " + link.decision + " → " + link.ref + " (цепь " + link.criterion + "→" + link.measuredBy + ")",
                  )),
                )
              : null,
            unlinked.length
              ? h(
                  "div",
                  { style: Object.assign({}, S.hint, { color: T.danger, marginTop: "8px" }) },
                  "Мимо цепи: " + unlinked.map((item) => item.decision + "→" + item.ref).join(", "),
                )
              : null,
            Array.isArray(effects.issues) && effects.issues.length
              ? h("ul", { style: S.list }, effects.issues.map((message, index) => h("li", { key: index }, message)))
              : null,
          );
        }

        /* 0.4.1: регресс-долг из regress.baseline.json — в карточке, не только бейджем на доске. */
        function renderRegress(entry) {
          if (!entry) return h("div", { style: S.empty }, "В regress.baseline.json записи по этому заданию нет.");
          return h(
            "div",
            null,
            kvGrid([
              ["статус", fmt(entry.status)],
              ["since", entry.since || "—"],
              ["reviewBy", entry.reviewBy ? entry.reviewBy + (entry.expired ? " — срок истёк" : "") : "—"],
              ["reason", entry.reason || "—"],
            ]),
            h("div", { style: S.hint }, REGRESS_HINT),
          );
        }

        function renderAttack(attack) {
          if (!attack) return h("div", { style: S.empty }, "attack.json нет — атака не проводилась.");
          return h(
            "div",
            null,
            kvGrid([
              ["критик", fmtIssuer(attack.critic)],
              ["attestedBy", attack.critic.attestedBy],
              ["находок", attack.summary.total],
              ["blocking", attack.summary.blocking],
              ["без решения", attack.summary.unresolved],
              ["независимость", attack.sameSession ? "та же сессия" : attack.level],
            ]),
            table(
              ["id", "class", "severity", "суть", "решение"],
              attack.findings.map((finding) => [
                finding.id,
                finding.class,
                finding.severity === "blocking"
                  ? badge("blocking", T.danger, BLOCKING_HINT)
                  : badge(
                      finding.severity || "—",
                      finding.severity === "follow-up" ? T.link : T.tertiary,
                      finding.severity === "follow-up" ? FOLLOW_UP_HINT : "Класс находки атаки: " + fmt(finding.severity) + ".",
                    ),
                finding.claim || "—",
                finding.resolution
                  || (finding.severity === "blocking" ? badge("нет решения", T.danger, NO_RESOLUTION_HINT) : "—"),
              ]),
            ),
          );
        }

        function renderRecord(record) {
          if (!record) return h("div", { style: S.empty }, "Записи о приёмке нет.");
          return h(
            "div",
            null,
            kvGrid([
              ["версия", record.version],
              ["статус", record.status],
              ["releaseReady", fmtBool(record.releaseReady)],
              ["keyId", record.keyId],
              ["приёмщик", record.acceptor],
              ["принято", fmtDate(record.acceptedAt)],
              ["actor", record.actor ? [record.actor.kind, record.actor.session, record.actor.model].filter(Boolean).join(" / ") : "—"],
              ["семейство", record.actor ? record.actor.family : "—"],
              ["независимость", record.independence ? record.independence.level + " / " + record.independence.modelLevel : "—"],
              ["подпись", record.signatureAlgorithm || "—"],
              ["кандидат", record.candidateCommit],
              ["контракт", record.contractCommit],
              ["checks", record.checks],
            ]),
            record.legacy
              ? h("div", { style: Object.assign({}, S.hint, { marginTop: "8px" }) }, "Запись старого формата (v" + record.version + "): independence, decisions и attack в ней отсутствуют.")
              : null,
            record.decisions
              ? h("div", { style: Object.assign({}, S.hint, { marginTop: "8px" }) }, "decisions: " + record.decisions.count + " (assumed: " + (record.decisions.assumed.join(", ") || "нет") + ")")
              : null,
            record.attack && record.attack.findings
              ? h("div", { style: Object.assign({}, S.hint, { marginTop: "8px" }) }, "attack: " + record.attack.findings.total + " находок, blocking " + record.attack.findings.blocking + ", без решения " + record.attack.findings.unresolved)
              : null,
            record.review
              ? h(
                  "div",
                  { style: { marginTop: "8px" } },
                  h("div", { style: S.kvLabel }, "review: " + fmt(record.review.decision) + ", releaseReady " + fmtBool(record.review.releaseReady)),
                  record.review.remarks.length
                    ? table(
                        ["id", "class", "решение"],
                        record.review.remarks.map((remark) => [
                          remark.id,
                          remark.class,
                          remark.resolution
                          || remark.reason
                          || (remark.unresolved ? badge("нет решения", T.danger, "Замечание без решения: выпуск закрыт (releaseReady=false).") : "—"),
                        ]),
                      )
                    : null,
                )
              : null,
          );
        }

        function renderGit(git) {
          if (!git || !git.log || git.log.length === 0) {
            return h("div", { style: S.empty }, "git log по каталогу задачи пуст. HEAD: " + fmt(git && git.head));
          }
          return h(
            "div",
            null,
            h("div", { style: S.kv }, h("span", { style: S.kvLabel }, "HEAD"), h("span", { style: S.mono }, fmt(git.head))),
            h(
              "ul",
              { style: S.list },
              git.log.map((item, index) => h("li", { key: index }, h("span", { style: S.mono }, item.hash), " ", item.date, " — ", item.subject)),
            ),
          );
        }

        function renderCard() {
          return h(
            "div",
            null,
            h("button", { type: "button", style: Object.assign({}, S.button, S.back), onClick: () => setCard(null) }, "← Доска"),
            h(
              "div",
              { style: S.actions },
              runButton("lint", card.id),
              runButton("check-acceptance", card.id),
            ),
            h(
              "div",
              { style: S.cardHead },
              h("h2", { style: S.cardHeadTitle }, card.id + " · " + (card.title || "без названия")),
              badge(stageLabel(card.stage), STAGE_COLOR[card.stage], stageHint(card.stage)),
              card.risk ? badge(card.risk, RISK_COLOR[card.risk], riskHint(card.risk)) : null,
              h("span", { style: S.kvLabel }, card.dir),
            ),
            h(
              "div",
              { style: Object.assign({}, S.stageBox, { borderLeftColor: STAGE_COLOR[card.stage] }) },
              h("div", { style: S.stageBoxTitle }, stageLabel(card.stage)),
              h("div", { style: S.stageText }, (STAGE_BY_CODE[card.stage] || {}).description || ""),
              h("div", { style: S.stageNext }, "Что дальше: " + taskNext(card)),
            ),
            section("Флаги", renderFlags(card.flags)),
            section("Контракт", renderContract(card.contract)),
            section("Решения", renderDecisions(card.decisions)),
            section("Доказательство и эффект", renderEffects(card.effects)),
            section("Критерии", renderCriteria(card.criteria)),
            section("Покрытие", renderCoverage(card.coverage)),
            section("Атака", renderAttack(card.attack)),
            section("Запись", renderRecord(card.record)),
            section("Регресс", renderRegress(card.regress)),
            section("Git", renderGit(card.git)),
          );
        }

        function renderPolicy() {
          if (!root) return h("div", { style: S.empty }, "Корень не настроен: добавьте roots в cordis.patch.yml.");
          if (!policy) return h("div", { style: S.empty }, "Чтение политики…");
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
            h("div", { style: S.hint }, "fail — запрещать, warn — предупреждать, off — не проверять. Эффективная политика (как её видит doctor). Правка политики из панели не делается: измените workflow.config.json и перечитайте. Исключение одно — флаг guard в разделе «Проверка коммитов»."),
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
        function renderGuard() {
          if (!root) return h("div", { style: S.empty }, "Корень не настроен.");
          const guard = (policy && policy.guard) || {};
          const on = guard.enabled === true;
          const disabled = Boolean(guardBusy) || Boolean(busy) || !root;
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
                  title: on ? "Выключить проверку коммитов" : "Включить проверку коммитов",
                },
                guardBusy ? "Запись…" : (on ? "Выключить проверку коммитов" : "Включить проверку коммитов"),
              ),
            ),
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
          const disabled = Boolean(deployBusy) || Boolean(busy);
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
            h("ul", { style: S.list }, DEPLOY_CHANGES.map((line, index) => h("li", { key: index }, line))),
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
                  title: "Развернуть движок subagent-workflow в " + target + ", спросив подтверждение",
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
        else body = renderBoard();

        const compatSummary = status && status.repo && status.repo.compat ? status.repo.compat.summary : null;

        return h(
          "div",
          { style: S.root },
          renderHeader(),
          renderTabs(),
          h(
            "div",
            { style: S.content },
            renderLocation(),
            renderRun(),
            renderDeployNote(),
            error ? h("p", { style: S.error }, error) : null,
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

    /* ------------------------------------------------------------------ *
     * plugin entry
     * ------------------------------------------------------------------ */

    function apply(rawContext) {
      const ctx = rawContext;
      let workspaceService = null;
      try {
        workspaceService = ctx.get ? ctx.get("uiWorkspace") : null;
      } catch {
        workspaceService = null;
      }
      if (!workspaceService && typeof ctx.inject === "function") {
        try {
          ctx.inject(["uiWorkspace"], (scope) => {
            workspaceService = scope.uiWorkspace || null;
          });
        } catch {
          /* optional service */
        }
      }
      const readWorkspace = () => {
        if (workspaceService) return workspaceService;
        try {
          return ctx.get ? ctx.get("uiWorkspace") : null;
        } catch {
          return null;
        }
      };
      const View = createView(readWorkspace);
      ctx.slots.inject("conversation.view", () =>
        ctx.slots.register(
          { name: "conversation.view", id: VIEW_ID, order: ORDER, label: () => VIEW_LABEL },
          View,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
