import { translations, type TranslationKey, type TranslationParams } from "./translations";

export type Locale = keyof typeof translations;

let activeLocale = resolveLocale("system");

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

export function translateNow(key: TranslationKey, params?: TranslationParams): string {
  return translate(key, activeLocale, params);
}

export function resolveLocale(language: string): Locale {
  if (language === "en" || language === "zh") {
    return language;
  }
  return detectSystemLocale();
}

export function translate(key: TranslationKey, locale: Locale, params?: TranslationParams): string {
  const template = translations[locale][key] ?? translations.en[key];
  const mergedParams: TranslationParams = {
    brand: translations[locale]["brand.name"],
    brandEnglish: translations[locale]["brand.nameEnglish"],
    brandChinese: translations[locale]["brand.nameChinese"],
    ...params,
  };
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = mergedParams[name];
    return value === undefined ? match : String(value);
  });
}

function detectSystemLocale(): Locale {
  const candidates = getSystemLocaleCandidates();
  for (const candidate of candidates) {
    if (candidate.toLowerCase().startsWith("zh")) {
      return "zh";
    }
  }
  return "en";
}

function getSystemLocaleCandidates(): string[] {
  const language = globalThis.navigator?.language;
  const languages = Array.isArray(globalThis.navigator?.languages)
    ? globalThis.navigator.languages
    : [];
  const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  return [...languages, language, intlLocale].filter((value): value is string => Boolean(value));
}
