import { t, getLocale, localeNumber, localeDate } from './i18n.js';
import './analytics.messages.js';
import { isArchived } from './archive-controls.js';

const METRICS = {
  feedImpressions: { label: 'Feed 曝光', unit: '次' },
  feedViewers: { label: 'Feed 触达人数', unit: '人' },
  pv: { label: '访问次数', short: 'PV', unit: '次' },
  uv: { label: '访问人数', short: 'UV', unit: '人' },
  players: { label: '试玩人数', unit: '人' },
  avgActiveMs: { label: '平均试玩时长', duration: true },
  totalActiveMs: { label: '总试玩时长', duration: true },
  opens: { label: '打开试玩', unit: '次' },
  starts: { label: '开始试玩次数', unit: '局' },
  completions: { label: '完成上报', unit: '次' },
  returningPlayers: { label: '期间回访试玩人数', unit: '人' },
  comments: { label: '评论', unit: '条' },
  likes: { label: '点赞次数', unit: '次' },
  outboundClicks: { label: '外链点击', unit: '次' },
};
const PRIMARY = ['pv', 'uv', 'players', 'avgActiveMs'];
const SORTABLE = ['feedViewers', 'uv', 'pv', 'players', 'avgActiveMs', 'totalActiveMs', 'outboundClicks'];
const TREND_METRICS = Object.keys(METRICS).filter(key => key !== 'returningPlayers');
const PLAY_METRICS = new Set(['players', 'avgActiveMs', 'totalActiveMs', 'opens', 'starts', 'completions', 'returningPlayers']);
export function analyticsMetricSet(external = false) {
  return {
    primary: external ? ['pv', 'uv', 'outboundClicks', 'comments'] : [...PRIMARY],
    trend: TREND_METRICS.filter(key => !external || !PLAY_METRICS.has(key)),
    sortable: SORTABLE.filter(key => !external || !PLAY_METRICS.has(key)),
  };
}
const DAY = 86400000;
let instanceId = 0;
const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const utcDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const todayUTC = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
const shortDate = date => utcDate(date) ? localeDate(date, { month: getLocale() === 'en' ? 'short' : 'numeric', day: 'numeric', timeZone: 'UTC' }) : '—';
const dateRange = (from, to) => from === to ? shortDate(from) : `${shortDate(from)} — ${shortDate(to)}`;

export function formatAnalyticsNumber(value) {
  return validNumber(value) ? localeNumber(value, { maximumFractionDigits: 0 }) : '—';
}
export function formatAnalyticsDuration(value, compact = false) {
  if (!validNumber(value)) return '—';
  if (value > 0 && value < 1000) return t(compact ? '不足1秒' : '不足 1 秒');
  const seconds = Math.round(value / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  const gap = compact && getLocale() === 'zh-CN' ? '' : ' ';
  if (seconds < 60) return `${localeNumber(seconds)}${t(compact ? '秒' : ' 秒')}`;
  if (minutes < 60) return `${localeNumber(minutes)}${t(compact ? '分' : ' 分')}${seconds % 60 ? `${gap}${localeNumber(seconds % 60)}${t('秒')}` : ''}`;
  return `${localeNumber(hours)}${t(compact ? '时' : ' 小时')}${minutes % 60 ? `${gap}${localeNumber(minutes % 60)}${t('分')}` : ''}`;
}
export function analyticsChange(current, previous) {
  if (!validNumber(current) || !validNumber(previous)) return { label: '—', direction: 'none' };
  if (previous === 0) return { label: current > 0 ? t('新增') : '—', direction: current > 0 ? 'new' : 'none' };
  if (current === previous) return { label: t('持平'), direction: 'flat' };
  const percent = Math.abs((current - previous) / previous * 100);
  return { label: `${current > previous ? '↑' : '↓'} ${percent < 0.1 ? '<0.1' : localeNumber(percent, { maximumFractionDigits: 1 })}%`, direction: current > previous ? 'up' : 'down' };
}
const ERROR_KEYS = {
  AUTH_REQUIRED: '请重新登录。', NOT_OWNER: '只能访问自己的作品数据', WORK_NOT_FOUND: '作品不存在',
  INVALID_VERSION: '版本不属于该作品', WORK_REQUIRED: '请先选择作品，再筛选版本',
  INVALID_DATE_RANGE: '请选择有效的 UTC 日期范围，结束日期不能晚于今天', INVALID_DAYS: '统计天数须为 1–90 天',
  INVALID_GRANULARITY: '请选择按日或按周查看', INVALID_SELF_FILTER: '排除本人参数无效',
  INVALID_FILTER: '作品或版本标识无效', INTERNAL_ERROR: '服务暂不可用，请保留内容后重试',
  INCOMPLETE_ANALYTICS: '暂时没有收到完整的统计数据。',
};
export function analyticsErrorMessage(error) {
  return t(ERROR_KEYS[error?.code] || (error?.status === 401 ? '请重新登录。' : '请稍后重试。'));
}
export function validateAnalyticsDates(from, to, today = todayUTC()) {
  if (!utcDate(from) || !utcDate(to)) return t('请选择完整的起止日期。');
  if (from < '1970-01-01') return t('开始日期不能早于 1970-01-01。');
  if (from > to) return t('开始日期不能晚于结束日期。');
  if (to > today) return t('结束日期不能晚于今天（UTC）。');
  if ((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY + 1 > 90) return t('一次最多查看 90 天。');
  return '';
}
export function normalizeAnalyticsQuery(initial = {}) {
  const work = typeof initial.work === 'string' ? initial.work : '';
  return {
    days: initial.from || initial.to ? 'custom' : Number.isInteger(Number(initial.days)) && Number(initial.days) >= 1 && Number(initial.days) <= 90 ? Number(initial.days) : 7,
    from: typeof initial.from === 'string' ? initial.from : '',
    to: typeof initial.to === 'string' ? initial.to : '',
    work,
    version: work && typeof initial.version === 'string' ? initial.version : '',
    excludeSelf: initial.excludeSelf === true || initial.excludeSelf === '1' || initial.excludeSelf === 1,
    granularity: initial.granularity === 'week' ? 'week' : 'day',
    metric: TREND_METRICS.includes(initial.metric) ? initial.metric : 'uv',
    sort: SORTABLE.includes(initial.sort) ? initial.sort : 'uv',
    direction: initial.direction === 'asc' ? 'asc' : 'desc',
  };
}
export function analyticsQuery(state, presentation = false) {
  const result = state.days === 'custom' ? { from: state.from, to: state.to } : { days: String(state.days) };
  if (state.work) result.work = state.work;
  if (state.work && state.version) result.version = state.version;
  if (state.excludeSelf) result.excludeSelf = '1';
  if (state.granularity === 'week') result.granularity = 'week';
  if (presentation && state.metric !== 'uv') result.metric = state.metric;
  if (presentation && state.sort !== 'uv') result.sort = state.sort;
  if (presentation && state.direction === 'asc') result.direction = 'asc';
  return result;
}
export function sortAnalyticsWorks(works, metric, direction = 'desc') {
  return [...works].sort((a, b) => {
    const av = a[metric], bv = b[metric], knownA = validNumber(av), knownB = validNumber(bv);
    if (knownA !== knownB) return knownA ? -1 : 1;
    if (knownA && av !== bv) return direction === 'asc' ? av - bv : bv - av;
    return String(a.workId).localeCompare(String(b.workId));
  });
}
function valueLabel(metric, value, compact = false) {
  return METRICS[metric]?.duration ? formatAnalyticsDuration(value, compact) : formatAnalyticsNumber(value);
}
function axisLabel(metric, value, upper) {
  const number = n => localeNumber(n, { notation: 'compact', maximumFractionDigits: 1 });
  if (!METRICS[metric].duration) return number(value);
  if (upper >= 3600000) return number(value / 3600000) + t('时');
  if (upper >= 60000) return number(value / 60000) + t('分');
  return upper < 1000 ? number(value) + 'ms' : number(value / 1000) + t('秒');
}
function bucketLabel(date, meta) {
  if (meta.granularity !== 'week' || !utcDate(date)) return shortDate(date);
  return dateRange(date < meta.from ? meta.from : date, addDays(date, 6) > meta.to ? meta.to : addDays(date, 6));
}
function insights(data, state) {
  const result = [], metric = (data.byWork || []).some(work => work.players > 0) ? 'players' : 'uv';
  const works = sortAnalyticsWorks(data.byWork || [], metric).filter(work => validNumber(work[metric]) && work[metric] > 0);
  if (!state.work && works.length) {
    const top = works[0], ties = works.filter(work => work[metric] === top[metric]).length;
    const keys = metric === 'players'
      ? ['《{name}》有 {count} 位试玩者。', '《{name}》有 {count} 位试玩者，作品中最多。', '《{name}》有 {count} 位试玩者，并列最多。']
      : ['《{name}》有 {count} 位访客。', '《{name}》有 {count} 位访客，作品中最多。', '《{name}》有 {count} 位访客，并列最多。'];
    const key = keys[works.length > 1 ? ties > 1 ? 2 : 1 : 0];
    result.push({ title: t('作品表现'), body: t(key, { name: top.name, count: formatAnalyticsNumber(top[metric]) }) });
  }
  const buckets = (data.series || []).filter(row => validNumber(row.uv) && row.uv > 0);
  if (buckets.length > 1) {
    const max = Math.max(...buckets.map(row => row.uv)), peaks = buckets.filter(row => row.uv === max);
    if (peaks.length === 1) result.push({ title: t('访问集中时间'), body: t(state.granularity === 'week' ? '{date} 有 {count} 位访客，是所选期间访问人数最多的一周。' : '{date} 有 {count} 位访客，是所选期间访问人数最多的一天。', { date: bucketLabel(peaks[0].date, data.meta), count: formatAnalyticsNumber(max) }) });
  }
  return result.slice(0, 2);
}
function graphGeometry(series, metric, width, height = 254) {
  const left = 44, right = 14, top = 16, bottom = 32, plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = series.map(row => validNumber(row[metric]) ? row[metric] : null), maximum = Math.max(0, ...values.filter(value => value !== null));
  const magnitude = maximum > 0 ? 10 ** Math.floor(Math.log10(maximum)) : 1;
  const upper = maximum > 0 ? Math.ceil(maximum / magnitude) * magnitude : 1;
  const x = index => left + (series.length > 1 ? index / (series.length - 1) : 0.5) * plotWidth;
  const y = value => top + plotHeight * (1 - value / upper);
  const segments = []; let segment = [];
  values.forEach((value, index) => {
    if (value === null) { if (segment.length) segments.push(segment); segment = []; }
    else segment.push({ x: x(index), y: y(value), index });
  });
  if (segment.length) segments.push(segment);
  return { width, height, left, top, plotWidth, plotHeight, upper, values, segments, x, y, baseline: top + plotHeight };
}

/** Mount in a studio container. onQuery updates the URL only; dispose on route exit. */
export async function mountAnalytics(root, { api, esc, initial = {}, onQuery = () => {}, works = null, timers = globalThis, signinURL = () => '/signin-with-chatgpt?return_to=' + encodeURIComponent(location.pathname + location.search + location.hash) } = {}) {
  const id = `analytics-${++instanceId}`, state = normalizeAnalyticsQuery(initial), owned = new Map();
  for (const work of works || []) owned.set(work.id || work.workId, { id: work.id || work.workId, name: work.name, source: work.source, archivedAt: work.archivedAt });
  let data = null, loading = false, revision = 0, controller = null, disposed = false, resizeObserver = null, geometry = null, focusIndex = null, pendingFocus = null, slowTimer = null;
  const $ = selector => root.querySelector(selector);
  const alive = () => !disposed && root.isConnected !== false;
  const emit = () => onQuery(analyticsQuery(state, true));
  const selectedExternal = () => Boolean(state.work && owned.get(state.work)?.source === 'url');
  const externalScope = () => selectedExternal() || data?.funnel?.supported === false;
  const clearSlowTimer = () => { if (slowTimer !== null) timers.clearTimeout(slowTimer); slowTimer = null; };
  const dispose = () => { if (disposed) return; disposed = true; revision++; clearSlowTimer(); controller?.abort(); resizeObserver?.disconnect(); root.removeEventListener('click', handleClick); root.removeEventListener('change', handleChange); root.removeEventListener('submit', handleSubmit); root.removeEventListener('keydown', handleKeydown); };

  root.classList.add('analytics');
  root.innerHTML = `<header class="an-header"><div class="an-heading"><button type="button" class="an-back" data-an-back hidden>${t('← 全部作品')}</button><h1>${t('数据概览')}</h1><p class="an-range" data-an-range></p></div><div class="an-period" aria-label="${t('统计期间')}">${[7, 30, 90].map(days => `<button type="button" data-an-days="${days}">${t('{days} 天', { days: localeNumber(days) })}</button>`).join('')}<details class="an-calendar"><summary>${t('自定义')}</summary><form class="an-date-form"><label>${t('开始日期')}<input type="date" name="from" required min="1970-01-01" max="${todayUTC()}"></label><span aria-hidden="true">—</span><label>${t('结束日期')}<input type="date" name="to" required min="1970-01-01" max="${todayUTC()}"></label><p class="an-date-error" role="alert"></p><button class="an-apply" type="submit">${t('应用日期')}</button></form></details></div></header><div class="an-filters"><label class="an-select"><span class="an-sr-only">${t('作品')}</span><select data-an-work><option value="">${t('全部作品')}</option></select></label><details class="an-advanced"><summary>${t('筛选')}<span data-an-filter-count></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><div class="an-advanced-panel"><label class="an-select an-version-select" hidden><span>${t('版本')}</span><select data-an-version><option value="">${t('所有版本')}</option></select></label><label class="an-self"><input type="checkbox" data-an-self><span>${t('不计入我的活动')}</span></label><p>${t('只过滤你的访问、试玩和互动，作品仍保留。')}</p></div></details><button type="button" class="an-refresh" data-an-refresh aria-label="${t('刷新数据')}" title="${t('刷新数据')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8A8 8 0 1 0 20 14M19 3v5h-5"/></svg></button></div><div class="an-request-status" role="status" aria-live="polite"></div><div class="an-content" aria-busy="true"></div>`;

  function drawControls() {
    root.querySelectorAll('[data-an-days]').forEach(button => { const selected = Number(button.dataset.anDays) === state.days; button.classList.toggle('is-active', selected); button.setAttribute('aria-pressed', String(selected)); });
    $('.an-calendar').classList.toggle('is-active', state.days === 'custom');
    $('[data-an-self]').checked = state.excludeSelf;
    const filterCount = Number(state.excludeSelf) + Number(Boolean(state.version));
    $('[data-an-filter-count]').textContent = filterCount ? String(filterCount) : '';
    $('.an-advanced').classList.toggle('has-filters', filterCount > 0);
    $('[data-an-work]').innerHTML = `<option value="">${t('全部作品')}</option>` + [...owned.values()].map(work => `<option value="${esc(work.id)}" ${state.work === work.id ? 'selected' : ''}>${esc(work.name)}${isArchived(work)?' · '+t('已归档'):''}</option>`).join('');
    if (state.work && !owned.has(state.work)) { const option = document.createElement('option'); option.value = state.work; option.textContent = t('所选作品'); option.selected = true; $('[data-an-work]').append(option); }
    const versions = data?.versions || [];
    $('[data-an-version]').innerHTML = `<option value="">${t('所有版本')}</option>` + versions.map(version => `<option value="${esc(version.id)}" ${state.version === version.id ? 'selected' : ''}>${esc(version.label)}${version.isCurrent ? ' · ' + t('当前') : ''}</option>`).join('');
    if (state.version && !versions.some(version => version.id === state.version)) { const option = document.createElement('option'); option.value = state.version; option.textContent = t('所选版本'); option.selected = true; $('[data-an-version]').append(option); }
    $('.an-version-select').hidden = !state.work || selectedExternal();
    $('[data-an-back]').hidden = !state.work;
    $('h1').textContent = state.work ? (owned.get(state.work)?.name || t('作品数据')) + (isArchived(owned.get(state.work))?' · '+t('已归档'):'') : t('数据概览');
    const meta = data?.meta;
    $('[data-an-range]').textContent = meta ? `${dateRange(meta.from, meta.to)} · UTC${meta.partialToday ? ' · ' + t('今日未结束') : ''}` : state.days === 'custom' ? `${dateRange(state.from, state.to)} · UTC` : `${state.days === 1 ? t('最近 1 天') : t('最近 {days} 天', { days: localeNumber(state.days) })} · UTC`;
    $('input[name="from"]').value = state.days === 'custom' ? state.from : meta?.from || addDays(todayUTC(), -(Number(state.days) - 1));
    $('input[name="to"]').value = state.days === 'custom' ? state.to : meta?.to || todayUTC();
  }
  function setPending(value) {
    loading = value;
    root.classList.toggle('is-loading', value);
    $('.an-content').setAttribute('aria-busy', String(value));
  }
  function drawEmpty() {
    resizeObserver?.disconnect(); geometry = null; focusIndex = null;
    root.classList.add('is-empty');
    $('.an-content').innerHTML = `<section class="an-no-works" aria-labelledby="${id}-empty-title"><svg class="an-empty-art" viewBox="0 0 240 160" aria-hidden="true" focusable="false"><ellipse cx="120" cy="143" rx="82" ry="7" fill="var(--soft, #f1f4f5)"/><rect x="45" y="30" width="136" height="98" rx="10" fill="var(--soft, #f5f7f8)" stroke="var(--line, #e1e7eb)" transform="rotate(-7 113 79)"/><rect x="63" y="22" width="136" height="106" rx="10" fill="var(--surface, #fff)" stroke="var(--border, #cad7de)"/><path d="M63 46h136" stroke="var(--line, #e4eaee)"/><circle cx="76" cy="34" r="2" fill="var(--text-tertiary, #bccdd5)"/><circle cx="84" cy="34" r="2" fill="var(--line, #d6e1e6)"/><rect x="81" y="63" width="42" height="42" rx="6" fill="var(--soft, #f4f8f9)" stroke="var(--line, #dbe6eb)"/><path d="m98 76 12 8-12 8z" fill="var(--accent, #abc4cd)"/><path d="M138 72h42m-42 13h32m-32 13h22" stroke="var(--line, #dbe5e9)" stroke-width="3" stroke-linecap="round"/><path d="M38 60v12m-6-6h12m159 41v10m-5-5h10" stroke="var(--text-tertiary, #c3d6db)" stroke-width="1.5" stroke-linecap="round"/></svg><h2 id="${id}-empty-title">${t('还没有作品')}</h2><p>${t('发布作品后，访问和试玩数据会显示在这里。')}</p><a class="button primary an-empty-action" href="#/publish">${t('发布作品')}</a></section>`;
    $('.an-content').setAttribute('aria-busy', String(loading));
  }
  function metricCard(metric) {
    const definition = METRICS[metric], value = data.summary?.[metric], change = analyticsChange(value, data.previous?.[metric]);
    return `<button type="button" class="an-metric ${state.metric === metric ? 'is-selected' : ''}" data-an-metric="${metric}" aria-pressed="${state.metric === metric}"><span class="an-metric-label">${t(definition.label)}${definition.short ? `<span>${definition.short}</span>` : ''}</span><strong class="${definition.duration ? 'an-duration-value' : ''}">${valueLabel(metric, value)}</strong><span class="an-metric-foot"><span class="an-change an-change-${change.direction}" aria-label="${esc(t('较前期{change}', { change: change.label }))}">${change.label}</span>${definition.duration ? `<span class="an-metric-context">${selectedExternal() || data.funnel?.supported === false ? t('外链未接入') : data.coverage?.durationSamples > 0 ? t('{count} 局样本', { count: formatAnalyticsNumber(data.coverage.durationSamples) }) : t('时长待采集')}</span>` : ''}</span></button>`;
  }
  function drawData() {
    if (!alive() || !data) return;
    const opened = ['.an-secondary', '.an-methods', '.an-series-data'].filter(selector => $(selector)?.open);
    resizeObserver?.disconnect(); geometry = null; focusIndex = null;
    if (!state.work && !data.byWork.length) { drawEmpty(); return; }
    root.classList.remove('is-empty');
    const observations = insights(data, state), metrics = analyticsMetricSet(externalScope());
    if (!metrics.trend.includes(state.metric)) { state.metric = 'outboundClicks'; emit(); }
    if (!metrics.sortable.includes(state.sort)) { state.sort = 'uv'; emit(); }
    $('.an-content').innerHTML = `
      <div class="an-metrics">${metrics.primary.map(metricCard).join('')}</div>
      <p class="an-comparison">${esc(t('对比 {range}', { range: dateRange(data.meta.previousFrom, data.meta.previousTo) }))}</p>
      <section class="an-chart-section" aria-labelledby="${id}-trend-title">
        <div class="an-section-head"><h2 id="${id}-trend-title">${t('趋势')}</h2>
          <div class="an-chart-controls"><label><span class="an-sr-only">${t('趋势指标')}</span><select data-an-metric-select>${metrics.trend.map(key => `<option value="${key}" ${state.metric === key ? 'selected' : ''}>${t(METRICS[key].label)}</option>`).join('')}</select></label>
            <div class="an-granularity" aria-label="${t('趋势粒度')}"><button type="button" data-an-granularity="day" aria-pressed="${state.granularity === 'day'}">${t('天')}</button><button type="button" data-an-granularity="week" aria-pressed="${state.granularity === 'week'}">${t('周')}</button></div>
          </div>
        </div>
        <div class="an-chart-host"></div>
        <details class="an-series-data"><summary>${t('查看趋势数据')}</summary><div class="an-table-scroll" tabindex="0" aria-label="${t('趋势数据表')}"><table><thead><tr><th scope="col">${t('日期（UTC）')}</th><th scope="col">${t(METRICS[state.metric].label)}</th></tr></thead><tbody>${(data.series || []).map(row => `<tr><th scope="row">${esc(bucketLabel(row.date, data.meta))}</th><td>${valueLabel(state.metric, row[state.metric])}</td></tr>`).join('')}</tbody></table></div></details>
      </section>
      ${engagementSummary()}
      ${observations.length ? `<section class="an-observations" aria-label="${t('数据观察')}">${observations.map(item => `<div><span>${item.title}</span><p>${esc(item.body)}</p></div>`).join('')}</section>` : ''}
      <section class="an-works-section" aria-labelledby="${id}-works-title"><div class="an-section-head"><h2 id="${id}-works-title">${t(state.work ? '作品汇总' : '作品比较')}</h2><span class="an-work-count">${t((data.byWork || []).length === 1 ? '1 件' : '{count} 件', { count: localeNumber((data.byWork || []).length) })}</span></div><div class="an-work-table"></div></section>
      <details class="an-secondary"><summary>${t('更多统计')}</summary><div class="an-secondary-content"></div></details>
      ${methodology()}`;
    $('.an-content').setAttribute('aria-busy', String(loading));
    drawChart(); drawWorks(); drawSecondary();
    opened.forEach(selector => { if ($(selector)) $(selector).open = true; });
    if (typeof ResizeObserver !== 'undefined') { let lastWidth = $('.an-chart-host').clientWidth; resizeObserver = new ResizeObserver(entries => { const width = Math.round(entries[0].contentRect.width); if (Math.abs(width - lastWidth) > 2 && alive()) { lastWidth = width; drawChart(); } }); resizeObserver.observe($('.an-chart-host')); }
    if (pendingFocus) { $(pendingFocus)?.focus({ preventScroll: true }); pendingFocus = null; }
  }
  function engagementSummary() {
    if (selectedExternal() || data.funnel?.supported === false) return `<section class="an-external-summary"><span>${t('外链点击')}</span><strong>${valueLabel('outboundClicks', data.summary?.outboundClicks)}</strong><p>${t('外链试玩数据未接入')}</p></section>`;
    const funnel = data.funnel;
    if (!funnel || funnel.supported === false) return '';
    const denominator = funnel.visitors, coverage = data.coverage || {};
    const durationLabel = coverage.endedStarts > 0
      ? t('{samples} / {ended} 局已结束试玩', { samples: formatAnalyticsNumber(coverage.durationSamples), ended: formatAnalyticsNumber(coverage.endedStarts) })
      : t('尚无可用的试玩时长样本');
    return `<div class="an-engagement-grid">
      <section class="an-funnel" aria-labelledby="${id}-funnel-title"><div class="an-section-head"><h2 id="${id}-funnel-title">${t('访客与试玩')}</h2><span class="an-scope-note">${t('站内作品')}</span></div>
        <ol>${[['visitors', '访问人数'], ['opened', '打开人数'], ['started', '操作人数']].map(([key, label]) => {
          const value = funnel[key], ratio = validNumber(value) && denominator > 0 ? Math.min(1, value / denominator) : 0;
          return `<li><span>${t(label)}</span><strong>${formatAnalyticsNumber(value)}</strong><div class="an-funnel-bar" aria-hidden="true"><i style="width:${ratio * 100}%"></i></div><small>${denominator > 0 && validNumber(value) ? t('{percent}% 的访客', { percent: localeNumber(ratio * 100, { maximumFractionDigits: 1 }) }) : '—'}</small></li>`;
        }).join('')}</ol>
      </section>
      <section class="an-duration-summary" aria-labelledby="${id}-duration-title"><h2 id="${id}-duration-title">${t('时长样本')}</h2><strong>${formatAnalyticsNumber(coverage.durationSamples)}</strong><p>${durationLabel}</p>
        ${validNumber(coverage.durationCoverage) ? `<div class="an-coverage-bar" aria-hidden="true"><i style="width:${Math.min(1, coverage.durationCoverage) * 100}%"></i></div>` : ''}
        ${coverage.unendedStarts > 0 ? `<small>${t('另有 {count} 局尚未结束', { count: formatAnalyticsNumber(coverage.unendedStarts) })}</small>` : ''}
      </section>
    </div>`;
  }
  function drawChart() {
    const host = $('.an-chart-host'); if (!host || !data) return;
    const series = data.series || [], values = series.map(row => row[state.metric]).filter(validNumber);
    if (!values.length) {
      const text = selectedExternal() && ['players', 'starts', 'opens', 'completions', 'avgActiveMs', 'totalActiveMs', 'returningPlayers'].includes(state.metric) ? t('外链试玩数据未接入') : METRICS[state.metric].duration ? t('尚无可用的试玩时长样本') : t('暂无可用数据');
      host.innerHTML = `<div class="an-chart-empty"><span aria-hidden="true">—</span><p>${text}</p></div>`; geometry = null; return;
    }
    const width = Math.max(280, Math.round(host.clientWidth || 800)); geometry = graphGeometry(series, state.metric, width);
    const g = geometry, paths = g.segments.map(segment => segment.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '));
    const area = g.segments.map((segment, i) => `${paths[i]} L${segment.at(-1).x.toFixed(2)},${g.baseline} L${segment[0].x.toFixed(2)},${g.baseline} Z`);
    const ticks = [...new Set([0, METRICS[state.metric].duration ? g.upper / 2 : Math.round(g.upper / 2), g.upper])];
    const grid = ticks.map(value => { const y = g.y(value); return `<line x1="${g.left}" x2="${width - 14}" y1="${y}" y2="${y}" class="an-grid-line"/><text x="${g.left - 10}" y="${y + 4}" text-anchor="end">${esc(axisLabel(state.metric, value, g.upper))}</text>`; }).join('');
    const indices = [...new Set([0, ...(width > 500 ? [Math.floor((series.length - 1) / 2)] : []), series.length - 1])];
    host.innerHTML = `<div class="an-chart-interactive" tabindex="0" role="group" aria-label="${esc(t('{metric}趋势，使用左右方向键查看每个时间点', { metric: t(METRICS[state.metric].label) }))}" aria-describedby="${id}-chart-hint"><span id="${id}-chart-hint" class="an-sr-only">${t('左右方向键切换时间点，Home 和 End 跳到两端，Escape 关闭提示。下方也有完整数据表。')}</span><svg viewBox="0 0 ${width} ${g.height}" role="img" aria-labelledby="${id}-chart-title"><title id="${id}-chart-title">${esc(t('{metric}，{range}', { metric: t(METRICS[state.metric].label), range: dateRange(data.meta.from, data.meta.to) }))}</title><defs><linearGradient id="${id}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--an-blue)" stop-opacity=".19"/><stop offset="100%" stop-color="var(--an-blue)" stop-opacity=".015"/></linearGradient></defs>${grid}${area.map(path => `<path d="${path}" fill="url(#${id}-fill)"/>`).join('')}${paths.map(path => `<path d="${path}" class="an-trend-line"/>`).join('')}${g.segments.filter(segment => segment.length === 1).map(segment => `<circle cx="${segment[0].x}" cy="${segment[0].y}" r="3.5" class="an-trend-dot"/>`).join('')}${indices.map(index => `<text x="${g.x(index)}" y="${g.height - 8}" text-anchor="${index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}">${esc(shortDate(series[index].date < data.meta.from ? data.meta.from : series[index].date))}</text>`).join('')}<g data-an-chart-focus hidden><line class="an-focus-line" y1="${g.top}" y2="${g.baseline}"/><circle class="an-focus-point" r="4.5"/></g></svg><div class="an-tooltip" role="tooltip" hidden></div><div class="an-sr-only" data-an-chart-announcement aria-live="polite"></div></div>`;
    const interactive = $('.an-chart-interactive');
    interactive.addEventListener('pointermove', event => { const bounds = interactive.querySelector('svg').getBoundingClientRect(); const x = (event.clientX - bounds.left) * g.width / bounds.width; const index = series.length === 1 ? 0 : Math.round((x - g.left) / g.plotWidth * (series.length - 1)); showPoint(Math.max(0, Math.min(series.length - 1, index))); });
    interactive.addEventListener('pointerleave', () => { if (document.activeElement !== interactive) hidePoint(); });
    interactive.addEventListener('focus', () => showPoint(focusIndex ?? series.length - 1, true));
    interactive.addEventListener('blur', hidePoint);
    interactive.addEventListener('keydown', event => { let index = focusIndex ?? series.length - 1; if (event.key === 'ArrowLeft') index--; else if (event.key === 'ArrowRight') index++; else if (event.key === 'Home') index = 0; else if (event.key === 'End') index = series.length - 1; else if (event.key === 'Escape') { hidePoint(); return; } else return; event.preventDefault(); showPoint(Math.max(0, Math.min(series.length - 1, index)), true); });
  }
  function showPoint(index, announce = false) {
    if (!geometry || !data?.series[index]) return; focusIndex = index;
    const g = geometry, row = data.series[index], value = row[state.metric], x = g.x(index), group = $('[data-an-chart-focus]'), tooltip = $('.an-tooltip');
    group.hidden = false; group.removeAttribute('hidden'); const line = group.querySelector('line'), point = group.querySelector('circle'); line.setAttribute('x1', x); line.setAttribute('x2', x);
    if (validNumber(value)) { point.removeAttribute('hidden'); point.setAttribute('cx', x); point.setAttribute('cy', g.y(value)); } else point.setAttribute('hidden', '');
    const label = bucketLabel(row.date, data.meta), text = t('{date}，{metric} {value}', { date: label, metric: t(METRICS[state.metric].label), value: valueLabel(state.metric, value) });
    tooltip.hidden = false; tooltip.innerHTML = `<span>${esc(label)}</span><strong>${valueLabel(state.metric, value)}</strong>`; tooltip.style.left = `${Math.min(g.width - 82, Math.max(82, x)) / g.width * 100}%`;
    if (announce) $('[data-an-chart-announcement]').textContent = text;
  }
  function hidePoint() { $('[data-an-chart-focus]')?.setAttribute('hidden', ''); if ($('.an-tooltip')) $('.an-tooltip').hidden = true; }
  function drawWorks() {
    const columns = analyticsMetricSet(externalScope()).sortable;
    const rows = sortAnalyticsWorks(data.byWork || [], state.sort, state.direction), max = Math.max(0, ...rows.map(work => validNumber(work.uv) ? work.uv : 0));
    if (!rows.length) { $('.an-work-table').innerHTML = `<div class="an-table-empty">${t('还没有作品')}</div>`; return; }
    $('.an-work-table').innerHTML = `<div class="an-table-scroll" tabindex="0" aria-label="${t('作品比较表')}"><table><thead><tr><th scope="col">${t('作品')}</th>${columns.map(metric => `<th scope="col" aria-sort="${state.sort === metric ? state.direction === 'asc' ? 'ascending' : 'descending' : 'none'}"><button type="button" data-an-sort="${metric}">${t(METRICS[metric].label)}<span aria-hidden="true">${state.sort === metric ? state.direction === 'asc' ? ' ↑' : ' ↓' : ''}</span></button></th>`).join('')}</tr></thead><tbody>${rows.map(work => `<tr><th scope="row"><button type="button" class="an-work-name" data-an-drill="${esc(work.workId)}">${esc(work.name)}</button>${isArchived(work)?`<span class="work-archived"> · ${t('已归档')}</span>`:''}${work.source === 'url' ? `<span class="an-external">${t('外链')}</span>` : ''}</th>${columns.map(metric => `<td>${metric === 'uv' ? `<span class="an-table-number">${valueLabel(metric, work[metric], true)}<i style="--an-bar:${max && validNumber(work.uv) ? work.uv / max * 100 : 0}%" aria-hidden="true"></i></span>` : valueLabel(metric, work[metric], true)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function drawSecondary() {
    $('.an-secondary-content').innerHTML = [
      ['试玩', ['opens', 'starts', 'totalActiveMs', 'completions', 'returningPlayers']],
      ['互动统计', ['feedImpressions', 'feedViewers', 'comments', 'likes', 'outboundClicks']],
    ].filter(([, metrics]) => !externalScope() || !metrics.every(metric => PLAY_METRICS.has(metric))).map(([title, metrics]) => `<section class="an-detail-section"><h3>${t(title)}</h3><dl class="an-detail-metrics">${metrics.map(metric => `<div><dt>${t(METRICS[metric].label)}</dt><dd>${valueLabel(metric, data.summary?.[metric])}</dd></div>`).join('')}</dl></section>`).join('');
  }
  function methodology() {
    return `<details class="an-methods"><summary>${t('统计口径')}</summary><dl><div><dt>${t('Feed 曝光')}</dt><dd>${t('卡片在前台至少一半可见并持续 1 秒才记曝光。同一账号、作品、UTC 日期只计一次；触达人数在所选期间跨作品去重。仅从本次上线开始采集，不补算历史；曝光没有版本归属，按版本筛选显示 —。它不表示点击、试玩或经过认证的真人数。')}</dd></div><div><dt>${t('访问')}</dt><dd>${t('PV 是作品详情访问次数；UV 按登录账号去重。同一账号浏览多件作品，整体 UV 只计一次。它不等于设备数或经过认证的真人数。')}</dd></div><div><dt>${t('试玩')}</dt><dd>${t('打开试玩统计创建的会话；收到首次操作才计为开始试玩。试玩人数按账号去重，期间回访指所选期间内至少两个 UTC 日期有试玩，不是次日留存。')}</dd></div><div><dt>${t('时长')}</dt><dd>${t('从首次操作后累计页面可见时间，仅统计已结束且包含新版时长样本的试玩。它不是持续操作时间；未结束和历史无样本会话不补算。没有样本显示 —，真实零时长显示 0 秒。')}</dd></div><div><dt>${t('完成与互动')}</dt><dd>${t('完成上报是游戏客户端报告完成，不表示验证过的通关或胜率。评论包含回复；点赞统计期间新增且目前仍保留的点赞。评论和点赞没有版本归属，按版本筛选时显示 —。')}</dd></div><div><dt>${t('访客与试玩')}</dt><dd>${t('三项仅统计站内作品，按同一期间、同一作品上的账号交集计算，再跨作品去重。它表示期间重叠人群，不承诺访问与试玩的先后或因果关系。外链作品没有站内试玩数据。')}</dd></div><div><dt>${t('时间与对比')}</dt><dd>${t('日期采用 UTC，起止日均包含；对比紧邻的等长前期。今天尚未结束时，当前期间数据仍会增加。周从周一开始，边界周只含选中日期；周与整体 UV 重新去重，不是每日 UV 相加。')}</dd></div></dl></details>`;
  }
  async function load() {
    if (!alive()) return;
    const ownRevision = ++revision; clearSlowTimer(); controller?.abort(); controller = new AbortController();
    const keepData = Boolean(data);
    if (!keepData) { resizeObserver?.disconnect(); geometry = null; }
    const dateError = state.days === 'custom' ? validateAnalyticsDates(state.from, state.to) : '';
    drawControls(); setPending(!dateError);
    $('.an-request-status').textContent = dateError || t('正在更新数据…');
    if (!keepData) {
      root.classList.remove('is-empty');
      $('.an-content').innerHTML = '<div class="an-loading" aria-hidden="true"><div></div><div></div><div></div><div></div><span></span></div>';
    }
    if (dateError) { if (!keepData) $('.an-content').innerHTML = ''; $('.an-calendar').open = true; $('.an-date-error').textContent = dateError; return; }
    slowTimer = timers.setTimeout(() => {
      slowTimer = null;
      if (!alive() || ownRevision !== revision || !loading) return;
      $('.an-request-status').innerHTML = `<span>${t('数据还在加载，可以继续等待或重试。')}</span><button type="button" class="an-inline-retry" data-an-retry>${t('重试')}</button>`;
    }, 6500);
    try {
      const response = await api('/api/analytics?' + new URLSearchParams(analyticsQuery(state)), { signal: controller.signal });
      if (!alive() || ownRevision !== revision) return;
      if (!response?.meta || !response.summary || !Array.isArray(response.series) || !Array.isArray(response.byWork)) throw Object.assign(new Error('暂时没有收到完整的统计数据。'), { code: 'INCOMPLETE_ANALYTICS' });
      clearSlowTimer(); data = response;
      if (!state.work) owned.clear();
      for (const work of data.byWork) owned.set(work.workId, { id: work.workId, name: work.name, source: work.source, archivedAt: work.archivedAt });
      setPending(false); drawControls(); drawData(); $('.an-request-status').textContent = '';
    } catch (error) {
      if (!alive() || ownRevision !== revision || controller.signal.aborted) return;
      clearSlowTimer(); setPending(false);
      if (keepData && error.status !== 401) {
        $('.an-request-status').innerHTML = `<span>${t('刷新失败，当前仍显示上次数据。')}</span><button type="button" class="an-inline-retry" data-an-retry>${t('重试')}</button>`;
        return;
      }
      data = null; root.classList.remove('is-empty');
      $('.an-request-status').textContent = '';
      $('.an-content').innerHTML = error.status === 401
        ? `<div class="an-error" role="alert"><h2>${t('登录后继续')}</h2><p>${esc(analyticsErrorMessage(error))}</p><a class="an-apply" href="${esc(signinURL())}" target="_top">${t('重新登录')}</a></div>`
        : `<div class="an-error" role="alert"><h2>${t('暂时没能加载数据')}</h2><p>${esc(analyticsErrorMessage(error))}</p><button type="button" class="an-apply" data-an-retry>${t('重试')}</button></div>`;
    }
  }
  function changed(patch, focus) { Object.assign(state, patch); if (focus) pendingFocus = focus; data = null; emit(); load(); }
  function handleClick(event) {
    const button = event.target.closest('button'); if (!button || !root.contains(button)) return;
    if (button.hasAttribute('data-an-days')) { $('.an-calendar').open = false; $('.an-date-error').textContent = ''; changed({ days: Number(button.dataset.anDays), from: '', to: '' }); }
    else if (button.hasAttribute('data-an-back')) changed({ work: '', version: '' });
    else if (button.hasAttribute('data-an-refresh') || button.hasAttribute('data-an-retry')) load();
    else if (button.hasAttribute('data-an-drill')) changed({ work: button.dataset.anDrill, version: '' }, '[data-an-back]');
    else if (button.hasAttribute('data-an-metric') && data) { state.metric = button.dataset.anMetric; pendingFocus = `[data-an-metric="${state.metric}"]`; emit(); drawData(); }
    else if (button.hasAttribute('data-an-granularity')) changed({ granularity: button.dataset.anGranularity }, `[data-an-granularity="${button.dataset.anGranularity}"]`);
    else if (button.hasAttribute('data-an-sort') && data) { state.direction = state.sort === button.dataset.anSort && state.direction === 'desc' ? 'asc' : 'desc'; state.sort = button.dataset.anSort; emit(); drawWorks(); $(`[data-an-sort="${state.sort}"]`)?.focus({ preventScroll: true }); }
  }
  function handleChange(event) {
    const element = event.target;
    if (element.hasAttribute('data-an-work')) changed({ work: element.value, version: '' });
    else if (element.hasAttribute('data-an-version')) changed({ version: element.value });
    else if (element.hasAttribute('data-an-self')) changed({ excludeSelf: element.checked });
    else if (element.hasAttribute('data-an-metric-select') && data) { state.metric = element.value; pendingFocus = '[data-an-metric-select]'; emit(); drawData(); }
  }
  function handleSubmit(event) {
    if (!event.target.matches('.an-date-form')) return; event.preventDefault();
    const from = $('input[name="from"]').value, to = $('input[name="to"]').value, error = validateAnalyticsDates(from, to); $('.an-date-error').textContent = error; if (error) return;
    $('.an-calendar').open = false; changed({ days: 'custom', from, to });
  }
  function handleKeydown(event) {
    if (event.key !== 'Escape') return;
    for (const selector of ['.an-calendar', '.an-advanced']) {
      const details = $(selector);
      if (details?.open) { details.open = false; details.querySelector('summary')?.focus(); event.preventDefault(); }
    }
  }
  root.addEventListener('click', handleClick); root.addEventListener('change', handleChange); root.addEventListener('submit', handleSubmit); root.addEventListener('keydown', handleKeydown);
  drawControls();
  if (Array.isArray(works) && !works.length && !state.work) drawEmpty();
  else void load();
  return { dispose, refresh: load };
}

