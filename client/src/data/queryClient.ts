import { QueryClient } from "@tanstack/react-query";

/**
 * Настройки кэша слоя данных (docs/adr/0001).
 *
 * - Свежесть держат сигналы, а не таймеры: правка в этом окне, в другом окне
 *   (BroadcastChannel) и от игроков (сокет) помечает задетое устаревшим — см.
 *   data/entities.ts и data/DataLayerSync.tsx. Поэтому перечитывания по фокусу
 *   окна нет: оно дублировало бы сигналы и тянуло запросы на каждое
 *   переключение между пультом и листом.
 * - 30 секунд данные считаются свежими: переход туда-обратно между страницами
 *   не перечитывает то, что только что пришло.
 * - Повтор чтения — один раз и только для сбоя сети или таймаута: ошибка
 *   сервера повтором не лечится, а зависание вдвое дольше хуже честной ошибки.
 * - Записи сами не повторяются никогда: повтор — кнопкой на плашке, решением
 *   человека.
 */
export function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /таймаут|не отвечает|failed to fetch|networkerror|load failed|сеть недоступна/i.test(message);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => failureCount < 1 && isTransientError(error),
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();
