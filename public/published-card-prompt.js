import { t, registerMessages } from './i18n.js';
import { isPublicWorkId } from './public-card-links.js';

registerMessages({
  '要把这件作品加入名片吗？': 'Add this work to your card?',
  '继续制作，预览并保存后生效。': 'Continue to the card builder, then preview and save.',
  '加入名片': 'Add to card',
  '暂不加入': 'Not now',
  '加入或更新名片': 'Add to or update a card',
});

const eligible = (owner, work) => Boolean(owner && work?.authorId === owner && isPublicWorkId(work.id) && !work.archivedAt);

// Only a successful publication in this document can offer the question. Keeping
// this ephemeral prevents refresh/back/direct links from reopening it; the normal
// card-builder link remains available. Same-route locale changes keep the offer.
export function createPublishedCardPrompt() {
  let pending = null;
  const seen = new Set();
  const key = (owner, work) => JSON.stringify([owner, work?.id]);
  const matches = (owner, work) => eligible(owner, work) && pending?.key === key(owner, work);
  return {
    published(owner, work) {
      if (!eligible(owner, work) || seen.has(key(owner, work))) return false;
      seen.add(key(owner, work));
      pending = { key: key(owner, work), path: '/published/' + encodeURIComponent(work.id) };
      return true;
    },
    onRoute(path) { if (pending && path !== pending.path) pending = null; },
    shouldOffer: matches,
    resolve(owner, work) {
      if (!matches(owner, work)) return false;
      pending = null;
      return true;
    },
  };
}

export function publishedCardChoiceMarkup(owner, work, offered) {
  if (!eligible(owner, work)) return '';
  return `<div id="published-card-choice"><section class="published-card-prompt" aria-labelledby="published-card-question" ${offered ? '' : 'hidden'}><h2 id="published-card-question">${t('要把这件作品加入名片吗？')}</h2><p>${t('继续制作，预览并保存后生效。')}</p><div class="published-card-actions"><button type="button" class="button primary" data-published-card="add">${t('加入名片')}</button><button type="button" class="button quiet" data-published-card="later">${t('暂不加入')}</button></div></section><p class="published-card-later" ${offered ? 'hidden' : ''}><a class="button" href="#/cards/me?addWork=${encodeURIComponent(work.id)}">${t('加入或更新名片')}</a></p></div>`;
}

export function mountPublishedCardChoice(root, { prompt, owner, work, current, go }) {
  if (!root) return;
  root.querySelectorAll('[data-published-card]').forEach(button => button.addEventListener('click', () => {
    if (!current() || !prompt.resolve(owner, work)) return;
    root.querySelector('.published-card-prompt').hidden = true;
    const later = root.querySelector('.published-card-later');
    later.hidden = false;
    if (button.dataset.publishedCard === 'add') go('/cards/me?addWork=' + encodeURIComponent(work.id));
    else later.querySelector('a').focus({ preventScroll: true });
  }));
}
