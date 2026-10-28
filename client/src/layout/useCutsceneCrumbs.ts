import type { CutsceneOriginal } from "@shared/cutscenes/types";
import { cutscenePaths, positiveCutsceneId, CUTSCENE_CATALOG_ROUTE } from "../data/cutscenes";
import { useResource } from "../data/hooks";
import type { Crumb } from "../components/Breadcrumbs";

export function useCutsceneCrumbs(pathname: string, gm: boolean): Crumb[] | null {
  const match = /^\/mastering\/cutscenes\/(\d+)$/.exec(pathname), id = positiveCutsceneId(match?.[1]);
  const original = useResource<CutsceneOriginal>(gm && id ? cutscenePaths.original(id) : null).data;
  if (!match || !gm) return null;
  return [{ label: "Главная", to: "/" }, { label: "Библиотека", to: "/mastering" },
    { label: "Катсцены", to: CUTSCENE_CATALOG_ROUTE }, { label: original?.document.name ?? "Катсцена" }];
}
