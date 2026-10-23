"use client";

import { useEffect } from "react";
import { APP_VIEWS } from "../planner/app-navigation";

export function LegacyEntry() {
  useEffect(() => {
    const openLegacyEntry = () => {
      const fragment = window.location.hash.slice(1);
      const legacy = fragment === "adjust" || (APP_VIEWS as readonly string[]).includes(fragment);
      const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
      if (legacy || installed) window.location.replace(`/app${window.location.search}${window.location.hash}`);
    };
    openLegacyEntry();
    window.addEventListener("hashchange", openLegacyEntry);
    return () => window.removeEventListener("hashchange", openLegacyEntry);
  }, []);
  return null;
}
