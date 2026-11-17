import { t, registerMessages } from './i18n.js';
import { closeDialog } from './experience.js?v=20261117-creator-actions';

registerMessages({
  '名片操作': 'Card actions', '删除名片': 'Delete card', '取消': 'Cancel',
  '删除这张名片？': 'Delete this card?',
  '删除后，这张名片将从列表移除，分享链接也会失效。作品和试玩数据会保留。': 'This card will be removed from the list and its shared link will stop working. Your works and play data will be kept.',
  '正在删除…': 'Deleting…', '名片已删除': 'Card deleted',
  '删除结果尚未确认，请重试。': 'Deletion is not yet confirmed. Please retry.',
  '删除结果尚未确认，请重试。重复操作不会删除其他名片。': 'Deletion is not yet confirmed. Retry safely; it will not affect other cards.',
});

const pending = new Map();
export const hasPendingCardDeletion = () => pending.size > 0;
export function deleteCard(id, api) {
  if (pending.has(id)) return pending.get(id);
  const operation = Promise.resolve().then(() => api('/api/cards/' + encodeURIComponent(id) + '/delete', { method: 'POST', body: {}, signal: AbortSignal.timeout(30000) })).then(result => {
    if (result.cardId !== id || result.deleted !== true) throw new Error(t('删除结果尚未确认，请重试。'));
    return result;
  }).finally(() => pending.delete(id));
  pending.set(id, operation); return operation;
}

export function confirmCardDeletion(card, { api, notify, onDeleted }) {
  if (document.querySelector('#delete-card-dialog')) return;
  const previous = document.activeElement, dialog = document.createElement('dialog');
  dialog.id = 'delete-card-dialog'; dialog.className = 'share-dialog card-delete-dialog';
  dialog.setAttribute('aria-labelledby', 'delete-card-title'); dialog.setAttribute('aria-describedby', 'delete-card-description');
  dialog.innerHTML = `<h2 id="delete-card-title"></h2><p class="delete-card-name"></p><p id="delete-card-description"></p><p class="error" role="alert"></p><div class="form-footer"><button class="button quiet" data-cancel type="button"></button><button class="button danger" data-confirm type="button"></button></div>`;
  const q = selector => dialog.querySelector(selector), confirm = q('[data-confirm]'), cancel = q('[data-cancel]');
  q('h2').textContent = t('删除这张名片？'); q('.delete-card-name').textContent = card.name;
  q('#delete-card-description').textContent = t('删除后，这张名片将从列表移除，分享链接也会失效。作品和试玩数据会保留。');
  confirm.textContent = t('删除名片'); cancel.textContent = t('取消');
  cancel.onclick = () => closeDialog(dialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
  dialog.addEventListener('close', () => { dialog.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); }, { once: true });
  confirm.onclick = async () => {
    if (confirm.disabled) return;
    confirm.disabled = true; confirm.textContent = t('正在删除…'); cancel.textContent = t('关闭'); q('.error').textContent = '';
    try { await deleteCard(card.id, api); if (dialog.isConnected) await closeDialog(dialog); notify(t('名片已删除')); onDeleted(card.id); }
    catch { if (dialog.isConnected) { q('.error').textContent = t('删除结果尚未确认，请重试。重复操作不会删除其他名片。'); confirm.disabled = false; confirm.textContent = t('重试'); } }
  };
  document.body.appendChild(dialog); dialog.showModal(); cancel.focus();
  return dialog;
}
