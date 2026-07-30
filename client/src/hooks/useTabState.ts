import { useSearchParams } from "react-router-dom";

// Keeps a detail page's active tab synced to the ?tab= URL param: survives
// page refresh, works with browser back/forward, and can be deep-linked.
export function useTabState<T extends string>(tabs: readonly T[], fallback: T): [T, (t: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = (tabs as readonly string[]).includes(tabParam ?? "") ? (tabParam as T) : fallback;

  function selectTab(t: T) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", t);
      return next;
    });
  }

  return [tab, selectTab];
}
