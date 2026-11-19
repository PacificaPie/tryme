import { t, registerMessages } from './i18n.js';

registerMessages({
  '让你的作品，也在这里被看见。':'Give your work a place to be discovered.',
  '上传第一件作品，再把作品做成可分享的名片。':'Upload your first work, then turn it into a card you can share.',
  '上传第一件作品':'Upload your first work', '先随便看看':'Just browsing for now',
  '逛一逛，试玩，遇见喜欢的创作者。':'Explore, play, and find creators you like.',
  '上传作品，把它放进自己的名片。':'Upload a work and give it a place on your card.',
  '随时都可以开始创作。':'You can start creating anytime.', '让大家认识你':'Let people meet you',
  '先取一个公开昵称，接着上传你的第一件作品。':'Choose a public name, then upload your first work.',
  '公开昵称':'Public name', '你希望大家怎么称呼你':'What should people call you?',
  '这个名字会显示在作品和名片上，之后可以修改。':'This name appears on your work and cards. You can change it later.',
  '继续上传作品':'Continue to upload', '继续制作名片':'Continue to your card', '返回选择':'Back to choices',
  '正在保存…':'Saving…', '开始创作':'Start creating', '制作我的名片':'Create my card',
  '一件作品，就是一个开始。':'One work is a beginning.', '上传作品':'Publish a work',
  '制作名片':'Make your card', '分享给更多人':'Share it with others', '已保存，可以继续了。':'Saved. You’re ready to continue.',
});

export function creatorEntry(path) {
  return ['/publish', '/cards/me'].includes(path);
}
export function onboardingRoute(state, path) {
  if (!state || path === '/welcome') return null;
  if (creatorEntry(path) && state.needsCreatorProfile) return '/welcome?intent=create&next=' + encodeURIComponent(path === '/cards/me' ? '/cards/me' : '/publish');
  return null;
}
export function onboardingNext(value, state) {
  return value === '/cards/me' && state?.hasWorks ? '/cards/me' : '/publish';
}

// Browsing is a local dismissal, not a role or a required server write. Scope it
// to this account; denied storage still permits dismissal for this document.
export function createOnboardingInvitation({ storage = () => globalThis.localStorage } = {}) {
  const dismissed = new Set();
  const key = id => 'tryme.onboarding.dismissed.v1:' + id;
  return {
    visible(user, state) {
      if (!user?.id || !state?.required || state.creatorReady || state.hasWorks || state.hasCard || dismissed.has(user.id)) return false;
      try { return storage()?.getItem(key(user.id)) !== '1'; } catch { return true; }
    },
    dismiss(user) {
      if (!user?.id) return;
      dismissed.add(user.id);
      try { storage()?.setItem(key(user.id), '1'); } catch { /* Browsing remains available. */ }
    },
  };
}

export function onboardingInvitationMarkup() {
  return `<section class="onboarding-invitation" aria-labelledby="onboarding-invitation-title"><div><p class="onboarding-eyebrow">WELCOME TO TRYME</p><h2 id="onboarding-invitation-title">${t('让你的作品，也在这里被看见。')}</h2><p>${t('上传第一件作品，再把作品做成可分享的名片。')}</p></div><div class="onboarding-invitation-actions"><a class="button primary" href="#/publish">${t('上传第一件作品')} →</a><button type="button" class="button quiet" data-onboarding-browse>${t('先随便看看')}</button></div></section>`;
}

export function mountOnboarding(root, { route, user, state, api, render, esc, current, onSaved, onBrowse, go }) {
  let disposed = false, pending = false, error = '', creating = route.params.get('intent') === 'create';
  let name = user.name === '创作者' || user.name?.includes('@') ? '' : user.name || '';
  const next = onboardingNext(route.params.get('next'), state);
  function draw() {
    if (disposed || !current()) return;
    const browse = `<button type="button" class="button quiet" data-onboarding-browse>${t('先随便看看')}</button>`;
    const content = creating ? `<a href="#/welcome" class="back">← ${t('返回选择')}</a><div class="onboarding-create"><div><p class="onboarding-eyebrow">TRYME / CREATOR</p><h1>${t('让大家认识你')}</h1><p class="onboarding-lead">${t('先取一个公开昵称，接着上传你的第一件作品。')}</p><form id="onboarding-profile"><div class="field"><label for="onboarding-name">${t('公开昵称')}</label><input id="onboarding-name" name="name" autocomplete="nickname" maxlength="80" required placeholder="${t('你希望大家怎么称呼你')}" value="${esc(name)}" aria-describedby="onboarding-name-note" ${pending?'disabled':''}><small id="onboarding-name-note">${t('这个名字会显示在作品和名片上，之后可以修改。')}</small></div><p class="error" role="alert">${esc(error)}</p><div class="onboarding-profile-actions"><button class="button primary" type="submit" ${pending?'disabled aria-busy="true"':''}>${t(pending?'正在保存…':next==='/cards/me'?'继续制作名片':'继续上传作品')} →</button>${browse}</div></form></div><aside class="onboarding-road"><div class="onboarding-card-art" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><b>TRYME</b></div><p>${t('一件作品，就是一个开始。')}</p><ol><li>${t('上传作品')}</li><li>${t('制作名片')}</li><li>${t('分享给更多人')}</li></ol></aside></div>` : `<p class="onboarding-eyebrow">WELCOME TO TRYME</p><h1>${t('让你的作品，也在这里被看见。')}</h1><p class="onboarding-lead">${t('上传第一件作品，再把作品做成可分享的名片。')}</p><div class="onboarding-options"><a href="#${next}" data-onboarding="create"><span class="onboarding-option-art create-art" aria-hidden="true">＋</span><strong>${t(state?.hasWorks?'上传作品':'上传第一件作品')}</strong><span>${t('上传作品，把它放进自己的名片。')}</span><i aria-hidden="true">→</i></a><button type="button" data-onboarding-browse><span class="onboarding-option-art discover-art" aria-hidden="true">↗</span><strong>${t('先随便看看')}</strong><span>${t('逛一逛，试玩，遇见喜欢的创作者。')}</span><i aria-hidden="true">→</i></button></div><p class="onboarding-footnote">${t('随时都可以开始创作。')}</p>`;
    if (!render(`<div class="page onboarding-page">${content}</div>`)) return;
    root.querySelector('[data-onboarding-browse]')?.addEventListener('click', () => {
      if (disposed || !current()) return;
      // Do not let a late nickname save navigate away after choosing to browse.
      disposed = true;
      onBrowse();
      go('/feed');
    });
    root.querySelector('#onboarding-name')?.addEventListener('input', event => { name = event.target.value; });
    root.querySelector('#onboarding-profile')?.addEventListener('submit', event => { event.preventDefault(); save(); });
  }
  async function save() {
    if (pending || disposed || !current()) return;
    pending = true; error = ''; draw();
    try {
      const result = await api('/api/me/onboarding', { method:'POST', body:{intent:'create', name:name.trim()} });
      if (disposed || !current() || result.user.id !== user.id) return;
      onSaved(result); go(next);
    } catch (failure) { if (!disposed && current()) { error = t(failure.message); pending = false; draw(); } }
    finally { pending = false; }
  }
  draw();
  return { get pending() { return pending; }, dispose() { disposed = true; } };
}
