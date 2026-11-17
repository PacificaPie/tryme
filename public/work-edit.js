import { t } from './i18n.js';
import './work-edit.messages.js';
import { newWorkEditDraft, editWorkDraft, rebaseWorkEditDraft, workEditChanged, coverFileError, workEditReturnPath } from './work-edit-state.js';

const contexts = new Map();
let active = null;
const uuid = () => crypto.randomUUID();
const read = key => { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {} };
const remove = key => { try { sessionStorage.removeItem(key); } catch {} };
const saveDraft = ctx => write(ctx.key, ctx.draft);
const visible = view => active === view && !view.disposed && view.h.isCurrent();
const query = selector => document.querySelector(selector);
function safeCover(value) { try { const url = new URL(value, location.origin); return value && url.origin === location.origin ? url.href : ''; } catch { return ''; } }
function revoke(ctx) { if (ctx?.previewURL) URL.revokeObjectURL(ctx.previewURL); if (ctx) ctx.previewURL = ''; }
function fileWrite(ctx, action, file) {
  ctx.fileWrites = (ctx.fileWrites || Promise.resolve()).then(() => ctx.h.fileStore(action, ctx.fileKey, file, true));
  return ctx.fileWrites;
}
function errorText(error) {
  if (error.code === 'WORK_CONFLICT') return '作品信息已变化，你的修改已保留。';
  if (error.code === 'IDEMPOTENCY_CONFLICT') return '保存内容与上次提交不一致，请刷新后继续编辑。';
  if (['COVER_TOO_LARGE', 'BODY_TOO_LARGE'].includes(error.code)) return '封面不能超过 2 MiB，请压缩图片后重新选择。';
  if (error.code === 'INVALID_COVER') return '封面内容无法识别，请重新导出 PNG、JPG 或 WebP 图片。';
  return error.message;
}
export function hasPendingWorkEdit() { return [...contexts.values()].some(ctx => ctx.pending); }
export function disposeWorkEdit() { if (active) { active.disposed = true; revoke(active.ctx); active = null; } }

async function context(view, work) {
  const { h } = view, key = `funtrack.work-info:${h.owner}:${work.id}`;
  let ctx = contexts.get(key);
  if (!ctx) {
    const stored = read(key);
    const valid = stored && Number.isInteger(stored.expectedRevision) && typeof stored.key === 'string' && typeof stored.name === 'string' && typeof stored.desc === 'string' && typeof stored.base?.name === 'string' && typeof stored.base?.desc === 'string';
    ctx = { key, fileKey: `work-info:${h.owner}:${work.id}:cover`, id: work.id, h, work, draft: valid ? stored : newWorkEditDraft(work, uuid()), cover: null, pending: false, error: '', fileError: '', conflict: false, previewURL: '' };
    contexts.set(key, ctx);
    ctx.loading = (async () => {
      if (ctx.draft.replaceCover) { ctx.cover = await h.fileStore('get', ctx.fileKey, null, true); if (!ctx.cover) ctx.fileError = '封面草稿无法恢复，请重新选择图片。'; }
    })();
  }
  await ctx.loading;
  ctx.h = h; ctx.work = work;
  if (!workEditChanged(ctx.draft) && !ctx.draft.attempted && !ctx.pending) { ctx.draft = newWorkEditDraft(work, uuid()); ctx.conflict = false; }
  if (ctx.draft.expectedRevision !== work.revision && !ctx.draft.attempted) ctx.conflict = true;
  saveDraft(ctx); return ctx;
}
function refresh(view) {
  if (!visible(view) && active?.ctx === view.ctx) view = active;
  if (!visible(view)) return;
  const { ctx } = view, form = query('#work-edit-form'); if (!form) return;
  const d = ctx.draft, busy = ctx.pending || ctx.rebasing, changed = workEditChanged(d);
  form.querySelectorAll('input,textarea,button').forEach(el => { el.disabled = busy; });
  query('#work-edit-submit').disabled = busy || ctx.conflict || Boolean(ctx.fileError) || !changed && !d.attempted;
  query('#work-edit-submit').textContent = t(ctx.pending ? '正在保存…' : d.attempted ? ctx.error ? '重试保存' : '确认保存结果' : '保存修改');
  query('#work-edit-status').textContent = t(changed || d.attempted ? '未保存' : '没有修改');
  query('#work-edit-error').textContent = t(ctx.conflict && ctx.error === '作品信息已变化，你的修改已保留。' ? '' : ctx.error || '');
  if (ctx.unauthorized) query('#work-edit-error').innerHTML = view.h.esc(t(ctx.error)) + ` <a class="text-link" target="_top" href="${view.h.esc(view.h.signinURL())}">${t('重新登录')}</a>`;
  query('#work-edit-cover-error').textContent = t(ctx.fileError || ctx.storageWarning || '');
  query('#work-edit-conflict').hidden = !ctx.conflict;
  query('#work-edit-cover-reset').hidden = !d.replaceCover && !ctx.fileError;
  const img = query('#work-edit-preview');
  if (ctx.cover && d.replaceCover && !ctx.previewURL) ctx.previewURL = URL.createObjectURL(ctx.cover);
  const src = d.replaceCover && ctx.cover ? ctx.previewURL : safeCover(d.base.coverUrl);
  img.hidden = !src; if (src && img.getAttribute('src') !== src) img.src = src;
  query('#work-edit-no-cover').hidden = Boolean(src);
  query('#work-edit-cover-name').textContent = d.replaceCover ? ctx.cover?.name || '' : '';
}
async function rebase(view) {
  const { ctx } = view; if (ctx.pending || ctx.rebasing) return;
  ctx.rebasing = true; ctx.error = ''; refresh(view);
  try {
    const { work } = await view.h.api('/api/works/' + encodeURIComponent(ctx.id));
    if (!visible(view)) return;
    ctx.work = work; ctx.draft = rebaseWorkEditDraft(ctx.draft, work, uuid()); ctx.conflict = false; ctx.unauthorized = false; saveDraft(ctx);
    query('#work-edit-name').value = ctx.draft.name; query('#work-edit-desc').value = ctx.draft.desc;
    view.h.notify(t('已载入最新信息，请检查后保存。'));
  } catch (error) { ctx.error = errorText(error); ctx.unauthorized = error.status === 401; }
  finally { ctx.rebasing = false; refresh(view); }
}
async function submit(view) {
  const { ctx, h } = view, d = ctx.draft;
  if (ctx.pending || ctx.rebasing || ctx.conflict || ctx.fileError || !workEditChanged(d) && !d.attempted) return;
  if (!d.name.trim() || !d.desc.trim()) { ctx.error = '作品名称和介绍不能为空。'; refresh(view); return; }
  if (d.replaceCover && coverFileError(ctx.cover)) { ctx.fileError = coverFileError(ctx.cover); refresh(view); return; }
  const body = new FormData(); body.set('name', d.name.trim()); body.set('desc', d.desc.trim()); body.set('expectedRevision', String(d.expectedRevision)); if (d.replaceCover) body.set('cover', ctx.cover);
  ctx.pending = true; ctx.error = ''; ctx.unauthorized = false; d.attempted = true; saveDraft(ctx); refresh(view);
  try {
    await ctx.fileWrites;
    const result = await h.api('/api/works/' + encodeURIComponent(ctx.id), { method: 'PATCH', headers: { 'Idempotency-Key': d.key }, body });
    if (result.work?.id !== ctx.id || result.operation?.action !== 'edit' || !Number.isInteger(result.current?.revision)) throw new Error('保存结果尚未确认，请使用同一份草稿重试。');
    remove(ctx.key); await fileWrite(ctx, 'delete'); contexts.delete(ctx.key); ctx.pending = false; h.onChanged();
    const later = result.current.revision !== result.operation.revision;
    h.notify(t(later ? '作品信息已保存；线上后来又有更新' : '作品信息已保存'));
    if (visible(view) || active?.ctx === ctx && visible(active)) h.go(active?.ctx === ctx ? active.returnPath : view.returnPath);
  } catch (error) {
    ctx.pending = false; ctx.error = errorText(error); ctx.unauthorized = error.status === 401;
    if (['WORK_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(error.code)) { ctx.conflict = true; d.attempted = false; saveDraft(ctx); }
    refresh(view);
  }
}
export async function renderWorkEdit(route, h) {
  const match = /^\/studio\/works\/([^/]+)\/edit$/.exec(route.path); if (!match) return false;
  const id = decodeURIComponent(match[1]), view = { h, disposed: false, returnPath: workEditReturnPath(route.params.get('from'), id) }; active = view;
  const { work } = await h.api('/api/works/' + encodeURIComponent(id)); if (!visible(view)) return true;
  if (work.authorId !== h.owner) throw new Error(t('只能编辑自己的作品信息。'));
  view.ctx = await context(view, work); if (!visible(view)) return true;
  const ctx = view.ctx, d = ctx.draft, e = h.esc;
  if (!h.render(`<div class="page narrow work-edit-page"><a class="back" href="#${e(view.returnPath)}">${t(view.returnPath === '/studio/works' ? '← 我的作品' : '← 返回作品')}</a><div class="page-head"><h1>${t('编辑作品信息')}</h1></div><form id="work-edit-form" class="form"><div class="field"><label for="work-edit-name">${t('作品名称')}</label><input id="work-edit-name" name="name" maxlength="80" required value="${e(d.name)}"></div><div class="field"><label for="work-edit-desc">${t('一句介绍')}</label><textarea id="work-edit-desc" name="desc" maxlength="500" required>${e(d.desc)}</textarea></div><div class="field"><label for="work-edit-cover">${t('封面')}</label><div class="work-edit-cover"><div class="work-edit-cover-preview"><img id="work-edit-preview" alt="${t('封面预览')}" hidden><span id="work-edit-no-cover">${t('暂无封面')}</span></div><div class="work-edit-cover-controls"><input id="work-edit-cover" type="file" accept="image/png,image/jpeg,image/webp" aria-label="${t('选择封面')}"><small>${t('PNG、JPG 或 WebP，最大 2 MiB。')}</small><span id="work-edit-cover-name"></span><button class="button quiet small" id="work-edit-cover-reset" type="button" hidden>${t('沿用当前封面')}</button></div></div><p id="work-edit-cover-error" class="error" role="alert"></p></div><section id="work-edit-conflict" class="version-conflict" hidden><p>${t('作品信息已变化，你的修改已保留。')}</p><button id="work-edit-rebase" type="button" class="button small">${t('刷新后继续编辑')}</button></section><p id="work-edit-error" class="error" role="alert"></p><div class="form-footer"><button id="work-edit-submit" class="button primary" type="submit">${t('保存修改')}</button><a class="button quiet" href="#${e(view.returnPath)}">${t('保留草稿并返回')}</a><span id="work-edit-status" class="tiny muted" role="status"></span></div></form></div>`)) return true;
  const form = query('#work-edit-form');
  form.addEventListener('input', event => {
    const field = event.target.name; if (!['name', 'desc'].includes(field) || ctx.pending) return;
    ctx.draft = editWorkDraft(ctx.draft, { [field]: event.target.value }, uuid()); ctx.error = ''; ctx.unauthorized = false; saveDraft(ctx); refresh(view);
  });
  query('#work-edit-cover').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file || ctx.pending) return;
    ctx.fileError = coverFileError(file); if (ctx.fileError) { event.target.value = ''; refresh(view); return; }
    revoke(ctx); ctx.cover = file; ctx.draft = editWorkDraft(ctx.draft, { replaceCover: true }, uuid());
    // A second chosen image changes the request even if replacement mode was already set.
    ctx.draft = { ...ctx.draft, key: uuid(), attempted: false }; ctx.error = ''; ctx.storageWarning = ''; saveDraft(ctx); refresh(view);
    const saved = await fileWrite(ctx, 'put', file); if (!saved && ctx.cover === file) { ctx.storageWarning = '封面尚未保存在本地，刷新页面后需要重新选择。'; refresh(view); }
  });
  query('#work-edit-cover-reset').addEventListener('click', async () => {
    if (ctx.pending) return; revoke(ctx); ctx.cover = null; ctx.fileError = ''; ctx.storageWarning = ''; ctx.error = ''; ctx.draft = editWorkDraft(ctx.draft, { replaceCover: false }, uuid()); saveDraft(ctx); query('#work-edit-cover').value = ''; refresh(view); await fileWrite(ctx, 'delete');
  });
  query('#work-edit-rebase').addEventListener('click', () => rebase(view));
  form.addEventListener('submit', event => { event.preventDefault(); submit(view); });
  refresh(view); return true;
}
