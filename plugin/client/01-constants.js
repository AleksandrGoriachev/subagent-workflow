    const BASE = "/workflow";
    const VIEW_ID = "workflow";
    const VIEW_LABEL = "Консоль workflow";
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
    /*
     * 0.9.0: воркспейс без движка может читать движок снаружи по карте
 * (~/.dsh/workflow/engine-roots.json). Чтение разрешено, запись запрещена
 * сервером (409 engine-external), поэтому кнопки записи в таком пространстве
 * неактивны с объяснением.
 *
 * 0.8.0: обновление развёрнутого движка. Кнопка показывает установленную и
     * доступную (вложенную в сборку) версии; при незавершённых заданиях диалог
     * перечисляет их и требует галочку «понимаю риск» — обновление меняет
     * ворота, и проверка незавершённого задания может сломаться.
     */
    const UPDATE_LABEL = "Обновить движок";
    const UPDATE_ROUTE = "/api/update";
    const UPDATE_RISK_LABEL = "понимаю риск";
    /*
     * 2.6.28 (0067): когда обновление из сборки ответило up-to-date или
     * panel-older, панель предлагает скачать движок из последнего релиза GitHub.
     * Это не обновление панели: tarball движка публикуется в релизе, поэтому
     * версия приходит из сети, а не из vendor/spec установленного плагина.
     */
    const RELEASE_UPDATE_LABEL = "Обновить из релиза";
    const RELEASE_UPDATE_SOURCE = "release";
    const RELEASE_UPDATE_HINT = "Версия движка скачивается из релиза GitHub (tarball + sha256), а не из сборки панели.";
    /*
     * 0.9.17 (0079, WC-52): обновление самого пакета панели. Кнопки движения
     * обновляют только движок; когда сборка панели старше движка, тупик
     * разрывает именно эта установка: релизный tarball плагина заменяет каталог
     * пакета в профиле, прежний сохраняется рядом как .dsh-plugin-backup-*.
     */
    const PLUGIN_UPDATE_LABEL = "Обновить панель";
    const PLUGIN_UPDATE_ROUTE = "/api/plugin-update";
    const PLUGIN_UPDATE_HINT = "Скачивает tarball панели из релиза GitHub (sha256), заменяет пакет в профиле и требует перезапуск DSH.";
    /*
     * 2.6.16 (0042): внешний движок обновляется в СВОЁМ репозитории. Явный
     * target отличает этот запрос от обновления воркспейса, которое для
     * внешнего движка по-прежнему запрещено (409 engine-external).
     */
    const EXTERNAL_UPDATE_TARGET = "engine-repo";
    const EXTERNAL_UPDATE_LABEL = "Обновить движок в репозитории движка";
    /*
     * 0.9.0: воркспейс без движка читает внешний движок по карте
     * (~/.dsh/workflow/engine-roots.json, env WF_ENGINE_ROOTS). Чтение
     * разрешено, запись запрещена сервером (409 engine-external), поэтому
     * развёртывание, обновление и guard в таком пространстве неактивны с
     * объяснением — панель не обещает то, что сервер отклонит.
     */
    const EXTERNAL_ENGINE_CODE = "engine-external";
    /* 0.9.4 (0041): отказ сервера, когда сборка панели старше движка. */
    const PANEL_OLDER_CODE = "panel-older";
    /*
     * 0.9.3 (0039): связь «воркспейс → движок» объявляется конфигом профиля или
     * выбирается кнопкой. Порядок источников — local → config → карта → absent;
     * карточка называет источник словами, а не кодом.
     */
    const ENGINE_ABSENT_TITLE = "движок не подключён";
    const ENGINE_DEPLOY_LABEL = "Развернуть здесь";
    const ENGINE_LINK_LABEL = "Подключить существующий";
    const ENGINE_LINK_ROUTE = "/api/engine-link";
    const ENGINE_CANDIDATES_ROUTE = "/api/engine/candidates";
    const ENGINE_SOURCE_LABEL = {
      workspace: "здесь",
      config: "задано конфигом профиля",
      mapping: "выбрано в панели",
    };
    /* Что именно появится в проекте: этот список показывает подтверждение. */
    const DEPLOY_CHANGES = [
      "docs/subagent-workflow/ — движок, ворота, шаблоны, хуки и публичный ключ приёмщика;",
      "docs/tasks/ — каталог заданий (пустой, если его ещё нет);",
      ".wf-keys/ — приватный ключ приёмщика этого проекта (каталог в .gitignore);",
      ".gitignore — строки журналов прогонов, guard.log и .wf-keys/;",
      "git init — если репозитория ещё нет (ворота и хуки требуют git);",
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

