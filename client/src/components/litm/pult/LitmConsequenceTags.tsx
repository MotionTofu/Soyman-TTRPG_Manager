import { useState } from "react";
import { consequenceAdjustment, consequenceTier, type MightStep } from "@shared/litm/consequence";
import type { LitMCharacterData } from "../../../types";
import { Modal } from "../../Modal";
import { HeroMight, SourceMight, type ConsequenceSource } from "./LitmConsequenceMight";
import { useLitmSheet } from "./litmSheetWrite";

type Scratch = { kind: "backpack"; name: string } | {
  kind: "themes" | "storyThemes" | "fellowshipTheme"; index: number; name: string; theme: string;
};

function scratchOptions(sheet: LitMCharacterData): Scratch[] {
  const themes = (kind: "themes" | "storyThemes" | "fellowshipTheme", list: LitMCharacterData["themes"]): Scratch[] =>
    list.flatMap((t, index) => [...new Set([t.name, ...t.powerTags])].filter((name) => name && !t.scratchedTags?.includes(name))
      .map((name) => ({ kind, index, name, theme: t.name })));
  return [
    ...[...new Set(sheet.backpack)].map((name): Scratch => ({ kind: "backpack", name })),
    ...themes("themes", sheet.themes),
    ...themes("storyThemes", sheet.storyThemes),
    ...themes("fellowshipTheme", [sheet.fellowshipTheme]),
  ];
}

function tagPatch(sheet: LitMCharacterData, added: string[], scratched: Scratch[]): Partial<LitMCharacterData> {
  const patch: Partial<LitMCharacterData> = {};
  const removed = scratched.filter((tag) => tag.kind === "backpack").map((tag) => tag.name);
  if (removed.length || added.length) patch.backpack = [...new Set([...sheet.backpack.filter((tag) => !removed.includes(tag)), ...added])];
  const apply = (kind: "themes" | "storyThemes" | "fellowshipTheme", list: LitMCharacterData["themes"]) => list.map((t, i) => {
    const names = scratched.flatMap((tag) => tag.kind === kind && tag.index === i && tag.theme === t.name
      && (tag.name === t.name || t.powerTags.includes(tag.name)) ? [tag.name] : []);
    return names.length ? { ...t, scratchedTags: [...new Set([...(t.scratchedTags ?? []), ...names])] } : t;
  });
  if (scratched.some((tag) => tag.kind === "themes")) patch.themes = apply("themes", sheet.themes);
  if (scratched.some((tag) => tag.kind === "storyThemes")) patch.storyThemes = apply("storyThemes", sheet.storyThemes);
  if (scratched.some((tag) => tag.kind === "fellowshipTheme")) patch.fellowshipTheme = apply("fellowshipTheme", [sheet.fellowshipTheme])[0];
  return patch;
}

export function LitmConsequenceTags({ heroes, initialId, source, initialMode, onClose, onBack, onApply }: {
  heroes: { id: number; label: string }[];
  initialId?: number;
  source: ConsequenceSource;
  initialMode: "give" | "scratch";
  onClose: () => void;
  onBack?: () => void;
  onApply: (id: number, label: string, patch: (data: LitMCharacterData) => Partial<LitMCharacterData>) => Promise<boolean>;
}) {
  const [id, setId] = useState(initialId ?? 0);
  const [mode, setMode] = useState(initialMode);
  const hero = heroes.find((h) => h.id === id);
  const sheet = useLitmSheet(id);
  const [sourceMight, setSourceMight] = useState<MightStep | "">("");
  const [heroMight, setHeroMight] = useState<MightStep | "">("");
  const [base, setBase] = useState(1);
  const [added, setAdded] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const adjustment = consequenceAdjustment(sourceMight, heroMight).tags;
  const count = consequenceTier(base, adjustment);
  const options = sheet ? scratchOptions(sheet) : [];
  const toAdd = added.slice(0, count).map((tag) => tag.trim()).filter(Boolean);
  const toScratch = options.filter((tag) => picked.includes(JSON.stringify(tag)));
  const valid = mode === "give"
    ? new Set(toAdd).size === count && toAdd.every((tag) => !sheet?.backpack.includes(tag))
    : toScratch.length === count;

  async function submit() {
    if (!hero || !sheet || !valid || busy) return;
    setBusy(true);
    try {
      const label = `${hero.label} · ${mode === "give" ? "получает теги" : "теряет теги"}`;
      const ok = await onApply(id, label, (fresh) => count ? tagPatch(fresh, mode === "give" ? toAdd : [], toScratch) : {});
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={busy ? () => {} : onClose} ariaLabel="Последствие тегами" className="lp-give lp-effect">
      <h2>{mode === "give" ? "Дать сюжетные теги" : "Вычеркнуть теги"}</h2>
      <label className="lp-give__name">
        Герой
        <select value={id || ""} onChange={(e) => {
          setId(Number(e.target.value));
          setHeroMight("");
          setAdded([]);
          setPicked([]);
        }}>
          <option value="">— выбрать героя —</option>
          {heroes.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
        </select>
      </label>
      <div className="lp-give__row" role="group" aria-label="Что сделать с тегами">
        <button type="button" className={`lp-chip${mode === "give" ? " is-on" : ""}`} aria-pressed={mode === "give"} onClick={() => setMode("give")}>Дать теги</button>
        <button type="button" className={`lp-chip${mode === "scratch" ? " is-on" : ""}`} aria-pressed={mode === "scratch"} onClick={() => setMode("scratch")}>Вычеркнуть теги</button>
      </div>
      <fieldset className="lp-give__might">
        <legend>Могущество в подходящем аспекте</legend>
        <SourceMight source={source} value={sourceMight} onChange={(level) => { setSourceMight(level); setPicked([]); }} />
        {hero && <HeroMight heroId={id} label={hero.label} value={heroMight} onChange={(level) => { setHeroMight(level); setPicked([]); }} />}
      </fieldset>
      <label className="lp-give__row">
        Тегов до поправки
        <input type="number" min={1} max={99} value={base} onChange={(e) => {
          setBase(Math.max(1, Math.min(99, Math.trunc(Number(e.target.value)) || 1)));
          setPicked([]);
        }} />
      </label>
      <p className="lp-give__preview" role="status">
        {adjustment ? `Поправка ${adjustment > 0 ? "+" : "−"}${Math.abs(adjustment)} · ` : ""}Тегов к применению: {count}
      </p>
      {mode === "give" && Array.from({ length: count }, (_, i) => (
        <label key={i} className="lp-give__name">
          Сюжетный тег {i + 1}
          <input value={added[i] ?? ""} onChange={(e) => {
            const name = e.target.value;
            setAdded((tags) => Object.assign(tags.slice(), { [i]: name }));
          }} />
        </label>
      ))}
      {mode === "scratch" && count > 0 && <div className="lp-give__row" role="group" aria-label="Какие теги вычеркнуть">
        {options.map((tag) => {
          const key = JSON.stringify(tag);
          const on = picked.includes(key);
          return <button key={key} type="button" className={`lp-chip${on ? " is-on" : ""}`} aria-pressed={on}
            disabled={!on && picked.length >= count} onClick={() => setPicked((items) => on ? items.filter((x) => x !== key) : [...items, key])}>
            {tag.name}{tag.kind === "backpack" ? " · рюкзак" : tag.theme && tag.name !== tag.theme ? ` · ${tag.theme}` : ""}
          </button>;
        })}
      </div>}
      {hero && !sheet && <p className="lp-give__preview">У героя нет доступного листа.</p>}
      <div className="modal-footer row">
        {onBack && <button type="button" disabled={busy} onClick={onBack}>К статусу</button>}
        <button type="button" disabled={busy} onClick={onClose}>Отмена</button>
        <button type="button" className="primary" disabled={!hero || !sheet || !valid || busy} onClick={() => void submit()}>
          {count ? "Применить" : "Завершить без эффекта"}
        </button>
      </div>
    </Modal>
  );
}
