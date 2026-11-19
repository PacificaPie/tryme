(function () {
  'use strict';
  const timing = window.OpeningTiming, settings = timing.resolve('?preset=balanced&transition=rise');
  const send = data => parent.postMessage({channel:'tryme-opening',...data}, location.origin);
  const seq = window.OpeningSequence = {
    settings, elapsed:0, duration:timing.duration(settings), paused:false, ready:false,
    sourceAt:elapsed => timing.sourceAt(elapsed,settings),
    fail:reason => send({type:'failed',reason}),
    report(type) { if(type!=='progress') send({type}); }
  };
  addEventListener('error',()=>seq.fail('runtime'));
  addEventListener('unhandledrejection',()=>seq.fail('runtime'));
})();
