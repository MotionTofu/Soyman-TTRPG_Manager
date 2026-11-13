import { memo, type DragEvent } from "react";
import type { LitMCharacterData, LitMThemeCard, LitMImprovement } from "../../types";
import type { SearchResult } from "../../types";
import { emptyTheme } from "./ThemeCard";
import { LitmSheet } from "./LitmSheet";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { applyGroupThemeToCampaign } from "../../data/campaignActions";
import { NavIcon } from "../NavIcons";
import { normalizeStatuses } from "@shared/litm/status";

async function applyGroupTheme(campaignId: number | undefined, theme: LitMThemeCard) {
  if (!campaignId) return;
  if (
    !confirm(
      "Применить эту Тему Содружества как общую для всех персонажей кампании? Она заменит текущую Тему Содружества у каждого персонажа."
    )
  ) {
    return;
  }
  await applyGroupThemeToCampaign(campaignId, theme);
}

export function emptyCharacter(): LitMCharacterData {
  return {
    characterName: "",
    playerName: "",
    promise: "",
    quest: "",
    fellowshipRelationship: "",
    companionRelationshipTag: "",
    quintessences: "",
    backpack: [],
    specialImprovements: "",
    notes: "",
    themes: [emptyTheme(), emptyTheme(), emptyTheme(), emptyTheme()],
    storyThemes: [emptyTheme()],
    fellowshipTheme: emptyTheme(),
  };
}

// Older saved statblocks may predate this shape (powerTags/weaknessTag as a
// single string, improve-only track, backpack as a single string, a single
// storyTheme instead of storyThemes[]). Fill in whatever's missing so those
// don't crash when reopened.
export function normalizeTheme(raw: unknown): LitMThemeCard {
  const t = (raw ?? {}) as Record<string, unknown>;
  const splitLines = (s: unknown) =>
    typeof s === "string" && s
      ? s.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];
  const power = t.power;
  const name = (t.name as string) ?? "";
  const powerTags = Array.isArray(t.powerTags) ? (t.powerTags as string[]) : splitLines(t.powerTags);
  // Вычеркнутое держится только у тегов, которые на карте есть.
  const scratchedTags = Array.isArray(t.scratchedTags)
    ? (t.scratchedTags as unknown[]).filter((x): x is string => typeof x === "string" && (x === name || powerTags.includes(x)))
    : [];
  return {
    power: power === "origin" || power === "adventure" || power === "greatness" || power === "variable" ? power : "",
    themeType: (t.themeType as string) ?? (t.type as string) ?? "",
    name,
    powerTags,
    weaknessTags: Array.isArray(t.weaknessTags)
      ? (t.weaknessTags as string[])
      : splitLines(t.weaknessTag),
    quest: (t.quest as string) ?? "",
    improve: typeof t.improve === "number" ? t.improve : 0,
    abandon: typeof t.abandon === "number" ? t.abandon : t.abandoned === true ? 3 : 0,
    milestone: typeof t.milestone === "number" ? t.milestone : t.milestone === true ? 3 : 0,
    specialImprovements: normalizeImprovements(t.specialImprovements),
    ...(scratchedTags.length ? { scratchedTags } : {}),
    ...(t.improvementPending === true ? { improvementPending: true } : {}),
  };
}

function isThemeEmpty(t: LitMThemeCard): boolean {
  return !t.name && !t.themeType && !t.power && t.powerTags.length === 0 && t.weaknessTags.length === 0;
}

// Older saved statblocks may have specialImprovements as a single newline-
// separated string instead of a checklist; treat every line as active so
// nothing that was previously shown disappears.
function normalizeImprovements(raw: unknown): LitMImprovement[] {
  if (Array.isArray(raw)) {
    return (raw as unknown[]).map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { text: (o.text as string) ?? "", active: o.active !== false };
    });
  }
  if (typeof raw === "string" && raw) {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => ({ text, active: true }));
  }
  return [];
}

export function normalizeCharacter(raw: unknown): LitMCharacterData {
  const d = (raw ?? {}) as Record<string, unknown>;
  const splitLines = (s: unknown) =>
    typeof s === "string" && s
      ? s.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];

  let storyThemes: LitMThemeCard[];
  if (Array.isArray(d.storyThemes)) {
    storyThemes = (d.storyThemes as unknown[]).map(normalizeTheme);
  } else if (d.storyTheme) {
    const single = normalizeTheme(d.storyTheme);
    storyThemes = isThemeEmpty(single) ? [emptyTheme()] : [single];
  } else {
    storyThemes = [emptyTheme()];
  }

  // Some statblocks briefly had a separate "groupTheme" card (a homebrew
  // addition) before it was merged back into Fellowship Theme, which is
  // already meant to be shared across the party. Recover that data here.
  const fellowshipTheme = normalizeTheme(d.fellowshipTheme);
  const legacyGroupTheme = d.groupTheme ? normalizeTheme(d.groupTheme) : null;

  return {
    characterName: (d.characterName as string) ?? "",
    playerName: (d.playerName as string) ?? "",
    promise: (d.promise as string) ?? "",
    quest: (d.quest as string) ?? "",
    fellowshipRelationship: (d.fellowshipRelationship as string) ?? "",
    companionCharacterType: (d.companionCharacterType as string) || undefined,
    companionCharacterId: typeof d.companionCharacterId === "number" ? d.companionCharacterId : undefined,
    companionCharacterName: (d.companionCharacterName as string) || undefined,
    companionRelationshipTag: (d.companionRelationshipTag as string) ?? "",
    quintessences: (d.quintessences as string) ?? "",
    backpack: Array.isArray(d.backpack) ? (d.backpack as string[]) : splitLines(d.backpack),
    specialImprovements: (d.specialImprovements as string) ?? "",
    notes: (d.notes as string) ?? "",
    themes: Array.isArray(d.themes) ? (d.themes as unknown[]).map(normalizeTheme) : [],
    storyThemes,
    fellowshipTheme:
      isThemeEmpty(fellowshipTheme) && legacyGroupTheme && !isThemeEmpty(legacyGroupTheme)
        ? legacyGroupTheme
        : fellowshipTheme,
    statuses: normalizeStatuses(d.statuses),
    relationships: Array.isArray(d.relationships)
      ? (d.relationships as Record<string, unknown>[])
          .filter((r) => r && typeof r.characterId === "number" && typeof r.tag === "string" && r.tag)
          .map((r) => ({ characterId: r.characterId as number, name: String(r.name ?? ""), tag: r.tag as string }))
      : [],
  };
}

// Depends only on the companion-related fields (not the whole LitMCharacterData)
// so it can be wrapped in React.memo — otherwise every keystroke anywhere in
// the character form would give it a new `value` reference and force a
// re-render regardless of memoization.
const CompanionField = memo(function CompanionField({
  companionCharacterName,
  companionRelationshipTag,
  onDropCompanion,
  onClearCompanion,
  onRelationshipTagChange,
}: {
  companionCharacterName?: string;
  companionRelationshipTag: string;
  onDropCompanion: (result: SearchResult) => void;
  onClearCompanion: () => void;
  onRelationshipTagChange: (v: string) => void;
}) {
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const result: SearchResult = JSON.parse(raw);
    onDropCompanion(result);
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="muted">Тег связи со спутником (Companion Relationship Tag)</span>
      <div className="row">
        <div
          className="litm-companion-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          {companionCharacterName ? (
            <span className="litm-tag litm-tag-companion">
              {companionCharacterName}
              <button type="button" onClick={onClearCompanion}>
                <NavIcon name="close" />
              </button>
            </span>
          ) : (
            <span className="muted">Перетащите персонажа сюда</span>
          )}
        </div>
        <input
          className="litm-tag-companion-input"
          placeholder="Тег отношений"
          value={companionRelationshipTag}
          onChange={(e) => onRelationshipTagChange(e.target.value)}
        />
      </div>
    </div>
  );
});

/** Правка листа на месте (Q13): тот же лист в «Д», поля правятся там, где стоят. */
export function LitMCharacterEdit({
  value,
  onChange,
  campaignId,
}: {
  value: LitMCharacterData;
  onChange: (v: LitMCharacterData) => void;
  campaignId?: number;
}) {
  return (
    <LitmSheet
      value={value}
      edit
      onChange={onChange}
      campaignId={campaignId}
      onMakeGroupTheme={campaignId ? () => applyGroupTheme(campaignId, value.fellowshipTheme) : undefined}
      companion={
        <CompanionField
          companionCharacterName={value.companionCharacterName}
          companionRelationshipTag={value.companionRelationshipTag}
          onDropCompanion={(r) => onChange({ ...value, companionCharacterType: r.type, companionCharacterId: r.id, companionCharacterName: r.title })}
          onClearCompanion={() => onChange({ ...value, companionCharacterType: undefined, companionCharacterId: undefined, companionCharacterName: undefined })}
          onRelationshipTagChange={(v) => onChange({ ...value, companionRelationshipTag: v })}
        />
      }
    />
  );
}

export function LitMCharacterView({
  value,
  onQuickUpdate,
  campaignId,
  characterId,
}: {
  value: LitMCharacterData;
  onQuickUpdate: (v: LitMCharacterData) => void;
  campaignId?: number;
  /** Персонаж листа — для плашки «Вы в спотлайте» у игрока (Д33, Q19). */
  characterId?: number;
}) {
  return (
    <LitmSheet
      value={value}
      edit={false}
      onChange={onQuickUpdate}
      campaignId={campaignId}
      characterId={characterId}
      onMakeGroupTheme={campaignId ? () => applyGroupTheme(campaignId, value.fellowshipTheme) : undefined}
    />
  );
}
