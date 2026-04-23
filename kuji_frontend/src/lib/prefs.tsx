"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { KujiTheme, KujiVariant, KujiLang } from "./ds/theme";

type Prefs = {
  theme: KujiTheme;
  variant: KujiVariant;
  lang: KujiLang;
  setTheme: (t: KujiTheme) => void;
  setVariant: (v: KujiVariant) => void;
  setLang: (l: KujiLang) => void;
};

const Ctx = createContext<Prefs | null>(null);

const STORAGE = "kuji.prefs.v1";

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme,   setTheme]   = useState<KujiTheme>("dark");
  const [variant, setVariant] = useState<KujiVariant>("A");
  const [lang,    setLang]    = useState<KujiLang>("zh");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.theme)   setTheme(p.theme);
        if (p.variant) setVariant(p.variant);
        if (p.lang)    setLang(p.lang);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE, JSON.stringify({ theme, variant, lang }));
    document.body.dataset.theme = theme;
    document.body.dataset.variant = variant;
    document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
  }, [theme, variant, lang, hydrated]);

  return (
    <Ctx.Provider value={{ theme, variant, lang, setTheme, setVariant, setLang }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePrefs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePrefs must be used inside <PrefsProvider>");
  return ctx;
}
