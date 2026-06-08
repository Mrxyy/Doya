import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useAppSettings, type LanguageSetting } from "@/hooks/use-settings";
import { translations, type TranslationKey, type TranslationParams } from "./translations";

export type Locale = keyof typeof translations;

interface I18nContextValue {
  locale: Locale;
  language: LanguageSetting;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

let activeLocale = resolveLocale("system");

export function I18nProvider({ children }: { children: ReactNode }) {
  const { settings } = useAppSettings();
  const locale = resolveLocale(settings.language);

  useEffect(() => {
    activeLocale = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      language: settings.language,
      t: (key, params) => translate(key, locale, params),
    }),
    [locale, settings.language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}

export function translateNow(key: TranslationKey, params?: TranslationParams): string {
  return translate(key, activeLocale, params);
}

export function resolveLocale(language: LanguageSetting): Locale {
  if (language === "en" || language === "zh") {
    return language;
  }
  return detectSystemLocale();
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

function translate(
  key: TranslationKey,
  locale: Locale,
  params: TranslationParams | undefined,
): string {
  const template = translations[locale][key] ?? translations.en[key];
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
