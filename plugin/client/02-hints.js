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

