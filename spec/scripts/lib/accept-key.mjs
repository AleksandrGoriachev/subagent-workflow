/**
 * Выбор ключа приёмщика с учётом ротации (задание 0081).
 *
 * task-accept брал первую запись acceptors.json с нужным keyId. После ротации под
 * одним keyId живут две записи — retired+legacy и активная, — и подпись активным
 * ключом падала «приватный ключ не соответствует закреплённому».
 *
 * Правило одно и то же для подписи и приёмки: окно activeFrom/retiredAt решает,
 * какая запись действует; retired-эпоха отдаётся только как legacy с причиной.
 */
import { selectAcceptorEntry } from '../sign.mjs';

export function pickAcceptorEntry(acceptors, keyId, at) {
  const moment = at || new Date().toISOString();
  const selection = selectAcceptorEntry(acceptors, keyId, moment);
  return { entry: selection.entry, legacy: selection.legacy === true, reason: selection.reason || null };
}
