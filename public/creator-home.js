import { t, registerMessages, localeNumber } from './i18n.js';
import { avatarMarkup } from './avatars.js';
import { CARD_TEMPLATES } from './card-templates.js';
import { cardRemixPath } from './card-remix.js';

registerMessages({
  '创作者': 'Creator', '我的主页': 'My profile', '编辑个人资料': 'Edit profile',
  '更换头像': 'Change avatar', '关注': 'Follow', '已关注': 'Following',
  '正在关注…': 'Following…', '正在取消…': 'Unfollowing…',
  '关注结果尚未确认，请重试。': 'The follow status could not be confirmed. Please retry.',
  '关注状态已更新': 'Follow status updated',
  '关注者': 'Followers', '正在关注': 'Following', '公开作品': 'Public works',
  '分享主页': 'Share profile',
  '来看看 {name} 在 TryMe 的作品和名片吧！': 'Explore {name}’s works and creator card on TryMe!',
  '看看名片': 'View card', '名片陈列': 'Creator card', '名片封面': 'Card cover',
  '{name} 的名片': '{name}’s card', '名片中有 {count} 件作品': '{count} works in this card',
  '制作我的名片': 'Create my card', '选几件作品，制作一张属于你的名片。': 'Choose a few works and make a card of your own.',
  '还没有公开名片': 'No public card yet', '重新制作': 'Make a new card', '删除名片': 'Delete card',
  '个人网址': 'Website', '墨黑': 'Ink', '象牙白': 'Ivory', '钴蓝': 'Cobalt',
  '全部作品': 'All works', '返回': 'Back',
  '更新名片封面':'Update card covers',
});

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const plus = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>';
const check = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>';
const share = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 12V2m-4 4 4-4 4 4M5 8H3v9h14V8h-2"/></svg>';

function localCover(value) {
  if (typeof value !== 'string') return '';
  const allowed = /^\/(?:media\/[A-Za-z0-9_-]{8,128}|api\/public\/cards\/[a-f0-9-]{36}\/works\/[A-Za-z0-9_-]{8,128}\/cover)$/i;
  return allowed.test(value) ? value : '';
}

function externalWebsite(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function creatorProfilePath(id) { return '/site#/author/' + encodeURIComponent(String(id)); }

// Lightweight template miniatures share saved content, not a generic layout.
// They remain one accessible link; full 3D interaction stays in the card viewer.
export function creatorCardPreview(card, { esc = escape, safeCover = localCover } = {}) {
  const works = Array.isArray(card?.works) ? card.works : [];
  const appearance = ['ink', 'ivory', 'cobalt'].includes(card?.backStyle) ? card.backStyle : 'ink';
  const template = CARD_TEMPLATES.find(item => item.id === card?.template);
  const image = work => {
    const source = safeCover(work?.coverUrl);
    return source ? `<img src="${esc(source)}" alt="" loading="lazy">` : `<span class="creator-card-cover-placeholder">${esc(work?.name || '')}</span>`;
  };
  return `<span class="creator-card-object" data-card-paper="${appearance}" data-card-template="${template?.id||'wall'}" aria-hidden="true"><span class="creator-card-object-top"><span>TRYME</span><span>${esc(t('名片封面'))}</span></span><span class="creator-card-object-art" data-count="${Math.min(works.length, 3)}">${works.slice(0, 3).map(image).join('')}</span><span class="creator-card-object-person">${avatarMarkup({ name: card?.name, avatarUrl: card?.avatarUrl }, { className: 'creator-card-object-avatar' })}<span class="creator-card-object-name">${esc(card?.name || t('创作者'))}</span></span>${card?.headline ? `<span class="creator-card-object-headline">${esc(card.headline)}</span>` : ''}<span class="creator-card-object-bottom"><span>${esc(template ? t(template.name) : t('创作者名片'))}</span><span>${localeNumber(works.length)}</span></span></span>`;
}

export function creatorHomeMarkup({ creator, card, me, esc = escape, safeCover, profileURL = '', backHref = '#/feed' }) {
  const own = creator.id === me?.id;
  const back = typeof backHref === 'string' && backHref.startsWith('#/') ? backHref : '#/feed';
  const website = externalWebsite(creator.website);
  const template = CARD_TEMPLATES.find(item => item.id === card?.template);
  const followingCount = `<strong>${localeNumber(count(creator.followingCount))}</strong> ${t('正在关注')}`;
  const countLabel = `<div class="creator-home-counts"><span><strong>${localeNumber(count(creator.worksCount))}</strong> ${t('公开作品')}</span><span><strong data-creator-followers>${localeNumber(count(creator.followersCount))}</strong> ${t('关注者')}</span>${own ? `<a class="creator-home-following" href="#/following">${followingCount}</a>` : `<span>${followingCount}</span>`}</div>`;
  const profileAvatar = avatarMarkup(creator, { className: 'creator-home-avatar' });
  const avatar = own ? `<button type="button" class="creator-home-avatar-edit" data-edit-profile aria-label="${esc(t('更换头像'))}">${profileAvatar}</button>` : profileAvatar;
  const follow = own ? `<button type="button" class="button" data-edit-profile>${t('编辑个人资料')}</button>` : `<button type="button" class="button creator-follow-button ${creator.followedByMe ? '' : 'primary'}" data-creator-follow aria-pressed="${Boolean(creator.followedByMe)}">${creator.followedByMe ? check : plus}<span>${t(creator.followedByMe ? '已关注' : '关注')}</span></button>`;
  const shared = profileURL ? `<button type="button" class="button quiet" data-share-url="${esc(profileURL)}" data-share-title="${esc(creator.name)}" data-share-text="${esc(t('来看看 {name} 在 TryMe 的作品和名片吧！', { name: creator.name }))}">${share}${t('分享主页')}</button>` : '';
  const identity = `<section class="creator-home-identity">${avatar}<div class="creator-home-copy"><h1>${esc(creator.name || t('创作者'))}</h1>${creator.headline ? `<p class="creator-home-headline">${esc(creator.headline)}</p>` : ''}${creator.bio ? `<p class="creator-home-bio">${esc(creator.bio)}</p>` : ''}${website ? `<a class="creator-home-website" href="${esc(website.href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t('个人网址'))}: ${esc(website.hostname)}">${esc(website.hostname)} ↗</a>` : ''}${countLabel}<div class="creator-home-actions">${follow}${shared}</div><p class="creator-follow-status" role="status" aria-live="polite" hidden></p></div></section>`;
  let exhibit = '';
  if (card) {
    const href = '#/card/' + encodeURIComponent(card.id);
    const label = t('{name} 的名片', { name: card.name });
    const cardActions = own
      ? `<div class="creator-home-card-actions creator-card-owner-actions"><a class="text-link" href="#/cards/me">${t('重新制作')}</a><a class="text-link" href="#/cards/covers/${encodeURIComponent(card.id)}">${t('更新名片封面')}</a><button type="button" class="button quiet small danger-text" data-delete-card="${esc(card.id)}" data-card-name="${esc(card.name)}">${t('删除名片')}</button></div>`
      : `<div class="creator-home-card-actions creator-card-visitor-actions"><a class="text-link" href="#${esc(cardRemixPath(card.id))}">${t('用同款制作')}</a></div>`;
    exhibit = `<section class="creator-home-card" aria-label="${esc(t('名片陈列'))}"><a class="creator-card-stage" href="${esc(href)}" aria-label="${esc(label)}">${creatorCardPreview(card, { esc, safeCover })}</a><div class="creator-card-caption"><div><h2>${esc(label)}</h2><p>${esc(template ? t(template.name) : t('创作者名片'))} · ${esc(t('名片中有 {count} 件作品', { count: localeNumber(Array.isArray(card.works) ? card.works.length : 0) }))}</p></div><a class="text-link" href="${esc(href)}">${t('看看名片')} <span aria-hidden="true">↗</span></a></div>${cardActions}</section>`;
  } else if (own) exhibit = `<section class="creator-home-card creator-home-card-empty" aria-label="${esc(t('名片陈列'))}"><span class="creator-card-empty-paper" aria-hidden="true"><span>TRYME</span><b>＋</b></span><h2>${t('制作我的名片')}</h2><p>${t('选几件作品，制作一张属于你的名片。')}</p><a class="button" href="#/cards/me">${t('制作名片')}</a></section>`;
  return `<a class="back" href="${esc(back)}">← ${t('返回')}</a><div class="creator-home-hero ${exhibit ? '' : 'without-card'}">${identity}${exhibit}</div><section class="creator-home-works discovery-page" aria-label="${esc(t('全部作品'))}" data-creator-works></section>`;
}

export async function updateCreatorFollow(api, creatorId, following) {
  const result = await api('/api/creators/' + encodeURIComponent(creatorId) + '/follow', { method: 'POST', body: { following }, signal: AbortSignal.timeout(30000) });
  if (result?.creatorId !== creatorId || result?.following !== following || !Number.isSafeInteger(result?.followersCount) || result.followersCount < 0) throw new Error(t('关注结果尚未确认，请重试。'));
  return result;
}

export function mountCreatorHome(root, options) {
  const { creator, api, onEditProfile, onFollowChange } = options;
  const origin = globalThis.location?.origin;
  const profileURL = options.profileURL || (origin ? origin + creatorProfilePath(creator.id) : '');
  root.classList.add('creator-home-page');
  root.innerHTML = creatorHomeMarkup({ ...options, profileURL });
  let disposed = false, pending = false, following = Boolean(creator.followedByMe);
  const button = root.querySelector('[data-creator-follow]');
  const status = root.querySelector('.creator-follow-status');
  const followers = root.querySelector('[data-creator-followers]');
  const alive = () => !disposed && root.isConnected;
  function paint() {
    if (!button) return;
    button.disabled = pending;
    button.setAttribute('aria-busy', String(pending));
    button.setAttribute('aria-pressed', String(following));
    button.classList.toggle('primary', !following);
    button.innerHTML = (following ? check : plus) + '<span>' + t(pending ? following ? '正在取消…' : '正在关注…' : following ? '已关注' : '关注') + '</span>';
  }
  const click = async event => {
    if (event.target.closest('[data-edit-profile]')) { onEditProfile?.(); return; }
    if (!event.target.closest('[data-creator-follow]') || pending || !alive()) return;
    const desired = !following; pending = true; status.hidden = true; paint();
    let confirmed;
    try {
      confirmed = await updateCreatorFollow(api, creator.id, desired);
      following = confirmed.following;
      if (alive()) { followers.textContent = localeNumber(confirmed.followersCount); status.textContent = t('关注状态已更新'); status.hidden = false; }
    } catch {
      if (alive()) { status.textContent = t('关注结果尚未确认，请重试。'); status.hidden = false; }
    } finally { pending = false; if (alive()) paint(); }
    // A confirmed write still invalidates feed caches after a route change.
    if (confirmed) onFollowChange?.(confirmed);
  };
  root.addEventListener('click', click);
  return { worksRoot: root.querySelector('[data-creator-works]'), dispose() { disposed = true; root.removeEventListener('click', click); } };
}
