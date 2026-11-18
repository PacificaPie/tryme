import { t, registerMessages } from './i18n.js';

registerMessages({
  '登录 TryMe': 'Sign in to TryMe',
  '登录 / 注册': 'Sign in / Sign up',
  '登录后即可试玩、发布作品和制作名片。': 'Sign in to play, publish works, and create your card.',
  '继续浏览 Feed': 'Keep exploring the Feed',
});

const illustration = (background, shapes) => `<svg viewBox="0 0 320 200" width="320" height="200" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="200" fill="${background}"/>${shapes}</svg>`;

// A small, language-neutral collection of play motifs, not specific games.
// Keep the decoration outside the reading and keyboard navigation order.
const illustrations = [
  illustration('#edf3ee', `
    <rect x="82" y="42" width="68" height="68" rx="15" fill="#7d9e91"/>
    <path d="M116 61v30m-15-15h30" fill="none" stroke="#edf3ee" stroke-width="8" stroke-linecap="round"/>
    <rect x="164" y="42" width="68" height="68" rx="15" fill="#d8e5d9"/>
    <circle cx="198" cy="76" r="14" fill="#88a697"/>
    <rect x="82" y="124" width="68" height="34" rx="12" fill="#d8e5d9"/>
    <rect x="164" y="124" width="68" height="34" rx="12" fill="#fbfaf3"/>
    <circle cx="198" cy="141" r="10" fill="#d9b67b"/>
  `),
  illustration('#f3f0e7', `
    <path d="M84 146V54h56m36 0h60v92h-56m-40 0H84m56-92v42h40v50" fill="none" stroke="#89959c" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M108 123V77h9m-9 46h55" fill="none" stroke="#c8d0cc" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 11"/>
    <circle cx="205" cy="79" r="13" fill="#d6ad76"/>
    <circle cx="158" cy="146" r="6" fill="#abb9b4"/>
  `),
  illustration('#e7eff3', `
    <path d="M65 143Q114 25 172 76T254 117" fill="none" stroke="#a1b7c1" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 11"/>
    <rect x="59" y="153" width="75" height="9" rx="4.5" fill="#8da5af"/>
    <rect x="205" y="130" width="53" height="9" rx="4.5" fill="#b1c3cb"/>
    <circle cx="158" cy="67" r="21" fill="#d5a875"/>
    <circle cx="152" cy="61" r="6" fill="#e6c49d"/>
  `),
  illustration('#f3ece7', `
    <path d="M91 47h64v30h-32v32H91Z" fill="#b9917e" stroke="#b9917e" stroke-width="8" stroke-linejoin="round"/>
    <path d="M179 84h30v40h32v30h-62Z" fill="#8d9990" stroke="#8d9990" stroke-width="8" stroke-linejoin="round"/>
    <rect x="87" y="128" width="34" height="30" rx="7" fill="#d6c8c0"/>
    <rect x="132" y="128" width="34" height="30" rx="7" fill="#d6c8c0"/>
    <path d="m221 44 4 10 10 4-10 4-4 10-4-10-10-4 10-4Z" fill="#c9ad93"/>
  `),
];

export function signInState(action) {
  return `<div class="page sign-in-page"><section class="sign-in-state" aria-labelledby="sign-in-title">
    <div class="sign-in-art" aria-hidden="true">${illustrations.map((art, index) => `<div class="sign-in-cover sign-in-cover-${index + 1}">${art}</div>`).join('')}</div>
    <div class="sign-in-copy"><h1 id="sign-in-title">${t('登录 TryMe')}</h1><p>${t('登录后即可试玩、发布作品和制作名片。')}</p><div class="sign-in-action">${action}</div><p><a href="#/feed">${t('继续浏览 Feed')}</a></p></div>
  </section></div>`;
}
