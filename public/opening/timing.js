(function () {
  'use strict';
  const presets = {
    balanced: { label: '均衡', gallery: 7.5, morph: 2.6, city: 4.8, settle: 1.6, hold: 2.5, fade: 0.6 },
    quick: { label: '紧凑', gallery: 4.2, morph: 2.2, city: 3.6, settle: 1.2, hold: 0.8, fade: 0.5 },
    original: { label: '舒展', gallery: 9.3 / 0.9, morph: 3.2, city: 5.85, settle: 2.4, hold: 1.2, fade: 0.7 }
  };
  const keys = ['gallery', 'morph', 'city', 'settle', 'hold', 'fade'];
  const names = ['展厅', '像素汇聚', '城市升起、落下', '名片收稳', '名片停留', '进入 Feed'];
  const source = [0, 9.3 / 0.9, 9.3 / 0.9 + 3.2, 9.3 / 0.9 + 1.25 + 7.8, 9.3 / 0.9 + 1.25 + 10.2];
  function resolve(query = '') {
    const params = new URLSearchParams(query);
    const preset = Object.hasOwn(presets, params.get('preset')) ? params.get('preset') : 'balanced';
    const settings = { ...presets[preset], preset };
    if (params.get('transition') === 'rise') settings.fade = 0.9;
    for (const key of keys) {
      const value = Number(params.get(key));
      if (params.has(key) && Number.isFinite(value)) settings[key] = Math.min(15, Math.max(key === 'hold' ? 0 : 0.15, value));
    }
    return settings;
  }
  const frontEnd = settings => keys.slice(0, -1).reduce((sum, key) => sum + settings[key], 0);
  const flipDuration = 1.3;
  const duration = settings => frontEnd(settings) + flipDuration;
  function flipAt(elapsed, settings) {
    const t = Math.max(0, Math.min(1, (elapsed - frontEnd(settings)) / flipDuration));
    return Math.PI * t * t * (3 - 2 * t);
  }
  function sourceAt(elapsed, settings) {
    let start = 0;
    for (let i = 0; i < 4; i++) {
      const end = start + settings[keys[i]];
      if (elapsed < end) return source[i] + (source[i + 1] - source[i]) * Math.max(0, elapsed - start) / settings[keys[i]];
      start = end;
    }
    return source[4];
  }
  function phaseAt(elapsed, settings) {
    let end = 0;
    for (let i = 0; i < keys.length - 1; i++) { end += settings[keys[i]]; if (elapsed < end) return names[i]; }
    return elapsed < duration(settings) ? '名片翻面' : '等待探索';
  }
  window.OpeningTiming = { presets, keys, names, resolve, duration, sourceAt, phaseAt, flipAt };
})();
