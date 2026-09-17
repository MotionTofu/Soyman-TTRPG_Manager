import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { SearchResult } from "../types";
import { dataKeys } from "./entities";
import { errorText } from "./hooks";

/**
 * Поиск по мере набора через слой данных (группа «остальное», часть 1).
 *
 * Раньше пять мест (панель поиска, компендиум пульта, выбор препятствия и
 * секции, связи сущности) держали свой таймер и свой `AbortController` мимо
 * слоя. Теперь запрос уходит после паузы в наборе, устаревший отменяется
 * слоем, а пока ищется новое — видны прежние результаты, без мигания пустым.
 *
 * Результаты не считаются свежими ни секунды: переименованное в соседнем окне
 * должно найтись под новым именем при следующем же наборе, а сигналов «поиск
 * устарел» у слоя нет — их пришлось бы слать от каждого вида.
 */
export interface SearchState<T = SearchResult> {
  results: T[];
  /** Набор ещё не отстоялся или запрос в пути. */
  searching: boolean;
  error: string | null;
}

const NO_RESULTS: never[] = [];

/**
 * Значение, которое держится `delayMs` без изменений. `initial` — что отдавать
 * до первой паузы: поиску — null, чтобы и первая буква ждала паузы.
 */
export function useSettled<T>(value: T, delayMs: number, initial: T = value): T {
  const [settled, setSettled] = useState(initial);
  useEffect(() => {
    const handle = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return settled;
}

/**
 * `path` — полный путь поиска; null — не искать (пустой или короткий запрос).
 * Годится и для подсказок по мере набора, отдающих не результаты поиска
 * (подписи отношений, сцены пульта), — тип строки задаёт `T`.
 */
export function useSearch<T = SearchResult>(path: string | null, delayMs = 200): SearchState<T> {
  const settled = useSettled<string | null>(path, delayMs, null);
  const active = path != null && settled === path;
  // Поле стёрли — прежние результаты больше не показываются, даже пока новый
  // набор ещё не отстоялся: иначе после стирания всплыло бы старое.
  const cleared = useRef(path == null);
  if (path == null) cleared.current = true;
  else if (active) cleared.current = false;
  const query = useQuery({
    queryKey: dataKeys.resource(settled ?? ""),
    queryFn: ({ signal }) => api.get<T[]>(settled as string, { signal }),
    enabled: active,
    staleTime: 0,
    gcTime: 60_000,
    // Прежние результаты — только от непустого запроса: стёртое поле и новый
    // набор не должны показать то, что искали до стирания.
    placeholderData: (previous, previousQuery) => (settled != null && previousQuery?.queryKey[1] !== "" ? previous : undefined),
  });
  if (path == null) return { results: NO_RESULTS, searching: false, error: null };
  if (!active && cleared.current) return { results: NO_RESULTS, searching: true, error: null };
  return {
    results: query.data ?? NO_RESULTS,
    searching: !active || query.isFetching,
    error: active && query.error ? errorText(query.error) : null,
  };
}
