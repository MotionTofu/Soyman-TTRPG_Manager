import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { notifyDataChanged } from "../dataSync";
import {
  dataKeys,
  entityPath,
  invalidateAffects,
  listPath,
  type Affect,
  type EntityKind,
  type ListScope,
} from "./entities";
import { showSaveError } from "./notices";

/**
 * Хуки слоя данных (docs/adr/0001). Страница получает данные, состояние и
 * «сохранить» — отмену устаревших запросов, откат, плашку ошибки, обновление
 * задетого и сигнал другим окнам слой берёт на себя.
 *
 * Всё, что хуки возвращают функциями, стабильно между отрисовками: нестабильный
 * колбэк однажды уже сломал `memo` и превратил один щелчок в перерисовку всего
 * раздела (CLAUDE.md, «галочка четыре секунды»).
 */

export interface DataState<T> {
  data: T | undefined;
  /** Данных ещё нет и они грузятся. Фоновое перечитывание сюда не входит. */
  loading: boolean;
  /** Текст ошибки чтения; null — ошибки нет. */
  error: string | null;
  reload: () => void;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

function useStableReload(refetch: () => Promise<unknown>): () => void {
  const ref = useRef(refetch);
  useEffect(() => {
    ref.current = refetch;
  });
  return useCallback(() => void ref.current(), []);
}

/** Чтение ресурса по пути API. null — не читать (данных для пути ещё нет). */
export function useResource<T>(path: string | null, options?: { staleMs?: number }): DataState<T> {
  const query = useQuery({
    queryKey: dataKeys.resource(path ?? ""),
    queryFn: ({ signal }) => api.get<T>(path as string, { signal }),
    enabled: path != null,
    staleTime: options?.staleMs,
  });
  const reload = useStableReload(query.refetch);
  return {
    data: query.data,
    loading: path != null && query.isPending,
    error: query.error ? errorText(query.error) : null,
    reload,
  };
}

/** Карточка сущности по виду и id. */
export function useEntity<T>(kind: EntityKind, id: number | null | undefined): DataState<T> {
  const query = useQuery({
    queryKey: dataKeys.entity(kind, id ?? -1),
    queryFn: ({ signal }) => api.get<T>(entityPath(kind, id as number), { signal }),
    enabled: id != null,
  });
  const reload = useStableReload(query.refetch);
  return {
    data: query.data,
    loading: id != null && query.isPending,
    error: query.error ? errorText(query.error) : null,
    reload,
  };
}

/** Список вида с параметрами (например, существа сеттинга). null — не читать. */
export function useEntityList<T>(kind: EntityKind, scope: ListScope | null): DataState<T[]> {
  const query = useQuery({
    queryKey: dataKeys.list(kind, scope ?? {}),
    queryFn: ({ signal }) => api.get<T[]>(listPath(kind, scope ?? {}), { signal }),
    enabled: scope != null,
  });
  const reload = useStableReload(query.refetch);
  return {
    data: query.data,
    loading: scope != null && query.isPending,
    error: query.error ? errorText(query.error) : null,
    reload,
  };
}

/** Записи слоя: мимо широковещания транспорта, адресный сигнал шлёт сам слой. */
export const write = {
  put: <R>(path: string, body?: unknown) => api.put<R>(path, body, { broadcast: false }),
  post: <R>(path: string, body?: unknown) => api.post<R>(path, body, { broadcast: false }),
  del: <R>(path: string) => api.del<R>(path, { broadcast: false }),
};

function afterWrite(client: ReturnType<typeof useQueryClient>, affects: readonly Affect[]): void {
  void invalidateAffects(client, affects);
  notifyDataChanged(affects);
}

/**
 * Сохранение полей сущности: значение меняется на экране сразу, при отказе
 * сервера возвращается и появляется плашка «Не сохранилось — Повторить».
 * `save` возвращает true, если сохранилось; ошибку показывает слой, странице
 * ловить её не нужно.
 */
export function useSaveEntity<T extends object>(
  kind: EntityKind,
  id: number | null | undefined,
  options?: { affects?: readonly Affect[] }
): { save: (patch: Partial<T>) => Promise<boolean>; saving: boolean } {
  const client = useQueryClient();
  const extraAffects = useRef(options?.affects ?? []);
  useEffect(() => {
    extraAffects.current = options?.affects ?? [];
  });

  const mutation = useMutation({
    mutationFn: (patch: Partial<T>) => write.put<T>(entityPath(kind, id as number), patch),
    onMutate: async (patch) => {
      const key = dataKeys.entity(kind, id as number);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<T>(key);
      if (previous !== undefined) client.setQueryData<T>(key, { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous !== undefined) client.setQueryData(dataKeys.entity(kind, id as number), context.previous);
    },
    onSettled: () => {
      if (id == null) return;
      afterWrite(client, [{ kind, id }, ...extraAffects.current]);
    },
  });

  const mutateAsync = useRef(mutation.mutateAsync);
  useEffect(() => {
    mutateAsync.current = mutation.mutateAsync;
  });

  const save = useCallback(async function save(patch: Partial<T>): Promise<boolean> {
    try {
      await mutateAsync.current(patch);
      return true;
    } catch (error) {
      showSaveError(errorText(error), async () => {
        if (!(await save(patch))) throw new Error("Снова не сохранилось");
      });
      return false;
    }
  }, []);

  return { save, saving: mutation.isPending };
}

export interface ActionOptions {
  /** Что задевает действие; пусто — перечитать всё. */
  affects: readonly Affect[];
  /**
   * Предлагать ли «Повторить» при ошибке. Для создания записей по умолчанию
   * стоит выключать: ответ мог потеряться после того, как сервер запись уже
   * сделал, и повтор создаст вторую.
   */
  retry?: boolean;
}

/**
 * Прочие записи: добавить связь, удалить дату, загрузить аватар. Действие
 * пишется через `write` (мимо широковещания транспорта); после успеха слой
 * обновляет задетое, при ошибке показывает плашку. Возвращает результат
 * действия или undefined, если оно не удалось.
 */
export function useAction(): <R>(action: () => Promise<R>, options: ActionOptions) => Promise<R | undefined> {
  const client = useQueryClient();
  return useCallback(
    async function run<R>(action: () => Promise<R>, options: ActionOptions): Promise<R | undefined> {
      try {
        const result = await action();
        afterWrite(client, options.affects);
        return result;
      } catch (error) {
        afterWrite(client, options.affects);
        showSaveError(
          errorText(error),
          options.retry === false
            ? undefined
            : async () => {
                if ((await run(action, options)) === undefined) throw new Error("Снова не получилось");
              }
        );
        return undefined;
      }
    },
    [client]
  );
}
