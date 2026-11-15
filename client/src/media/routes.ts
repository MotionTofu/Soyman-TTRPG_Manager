export const MEDIA_ROUTE = "/media";
export const MEDIA_TABS = [
  { id: "gallery", label: "Галерея" },
  { id: "sound", label: "Звук" },
  { id: "cutscenes", label: "Катсцены" },
] as const;
export type MediaTab = typeof MEDIA_TABS[number]["id"];

export function mediaTab(value: string | null): MediaTab | undefined {
  return MEDIA_TABS.find(tab => tab.id === value)?.id;
}

export function mediaUrl(tab: MediaTab, query?: URLSearchParams | string, hash = "") {
  const params = new URLSearchParams(query);
  params.set("tab", tab);
  return `${MEDIA_ROUTE}?${params}${hash}`;
}
