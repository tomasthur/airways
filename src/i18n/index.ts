import { de } from './de';
import { en } from './en';
import { sk } from './sk';
import { zh } from './zh';

export type Lang = 'en' | 'de' | 'sk' | 'zh';

export const LANGS: { id: Lang; label: string; html: string }[] = [
  { id: 'en', label: 'EN', html: 'en' },
  { id: 'de', label: 'DE', html: 'de' },
  { id: 'sk', label: 'SK', html: 'sk' },
  { id: 'zh', label: '中文', html: 'zh-CN' },
];

const KEY = 'airways.lang';
const TABLES: Record<Lang, Record<string, string>> = { en, de, sk, zh };

let lang: Lang = 'en';
const listeners = new Set<() => void>();

function isLang(v: string | null | undefined): v is Lang {
  return v === 'en' || v === 'de' || v === 'sk' || v === 'zh';
}

function fill(raw: string, vars?: Record<string, string | number>): string {
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const table = TABLES[lang] ?? en;
  return fill(table[key] ?? en[key] ?? key, vars);
}

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  if (next === lang) {
    syncLangButtons();
    return;
  }
  lang = next;
  localStorage.setItem(KEY, next);
  document.documentElement.lang = LANGS.find((l) => l.id === next)?.html ?? 'en';
  applyDom();
  syncLangButtons();
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Translate static copy marked with data-i18n / data-i18n-placeholder / data-i18n-title / data-i18n-aria. */
export function applyDom(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle!);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = (el as HTMLElement).dataset.i18nAria;
    if (key) el.setAttribute('aria-label', t(key));
  });
}

export function bindLangSwitch(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
    if (btn.dataset.langBound) return;
    btn.dataset.langBound = '1';
    btn.addEventListener('click', () => {
      const id = btn.dataset.lang;
      if (isLang(id)) setLang(id);
    });
  });
  syncLangButtons();
}

function syncLangButtons(): void {
  document.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.lang === lang);
  });
}

export function initI18n(): void {
  const stored = localStorage.getItem(KEY);
  lang = isLang(stored) ? stored : 'en';
  document.documentElement.lang = LANGS.find((l) => l.id === lang)?.html ?? 'en';
  applyDom();
  bindLangSwitch();
}
