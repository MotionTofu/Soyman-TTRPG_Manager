import { createContext, useContext } from "react";

// Принудительно раскрытые карточки в сетке пульта. Блоки на GridStack всегда
// открыты (схлопнутое таскать и мерить бессмысленно), а та же панель в
// мобильной стопке или в окне попаута — обычная collapsible. Контекстом, а не
// пропсами: узлы виджетов одни на обе ветки PultGrid, поведение различает
// провайдер вокруг сетки.
export const PultGridForceOpenContext = createContext(false);

export function usePultGridForceOpen(): boolean {
  return useContext(PultGridForceOpenContext);
}
