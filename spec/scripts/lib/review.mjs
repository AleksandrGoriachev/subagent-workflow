/*
 * Разбор замечаний приёмщика (1.4.1): классификация и решение.
 * Общий модуль для task-accept и task-check-acceptance.
 */
export const REMARK_CLASSES = ['blocking', 'non-blocking', 'follow-up'];

export function validateReview(review) {
  const errors = [];
  if (review === null || typeof review !== 'object' || Array.isArray(review)) {
    return { ok: false, errors: ['review: ожидается объект'], releaseReady: false };
  }
  if (review.decision !== 'accepted' && review.decision !== 'rework') {
    errors.push('review.decision: accepted | rework');
  }
  const remarks = Array.isArray(review.remarks) ? review.remarks : [];
  if (review.remarks !== undefined && !Array.isArray(review.remarks)) errors.push('review.remarks: массив');
  const seen = new Set();
  remarks.forEach((remark, index) => {
    const label = 'review.remarks[' + index + ']';
    if (remark === null || typeof remark !== 'object' || Array.isArray(remark)) {
      errors.push(label + ': объект');
      return;
    }
    if (typeof remark.id !== 'string' || remark.id.trim() === '') errors.push(label + '.id: непустой');
    else if (seen.has(remark.id)) errors.push(label + ': дубликат id ' + remark.id);
    else seen.add(remark.id);
    if (!REMARK_CLASSES.includes(remark.class)) errors.push(label + '.class: blocking | non-blocking | follow-up');
    if (remark.class === 'blocking' && !(typeof remark.resolution === 'string' && remark.resolution.trim())) {
      errors.push(label + ': blocking требует resolution');
    }
    if (remark.class === 'non-blocking' && !(typeof remark.reason === 'string' && remark.reason.trim())) {
      errors.push(label + ': non-blocking требует reason');
    }
    if (remark.class === 'follow-up' && !(typeof remark.followUpId === 'string' && remark.followUpId.trim())) {
      errors.push(label + ': follow-up требует followUpId');
    }
  });
  const unresolved = remarks.filter(
    (remark) => remark && remark.class === 'blocking' && !(typeof remark.resolution === 'string' && remark.resolution.trim()),
  );
  if (review.decision === 'rework') errors.push('review.decision=rework: задача отправлена на доработку, приёмка не создаётся');
  return {
    ok: errors.length === 0,
    errors,
    releaseReady: review.decision === 'accepted' && unresolved.length === 0,
    unresolved: unresolved.map((remark) => remark.id),
  };
}
