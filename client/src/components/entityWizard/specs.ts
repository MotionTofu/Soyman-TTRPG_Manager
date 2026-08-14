import { api } from "../../api/client";
import {
  createRelations,
  file,
  ids,
  linkEventParticipants,
  linkEvents,
  relations,
  str,
  strings,
  uploadAvatar,
} from "./apply";
import { beingSteps, locationSteps } from "./steps";
import { eventSteps } from "./stepsEvent";
import { artifactSteps, communitySteps } from "./stepsExtra";
import type { SearchResult } from "../../types";
import type { WizardContext, WizardDraft, WizardEntityType, WizardTypeSpec } from "./types";

// Пока у типов только первый (общий) шаг: имя и тип. Остальные шаги из
// спецификации добавляются сюда по одному — визард сам ничего о конкретных
// полях не знает, ему хватает steps() и create().

const location: WizardTypeSpec = {
  type: "location",
  label: "Локация",
  labelGenitive: "локации",
  namePlaceholder: "Название локации",
  initialDraft: (ctx) => ({
    name: "",
    parent_id: ctx.defaults?.parentLocationId ?? null,
    aliases: [],
  }),
  steps: () => locationSteps(),
  create: async (draft, ctx) => {
    const created = await api.post<{ id: number }>("/setting-locations", {
      setting_id: ctx.settingId,
      name: draft.name,
      kind: str(draft, "kind"),
      parent_id: draft.parent_id ?? null,
    });
    const id = created.id;
    // Остальное создание не принимает — дописывается правкой, как это делает
    // профиль локации.
    await api.put(`/setting-locations/${id}`, {
      aliases: strings(draft, "aliases"),
      name_original: str(draft, "name_original"),
      short_name: str(draft, "short_name"),
      description: str(draft, "description"),
    });
    await uploadAvatar(`/setting-locations/${id}/avatar`, file(draft, "avatar"));
    for (const childId of ids(draft, "child_ids")) {
      await api.put(`/setting-locations/${childId}/parent`, { parent_id: id });
    }
    for (const beingId of ids(draft, "inhabitant_being_ids")) {
      await api.post(`/setting-locations/${id}/inhabitants`, { type: "being", id: beingId });
    }
    for (const communityId of ids(draft, "inhabitant_community_ids")) {
      await api.post(`/setting-locations/${id}/inhabitants`, { type: "community", id: communityId });
    }
    await linkEvents("location", id, ids(draft, "event_ids"));
    return id;
  },
  profilePath: (id) => `/locations/${id}`,
};

// Личность и запись бестиария различаются только категорией и подписями —
// шаги и сохранение у них общие.
async function createBeing(draft: WizardDraft, ctx: WizardContext, category: string) {
  const base = draft.base_monster as SearchResult | null;
  const created = await api.post<{ id: number }>("/setting-beings", {
    setting_id: ctx.settingId,
    name: draft.name,
    category,
    base_monster_id: base?.id ?? null,
    community_ids: ids(draft, "community_ids"),
  });
  const id = created.id;
  await api.put(`/setting-beings/${id}`, {
    aliases: strings(draft, "aliases"),
    name_original: str(draft, "name_original"),
    short_name: str(draft, "short_name"),
    description: str(draft, "description"),
  });
  await uploadAvatar(`/setting-beings/${id}/avatar`, file(draft, "avatar"));
  for (const locationId of ids(draft, "location_ids")) {
    await api.post(`/setting-beings/${id}/locations`, { location_id: locationId });
  }
  await createRelations("being", id, relations(draft, "relations"));
  await linkEvents("being", id, ids(draft, "event_ids"));
  return id;
}

const being: WizardTypeSpec = {
  type: "being",
  label: "Личность",
  labelGenitive: "личности",
  namePlaceholder: "Имя личности",
  initialDraft: (ctx) => ({
    name: "",
    category: "key_figure",
    aliases: [],
    community_ids: ctx.defaults?.communityIds ?? [],
    location_ids: ctx.defaults?.locationIds ?? [],
  }),
  create: (draft, ctx) => createBeing(draft, ctx, str(draft, "category") || "key_figure"),
  steps: () => beingSteps(true),
  profilePath: (id) => `/beings/${id}`,
};

// Существо бестиария — та же сущность, что личность, только категория другая:
// в интерфейсе это отдельные разделы, в базе одна таблица.
const bestiary: WizardTypeSpec = {
  type: "bestiary",
  label: "Существо бестиария",
  labelGenitive: "существа",
  namePlaceholder: "Название вида (например, «Гоблины Подгорья»)",
  initialDraft: (ctx) => ({
    name: "",
    category: "bestiary",
    aliases: [],
    community_ids: ctx.defaults?.communityIds ?? [],
    location_ids: ctx.defaults?.locationIds ?? [],
  }),
  create: (draft, ctx) => createBeing(draft, ctx, "bestiary"),
  // У бестиария нет «типа личности» — остальные шаги те же.
  steps: () => beingSteps(false),
  profilePath: (id) => `/beings/${id}`,
};

const community: WizardTypeSpec = {
  type: "community",
  label: "Сообщество",
  labelGenitive: "сообщества",
  namePlaceholder: "Название сообщества",
  initialDraft: (ctx) => ({
    name: "",
    aliases: [],
    location_ids: ctx.defaults?.locationIds ?? [],
  }),
  create: async (draft, ctx) => {
    const created = await api.post<{ id: number }>("/setting-communities", {
      setting_id: ctx.settingId,
      name: draft.name,
    });
    const id = created.id;
    await api.put(`/setting-communities/${id}`, {
      aliases: strings(draft, "aliases"),
      name_original: str(draft, "name_original"),
      description: str(draft, "description"),
    });
    await uploadAvatar(`/setting-communities/${id}/avatar`, file(draft, "avatar"));
    for (const locationId of ids(draft, "location_ids")) {
      await api.post(`/setting-communities/${id}/locations`, { location_id: locationId });
    }
    // Вложенные — это перевешивание существующих сообществ под новое.
    for (const childId of ids(draft, "child_ids")) {
      await api.put(`/setting-communities/${childId}`, { parent_id: id });
    }
    for (const beingId of ids(draft, "member_ids")) {
      await api.post(`/setting-communities/${id}/members`, { being_id: beingId });
    }
    await createRelations("community", id, relations(draft, "relations"));
    await linkEvents("community", id, ids(draft, "event_ids"));
    return id;
  },
  steps: () => communitySteps(),
  profilePath: (id) => `/communities/${id}`,
};

const artifact: WizardTypeSpec = {
  type: "artifact",
  label: "Предмет сокровищницы",
  labelGenitive: "предмета",
  namePlaceholder: "Название предмета",
  initialDraft: () => ({ name: "", aliases: [], requires_attunement: false }),
  create: async (draft, ctx) => {
    // Предмет, в отличие от остальных, принимает почти всё сразу — своих
    // связующих таблиц у его полей нет, кроме компендиума и событий.
    const created = await api.post<{ id: number }>("/artifacts", {
      setting_id: ctx.settingId,
      name: draft.name,
      short_name: str(draft, "short_name"),
      aliases: strings(draft, "aliases"),
      name_original: str(draft, "name_original"),
      description: str(draft, "description"),
      power: str(draft, "power"),
      item_class: str(draft, "item_class") || null,
      item_type: str(draft, "item_type") || null,
      rarity: str(draft, "rarity") || null,
      requires_attunement: !!draft.requires_attunement,
      location_id: (draft.location_id as number | null) ?? null,
      owner_type: (draft.owner_type as string | null) ?? null,
      owner_id: (draft.owner_id as number | null) ?? null,
    });
    const id = created.id;
    await uploadAvatar(`/artifacts/${id}/avatar`, file(draft, "avatar"));
    const entry = draft.compendium_entry as SearchResult | null;
    if (entry) {
      await api.post(`/artifacts/${id}/compendium-links`, { compendium_entry_id: entry.id });
    }
    await linkEvents("artifact", id, ids(draft, "event_ids"));
    return id;
  },
  steps: () => artifactSteps(),
  profilePath: (id) => `/artifacts/${id}`,
};

const event: WizardTypeSpec = {
  type: "event",
  label: "Событие",
  labelGenitive: "события",
  namePlaceholder: "Название события",
  // Дата обязательна для записи в хронику, поэтому у события черновик сразу
  // несёт год/месяц/день — их заполняет шаг 2, а до тех пор стоит первое
  // число первого месяца нулевого года.
  initialDraft: () => ({ name: "", inworld_year: 0, inworld_month: 1, inworld_day: 1 }),
  create: async (draft, ctx) => {
    const created = await api.post<{ id: number }>(`/settings/${ctx.settingId}/calendar-events`, {
      title: draft.name,
      description: str(draft, "description"),
      full_description: str(draft, "full_description"),
      consequences: str(draft, "consequences"),
      inworld_year: draft.inworld_year ?? 0,
      inworld_month: draft.inworld_month ?? 1,
      inworld_day: draft.inworld_day ?? 1,
      important: !!draft.important,
    });
    const id = created.id;
    await linkEventParticipants(id, "location", ids(draft, "location_ids"));
    await linkEventParticipants(id, "being", ids(draft, "being_ids"));
    await linkEventParticipants(id, "community", ids(draft, "community_ids"));
    await linkEventParticipants(id, "artifact", ids(draft, "artifact_ids"));
    return id;
  },
  steps: () => eventSteps(),
  profilePath: (id) => `/events/${id}`,
};

export const WIZARD_SPECS: Record<WizardEntityType, WizardTypeSpec> = {
  location,
  being,
  bestiary,
  community,
  artifact,
  event,
};

export const WIZARD_TYPE_ORDER: WizardEntityType[] = [
  "location",
  "being",
  "bestiary",
  "community",
  "artifact",
  "event",
];

// Черновик при смене типа: общие поля (имя) переносятся, остальное берётся
// из нового типа — иначе выбранная категория личности уехала бы в предмет.
export function draftForType(
  type: WizardEntityType,
  ctx: WizardContext,
  previous?: WizardDraft
): WizardDraft {
  return { ...WIZARD_SPECS[type].initialDraft(ctx), name: previous?.name ?? "" };
}
