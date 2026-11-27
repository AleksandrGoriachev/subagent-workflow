/*
 * Контракт в git: коммит контракта и сверка замков.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import { TASK_ARTIFACTS } from './engine-version.mjs';
import { toPosix, relPosix } from './fsio.mjs';
import { git, headCommit, filesAtCommitDetailed } from './git-base.mjs';
import { matchesAny, listRepoFiles, protectedManifest } from './glob.mjs';
export function checkContractCommitted(repo, taskDir, meta) {
  const head = headCommit(repo);
  if (!head) {
    return { ok: false, errors: ['в репозитории нет HEAD: контракт задания не закоммичен'], files: [], contractCommit: null };
  }
  const taskRel = relPosix(repo, taskDir);
  /*
   * 0124 (2.6.105): сбой чтения дерева не должен выглядеть как «файл не
   * закоммичен». Пустой ответ повторяем один раз (транзиент) и, если он снова
   * пуст при непустом рабочем дереве, говорим «git не ответил», а не «нет файла».
   */
  let headFilesRaw = filesAtCommitDetailed(repo, head);
  if (!headFilesRaw.ok || headFilesRaw.files.length === 0) headFilesRaw = filesAtCommitDetailed(repo, head);
  const workFiles = listRepoFiles(repo, { includeUntracked: true });
  if (!headFilesRaw.ok || (headFilesRaw.files.length === 0 && workFiles.length > 0)) {
    const why = headFilesRaw.ok
      ? 'git вернул пустой список файлов ' + String(head).slice(0, 12) + ' при непустом рабочем дереве'
      : headFilesRaw.error;
    return {
      ok: false,
      errors: ['git не ответил на чтение дерева (' + why + ') — это сбой чтения, а не «файл не закоммичен»; повторите прогон'],
      files: [],
      contractCommit: head,
      gitReadFailed: true,
    };
  }
  const headFiles = headFilesRaw.files;
  const protectedPatterns = Array.isArray(meta.protectedPaths) ? meta.protectedPaths : [];
  const isArtifact = (file) => file.startsWith(taskRel + '/') && TASK_ARTIFACTS.has(file.split('/').pop());
  /* 0167: у лёгкой задачи criteria.json нет — контракт фиксирует task.md с checks. */
  const lightContract = String(meta.mode || '') === 'light';
  const files = new Set([taskRel + '/task.md', ...(lightContract ? [] : [taskRel + '/criteria.json'])]);
  /*
   * Тот же манифест, что попадёт в criteria.lock (2.6.18): движок
   * (docs/subagent-workflow/**) контрактом задания не считается, если задание не
   * объявило locksEngine. Иначе деплой пакета в чужом окне даёт «файл контракта
   * изменён после коммита» — ровно та красная чужая правка, из-за которой re-lock
   * и появился.
   */
  const protectedManifestFiles = protectedManifest(
    [...workFiles, ...headFiles].filter((file) => !isArtifact(file) && matchesAny(file, protectedPatterns)),
    { locksEngine: meta.locksEngine === true },
  );
  for (const file of protectedManifestFiles) files.add(file);
  const errors = [];
  const present = [];
  for (const file of [...files].sort()) {
    if (!headFiles.includes(file)) { errors.push('файл контракта не закоммичен: ' + file); continue; }
    if (!workFiles.includes(file)) { errors.push('файл контракта удалён из рабочего дерева: ' + file); continue; }
    present.push(file);
  }
  /*
   * Один git diff на пачку, а не на файл: у задачи может быть сотня защищённых
   * тестов, а запуск git на Windows стоит ~150 мс.
   */
  const changed = new Set();
  for (let i = 0; i < present.length; i += 100) {
    const chunk = present.slice(i, i + 100);
    const diff = git(repo, ['diff', '--name-only', '-z', 'HEAD', '--', ...chunk]);
    if (diff.exitCode !== 0) {
      for (const file of chunk) errors.push('файл контракта изменён после коммита: ' + file);
      continue;
    }
    for (const file of diff.stdout.split('\0')) if (file) changed.add(toPosix(file));
  }
  for (const file of present) if (changed.has(file)) errors.push('файл контракта изменён после коммита: ' + file);
  return { ok: errors.length === 0, errors, files: [...files].sort(), contractCommit: head };
}

export function sameLockContract(a, b) {
  if (!a || !b) return false;
  const shape = (lock) => JSON.stringify({
    task: lock.task,
    taskFileSha256: lock.taskFileSha256,
    criteriaSha256: lock.criteriaSha256,
    criteriaJsonSha256: lock.criteriaJsonSha256,
    contractCommit: lock.contractCommit || null,
    protected: (lock.protected || []).map((x) => [x.path, x.sha256]).sort(),
  });
  return shape(a) === shape(b);
}

