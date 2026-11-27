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
          const summaryTasks = board && board.tasks ? board.tasks : [];
          return h(
            "div",
            null,
            renderNowSummary(summaryTasks, summaryTasks.filter((task) => ["contract", "attack", "lock", "red", "green", "incomplete"].includes(task.stage)).length, summaryTasks.filter((task) => task.stage === "accepted").length, summaryTasks.filter((task) => task.stage === "remarks").length),
            h("h2", { style: S.summaryTitle }, "Карточка задачи"),
            h(
              "div",
              { style: Object.assign({}, S.cardHead, { margin: "8px 0" }) },
              h("h2", { style: S.cardHeadTitle }, card.id + " · " + (card.title || "без названия")),
              badge(stageLabel(card.stage), STAGE_COLOR[card.stage], stageHint(card.stage)),
              card.risk ? badge(card.risk, RISK_COLOR[card.risk], riskHint(card.risk)) : null,
              h("span", { style: S.kvLabel }, card.dir),
            ),
            h("div", { style: S.stageText }, "Карточка показывает идентификатор, состояние и материалы выбранного задания. Используйте кнопки ниже для чтения проверок или подготовки замка; без действий переход по этапам задания не подтверждается."),
            h("button", { type: "button", style: Object.assign({}, S.button, S.back), onClick: () => setCard(null) }, "← Доска"),
            h(
              "div",
              { style: S.actions },
              runButton("lint", card.id),
              runButton("check-acceptance", card.id),
              h("div", { style: Object.assign({}, S.stageText, { flex: "1 1 100%" }) }, "«Проверить задание» и «Проверить запись» выполняют только чтение и показывают результат ниже. Без проверки можно пропустить дефекты задания или непригодную для выпуска запись."),
              /*
               * 0090: замок контракта. Кнопка есть всегда — отказ скрипта
               * («контракт не закоммичен») печатается как есть, без догадок.
               */
              h(
                "button",
                {
                  type: "button",
                  style: lockBusy ? Object.assign({}, S.button, S.buttonDisabled) : S.button,
                  disabled: lockBusy,
                  onClick: () => void lockContract(card.id),
                  title: "node task-hash.mjs --write: записать criteria.lock (контракт должен быть закоммичен)",
                },
                lockBusy ? "Собираю замок…" : "Собрать замок",
              ),
              h("div", { style: Object.assign({}, S.stageText, { flex: "1 1 100%" }) }, "«Собрать замок» фиксирует хеши контракта в criteria.lock после коммита и успешной атаки. Без замка красная проверка не подтвердит, что критерии зафиксированы заранее."),
            ),
            lockNote
              ? h(
                  "div",
                  { style: Object.assign({}, S.hint, lockNote.ok ? null : { color: T.danger }) },
                  lockNote.text,
                  lockNote.log ? h("div", { style: S.pre }, lockNote.log) : null,
                )
              : null,
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

