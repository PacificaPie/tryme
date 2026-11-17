import { t } from './i18n.js';
import './archive.messages.js';

let pending = 0;
export const hasPendingArchiveControl = () => pending > 0;
export const archivedWorksPath = '/studio/works?state=archived';
export const isArchived = work => Boolean(work?.archivedAt);
export const archivedWorkPath = id => archivedWorksPath + '&work=' + encodeURIComponent(id);
export function archiveGuardMarkup(work, { esc }) {
  return `<div class="page narrow"><a class="back" href="#${archivedWorksPath}">← ${t('已归档作品')}</a><div class="page-head"><h1>${esc(work.name)}</h1></div><section class="archive-guard"><h2>${t('已归档')}</h2><p>${t('这件作品已归档，请先恢复再继续。')}</p><a class="button primary" href="#${archivedWorkPath(work.id)}">${t('前往归档恢复')}</a></section></div>`;
}

// One intent, one in-flight request. A failed transport can retry the same
// revision; a CAS conflict requires a fresh view, never an automatic overwrite.
export function createArchiveRequest(work, action, api, onState = () => {}, { timers = globalThis, timeoutMs = 30000 } = {}) {
  const state = { pending: false, error: null, needsRefresh: false, uncertain: false };
  const id = work?.id, expectedRevision = work?.revision;
  let request = null;
  function run() {
    if (request) return request;
    if (state.needsRefresh) return Promise.resolve(null);
    if (!['archive', 'restore'].includes(action) || !id || !Number.isInteger(expectedRevision)) {
      state.error = Object.assign(new Error('归档操作不可用，请刷新后重试。'), { code: 'INVALID_ARCHIVE_REQUEST' });
      state.needsRefresh = true; onState(state); return Promise.resolve(null);
    }
    state.pending = true; state.error = null; state.uncertain = false; pending++; onState(state);
    const controller = new AbortController();
    let deadline;
    const expiry = new Promise((_, reject) => {
      deadline = timers.setTimeout(() => {
        // Aborting the wait is not cancellation of the server mutation. The
        // same intent/revision can be retried, including after a lost receipt.
        reject(Object.assign(new Error('操作结果尚未确认，请刷新状态或重试。'), { code: 'ARCHIVE_TIMEOUT' }));
        controller.abort();
      }, timeoutMs);
    });
    const attempt = Promise.resolve().then(() => api('/api/works/' + encodeURIComponent(id) + '/archive', {
      method: 'POST', body: { action, expectedRevision }, signal: controller.signal,
    }));
    request = Promise.race([attempt, expiry]).then(result => {
      const updated = result?.work;
      if (updated?.id !== id || !Number.isInteger(updated.revision) || !Object.hasOwn(updated, 'archivedAt') || isArchived(updated) !== (action === 'archive')) {
        throw Object.assign(new Error('操作未能确认，请重试。'), { code: 'ARCHIVE_UNCONFIRMED' });
      }
      return updated;
    }).catch(error => {
      state.error = error instanceof Error ? error : new Error('操作未能确认，请重试。');
      state.needsRefresh = ['ARCHIVE_CONFLICT', 'WORK_CONFLICT', 'WORK_ARCHIVED'].includes(state.error.code);
      state.uncertain = !state.needsRefresh && (!state.error.status || ['ARCHIVE_TIMEOUT', 'ARCHIVE_UNCONFIRMED'].includes(state.error.code));
      return null;
    }).finally(() => { timers.clearTimeout(deadline); request = null; state.pending = false; pending--; onState(state); });
    return request;
  }
  return { state, run };
}

export function disposeArchiveControls() { document.querySelector('#archive-dialog')?.remove(); }
export function changeArchive(work, action, h) {
  disposeArchiveControls();
  const dialog = document.createElement('dialog'); dialog.id = 'archive-dialog'; dialog.className = 'share-dialog archive-dialog';
  const label = action === 'archive' ? '归档作品' : '恢复作品';
  dialog.innerHTML = `<h2>${t(label)}</h2><p class="share-item-title">${h.esc(work.name)}</p><p>${t(action === 'archive'
    ? '作品将移出“我的作品”和 Feed。原链接、版本、名片与历史数据保留，之后可在归档中恢复。'
    : '作品将回到“我的作品”，仍从 Feed 隐藏。需要公开时，可再选择“恢复到 Feed”。')}</p><p class="archive-request-status" role="status" hidden></p><p class="error" role="alert"></p><div class="form-footer"><button type="button" class="button primary" data-archive-confirm>${t(label)}</button><button type="button" class="button quiet" data-archive-refresh hidden>${t('刷新状态')}</button><button type="button" class="button quiet" data-archive-back>${t('返回')}</button></div>`;
  const button = dialog.querySelector('[data-archive-confirm]'), back = dialog.querySelector('[data-archive-back]'), refresh = dialog.querySelector('[data-archive-refresh]'), error = dialog.querySelector('.error'), status = dialog.querySelector('.archive-request-status');
  const request = createArchiveRequest(work, action, h.api, state => {
    if (!dialog.isConnected) return;
    button.disabled = state.pending;
    button.textContent = t(state.pending ? action === 'archive' ? '归档中…' : '恢复中…' : state.needsRefresh ? '刷新状态' : state.uncertain ? '重试确认' : label);
    back.textContent = t(state.pending ? '关闭窗口' : '返回');
    status.hidden = !state.pending; status.textContent = state.pending ? t('已提交；关闭窗口不会撤回操作。') : '';
    refresh.hidden = !state.error || state.needsRefresh;
    error.textContent = state.error ? t(state.needsRefresh ? '作品状态已变化，请刷新后再操作。' : state.uncertain ? '操作结果尚未确认，请刷新状态或重试。' : state.error.message) : '';
  });
  button.onclick = async () => {
    if (request.state.pending) return;
    if (request.state.needsRefresh) { dialog.close(); if (h.isCurrent()) h.reload(); return; }
    const updated = await request.run();
    if (!updated) return;
    h.onChanged?.(updated); if (dialog.isConnected) dialog.close();
    h.notify(t(action === 'archive' ? '已移至归档' : '已恢复作品，仍从 Feed 隐藏'));
    if (h.isCurrent()) h.reload();
  };
  refresh.onclick = () => { dialog.close(); if (h.isCurrent()) h.reload(); };
  back.onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.appendChild(dialog); dialog.showModal(); back.focus();
}
