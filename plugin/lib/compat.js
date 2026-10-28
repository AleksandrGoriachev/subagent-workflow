/**
 * Version compatibility between this plugin and the deployed workflow package.
 *
 * Pure: the caller passes the version fields, the workflow file map, the
 * effective config and the board tasks. No filesystem access, so every rule is
 * testable. The plugin only reports; recommendations are commands for a human,
 * never actions the panel performs.
 */
/* Версия для панели. Обязана совпадать с package.json — это проверяет тест. */
export const PLUGIN_VERSION = '0.6.0';
/* Диапазон, который панель показывает. С 0.6.0 в него входят guard (2.5.0) и запись 2.6.0. */
export const SUPPORTED_LABEL = '2.0.0 – 2.6.x';

export function parseVersion(value) {
  const match = String(value === null || value === undefined ? '' : value).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] || 0),
    raw: match[0],
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function check(id, severity, title, message, recommendation, limited = false) {
  return { id, severity, title, message, recommendation, limited };
}

function sampleIds(tasks, limit = 5) {
  const ids = tasks.map((task) => String(task.id));
  return ids.slice(0, limit).join(', ') + (ids.length > limit ? ' …' : '');
}

/**
 * Build the compatibility view.
 *
 * @param {object} input
 * @param {string} [input.pluginVersion]
 * @param {string|null} [input.packageVersion] VERSION file content
 * @param {string|null} [input.specVersion] "Версия:" line of SPEC.md
 * @param {string|null} [input.versionSource] 'VERSION' | 'SPEC' | null
 * @param {object|null} [input.workflow] file map from state.readWorkflowInfo
 * @param {object|null} [input.config] effective config
 * @param {Array<object>} [input.tasks] board tasks
 */
export function compatView(input = {}) {
  const pluginVersion = input.pluginVersion || PLUGIN_VERSION;
  const packageVersion = input.packageVersion || null;
  const specVersion = input.specVersion || null;
  const workflow = input.workflow || null;
  const config = input.config || null;
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const checks = [];

  if (!workflow || workflow.dir !== true) {
    checks.push(check(
      'workflow-missing',
      'error',
      'Workflow не развёрнут',
      'В репозитории нет каталога docs/subagent-workflow.',
      'Разверните пакет subagent-workflow 2.2.x: из распакованного пакета выполните node spec/scripts/init.mjs --repo .',
      true,
    ));
  } else {
    if (!config || config.loaded !== true) {
      checks.push(check(
        'config-missing',
        'error',
        'Нет workflow.config.json',
        'Каталог workflow есть, но конфигурацию прочитать не удалось.',
        'Создайте docs/subagent-workflow/workflow.config.json из spec/workflow.config.json (или повторите init).',
        true,
      ));
    }
    if (workflow.versionFile !== true) {
      checks.push(check(
        'version-source',
        'warn',
        'Нет файла VERSION',
        'Версия workflow определяется по строке «Версия:» в SPEC.md. В 2.2.2+ файл VERSION появляется в пакете.',
        'Обновите развёрнутую копию до 2.2.2+ или добавьте docs/subagent-workflow/VERSION.',
        false,
      ));
    }
  }

  const workflowVersion = packageVersion || specVersion || null;
  const parsed = parseVersion(workflowVersion);

  if (workflow && workflow.dir === true && !parsed) {
    checks.push(check(
      'version-unknown',
      'warn',
      'Версия workflow не определена',
      'Нет ни файла VERSION, ни строки «Версия:» в SPEC.md — совместимость проверить нельзя.',
      'Добавьте docs/subagent-workflow/VERSION или обновите пакет до 2.2.2+.',
      false,
    ));
  }

  if (parsed) {
    if (parsed.major < 2) {
      checks.push(check(
        'workflow-too-old',
        'error',
        'Workflow старше 2.0',
        'Панель рассчитана на формат 2.0+: замок v3, запись v4–v6, решения и покрытие. Часть полей в этой версии отсутствует.',
        'Обновите workflow до 2.2.x: разверните свежий пакет через init.mjs --force.',
        true,
      ));
    } else if (parsed.minor === 0) {
      checks.push(check(
        'workflow-2.0',
        'warn',
        'Workflow 2.0.x',
        'В этой версии нет реестра решений, покрытия, атаки и политики. Панель покажет контракт, замок, красный и запись, но не сможет проверить decisions/coverage/attack.',
        'Обновите развёрнутую копию до 2.2.x и перезапустите панель.',
        true,
      ));
    } else if (parsed.minor === 1) {
      checks.push(check(
        'workflow-2.1',
        'warn',
        'Workflow 2.1.x',
        'Есть решения и покрытие, но нет атаки задания и policy. Вкладка «Атака» будет пустой, policy — значениями по умолчанию.',
        'Обновите развёрнутую копию до 2.2.x.',
        true,
      ));
    } else if (parsed.major > 2 || parsed.minor > 6) {
      /*
       * Ветка для случая, когда устарел сам плагин: он не знает формат этой
       * версии workflow. Здесь совет обновиться уместен — но баннера
       * «функционал ограничен» нет: работа ворот от панели не зависит, а
       * пугать владельца рабочего проекта из-за отставшей панели незачем.
       */
      checks.push(check(
        'workflow-newer',
        'warn',
        'Workflow новее 2.6',
        'Пакет новее известного панели диапазона: панель может не знать новые поля и правила. На работу ворот это не влияет — панель только читает файлы.',
        'Обновите плагин dsh-workflow-console, когда выйдет версия с поддержкой этого workflow.',
      ));
    }
    /*
     * 0.4.0 (WC-5): пробел 2.3–2.4 закрыт — панель читает criteria.effect,
     * decisions[].evidence.measuredBy, verify.effects, effectConsistency записи
     * и regress.baseline.json. Отдельной проверки «не показываем» больше нет:
     * она была честной, пока пробел был, и мешала бы, когда его нет.
     */

    if ((parsed.major > 2 || parsed.minor >= 2)) {
      if (workflow && workflow.attackGate !== true) {
        checks.push(check(
          'attack-gate-missing',
          'error',
          'Нет task-attack.mjs',
          'Версия workflow заявляет 2.2+, но в развёрнутой копии нет scripts/task-attack.mjs: атака задания не работает.',
          'Переразверните пакет 2.2.x: в нём есть scripts/task-attack.mjs.',
          true,
        ));
      }
      if (workflow && workflow.policyLib !== true) {
        checks.push(check(
          'policy-lib-missing',
          'warn',
          'Нет lib/policy.mjs',
          'Версия workflow заявляет 2.2+, но в развёрнутой копии нет scripts/lib/policy.mjs: policy не применяется воротами.',
          'Переразверните пакет 2.2.x: в нём есть scripts/lib/policy.mjs.',
          true,
        ));
      }
    }
  }

  if (packageVersion && specVersion && packageVersion !== specVersion) {
    checks.push(check(
      'package-spec',
      'info',
      'VERSION и SPEC расходятся',
      'VERSION ' + packageVersion + ', SPEC ' + specVersion + '. Обычно это патч документации без изменения кода.',
      'Если расхождение не ожидалось, обновите SPEC.md или VERSION.',
      false,
    ));
  }

  const oldLocks = tasks.filter((task) => Number(task.lockVersion) > 0 && Number(task.lockVersion) < 3);
  if (oldLocks.length > 0) {
    checks.push(check(
      'lock-old',
      'warn',
      'Замки старого формата',
      oldLocks.length + ' задач с criteria.lock версии ниже 3: ' + sampleIds(oldLocks) + '. Панель читает их, но хеши и защищённые файлы могли не проверяться.',
      'Для задач без доказанного красного: node docs/subagent-workflow/scripts/task-hash.mjs --task <каталог> --write. После красного перезамок запрещён — нужен новый ID/перевыпуск.',
      false,
    ));
  }

  const oldRecords = tasks.filter((task) => Number(task.recordVersion) > 0 && Number(task.recordVersion) < 4);
  if (oldRecords.length > 0) {
    checks.push(check(
      'record-old',
      'warn',
      'Записи старого формата',
      oldRecords.length + ' записей версии ниже 4: ' + sampleIds(oldRecords) + '. В них нет independence/decisions/attack, поэтому эти поля не проверяются.',
      'Переписывать старые записи не нужно: новые поля появятся при следующей приёмке текущими воротами. Для выпуска смотрите флаги releaseReady/legacy.',
      false,
    ));
  }

  const errors = checks.filter((item) => item.severity === 'error').length;
  const warnings = checks.filter((item) => item.severity === 'warn').length;
  const limited = checks.some((item) => item.limited);
  const firstLimited = checks.find((item) => item.limited);
  const firstWarning = checks.find((item) => item.severity === 'warn');
  const headline = limited
    ? 'Функционал ограничен: ' + (firstLimited.title || 'несовместимость версий')
    : errors > 0
      ? 'Есть ошибки совместимости'
      : warnings > 0
        ? 'Совместимо, но есть замечания'
        : 'Совместимо с workflow ' + (workflowVersion || '2.2.x');

  return {
    pluginVersion,
    supported: SUPPORTED_LABEL,
    workflowVersion,
    versionSource: input.versionSource || (workflow && workflow.versionFile ? 'VERSION' : parsed ? 'SPEC' : null),
    versions: { package: packageVersion, spec: specVersion },
    checks,
    summary: {
      errors,
      warnings,
      limited,
      headline,
    },
  };
}
