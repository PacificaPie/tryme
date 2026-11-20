import { t, registerMessages, getLocale } from './i18n.js';
import { closeDialog } from './experience.js?v=20261117-creator-actions';

registerMessages({
  '看看我在 TryMe 制作的名片吧！': 'Take a look at the card I made on TryMe!',
  '来看看 {name} 在 TryMe 的名片吧！': 'Take a look at {name}’s card on TryMe!',
  '分享给朋友': 'Share with friends', '分享文案': 'Share message',
  '复制文案和链接': 'Copy message and link', '只复制链接': 'Copy link only',
  '文案和链接已复制，发给朋友吧！': 'Message and link copied. Send it to a friend!',
  '请选中上方内容手动复制。': 'Select the text above to copy it manually.',
  '扫码查看名片':'Scan to view card', '生成分享图':'Create share image', '生成中…':'Creating…',
  '保存图片':'Save image', '分享图':'Share image', '分享名片':'Share card',
  '打开原图':'Open full image', '分享图片':'Share image file',
  '若未开始下载，可打开原图后长按保存；也可复制链接。':'If downloading does not start, open the full image and press and hold to save, or copy the link.',
  '未能分享图片，可下载或打开原图保存。':'Could not share the image. Download it or open the full image to save.',
  '分享图包含姓名、作品和二维码；动态效果需打开链接查看。':'The image includes your name, works and QR code. Open the link for the interactive card.',
  '分享图生成失败，仍可复制链接。':'The image could not be created. You can still copy the link.',
  '名片已不可访问，请返回检查。':'This card is no longer available. Return to check it.',
  '图片不会随名片更新，分享前请重新生成。':'Saved images do not update with the card. Regenerate before sharing.',
});

export const cardShareText = (card, own) => own ? t('看看我在 TryMe 制作的名片吧！') : t('来看看 {name} 在 TryMe 的名片吧！', { name: card.name });
export const shareMessage = (text, url) => text ? `${text}\n${url}` : url;

export function openShareDialog({ url, title = '', text = '', returnFocus = null }) {
  const previousDialog = document.querySelector('#share-link-dialog');
  if (previousDialog) { previousDialog.close(); previousDialog.remove(); }
  // Safari does not focus a button on pointer activation. Let callers retain
  // the actual trigger instead of restoring focus to the document body.
  const previous = returnFocus || document.activeElement, dialog = document.createElement('dialog');
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
    try { await navigator.share({ title: title || 'TryMe', text, url }); }
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
  mountCardExport(dialog, url);
  return dialog;
}

async function mountCardExport(dialog, url) {
  const task = new AbortController(); let imageURL = '', timer;
  const clean = () => { task.abort(); clearTimeout(timer); if (imageURL) URL.revokeObjectURL(imageURL); };
  dialog.addEventListener('close', clean, { once: true });
  try {
    const { exportCardTarget, qrMatrix, drawQR, renderCardPoster } = await import('./card-export.js');
    const target = exportCardTarget(url); if (!target || !dialog.isConnected || task.signal.aborted) return;
    const section = document.createElement('section'); section.className = 'share-card-tools';
    section.innerHTML = `<div class="share-qr-row"><canvas width="220" height="220" role="img"></canvas><div><strong></strong><p></p><button class="button" type="button"></button></div></div><div class="share-poster-preview" hidden><img alt=""><div class="share-image-actions"><a class="button primary" data-download download="TryMe-card.png"></a><a class="button" data-open-image target="_blank" rel="noopener"></a><button class="button" data-share-image hidden type="button"></button></div><p class="tiny muted"></p></div>`;
    dialog.querySelector('.share-status').before(section);
    const qr = section.querySelector('canvas'), button = section.querySelector('.share-qr-row button'), status = dialog.querySelector('.share-status');
    qr.setAttribute('aria-label', t('扫码查看名片')); drawQR(qr.getContext('2d'), qrMatrix(target.url), 0, 0, 220);
    section.querySelector('strong').textContent = t('扫码查看名片');
    section.querySelector('.share-qr-row p').textContent = t('分享图包含姓名、作品和二维码；动态效果需打开链接查看。');
    button.textContent = t('生成分享图');
    button.onclick = async () => {
      button.disabled = true; button.textContent = t('生成中…'); status.textContent = '';
      section.querySelector('.share-poster-preview').hidden = true;
      if (imageURL) { URL.revokeObjectURL(imageURL); imageURL = ''; }
      const renderTask = new AbortController();
      const abort = () => renderTask.abort(); task.signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, 15000);
      try {
        const response = await fetch('/api/public/cards/' + encodeURIComponent(target.id), { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: renderTask.signal });
        if (!response.ok) throw Object.assign(Error('CARD_UNAVAILABLE'), { status: response.status });
        const { card } = await response.json();
        if (card?.id !== target.id || !Array.isArray(card.works)) throw Error('INVALID_CARD');
        const canvas = document.createElement('canvas');
        await renderCardPoster({ card, url: target.url, canvas, signal: renderTask.signal, locale: getLocale() });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw Error('EXPORT_FAILED');
        if (task.signal.aborted || renderTask.signal.aborted || !dialog.isConnected) return;
        if (imageURL) URL.revokeObjectURL(imageURL); imageURL = URL.createObjectURL(blob);
        const preview = section.querySelector('.share-poster-preview'), image = preview.querySelector('img'), download = preview.querySelector('[data-download]');
        image.src = imageURL; image.alt = t('分享图'); download.href = imageURL; download.textContent = t('保存图片');
        const open = preview.querySelector('[data-open-image]'), share = preview.querySelector('[data-share-image]');
        open.href = imageURL; open.textContent = t('打开原图');
        const file = new File([blob], 'TryMe-card.png', { type: 'image/png' });
        share.hidden = !(typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }));
        share.textContent = t('分享图片');
        share.onclick = async () => {
          try { await navigator.share({ files: [file], title: card.name + ' · TryMe' }); }
          catch (error) { if (error?.name !== 'AbortError') status.textContent = t('未能分享图片，可下载或打开原图保存。'); }
        };
        preview.querySelector('p').textContent = t('若未开始下载，可打开原图后长按保存；也可复制链接。') + ' ' + t('图片不会随名片更新，分享前请重新生成。'); preview.hidden = false;
        download.focus({ preventScroll: true });
      } catch (error) {
        if (!task.signal.aborted && dialog.isConnected) status.textContent = t(error.status === 404 ? '名片已不可访问，请返回检查。' : '分享图生成失败，仍可复制链接。');
      } finally {
        clearTimeout(timer); task.signal.removeEventListener('abort', abort);
        if (dialog.isConnected) { button.disabled = false; button.textContent = t('生成分享图'); }
      }
    };
  } catch { /* Link sharing remains usable if export support cannot load. */ }
}
