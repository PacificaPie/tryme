import { t, registerMessages } from './i18n.js';
import { closeDialog } from './experience.js?v=20261117-creator-actions';

registerMessages({
  '看看我在 Funtrack 制作的名片吧！': 'Take a look at the card I made on Funtrack!',
  '来看看 {name} 在 Funtrack 的名片吧！': 'Take a look at {name}’s card on Funtrack!',
  '分享给朋友': 'Share with friends', '分享文案': 'Share message',
  '复制文案和链接': 'Copy message and link', '只复制链接': 'Copy link only',
  '文案和链接已复制，发给朋友吧！': 'Message and link copied. Send it to a friend!',
  '请选中上方内容手动复制。': 'Select the text above to copy it manually.',
});

export const cardShareText = (card, own) => own ? t('看看我在 Funtrack 制作的名片吧！') : t('来看看 {name} 在 Funtrack 的名片吧！', { name: card.name });
export const shareMessage = (text, url) => text ? `${text}\n${url}` : url;

export function openShareDialog({ url, title = '', text = '' }) {
  document.querySelector('#share-link-dialog')?.remove();
  const previous = document.activeElement, dialog = document.createElement('dialog');
  dialog.id = 'share-link-dialog'; dialog.className = 'share-dialog';
  dialog.setAttribute('aria-labelledby', 'share-title');
  dialog.innerHTML = `<div class="share-dialog-head"><h2 id="share-title"></h2><button class="share-close" type="button">×</button></div><p class="share-item-title"></p><textarea class="share-message" readonly rows="4"></textarea><div class="share-dialog-actions"><button class="button primary share-copy" type="button"></button><button class="button quiet share-link-only" type="button"></button><button class="button quiet share-native" type="button"></button></div><p class="share-status" role="status" aria-live="polite"></p>`;
  const q = selector => dialog.querySelector(selector), message = shareMessage(text, url);
  q('h2').textContent = t(text ? '分享给朋友' : '分享链接');
  q('.share-close').setAttribute('aria-label', t('关闭'));
  q('.share-item-title').textContent = title;
  q('.share-item-title').hidden = !title;
  q('textarea').value = message;
  q('textarea').setAttribute('aria-label', t(text ? '分享文案' : '可分享的链接'));
  q('.share-copy').textContent = t(text ? '复制文案和链接' : '复制链接');
  q('.share-link-only').textContent = t('只复制链接'); q('.share-link-only').hidden = !text;
  q('.share-native').textContent = t('更多分享方式'); q('.share-native').hidden = typeof navigator.share !== 'function';
  const copy = async (value, button) => {
    button.disabled = true;
    try { await navigator.clipboard.writeText(value); q('.share-status').className = 'share-status success'; q('.share-status').textContent = t(value === message && text ? '文案和链接已复制，发给朋友吧！' : '链接已复制。'); }
    catch { q('textarea').value = value; q('textarea').focus(); q('textarea').select(); q('.share-status').className = 'share-status'; q('.share-status').textContent = t('请选中上方内容手动复制。'); }
    finally { button.disabled = false; }
  };
  q('.share-copy').onclick = event => copy(message, event.currentTarget);
  q('.share-link-only').onclick = event => copy(url, event.currentTarget);
  q('.share-native').onclick = async () => {
    try { await navigator.share({ title: title || 'Funtrack', text, url }); }
    catch (error) { if (error?.name !== 'AbortError') q('.share-status').textContent = t('未能打开系统分享，请复制链接。'); }
  };
  q('.share-close').onclick = () => closeDialog(dialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const b = dialog.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) closeDialog(dialog);
  });
  dialog.addEventListener('close', () => { dialog.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); }, { once: true });
  document.body.appendChild(dialog); dialog.showModal(); q('.share-copy').focus();
  return dialog;
}
