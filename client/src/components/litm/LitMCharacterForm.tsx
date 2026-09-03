import { memo, useCallback, useMemo, useRef, type DragEvent, useState } from "react";
import type { LitMCharacterData, LitMThemeCard, LitMImprovement } from "../../types";
import type { SearchResult } from "../../types";
import { emptyTheme, ThemeCardEdit, ThemeCardView } from "./ThemeCard";
import { TagList } from "./TagList";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MentionText } from "../mentions/MentionText";
import { api } from "../../api/client";
import { NavIcon } from "../NavIcons";
import {
  findLitmSystemId,
  loadLitmThemeKits,
} from "./litmCompendium";
import { TropePickerModal } from "./TropePickerModal";
import { useConfirm } from "../../hooks/useConfirm";

async function applyGroupTheme(campaignId: number | undefined, theme: LitMThemeCard) {
  if (!campaignId) return;
  if (
    !confirm(
      "Применить эту Тему Содружества как общую для всех персонажей кампании? Она заменит текущую Тему Содружества у каждого персонажа."
    )
  ) {
    return;
  }
  await api.post(`/campaigns/${campaignId}/group-theme/apply`, { theme });
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
  return {
    power: power === "origin" || power === "adventure" || power === "greatness" || power === "variable" ? power : "",
    themeType: (t.themeType as string) ?? (t.type as string) ?? "",
    name: (t.name as string) ?? "",
    powerTags: Array.isArray(t.powerTags) ? (t.powerTags as string[]) : splitLines(t.powerTags),
    weaknessTags: Array.isArray(t.weaknessTags)
      ? (t.weaknessTags as string[])
      : splitLines(t.weaknessTag),
    quest: (t.quest as string) ?? "",
    improve: typeof t.improve === "number" ? t.improve : 0,
    abandon: typeof t.abandon === "number" ? t.abandon : t.abandoned === true ? 3 : 0,
    milestone: typeof t.milestone === "number" ? t.milestone : t.milestone === true ? 3 : 0,
    specialImprovements: normalizeImprovements(t.specialImprovements),
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

export function LitMCharacterEdit({
  value,
  onChange,
  campaignId,
}: {
  value: LitMCharacterData;
  onChange: (v: LitMCharacterData) => void;
  campaignId?: number;
}) {
  const [confirmDialog, confirm] = useConfirm();
  // A keystroke in any one field used to replace the whole LitMCharacterData
  // object and hand every child (4 theme cards, story themes, fellowship
  // theme, backpack) a brand-new `value`/`onChange` prop, defeating
  // React.memo and forcing React to reconcile the entire ~500-node form on
  // every character typed (measured ~30-45ms/keystroke). These refs let the
  // callbacks below stay referentially stable across renders while still
  // reading/writing the latest data, so React.memo on the child cards can
  // actually skip the ones the user isn't currently editing.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

const [showTropePicker, setShowTropePicker] = useState(false);

  const setField = useCallback(
    <K extends keyof LitMCharacterData>(key: K, v: LitMCharacterData[K]) => {
      onChangeRef.current({ ...valueRef.current, [key]: v });
    },
    []
  );
  const setPromise = useCallback((v: string) => setField("promise", v), [setField]);
  const setQuest = useCallback((v: string) => setField("quest", v), [setField]);
  const setFellowshipRelationship = useCallback(
    (v: string) => setField("fellowshipRelationship", v),
    [setField]
  );
  const setQuintessences = useCallback((v: string) => setField("quintessences", v), [setField]);
  const setSpecialImprovements = useCallback(
    (v: string) => setField("specialImprovements", v),
    [setField]
  );
  const setNotes = useCallback((v: string) => setField("notes", v), [setField]);
  const setBackpack = useCallback((tags: string[]) => setField("backpack", tags), [setField]);
  const setFellowshipTheme = useCallback(
    (v: LitMThemeCard) => setField("fellowshipTheme", v),
    [setField]
  );

  const onDropCompanion = useCallback((result: SearchResult) => {
    onChangeRef.current({
      ...valueRef.current,
      companionCharacterType: result.type,
      companionCharacterId: result.id,
      companionCharacterName: result.title,
    });
  }, []);
  const onClearCompanion = useCallback(() => {
    onChangeRef.current({
      ...valueRef.current,
      companionCharacterType: undefined,
      companionCharacterId: undefined,
      companionCharacterName: undefined,
    });
  }, []);
  const onRelationshipTagChange = useCallback((v: string) => setField("companionRelationshipTag", v), [setField]);

  const updateTheme = useCallback((i: number, patch: LitMThemeCard) => {
    const themes = valueRef.current.themes.slice();
    themes[i] = patch;
    onChangeRef.current({ ...valueRef.current, themes });
  }, []);
  const removeTheme = useCallback(async (i: number) => {
    if (!(await confirm({ message: "Удалить эту тему?", confirmLabel: "Удалить", danger: true })))
      return;
    onChangeRef.current({
      ...valueRef.current,
      themes: valueRef.current.themes.filter((_, idx) => idx !== i),
    });
  }, []);
  function addTheme() {
    onChange({ ...value, themes: [...value.themes, emptyTheme()] });
  }
  // Stable per-index callbacks — rebuilt only when the number of theme cards
  // changes (add/remove), not on every keystroke, so React.memo on
  // ThemeCardEdit sees the same onChange/onRemove reference for every card
  // except the one actually being edited.
  const themeChangeCallbacks = useMemo(
    () => value.themes.map((_, i) => (v: LitMThemeCard) => updateTheme(i, v)),
    [value.themes.length, updateTheme]
  );
  const themeRemoveCallbacks = useMemo(
    () => value.themes.map((_, i) => () => removeTheme(i)),
    [value.themes.length, removeTheme]
  );

  const updateStoryTheme = useCallback((i: number, patch: LitMThemeCard) => {
    const storyThemes = valueRef.current.storyThemes.slice();
    storyThemes[i] = patch;
    onChangeRef.current({ ...valueRef.current, storyThemes });
  }, []);
  const removeStoryTheme = useCallback(async (i: number) => {
    if (!(await confirm({ message: "Удалить эту сюжетную тему?", confirmLabel: "Удалить", danger: true })))
      return;
    onChangeRef.current({
      ...valueRef.current,
      storyThemes: valueRef.current.storyThemes.filter((_, idx) => idx !== i),
    });
  }, []);
  function addStoryTheme() {
    onChange({ ...value, storyThemes: [...value.storyThemes, emptyTheme()] });
  }
  const storyThemeChangeCallbacks = useMemo(
    () => value.storyThemes.map((_, i) => (v: LitMThemeCard) => updateStoryTheme(i, v)),
    [value.storyThemes.length, updateStoryTheme]
  );
  const storyThemeRemoveCallbacks = useMemo(
    () => value.storyThemes.map((_, i) => () => removeStoryTheme(i)),
    [value.storyThemes.length, removeStoryTheme]
  );

  const onMakeGroupTheme = useMemo(
    () => (campaignId ? () => applyGroupTheme(campaignId, valueRef.current.fellowshipTheme) : undefined),
    [campaignId]
  );

  return (
    <div className="stack litm-character-form">
      {confirmDialog}
      <label>
        Обещание (Promise)
        <input value={value.promise} onChange={(e) => setPromise(e.target.value)} />
      </label>
      <label>
        Квест (Quest)
        <input value={value.quest} onChange={(e) => setQuest(e.target.value)} />
      </label>
      <label>
        Связь с содружеством (Fellowship Relationship)
        <input
          value={value.fellowshipRelationship}
          onChange={(e) => setFellowshipRelationship(e.target.value)}
        />
      </label>
      <CompanionField
        companionCharacterName={value.companionCharacterName}
        companionRelationshipTag={value.companionRelationshipTag}
        onDropCompanion={onDropCompanion}
        onClearCompanion={onClearCompanion}
        onRelationshipTagChange={onRelationshipTagChange}
      />
      <label>
        Квинтэссенции
        <MentionTextarea value={value.quintessences} onChange={setQuintessences} rows={2} />
      </label>
      <label>
        Особые улучшения
        <MentionTextarea value={value.specialImprovements} onChange={setSpecialImprovements} rows={3} />
      </label>
      <label>
        Заметки
        <MentionTextarea value={value.notes} onChange={setNotes} rows={3} />
      </label>

      <strong>Карты Тем (Theme Cards)</strong>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span></span>
        <button
          type="button"
          onClick={() => setShowTropePicker(true)}
          style={{ padding: "4px 10px", border: "1.5px solid var(--ink)", background: "transparent", cursor: "pointer" }}
        >
          ⚡ Выбрать троп
        </button>
      </div>
      <div className="litm-theme-row">
        {value.themes.map((t, i) => (
          <ThemeCardEdit
            key={i}
            value={t}
            onChange={themeChangeCallbacks[i]}
            onRemove={themeRemoveCallbacks[i]}
          />
        ))}
      </div>
      <button onClick={addTheme} style={{ alignSelf: "flex-start" }}>
        + Добавить карту темы
      </button>

      <strong>Рюкзак, Темы Истории, Тема Содружества</strong>
      <div className="litm-theme-row">
        <div className="card stack litm-theme-card">
          <div className="litm-theme-header litm-header-backpack">
            <div className="litm-theme-title-row">
              <strong className="litm-theme-title">Инвентарь</strong>
            </div>
          </div>
          <TagList tags={value.backpack} variant="power" onChange={setBackpack} />
        </div>
        {value.storyThemes.map((t, i) => (
          <ThemeCardEdit
            key={i}
            value={t}
            onChange={storyThemeChangeCallbacks[i]}
            onRemove={value.storyThemes.length > 1 ? storyThemeRemoveCallbacks[i] : undefined}
            headerColorClass="litm-header-story"
          />
        ))}
        <ThemeCardEdit
          value={value.fellowshipTheme}
          onChange={setFellowshipTheme}
          headerColorClass="litm-header-fellowship"
          onMakeGroupTheme={onMakeGroupTheme}
        />
      </div>
      <button onClick={addStoryTheme} style={{ alignSelf: "flex-start" }}>
        + Добавить тему истории
      </button>

      <TropePickerModal
        isOpen={showTropePicker}
        onClose={() => setShowTropePicker(false)}
        onPick={async (trope) => {
          try {
            const sysId = await findLitmSystemId();
            if (!sysId) return;
            const kits = await loadLitmThemeKits(sysId);
            
            const kitsByThemebook = new Map<string, any[]>();
            for (const kit of kits) {
              const arr = kitsByThemebook.get(kit.themebookEn) ?? [];
              arr.push(kit);
              kitsByThemebook.set(kit.themebookEn, arr);
            }

            const allTypes = [...trope.data.themes_fixed];
            const newThemes = allTypes.map((themebookEn: string) => {
              const themebookKits = kitsByThemebook.get(themebookEn) ?? [];
              const kit = themebookKits[0];
              return {
                ...emptyTheme(),
                themeType: themebookEn,
                power: kit?.data.might ?? "",
                name: kit ? `${kit.name.split(" [")[0]} [${themebookEn}]` : themebookEn,
                powerTags: kit?.data.powerTags ?? [],
                weaknessTags: kit?.data.weaknessTags ?? [],
                quest: kit?.data.quest ?? "",
              };
            });

            const themes = value.themes.slice();
            for (let i = 0; i < 4; i++) {
              themes[i] = newThemes[i] ?? emptyTheme();
            }
            onChange({ ...value, themes });
          } catch (e) {
            console.error(e);
          }
          setShowTropePicker(false);
        }}
      />
    </div>
  );
}

export function LitMCharacterView({
  value,
  onQuickUpdate,
  campaignId,
}: {
  value: LitMCharacterData;
  onQuickUpdate: (v: LitMCharacterData) => void;
  campaignId?: number;
}) {
  function updateTheme(i: number, patch: LitMThemeCard) {
    const themes = value.themes.slice();
    themes[i] = patch;
    onQuickUpdate({ ...value, themes });
  }
  function updateStoryTheme(i: number, patch: LitMThemeCard) {
    const storyThemes = value.storyThemes.slice();
    storyThemes[i] = patch;
    onQuickUpdate({ ...value, storyThemes });
  }

  return (
    <div className="stack sb-scope">
      {value.promise && (
        <div>
          <strong>Обещание</strong> <span>{value.promise}</span>
        </div>
      )}
      {value.quest && (
        <div>
          <strong>Квест</strong> <span>{value.quest}</span>
        </div>
      )}
      {value.fellowshipRelationship && <div className="muted">{value.fellowshipRelationship}</div>}
      {(value.companionCharacterName || value.companionRelationshipTag) && (
        <div className="row">
          {value.companionCharacterName && (
            <span className="litm-tag litm-tag-companion">{value.companionCharacterName}</span>
          )}
          {value.companionRelationshipTag && (
            <span className="litm-tag litm-tag-companion">{value.companionRelationshipTag}</span>
          )}
        </div>
      )}
      {value.quintessences && (
        <div>
          <strong>Квинтэссенции</strong>
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={value.quintessences} />
          </div>
        </div>
      )}
      {value.specialImprovements && (
        <div>
          <strong>Особые улучшения</strong>
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={value.specialImprovements} />
          </div>
        </div>
      )}
      {value.notes && (
        <div>
          <strong>Заметки</strong>
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={value.notes} />
          </div>
        </div>
      )}

      {value.themes.length > 0 && <strong>Карты Тем</strong>}
      <div className="litm-theme-row">
        {value.themes.map((t, i) => (
          <ThemeCardView key={i} value={t} onQuickUpdate={(v) => updateTheme(i, v)} />
        ))}
      </div>

      <strong>Рюкзак, Темы Истории, Тема Содружества</strong>
      <div className="litm-theme-row">
        <div className="card stack litm-theme-card">
          <div className="litm-theme-header litm-header-backpack">
            <div className="litm-theme-title-row">
              <strong className="litm-theme-title">Инвентарь</strong>
            </div>
          </div>
          <TagList
            tags={value.backpack}
            variant="power"
            onChange={(tags) => onQuickUpdate({ ...value, backpack: tags })}
          />
        </div>
        {value.storyThemes.map((t, i) => (
          <ThemeCardView
            key={i}
            value={t}
            onQuickUpdate={(v) => updateStoryTheme(i, v)}
            headerColorClass="litm-header-story"
          />
        ))}
        <ThemeCardView
          value={value.fellowshipTheme}
          onQuickUpdate={(v) => onQuickUpdate({ ...value, fellowshipTheme: v })}
          headerColorClass="litm-header-fellowship"
          onMakeGroupTheme={
            campaignId ? () => applyGroupTheme(campaignId, value.fellowshipTheme) : undefined
          }
        />
      </div>
    </div>
  );
}
