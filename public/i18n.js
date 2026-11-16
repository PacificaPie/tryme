export const LOCALE_STORAGE_KEY = 'funtrack.locale';
export const LOCALE_CHANGE_EVENT = 'funtrack:localechange';
const supported = locale => locale === 'zh-CN' || locale === 'en';

// The factory keeps persistence/event behavior testable without changing globals.
// Translations are explicit UI calls: this module never traverses or edits DOM.
export function createI18n({ storage = () => globalThis.localStorage, events = () => globalThis.window } = {}) {
  let locale = 'zh-CN';
  const messages = new Map();
  try { const saved = storage()?.getItem(LOCALE_STORAGE_KEY); if (supported(saved)) locale = saved; } catch { /* Private browsing can deny storage. */ }
  const getLocale = () => locale;
  function setLocale(next) {
    if (!supported(next)) return locale;
    const changed = next !== locale; locale = next;
    try { storage()?.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* The current page still changes language. */ }
    if (changed) {
      const target = events();
      if (target?.dispatchEvent) target.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT, { detail: { locale } }));
    }
    return locale;
  }
  function registerMessages(entries) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new TypeError('Messages must be an object.');
    for (const [source, translated] of Object.entries(entries)) {
      if (typeof translated !== 'string') throw new TypeError('Translations must be strings.');
      messages.set(source, translated);
    }
  }
  function t(source, values) {
    if (typeof source !== 'string') return source;
    const text = locale === 'en' && messages.has(source) ? messages.get(source) : source;
    if (!values || typeof values !== 'object') return text;
    // A single replacement pass keeps user-supplied names/content literal, even
    // when they contain another placeholder or a known translation key.
    return text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
  }
  function localeNumber(value, options = {}) {
    if ((typeof value !== 'number' || !Number.isFinite(value)) && typeof value !== 'bigint') return '—';
    return new Intl.NumberFormat(locale, options).format(value);
  }
  function localeDate(value, options = {}) {
    const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = value instanceof Date ? value : new Date(dateOnly ? value + 'T00:00:00Z' : value);
    if (value === null || value === undefined || !Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat(locale, { ...(dateOnly ? { timeZone: 'UTC' } : {}), ...options }).format(date);
  }
  return { t, getLocale, setLocale, registerMessages, localeNumber, localeDate };
}

const i18n = createI18n();
export const { t, getLocale, setLocale, registerMessages, localeNumber, localeDate } = i18n;
