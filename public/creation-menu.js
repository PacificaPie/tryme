import {t,registerMessages} from './i18n.js';
registerMessages({'新建':'Create','上传作品':'Publish a work','制作名片':'Create a card'});
export function creationMenuMarkup(){
 return `<details class="creation-menu"><summary aria-label="${t('新建')}" title="${t('新建')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></summary><div class="creation-options"><a href="#/publish"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4M5 15v5h14v-5"/></svg>${t('上传作品')}</a><a href="#/cards/me"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M7 3h11M7 10h4m-4 5h10"/></svg>${t('制作名片')}</a></div></details>`;
}
