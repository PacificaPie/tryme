import { t, registerMessages } from './i18n.js';

registerMessages({
  '暖阳': 'Sunshine', '月光': 'Moonlight', '新芽': 'Sprout', '海浪': 'Wave',
  '{name}的头像': '{name}’s avatar', '创作者': 'Creator',
});

export const AVATAR_PRESETS = Object.freeze([
  { id:'sun', label:'暖阳' }, { id:'moon', label:'月光' },
  { id:'sprout', label:'新芽' }, { id:'wave', label:'海浪' },
]);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const avatarPath = /^(?:\/avatars\/(?:sun|moon|sprout|wave)\.svg|\/api\/public\/avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Avatars are first-party images. Do not allow arbitrary URLs, SVG uploads,
// data URLs or query strings supplied through an imported card/profile.
export function safeAvatarURL(value) {
  return typeof value === 'string' && avatarPath.test(value) ? value : '';
}
export function avatarContent(user = {}) {
  const src = safeAvatarURL(user.avatarUrl), initial = [...String(user.name || t('创作者')).trim()][0] || '?';
  return src ? `<img src="${escape(src)}" alt="" decoding="async">` : `<span class="avatar-initial">${escape(initial)}</span>`;
}
export function avatarMarkup(user = {}, { className = 'avatar', decorative = true, label } = {}) {
  return `<span class="profile-avatar ${escape(className)}" ${decorative ? 'aria-hidden="true"' : `role="img" aria-label="${escape(label || t('{name}的头像',{name:user.name || t('创作者')}))}"`}>${avatarContent(user)}</span>`;
}
