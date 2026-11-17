const baseFor = work => ({ name: work.name, desc: work.desc, coverUrl: work.coverUrl || '' });
export function newWorkEditDraft(work, key) {
  return { key, expectedRevision: work.revision, base: baseFor(work), name: work.name, desc: work.desc, replaceCover: false, attempted: false };
}
export function workEditChanged(draft) {
  return draft.replaceCover || draft.name.trim() !== draft.base.name.trim() || draft.desc.trim() !== draft.base.desc.trim();
}
export function editWorkDraft(draft, values, key) {
  if (Object.entries(values).every(([field, value]) => draft[field] === value)) return draft;
  return { ...draft, ...values, key, attempted: false };
}
// Rebase only after an explicit refresh. Keep edited fields, adopt server values
// for untouched fields, and leave a selected replacement cover in place.
export function rebaseWorkEditDraft(draft, work, key) {
  return {
    ...draft, key, expectedRevision: work.revision, base: baseFor(work), attempted: false,
    name: draft.name.trim() === draft.base.name.trim() ? work.name : draft.name,
    desc: draft.desc.trim() === draft.base.desc.trim() ? work.desc : draft.desc,
  };
}
export function coverFileError(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return '请选择 PNG、JPG 或 WebP 图片。';
  if (!file.size) return '图片文件为空，请重新选择。';
  if (file.size > 2 * 1024 * 1024) return '封面不能超过 2 MiB，请压缩图片后重新选择。';
  return '';
}
export function workEditReturnPath(value, workId) {
  if (typeof value !== 'string') return '/studio/works';
  const [path, query = ''] = value.split('?');
  const params = new URLSearchParams(query);
  // Only return to this live work; never turn an edit into a snapshot or autoplay.
  if (path !== '/work/' + encodeURIComponent(workId) || params.has('card')) return '/studio/works';
  params.delete('play');
  return path + (params.size ? '?' + params : '');
}
