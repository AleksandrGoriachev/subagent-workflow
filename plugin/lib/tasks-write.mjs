/**
 * Первая запись из панели (WC-4, 0090): замок контракта и новое задание.
 *
 * Панель остаётся панелью: она не редактирует task.md и не пишет критерии.
 * Она запускает штатные скрипты движка с явными аргументами — ровно те же,
 * что человек набрал бы в консоли, и возвращает их вывод. Аргументы строятся
 * здесь, поэтому проверки (id, риск, заголовок) не зависят от UI.
 */
import path from 'node:path';

/** Каталог задания: четыре цифры, как в docs/tasks. */
export function validateTaskId(value) {
  const id = String(value === null || value === undefined ? '' : value).trim();
  if (!/^\d{4}$/u.test(id)) throw new Error('id задания — четыре цифры, например 0110');
  return id;
}

/** Заголовок задания: строка без переводов строк, 5..200 символов. */
export function validateTitle(value) {
  const title = String(value === null || value === undefined ? '' : value).trim();
  if (/[\r\n]/u.test(title)) throw new Error('заголовок не может содержать перевод строки');
  if (title.length < 5) throw new Error('заголовок короче 5 символов: панель не создаёт задание без темы');
  if (title.length > 200) throw new Error('заголовок длиннее 200 символов');
  return title;
}

/** Риск задания: ровно три значения контракта. */
export function validateRisk(value) {
  const risk = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (!['low', 'medium', 'high'].includes(risk)) {
    throw new Error('риск задания: low, medium или high');
  }
  return risk;
}

/** Роль-исполнитель/приёмщик: только безопасный набор символов. */
export function validateRole(value, label) {
  const role = String(value === null || value === undefined ? '' : value).trim();
  if (role === '') return '';
  if (!/^[a-z][a-z0-9:_-]{2,79}$/iu.test(role)) throw new Error(label + ': недопустимые символы');
  return role;
}

/**
 * Аргументы task-hash: --write (замок) или --relock (правка границ после красного).
 * @returns {string[]}
 */
export function taskHashArgs({ taskDir, root, mode = 'write', reason = '' }) {
  const args = ['--task', path.resolve(String(taskDir)), '--repo', path.resolve(String(root))];
  if (mode === 'write') {
    args.push('--write');
  } else if (mode === 'relock') {
    const text = String(reason === null || reason === undefined ? '' : reason).trim();
    if (text.length < 10) throw new Error('--relock требует причину от 10 символов');
    args.push('--relock', '--reason', text);
  } else {
    throw new Error('режим task-hash: write или relock');
  }
  return args;
}

/** Аргументы new-task: id, тема, риск и, если заданы, роли. */
export function newTaskArgs({ id, title, risk, root, executor = '', acceptor = '' }) {
  const args = [
    '--id', validateTaskId(id),
    '--title', validateTitle(title),
    '--risk', validateRisk(risk),
    '--repo', path.resolve(String(root)),
  ];
  const withExecutor = validateRole(executor, 'executor');
  const withAcceptor = validateRole(acceptor, 'acceptor');
  if (withExecutor !== '') args.push('--executor', withExecutor);
  if (withAcceptor !== '') args.push('--acceptor', withAcceptor);
  return args;
}

/** Каталог задания в воркспейсе. */
export function taskDirOf(root, tasksDir, id) {
  return path.join(path.resolve(String(root)), String(tasksDir || 'docs/tasks'), validateTaskId(id));
}
