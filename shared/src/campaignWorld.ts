/** Состояние сущности в одной кампании (ADR-0006, campaign-world-tab). */
export const CAMPAIGN_ENTITY_STATES = {
  being: [
    { key: "alive", label: "жив" },
    { key: "dead", label: "погиб" },
    { key: "missing", label: "пропал" },
  ],
  location: [
    { key: "intact", label: "цело" },
    { key: "damaged", label: "повреждено" },
    { key: "destroyed", label: "разрушено" },
    { key: "abandoned", label: "заброшено" },
  ],
  community: [
    { key: "active", label: "действует" },
    { key: "weakened", label: "ослаблено" },
    { key: "dissolved", label: "распалось" },
  ],
  artifact: [
    { key: "as_setting", label: "как в сеттинге" },
    { key: "with_party", label: "у героев" },
    { key: "lost", label: "утерян" },
    { key: "destroyed", label: "уничтожен" },
  ],
} as const;

export type CampaignEntityKind = keyof typeof CAMPAIGN_ENTITY_STATES;
export type CampaignEntityState = (typeof CAMPAIGN_ENTITY_STATES)[CampaignEntityKind][number]["key"];

export function isCampaignEntityKind(value: unknown): value is CampaignEntityKind {
  return typeof value === "string" && Object.hasOwn(CAMPAIGN_ENTITY_STATES, value);
}

export function isCampaignEntityState(kind: CampaignEntityKind, value: unknown): value is CampaignEntityState {
  return CAMPAIGN_ENTITY_STATES[kind].some((s) => s.key === value);
}

/** Отсутствующее или старое неизвестное значение читается как умолчание вида. */
export function campaignEntityState(kind: CampaignEntityKind, value: unknown): CampaignEntityState {
  return isCampaignEntityState(kind, value) ? value : CAMPAIGN_ENTITY_STATES[kind][0].key;
}

export function campaignEntityStateLabel(kind: CampaignEntityKind, value: CampaignEntityState): string {
  return CAMPAIGN_ENTITY_STATES[kind].find((s) => s.key === value)?.label ?? CAMPAIGN_ENTITY_STATES[kind][0].label;
}

/** Умолчание — без плашки; потеря — красная, у героев — зелёная, прочее — жёлтая. */
export function campaignEntityStateTone(kind: CampaignEntityKind, value: CampaignEntityState): "red" | "green" | "yellow" | null {
  if (value === CAMPAIGN_ENTITY_STATES[kind][0].key) return null;
  if (["dead", "destroyed", "dissolved", "lost"].includes(value)) return "red";
  return value === "with_party" ? "green" : "yellow";
}

export const CAMPAIGN_STATE_ASPECT = { key: "state", label: "Состояние" } as const;
export const ARTIFACT_RECORD_ASPECTS = [
  { key: "holder", label: "У кого / где сейчас" },
  { key: "revealed", label: "Что открылось о свойствах" },
  { key: "note", label: "Свободная запись" },
  CAMPAIGN_STATE_ASPECT,
] as const;
