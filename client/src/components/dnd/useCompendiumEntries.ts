import { useEffect, useSyncExternalStore } from "react";
import { ensureEntries, getCachedEntry, subscribeEntryCache } from "./entryCache";
import type { CompendiumEntry } from "../../types";

// Подписка на кэш записей компендиума: запрашивает недостающие id одной
// пачкой и перерисовывает компонент, когда они приходят.
//
// useSyncExternalStore, а не useState — кэш общий для всего приложения, и
// вкладка «Заклинания» с вкладкой «Действия», открытые на одном листе, должны
// видеть одно и то же, не дублируя запрос.
export function useCompendiumEntries(ids: (number | null | undefined)[]): (id: number | null | undefined) => CompendiumEntry | undefined {
  // Ключ по значению, а не по ссылке: массив id пересобирается на каждый
  // рендер, и зависимость по нему зациклила бы эффект.
  const key = ids.filter((i) => typeof i === "number").join(",");
  // Версия кэша — не только повод перерисоваться, но и повод сходить заново.
  // Инвалидация записи (правка в компендиуме) и снятие пометки неудачи
  // меняют версию, а список id при этом прежний — без версии в зависимостях
  // эффект бы не сработал, и лист остался бы без живых данных до
  // перезагрузки страницы.
  const version = useSyncExternalStore(subscribeEntryCache, () => cacheVersion, () => cacheVersion);
  useEffect(() => {
    if (key) void ensureEntries(key.split(",").map(Number));
  }, [key, version]);
  return getCachedEntry;
}

// Счётчик версии — useSyncExternalStore требует стабильный снимок, а Map
// сама по себе его не даёт (ссылка не меняется при вставке).
let cacheVersion = 0;
subscribeEntryCache(() => {
  cacheVersion += 1;
});
