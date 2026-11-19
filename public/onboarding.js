import { t, registerMessages } from './i18n.js';

registerMessages({
  '你想先做什么？':'What would you like to do first?', '从好奇开始，也可以从创作开始。':'Start with curiosity, or with something you made.',
  '发现有意思的作品':'Discover something interesting', '逛一逛，试玩，遇见喜欢的创作者。':'Explore, play, and find creators you like.',
  '发布我的作品':'Share something I made', '上传第一件作品，把它放进自己的名片。':'Publish your first work and give it a place on your card.',
  '随时都可以开始创作。':'You can start creating anytime.', '让大家认识你':'Let people meet you',
  '先取一个公开昵称，接着上传你的第一件作品。':'Choose a public name, then upload your first work.',
  '公开昵称':'Public name', '你希望大家怎么称呼你':'What should people call you?',
  '这个名字会显示在作品和名片上，之后可以修改。':'This name appears on your work and cards. You can change it later.',
  '继续上传作品':'Continue to upload', '继续制作名片':'Continue to your card', '返回选择':'Back to choices',
  '正在保存…':'Saving…', '使用偏好':'Getting started', '制作我的名片':'Create my card',
  '一件作品，就是一个开始。':'One work is a beginning.', '上传作品':'Publish a work',
  '制作名片':'Make your card', '分享给更多人':'Share it with others', '已保存，可以继续了。':'Saved. You’re ready to continue.',
});

export function creatorEntry(path) {
  return ['/publish', '/studio', '/studio/works', '/cards/me'].includes(path);
}
export function onboardingRoute(state, path) {
  if (!state || path === '/welcome') return null;
  if (creatorEntry(path) && state.needsCreatorProfile) return '/welcome?intent=create&next=' + encodeURIComponent(path === '/cards/me' ? '/cards/me' : '/publish');
  return state.required && path === '/feed' ? '/welcome' : null;
}
export function onboardingNext(value, state) {
  return value === '/cards/me' && state?.hasWorks ? '/cards/me' : '/publish';
}

export function mountOnboarding(root, { route, user, state, api, render, esc, current, onSaved, go }) {
  let disposed = false, pending = false, error = '', creating = route.params.get('intent') === 'create';
  let name = user.name === '创作者' || user.name?.includes('@') ? '' : user.name || '';
  const next = onboardingNext(route.params.get('next'), state);
  function draw() {
    if (disposed || !current()) return;
    const content = creating ? `<a href="#/welcome" class="back">← ${t('返回选择')}</a><div class="onboarding-create"><div><p class="onboarding-eyebrow">TRYME / CREATOR</p><h1>${t('让大家认识你')}</h1><p class="onboarding-lead">${t('先取一个公开昵称，接着上传你的第一件作品。')}</p><form id="onboarding-profile"><div class="field"><label for="onboarding-name">${t('公开昵称')}</label><input id="onboarding-name" name="name" autocomplete="nickname" maxlength="80" required placeholder="${t('你希望大家怎么称呼你')}" value="${esc(name)}" aria-describedby="onboarding-name-note" ${pending?'disabled':''}><small id="onboarding-name-note">${t('这个名字会显示在作品和名片上，之后可以修改。')}</small></div><p class="error" role="alert">${esc(error)}</p><button class="button primary" type="submit" ${pending?'disabled aria-busy="true"':''}>${t(pending?'正在保存…':next==='/cards/me'?'继续制作名片':'继续上传作品')} →</button></form></div><aside class="onboarding-road"><div class="onboarding-card-art" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><b>TRYME</b></div><p>${t('一件作品，就是一个开始。')}</p><ol><li>${t('上传作品')}</li><li>${t('制作名片')}</li><li>${t('分享给更多人')}</li></ol></aside></div>` : `<p class="onboarding-eyebrow">WELCOME TO TRYME</p><h1>${t('你想先做什么？')}</h1><p class="onboarding-lead">${t('从好奇开始，也可以从创作开始。')}</p><div class="onboarding-options"><button type="button" data-onboarding="discover" ${pending?'disabled':''}><span class="onboarding-option-art discover-art" aria-hidden="true">↗</span><strong>${t('发现有意思的作品')}</strong><span>${t('逛一逛，试玩，遇见喜欢的创作者。')}</span><i aria-hidden="true">→</i></button><button type="button" data-onboarding="create" ${pending?'disabled':''}><span class="onboarding-option-art create-art" aria-hidden="true">＋</span><strong>${t('发布我的作品')}</strong><span>${t('上传第一件作品，把它放进自己的名片。')}</span><i aria-hidden="true">→</i></button></div><p class="error" role="alert">${esc(error)}</p><p class="onboarding-footnote" role="status">${t(pending?'正在保存…':'随时都可以开始创作。')}</p>`;
    if (!render(`<div class="page onboarding-page">${content}</div>`)) return;
    root.querySelector('[data-onboarding="discover"]')?.addEventListener('click', () => save('discover'));
    root.querySelector('[data-onboarding="create"]')?.addEventListener('click', () => { go('/welcome?intent=create'); });
    root.querySelector('#onboarding-name')?.addEventListener('input', event => { name = event.target.value; });
    root.querySelector('#onboarding-profile')?.addEventListener('submit', event => { event.preventDefault(); save('create'); });
  }
  async function save(intent) {
    if (pending || disposed || !current()) return;
    pending = true; error = ''; draw();
    try {
      const result = await api('/api/me/onboarding', { method:'POST', body:{intent, ...(intent==='create'?{name:name.trim()}:{})} });
      if (disposed || !current() || result.user.id !== user.id) return;
      onSaved(result); go(intent === 'discover' ? '/feed' : next);
    } catch (failure) { if (!disposed && current()) { error = t(failure.message); pending = false; draw(); } }
    finally { pending = false; }
  }
  draw();
  return { get pending() { return pending; }, dispose() { disposed = true; } };
}
