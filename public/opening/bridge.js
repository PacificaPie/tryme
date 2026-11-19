(function () {
  'use strict';
  const timing = window.OpeningTiming, settings = timing.resolve('?preset=balanced&transition=rise');
  const send = data => parent.postMessage({channel:'tryme-opening',...data}, location.origin);
  const seq = window.OpeningSequence = {
    settings, elapsed:0, duration:timing.duration(settings), paused:true, ready:false, completed:false,
    sourceAt:elapsed => timing.sourceAt(elapsed,settings),
    flipAt:elapsed => timing.flipAt(elapsed,settings),
    fail:reason => send({type:'failed',reason}),
    report(type) { if(type!=='progress') send({type}); }
  };
  addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== 'tryme-opening') return;
    if (event.data.type === 'start' && seq.ready && !seq.completed) seq.paused = false;
    if (event.data.type === 'flip' && seq.completed) seq.flip?.();
  });
  seq.flipped = back => send({type:'flipped',back});
  addEventListener('error',()=>seq.fail('runtime'));
  addEventListener('unhandledrejection',()=>seq.fail('runtime'));
})();
