import { api } from "../api/client";
import { dataKeys, type Affect } from "./entities";
import { afterWrite } from "./hooks";
import { queryClient } from "./queryClient";

/**
 * Слой данных для кода вне компонентов (docs/adr/0001, п. 7): функции модуля,
 * обработчики, которые читают запись справочника посреди расчёта, и тонкие
 * обёртки вызовов вроде передач между персонажами. Хуком там не
 * воспользоваться, а прямой `api.get` мимо слоя — это тот самый второй кэш,
 * который слой убирает.
 */

/**
 * Прочитать ресурс по пути: свежее из кэша слоя, иначе запросом — и положить
 * в тот же кэш, откуда его возьмёт и `useResource`.
 *
 * `fresh` — не верить кэшу: для чтения, поверх которого сразу пишут (чужой
 * лист, в который кладут предмет), и для опроса.
 */
export function readResource<T>(path: string, options?: { fresh?: boolean }): Promise<T> {
  return queryClient.fetchQuery({
    queryKey: dataKeys.resource(path),
    queryFn: ({ signal }) => api.get<T>(path, { signal }),
    ...(options?.fresh ? { staleTime: 0 } : {}),
  });
}

/** `afterWrite` вне компонента: обновить задетое и сказать о нём другим окнам. */
export function afterWriteAnywhere(affects: readonly Affect[]): void {
  afterWrite(queryClient, affects);
}
