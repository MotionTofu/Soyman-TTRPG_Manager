import { useLayoutEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { NavigationHistory } from "./navigationHistoryContext";

/** Only go back to pages visited inside this shell; a direct URL uses its parent. */
export function NavigationHistoryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const [history, setHistory] = useState({ entries: [{ key: location.key, path: location.pathname }], index: 0 });
  useLayoutEffect(() => {
    setHistory((previous) => {
      if (previous.entries[previous.index].key === location.key) return previous;
      const entry = { key: location.key, path: location.pathname };
      if (navigationType === "POP") {
        const index = previous.entries.findIndex((item) => item.key === location.key);
        return index < 0 ? { entries: [entry], index: 0 } : { ...previous, index };
      }
      if (navigationType === "REPLACE") {
        return { ...previous, entries: previous.entries.map((item, i) => i === previous.index ? entry : item) };
      }
      return { entries: [...previous.entries.slice(0, previous.index + 1), entry], index: previous.index + 1 };
    });
  }, [location.key, location.pathname, navigationType]);
  let previousPage = history.index - 1;
  // Tab changes belong to the same page. Return past them to the page of origin.
  while (previousPage >= 0 && history.entries[previousPage].path === location.pathname) previousPage--;
  const back = previousPage < 0 ? null : () => navigate(previousPage - history.index);
  return <NavigationHistory.Provider value={back}>{children}</NavigationHistory.Provider>;
}

