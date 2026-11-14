import type { Crumb } from "../components/Breadcrumbs";
import type { WorkbookInstance } from "../components/workbooks/model";
import { useEntity, useResource } from "../data/hooks";
import { settingAdventuresPath } from "./useSettingCrumbs";

/** Путь к тетради определяется её проектом, независимо от места открытия. */
export function useWorkbookCrumbs(pathname: string): Crumb[] | null {
  const id = pathname.match(/^\/workbooks\/(\d+)$/)?.[1];
  const workbook = useResource<WorkbookInstance>(id ? `/workbooks/instances/${id}` : null).data;
  const kind = workbook?.project_type;
  const projectKind = kind === "setting" || kind === "campaign" || kind === "adventure" ? kind : null;
  const project = useEntity<{ name: string; setting_id?: number | null }>(
    projectKind ?? "setting", projectKind ? workbook?.project_id ?? null : null
  ).data;
  const settingId = projectKind === "adventure" ? project?.setting_id ?? workbook?.project_setting_id ?? null : null;
  const setting = useEntity<{ name: string }>("setting", settingId).data;

  if (!id) return null;
  const crumbs: Crumb[] = [{ label: "Главная", to: "/" }];
  if (!workbook) return [...crumbs, { label: "…" }];
  if (!projectKind || !workbook.project_id) {
    return [...crumbs, { label: "Библиотека", to: "/mastering" }, { label: "Тетради", to: "/mastering?tab=workbooks" }, { label: workbook.title }];
  }
  if (projectKind === "setting") {
    crumbs.push({ label: "Сеттинги", to: "/settings" }, { label: project?.name ?? "Сеттинг", to: `/settings/${workbook.project_id}` });
  } else if (projectKind === "campaign") {
    crumbs.push({ label: "Кампании", to: "/campaigns" }, { label: project?.name ?? "Кампания", to: `/campaigns/${workbook.project_id}` });
  } else {
    if (settingId) {
      const settingPath = `/settings/${settingId}`;
      crumbs.push({ label: "Сеттинги", to: "/settings" }, { label: setting?.name ?? "Сеттинг", to: settingPath }, { label: "Приключения", to: settingAdventuresPath(settingId, workbook.project_id) });
    }
    crumbs.push({ label: project?.name ?? "Приключение", to: `/adventures/${workbook.project_id}` });
  }
  return [...crumbs, { label: workbook.title }];
}
