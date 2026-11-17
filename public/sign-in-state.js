import { t, registerMessages } from './i18n.js';

registerMessages({
  '登录 Funtrack': 'Sign in to Funtrack',
  '登录 / 注册': 'Sign in / Sign up',
});

const covers = ['memory-tide', 'mini-sudoku', 'arc-hoops', 'pulse-lanes'];

// These are the covers of playable examples, not interactive work cards. Keep
// the entire illustration outside the reading and keyboard navigation order.
export function signInState(action) {
  return `<div class="page sign-in-page"><section class="sign-in-state" aria-labelledby="sign-in-title">
    <div class="sign-in-art" aria-hidden="true">${covers.map((cover, index) => `<div class="sign-in-cover sign-in-cover-${index + 1}"><img src="/examples/${cover}.png" width="1200" height="750" alt="" draggable="false" decoding="async"></div>`).join('')}</div>
    <div class="sign-in-copy"><h1 id="sign-in-title">${t('登录 Funtrack')}</h1><div class="sign-in-action">${action}</div></div>
  </section></div>`;
}
