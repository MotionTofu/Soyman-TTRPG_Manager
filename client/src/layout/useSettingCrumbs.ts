import type { Crumb } from "../components/Breadcrumbs";
import { useEntity } from "../data/hooks";

export function useSettingCrumbs(settingId: number | null | undefined): Crumb[] {
  const setting = useEntity<{ name: string }>("setting", settingId ?? null).data;
  return [
    { label: "Сеттинги", to: "/settings" },
    ...(settingId ? [{ label: setting?.name ?? "Сеттинг", to: `/settings/${settingId}` }] : []),
  ];
}

export function settingAdventuresPath(settingId: number, adventureId?: number): string {
  const params = new URLSearchParams({ tab: "Приключения" });
  if (adventureId != null) params.set("adventure", String(adventureId));
  return `/settings/${settingId}?${params}`;
}
