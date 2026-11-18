// The iframe is usable only after its own controller acknowledges the payload.
// A load event alone also fires for failed or redirected navigations.
export function createGalleryBridge({frame, payload, isCurrent = () => true, onStatus,
  events = window, origin = location.origin, timers = globalThis, timeout = 15000, retryDelay = 600, recoveryDelay = 5000}) {
  let disposed = false, acknowledged = false, timedOut = false, receivedReady = false, requestId = 0, documentId = '', retryTimer, timeoutTimer, recoveryTimer;
  const mark = value => { if(frame.dataset)frame.dataset.galleryHandshake=value; };
  const clear = () => { timers.clearTimeout(retryTimer); timers.clearTimeout(timeoutTimer); timers.clearTimeout(recoveryTimer); };
  const active = () => { if (!disposed && !isCurrent()) dispose(); return !disposed; };
  const send = () => {
    if (!active() || acknowledged || timedOut) return;
    timers.clearTimeout(retryTimer);
    frame.contentWindow?.postMessage({type: 'funtrack:gallery:init', requestId, payload: payload()}, origin);
    retryTimer = timers.setTimeout(send, retryDelay);
  };
  const start = (sendNow = true) => {
    if (!active()) return;
    clear(); acknowledged = false; timedOut = false; receivedReady = false; requestId++;
    mark('loading');onStatus('loading');
    timeoutTimer = timers.setTimeout(() => {
      if (!active() || acknowledged) return;
      clear(); timedOut = true; mark('timeout');onStatus('timeout');
    }, timeout);
    // Some embedded navigations never reach the child's controller. Recover
    // once per explicit attempt, without resetting the original deadline or
    // interrupting a document that has already announced its readiness.
    recoveryTimer = timers.setTimeout(() => {
      if (!active() || acknowledged || timedOut || receivedReady) return;
      timers.clearTimeout(retryTimer); requestId++; documentId = '';
      frame.src = frame.src;
    }, recoveryDelay);
    if (sendNow) send();
  };
  const receive = event => {
    if (!active() || event.origin !== origin || event.source !== frame.contentWindow) return;
    const message = event.data;
    if (message?.type === 'funtrack:gallery:ready') {
      const nextDocument = typeof message.documentId === 'string' ? message.documentId : '';
      // A new document can appear after a redirect or iframe reload. Repeated
      // ready messages from the same document must not reset the user's view.
      if (documentId && nextDocument && documentId !== nextDocument) start();
      documentId = nextDocument; receivedReady = true;mark('ready'); timers.clearTimeout(recoveryTimer);
      send();
    } else if (!acknowledged && message?.type === 'funtrack:gallery:initialized' && message.requestId === requestId &&
      ['rendered', 'empty', 'fallback'].includes(message.state)) {
      acknowledged = true; clear();mark(message.state);onStatus(message.state);
    }
  };
  const loaded = () => { if (!acknowledged) send(); };
  const failed = () => { if (active()) { clear(); timedOut = true; mark('timeout');onStatus('timeout'); } };
  const retry = () => { if (!active()) return; documentId = ''; start(false); frame.src = frame.src; };
  function dispose() { if (disposed) return; disposed = true; clear(); events.removeEventListener('message', receive); frame.removeEventListener('load', loaded); frame.removeEventListener('error', failed); }
  events.addEventListener('message', receive); frame.addEventListener('load', loaded); frame.addEventListener('error', failed);
  start();
  return {retry, dispose};
}
