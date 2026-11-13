import { useEffect, useMemo, useRef, useState } from "react";
import { addToBag } from "../../bag";
import { campaignPaths } from "../../data/campaigns";
import { useResource } from "../../data/hooks";
import { sessionPaths } from "../../data/sessions";
import { statblockListPath } from "../../data/statblocks";
import type { Campaign, Character, CompendiumEntry, Statblock } from "../../types";
import { DSeg } from "../DSeg";
import { Tag } from "./LitmBook";
import { normalizeCharacter } from "./LitMCharacterForm";
import { plural } from "./litmBookText";
import { patchLitmSheet } from "./pult/litmSheetWrite";
import { giveTreasure, treasureTheme, treasuresOf, type Treasure } from "./litmTreasury";

const NO_CAMPAIGNS: Campaign[] = [];
const NO_CHARACTERS: Character[] = [];
const NO_STATBLOCKS: Statblock[] = [];

/** Герой партии: сколько тем на листе и есть ли уже это сокровище. */
function HeroRow({ hero, t, onDone }: { hero: Character; t: Treasure; onDone: () => void }) {
  const rows = useResource<Statblock[]>(statblockListPath("character", hero.id)).data;
  const sb = (rows ?? NO_STATBLOCKS).find((s) => s.format === "litm_character");
  const sheet = useMemo(() => {
    if (!sb) return null;
    try { return normalizeCharacter(JSON.parse(sb.content || "{}")); } catch { return normalizeCharacter({}); }
  }, [sb]);
  const name = hero.short_name || hero.character_name;
  const themes = sheet?.themes.filter((x) => x.name).length ?? 0;
  const story = sheet?.storyThemes.filter((x) => x.name).length ?? 0;
  const has = sheet?.storyThemes.some((x) => x.name === t.entry.name) ?? false;
  const give = () => {
    void patchLitmSheet(hero.id, `Сокровище «${t.entry.name}» — ${name}`, giveTreasure(treasureTheme({ ...t, name: t.entry.name })));
    onDone();
  };
  return (
    <button type="button" className="lt-hero" disabled={!sheet || has} onClick={give}>
      <span>{name}</span>
      <small>
        {rows === undefined ? "…" : !sheet ? "нет листа LitM" : has ? "уже есть"
          : `${themes} ${plural(themes, "тема", "темы", "тем")}${story ? ` · сюжетных ${story}` : ""}`}
      </small>
    </button>
  );
}

function CampaignHeroes({ campaign, t, onDone }: { campaign: Campaign; t: Treasure; onDone: () => void }) {
  const heroes = (useResource<Character[]>(sessionPaths.campaignCharacters(campaign.id)).data ?? NO_CHARACTERS)
    .filter((h) => !h.archived_at && (h.status ?? "active") === "active");
  if (!heroes.length) return null;
  return (
    <div className="lt-camp">
      <div className="lb-lbl">{campaign.name} · партия</div>
      {heroes.map((h) => <HeroRow key={h.id} hero={h} t={t} onDone={onDone} />)}
    </div>
  );
}

/** «Дать герою…»: герои кампаний этой системы, сокровище встаёт сюжетной темой. */
function GiveBox({ t, systemId, onClose }: { t: Treasure; systemId: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const campaigns = (useResource<Campaign[]>(campaignPaths.list()).data ?? NO_CAMPAIGNS)
    .filter((c) => c.system_id === systemId && c.status !== "completed");
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  return (
    <div className="lt-give" ref={ref} role="dialog" aria-label={`Дать герою: ${t.entry.name}`}>
      <div className="lb-lbl">{t.entry.name} → сюжетной темой</div>
      {campaigns.map((c) => <CampaignHeroes key={c.id} campaign={c} t={t} onDone={onClose} />)}
      {!campaigns.length && <p className="lb-empty">Нет кампаний по этой системе.</p>}
    </div>
  );
}

function TreasureCard({ t, systemId, focus }: { t: Treasure; systemId: number; focus: boolean }) {
  const [giving, setGiving] = useState(false);
  const e = t.entry;
  const influence = t.typeEn === "Influence";
  return (
    <div className={`lt-card${influence ? " lt-card--inf" : ""}${focus ? " is-on" : ""}`} id={`litm-tr-${e.id}`}>
      <span className="lt-card__ty">{t.type || "Сокровище"} · сюжетная тема</span>
      <h4>{e.name}<small>{e.name_original}</small></h4>
      {e.description && <p>{e.description}</p>}
      <div className="lb-tags">{t.powerTags.map((x) => <Tag key={x}>{x}</Tag>)}</div>
      {t.weakness && <div className="lb-tags"><Tag weak>{t.weakness}</Tag></div>}
      <div className="lt-card__acts">
        <button type="button" className="d-btn d-btn--sm" aria-expanded={giving} onClick={() => setGiving((v) => !v)}>Дать герою…</button>
        <button type="button" className="d-btn d-btn--sm d-btn--quiet"
          onClick={() => addToBag({ type: "compendium_entry", id: e.id, title: e.name, kind: e.kind, system_id: e.system_id, section_id: e.section_id })}>В мешок</button>
      </div>
      {giving && <GiveBox t={t} systemId={systemId} onClose={() => setGiving(false)} />}
    </div>
  );
}

/** «Сокровищница» LitM по доске Litm-Treasury: карточки как у набора, фильтр по типу, «Дать герою…». */
export function LitmTreasuryView({ systemId, entries, selectedId }: {
  systemId: number;
  entries: CompendiumEntry[];
  selectedId: number | undefined;
}) {
  const all = useMemo(() => treasuresOf(entries), [entries]);
  const types = useMemo(() => [...new Set(all.map((t) => t.type).filter(Boolean))], [all]);
  const [type, setType] = useState("");
  const shown = type ? all.filter((t) => t.type === type) : all;
  const pages = [...new Set(all.map((t) => t.page).filter(Boolean))];
  useEffect(() => {
    if (selectedId !== undefined) document.getElementById(`litm-tr-${selectedId}`)?.scrollIntoView({ block: "center" });
  }, [selectedId, all]);
  return (
    <div className="lg lt">
      <div className="lb-head">
        <h2>Сокровищница</h2>
        <span className="d-mono">{all.length} {plural(all.length, "сокровище", "сокровища", "сокровищ")} · 2 тега силы и слабость</span>
      </div>
      {types.length > 1 && (
        <div className="lb-bar">
          <DSeg label="Тип сокровища" value={type} onChange={setType}
            items={[{ id: "", label: "Все" }, ...types.map((x) => ({ id: x, label: `${x} · ${all.filter((t) => t.type === x).length}` }))]} />
        </div>
      )}
      <div className="lt-how">
        <div><b>Что это</b><p>Особая вещь, зверь или милость — сюжетная тема героя, а не тег рюкзака.</p></div>
        <div><b>Как удержать</b><p>Тему сокровища поддерживают на привале, иначе она уходит.</p></div>
        <div><b>Навсегда</b><p>Когда герой меняет тему, сокровище может стать его темой.</p></div>
      </div>
      <div className="lt-cards">{shown.map((t) => <TreasureCard key={t.entry.id} t={t} systemId={systemId} focus={t.entry.id === selectedId} />)}</div>
      <div className="lb-src">Legend in the Mist · том II · с. B38{pages.length > 0 && `, ${pages.join(", ")}`}</div>
    </div>
  );
}
