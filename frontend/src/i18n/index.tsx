"use client"

/**
 * Minimal i18n layer. Azerbaijani is the default and complete dictionary; English and Turkish
 * fall back to Azerbaijani for any key they do not define yet. To add a language, add a
 * dictionary below — components only ever call t("key").
 */
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react"

const az = {
  "nav.dashboard": "İdarə paneli",
  "nav.assistant": "AI köməkçi",
  "nav.inventory": "Inventar",
  "nav.products": "Məhsullar",
  "nav.listings": "Bazar elanları",
  "nav.orders": "Sifarişlər",
  "nav.quotes": "Sorğular və təkliflər",
  "nav.analytics": "Analitika",
  "nav.notifications": "Bildirişlər",
  "nav.settings": "Tənzimləmələr",
  "nav.marketplace": "Bazar",
  "nav.favorites": "Seçilmişlər",
  "nav.home": "Əsas",
  "action.save": "Yadda saxla",
  "action.cancel": "Ləğv et",
  "action.confirm": "Təsdiqlə",
  "action.reject": "İmtina et",
  "action.retry": "Yenidən cəhd et",
  "action.logout": "Çıxış",
  "action.login": "Daxil ol",
  "action.register": "Qeydiyyat",
  "action.requestQuote": "Təklif istə",
  "action.order": "Sifariş ver",
  "state.loading": "Yüklənir…",
  "state.error": "Məlumatı yükləmək mümkün olmadı",
  "brand.tagline": "Topdansatıcılar və ustalar üçün AI bazar",
} as const

export type MessageKey = keyof typeof az
type Dict = Partial<Record<MessageKey, string>>

const en: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.assistant": "AI Assistant",
  "nav.inventory": "Inventory",
  "nav.products": "Products",
  "nav.listings": "Marketplace listings",
  "nav.orders": "Orders",
  "nav.quotes": "Requests & quotations",
  "nav.analytics": "Analytics",
  "nav.notifications": "Notifications",
  "nav.settings": "Settings",
  "nav.marketplace": "Marketplace",
  "nav.favorites": "Favorites",
  "nav.home": "Home",
  "action.logout": "Log out",
}

const tr: Dict = {
  "nav.dashboard": "Gösterge paneli",
  "nav.assistant": "AI asistan",
  "nav.inventory": "Envanter",
  "nav.products": "Ürünler",
  "nav.orders": "Siparişler",
  "nav.settings": "Ayarlar",
}

export const LOCALES = { az, en, tr } as const
export type Locale = keyof typeof LOCALES

const I18nContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void; t: (k: MessageKey) => string } | null>(null)

const LOCALE_KEY = "zapcastsat.locale"
const localeListeners = new Set<() => void>()

function subscribeLocale(cb: () => void) {
  localeListeners.add(cb)
  return () => localeListeners.delete(cb)
}

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    return saved && saved in LOCALES ? (saved as Locale) : "az"
  } catch {
    return "az"
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // the server always renders Azerbaijani; the browser picks up a saved preference after hydration
  const locale = useSyncExternalStore(subscribeLocale, readLocale, () => "az" as Locale)
  const setLocale = useCallback((l: Locale) => {
    try {
      localStorage.setItem(LOCALE_KEY, l)
    } catch {
      /* storage unavailable */
    }
    localeListeners.forEach((f) => f())
  }, [])
  const t = useCallback((k: MessageKey) => (LOCALES[locale] as Dict)[k] ?? az[k], [locale])
  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>
}

export function useT() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useT must be used inside I18nProvider")
  return ctx
}
