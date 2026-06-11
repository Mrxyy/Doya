import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useAppSettings, type LanguageSetting } from "@/hooks/use-settings";
import type { TranslationKey, TranslationParams } from "./translations";
import {
  resolveLocale as resolveLocaleValue,
  setActiveLocale,
  translate,
  translateNow,
  type Locale,
} from "./translate";

export { translateNow, type Locale };

interface I18nContextValue {
  locale: Locale;
  language: LanguageSetting;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { settings } = useAppSettings();
  const locale = resolveLocale(settings.language);

  useEffect(() => {
    setActiveLocale(locale);
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

export function resolveLocale(language: LanguageSetting): Locale {
  return resolveLocaleValue(language);
}
