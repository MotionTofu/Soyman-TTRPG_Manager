import { createCutsceneDocument } from "@shared/cutscenes/defaults";
import type { CutsceneDocument, CutsceneOriginal } from "@shared/cutscenes/types";
import { queryClient } from "./queryClient";
import { dataKeys } from "./entities";
import { write } from "./hooks";
import { afterWriteAnywhere, readOnce } from "./imperative";
import { mergeWorkshopDraft } from "../cutscenes/workshopDraft";

export interface CutsceneSummary extends Omit<CutsceneOriginal, "document"> {
  readonly name: string; readonly description: string;
  /** Catalogue facts; older servers may omit them. */
  readonly stepCount?: number; readonly campaigns?: readonly string[];
}
export interface CutsceneCatalogFilter {
  search: string; campaignId: number | null; archive: "active" | "archived" | "all"; sort: "name" | "updated"; order: "asc" | "desc";
}
export const CUTSCENE_CATALOG_ROUTE = "/mastering/cutscenes";
export const cutsceneRoute = (id: number) => `${CUTSCENE_CATALOG_ROUTE}/${id}`;
export function positiveCutsceneId(raw: string | null | undefined): number | null {
  return raw && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}
export function parseCutsceneCatalogFilter(params: URLSearchParams): CutsceneCatalogFilter {
  const sort = params.get("sort") === "name" ? "name" : "updated";
  const archive = params.get("archive");
  return { search: params.get("search") ?? "", campaignId: positiveCutsceneId(params.get("campaignId")),
    archive: archive === "archived" || archive === "all" ? archive : "active", sort,
    order: params.get("order") === "asc" ? "asc" : params.get("order") === "desc" ? "desc" : sort === "name" ? "asc" : "desc" };
}
export function cutsceneCatalogParams(filter: CutsceneCatalogFilter): URLSearchParams {
  const params = new URLSearchParams({ archive: filter.archive, sort: filter.sort, order: filter.order });
  if (filter.search.trim()) params.set("search", filter.search.trim());
  if (filter.campaignId) params.set("campaignId", String(filter.campaignId));
  return params;
}
/** React Router callbacks can share a params object before navigation commits. Keep successive edits on it. */
export function updateCutsceneCatalogParams(current: URLSearchParams, patch: Partial<CutsceneCatalogFilter>): URLSearchParams {
  const next = { ...parseCutsceneCatalogFilter(current), ...patch }, params = cutsceneCatalogParams(next);
  if (next.search) params.set("search", next.search);
  for (const key of [...current.keys()]) current.delete(key);
  params.forEach((value, key) => current.set(key, value));
  return current;
}
export const cutscenePaths = {
  catalog: (filter: CutsceneCatalogFilter) => `/cutscenes?${cutsceneCatalogParams(filter)}`,
  original: (id: number) => `/cutscenes/${id}`,
  thumbnail: (id: number, version: string) => `/cutscenes/${id}/thumbnail?version=${encodeURIComponent(version)}`,
};
export const CUTSCENE_AFFECTS = [{ path: "/cutscenes" }, { path: "/archive" }] as const;
const queues = new Map<number, Promise<unknown>>();
function serial<T>(id: number, apply: () => Promise<T>): Promise<T> {
  const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(apply); queues.set(id, next);
  void next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {});
  return next;
}
async function changed(original: CutsceneOriginal): Promise<CutsceneOriginal> {
  const queryKey = dataKeys.resource(cutscenePaths.original(original.id));
  // An older background GET must not land after this successful write and replace the saved version.
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData(queryKey, original);
  afterWriteAnywhere(CUTSCENE_AFFECTS); return original;
}
async function persist(id: number, document: CutsceneDocument): Promise<CutsceneOriginal> {
  return changed(await write.put<CutsceneOriginal>(cutscenePaths.original(id), { document }));
}
export const cutscenes = {
  async create(name: string, description: string): Promise<CutsceneOriginal> {
    return changed(await write.post<CutsceneOriginal>("/cutscenes", { document: { ...createCutsceneDocument(name.trim()), description } }));
  },
  async duplicate(id: number): Promise<CutsceneOriginal> {
    return changed(await write.post<CutsceneOriginal>(`${cutscenePaths.original(id)}/duplicate`));
  },
  archive: (id: number) => serial(id, async () => changed(await write.del<CutsceneOriginal>(cutscenePaths.original(id)))),
  restore: (id: number) => serial(id, async () => changed(await write.put<CutsceneOriginal>(`${cutscenePaths.original(id)}/restore`))),
  save: (id: number, document: CutsceneDocument) => serial(id, () => persist(id, document)),
  saveDraft: (id: number, base: CutsceneDocument, draft: CutsceneDocument) => serial(id, async () => {
    const latest = await readOnce<CutsceneOriginal>(cutscenePaths.original(id));
    return persist(id, mergeWorkshopDraft(base, draft, latest.document));
  }),
  updateMetadata: (id: number, patch: Partial<Pick<CutsceneDocument, "name" | "description">>) => serial(id, async () => {
    // Preserve steps/settings changed in another window while the name/description was being edited.
    const latest = await readOnce<CutsceneOriginal>(cutscenePaths.original(id));
    return persist(id, { ...latest.document, ...patch });
  }),
};
