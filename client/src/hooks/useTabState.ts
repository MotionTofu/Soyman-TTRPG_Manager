import { useSearchParams } from "react-router-dom";

// Keeps a detail page's active tab synced to the ?tab= URL param: survives
// page refresh, works with browser back/forward, and can be deep-linked.
export function useTabState<T extends string>(
  tabs: readonly T[],
  fallback: T,
  // Прежние имена переименованных вкладок: сохранённая ссылка на «Заметки по
  // ведению» должна открывать «Заметки», а не падать на вкладку по умолчанию.
  aliases?: Readonly<Record<string, string>>,
  // Имя параметра. По умолчанию `tab` — вкладки самой страницы. Лист
  // персонажа живёт внутри страницы, у которой свои вкладки, и делить с ней
  // один параметр не может: нужен свой (`sheet`).
  param = "tab"
): [T, (t: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(param);
  const tabParam = raw && aliases?.[raw] ? aliases[raw] : raw;
  const tab = (tabs as readonly string[]).includes(tabParam ?? "") ? (tabParam as T) : fallback;

  function selectTab(t: T) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(param, t);
      return next;
    });
  }

  return [tab, selectTab];
}
