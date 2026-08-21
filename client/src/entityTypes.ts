export const ENTITY_TYPES: { key: string; label: string }[] = [
  { key: "campaign", label: "Кампании" },
  { key: "setting", label: "Сеттинги" },
  { key: "player", label: "Игроки" },
  { key: "character", label: "Персонажи" },
  { key: "location", label: "Локации" },
  { key: "being", label: "Существа" },
  { key: "community", label: "Сообщества" },
  { key: "artifact", label: "Артефакты" },
  { key: "resource", label: "Ресурсы" },
  // «Мастерение» из поиска убрано (решение владельца, 2026-08-21): три
  // заметки на всю базу, и находят их глазами в своём разделе, а не поиском.
  // Серверный блок `wantsType("mastering")` цел — вернуть значит вписать сюда
  // ту же строку обратно.
  { key: "adventure", label: "Приключения" },
  { key: "scene", label: "Сцены" },
  { key: "session", label: "Сессии" },
  { key: "compendium_entry", label: "Компендиум" },
];

export const ENTITY_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  ENTITY_TYPES.map((t) => [t.key, t.label])
);

// Singular form, used for the entity-type-chip label on a single entity's
// detail page (the nav/search labels above are plural, for lists).
export const ENTITY_TYPE_SINGULAR: Record<string, string> = {
  campaign: "Кампания",
  setting: "Сеттинг",
  player: "Игрок",
  character: "Персонаж",
  location: "Локация",
  being: "Существо",
  community: "Сообщество",
  artifact: "Артефакт",
  resource: "Ресурс",
  mastering: "Мастерение",
  adventure: "Приключение",
  scene: "Сцена",
  session: "Сессия",
  compendium_entry: "Запись компендиума",
  // Событие хроники — не в ENTITY_TYPES выше: своего раздела и поиска у него
  // нет, но связи с ним показываются наравне с остальными.
  setting_event: "Событие",
};

// Only types with a real "/type/:id" detail page — others (resource, mastering)
// are list-only pages and can't be deep-linked to a specific item.
export const DETAIL_ROUTES: Record<string, string> = {
  location: "/locations",
  being: "/beings",
  character: "/characters",
  artifact: "/artifacts",
  adventure: "/adventures",
  scene: "/scenes",
  session: "/sessions",
  setting: "/settings",
  campaign: "/campaigns",
  player: "/players",
  community: "/communities",
  compendium_entry: "/compendium",
  setting_event: "/events",
};
