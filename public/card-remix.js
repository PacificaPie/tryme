import { CARD_TEMPLATES } from './card-templates.js';
import { registerMessages } from './i18n.js';

registerMessages({
  '用同款制作': 'Use this template',
  '使用这个模板': 'Use this template',
  '同款名片': 'Make a card like this',
  '沿用模板和卡背样式，资料与作品由你自己选择。': 'Keep the layout and card-back style, then use your own profile and works.',
  '你有未完成的名片草稿。使用同款会开始一份新草稿。': 'You have an unfinished card draft. Using this template will start a new draft.',
});

const templates = new Set(CARD_TEMPLATES.map(template => template.id));
const backStyles = new Set(['ink', 'ivory', 'cobalt']);
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

// This explicit projection is the reuse boundary. A future visual setting must
// be deliberately added here; a source card's identity/content never spreads.
export function remixStyle(card) {
  const template = templates.has(card?.template) ? card.template : 'wall';
  return { template, backStyle: backStyles.has(card?.backStyle) ? card.backStyle : 'ink' };
}

export function createRemixDraft(card, user) {
  return {
    ids: [], ...remixStyle(card),
    signature: text(user?.signature, 80),
  };
}

export function cardRemixPath(cardId) {
  return '/cards/me?templateFrom=' + encodeURIComponent(String(cardId));
}
