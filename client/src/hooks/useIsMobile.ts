import { useEffect, useState } from "react";

// Same breakpoint the CSS uses everywhere for the mobile layout switch
// (index.css's `@media (max-width: 700px)` rules) — kept as a single
// source of truth here so JS-level behavior (which interaction to render,
// not just how it looks) stays in sync with it.
const QUERY = "(max-width: 700px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}
