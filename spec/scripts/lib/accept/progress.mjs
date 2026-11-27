/*
 * 0184: маркер стадии приёмки и fail — вынесены из task-accept.mjs.
 * Прогресс живёт ВНЕ репозитория: убитый прогон не выглядит как «ничего не
 * начиналось». Ошибка маркера приёмку не ломает.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

let context = { repo: '', taskDir: '' };

/** Контекст нужен fail/progress: каталог задания и корень репозитория. */
export function setProgressContext(repo, taskDir) {
  context = { repo: String(repo), taskDir: String(taskDir) };
}

export function fail(message) { writeProgress('failed', { message: String(message).slice(0, 500) }); console.error('task-accept: ' + message); process.exit(1); }

/*
 * 2.6.82: маркер стадии ВНЕ репозитория. Убитый прогон перестаёт выглядеть как
 * «ничего не начиналось»: видно, до какой стадии дошли. Ошибка маркера приёмку
 * не ломает.
 */
function progressFile() {
  const dir = process.env.WF_PROGRESS_DIR || path.join(os.homedir(), '.dsh', 'workflow', 'progress');
  const key = crypto.createHash('sha256').update(String(context.repo)).digest('hex').slice(0, 12);
  return path.join(dir, key, path.basename(context.taskDir) + '.json');
}
export function writeProgress(stage, extra = {}) {
  try {
    const file = progressFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    const body = { task: path.basename(context.taskDir), repo: context.repo, stage, at: new Date().toISOString(), pid: process.pid, ...extra };
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + String.fromCharCode(10), 'utf8');
    fs.renameSync(tmp, file);
  } catch { /* маркер не имеет права ломать приёмку */ }
}


