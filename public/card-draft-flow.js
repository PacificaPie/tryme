import { t, registerMessages } from './i18n.js';
import { isCardId, isPublicWorkId } from './public-card-links.js';
import { hasCardDraft, planCardAddition } from './card-addition.js';

registerMessages({
  '加入或更新名片':'Add to or update a card', '更新名片':'Update card', '加入名片':'Add to card',
  '保存为新名片':'Save as a new card',
  '保存会生成新链接，旧名片链接与作品快照保持不变。':'Saving creates a new link. Previous card links and work snapshots stay unchanged.',
  '选择从哪里继续':'Choose a starting point',
  '加入现有草稿':'Add to existing draft', '继续原草稿':'Continue existing draft',
  '从这张名片继续制作':'Continue from this card', '从当前名片继续制作':'Continue from current card',
  '只用这件作品开始':'Start with this work',
  '选择其他起点会替换当前未保存草稿。':'Choosing another starting point replaces your unsaved draft.',
  '新名片使用所选作品在生成预览时的版本、介绍和封面。':'The new card uses the work versions, descriptions and covers available when you generate its preview.',
  '这件作品当前不可加入名片。':'This work is not available for your card.',
  '这张名片不可编辑。':'This card cannot be edited by this account.',
  '草稿已有 30 件作品，请先移除一件，再加入新作品。':'Your draft already has 30 works. Remove one before adding another.',
  '已加入草稿，预览并保存后生效。':'Draft prepared. Preview and save it to create your card.',
  '有 {count} 件作品已不可选，新草稿中将移除；旧名片不受影响。':'{count} works are unavailable and will be removed from the new draft. The old card is unchanged.',
  '暂不加入':'Not now', '返回名片':'Back to cards',
});

export async function renderCardDraftStart(r, { api, readMine, owner, current, getDraft, getPreview, commit, render, esc, notify, go }) {
  const workId = r.params.get('addWork'), cardId = r.params.get('editCard');
  if (r.params.has('addWork') && (!isPublicWorkId(workId) || r.params.has('editCard'))) throw Object.assign(Error(t('这件作品当前不可加入名片。')), { status: 404 });
  if (r.params.has('editCard') && !isCardId(cardId)) throw Object.assign(Error(t('这张名片不可编辑。')), { status: 404 });
  const [works, result] = await Promise.all([readMine(), api(cardId ? '/api/cards/' + encodeURIComponent(cardId) : '/api/cards/me').catch(error => {
    if (!cardId && error.status === 404) return { card: null };
    throw error;
  })]);
  if (!current()) return;
  const work = workId ? works.find(item => item.id === workId && item.authorId === owner && !item.archivedAt) : null;
  const card = result.card?.authorId === owner ? result.card : null;
  if (workId && !work) throw Object.assign(Error(t('这件作品当前不可加入名片。')), { status: 404 });
  if (cardId && !card) throw Object.assign(Error(t('这张名片不可编辑。')), { status: 404 });
  const hasDraft = hasCardDraft(getDraft(), getPreview(), card);
  const removed = card ? planCardAddition({ workId, works, ownerId: owner, card, source: 'card' }).removedCount : 0;
  const back = workId ? '#/published/' + encodeURIComponent(workId) : '#/card/' + encodeURIComponent(cardId);
  if (!render(`<div class="page narrow card-start-page"><a class="back" href="${esc(back)}">${t(workId ? '暂不加入' : '返回名片')}</a><header class="page-head"><div><h1>${t(workId ? '加入名片' : '更新名片')}</h1><p>${esc(work?.name || card.name)}</p></div></header><section class="card-addition"><h2>${t('选择从哪里继续')}</h2><p>${t('保存会生成新链接，旧名片链接与作品快照保持不变。')}</p><div class="card-start-options">${hasDraft ? `<button class="button primary" data-add-source="draft">${t(workId ? '加入现有草稿' : '继续原草稿')}</button>` : ''}${card ? `<button class="button ${hasDraft ? '' : 'primary'}" data-add-source="card">${t(cardId ? '从这张名片继续制作' : '从当前名片继续制作')}</button>` : ''}${workId ? `<button class="button ${hasDraft || card ? '' : 'primary'}" data-add-source="new">${t('只用这件作品开始')}</button>` : ''}</div>${hasDraft ? `<p>${t('选择其他起点会替换当前未保存草稿。')}</p>` : ''}${removed ? `<p class="card-start-notice">${t('有 {count} 件作品已不可选，新草稿中将移除；旧名片不受影响。', { count: removed })}</p>` : ''}<p>${t('新名片使用所选作品在生成预览时的版本、介绍和封面。')}</p><p id="card-addition-error" class="error" role="alert"></p></section></div>`)) return;
  document.querySelectorAll('[data-add-source]').forEach(button => button.addEventListener('click', () => {
    if (!current()) return;
    const plan = planCardAddition({ workId, works, ownerId: owner, card, draft: getDraft(), source: button.dataset.addSource });
    if (plan.error) {
      document.querySelector('#card-addition-error').textContent = t(plan.error === 'CARD_FULL' ? '草稿已有 30 件作品，请先移除一件，再加入新作品。' : '这件作品当前不可加入名片。');
      return;
    }
    commit(plan.draft); notify(t('已加入草稿，预览并保存后生效。')); go('/cards/me');
  }));
}
