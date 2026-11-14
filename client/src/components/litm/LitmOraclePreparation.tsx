import { useQueries } from "@tanstack/react-query";
import { useContext, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DSeg } from "../DSeg";
import { Modal } from "../Modal";
import { compendiumMembershipAffects } from "../../data/compendiumEntries";
import { canvasStoryAffects } from "../../data/canvas";
import { statblockListPath } from "../../data/statblocks";
import { resourceQuery, useAction, useResource, write } from "../../data/hooks";
import type { Campaign, Character, CompendiumEntry, LitMCharacterData, Setting, Statblock, StoryArc } from "../../types";
import { LitmChallengeEditor } from "./LitmChallengeEditor";
import { Rating, Roles } from "./LitmBook";
import { parseStatusTag } from "@shared/litm/status";
import { emptyChallengeProfile, ROLE_ORDER, toEntryData, toStatblockContent, type LitmChallengeProfileData } from "./litmChallenge";
import { findLitmSheet } from "./pult/litmSheetWrite";
import { cleanProfile } from "./litmChallengeSave";
import { DiceResult, OracleText, RollBar, RollButton } from "./LitmOracleParts";
import { OracleHistory } from "./useLitmOracle";
import { throwDice, type Builder, type Dice } from "./litmOracles";

const TIMING = [{ id: "start", label: "Начало" }, { id: "middle", label: "Середина" }, { id: "end", label: "Конец" }];
const DIFFICULTIES = [{ id: "hard", label: "Трудный", offset: 1 }, { id: "medium", label: "Средний", offset: 0 }, { id: "easy", label: "Лёгкий", offset: -1 }] as const;

export function BuilderOracle({ data, systemId, challengesId, actionPath, isGM, campaignId, onSavedToScene }: {
  data: Builder; systemId: number; challengesId?: number; actionPath?: string; isGM: boolean; campaignId?: number; onSavedToScene?: (entry: CompendiumEntry) => Promise<boolean>;
}) {
  const record = useContext(OracleHistory);
  const [name, setName] = useState("");
  const [timing, setTiming] = useState("middle");
  const [rating, setRating] = useState<number>();
  const [dice, setDice] = useState<Dice>();
  const [raises, setRaises] = useState(0);
  const [adventure, setAdventure] = useState(0);
  const [greatness, setGreatness] = useState(0);
  const [party, setParty] = useState(campaignId == null ? "" : String(campaignId));
  const [roles, setRoles] = useState<string[]>([]);
  const [threat, setThreat] = useState("");
  const [consequences, setConsequences] = useState("");
  const campaigns = useResource<Campaign[]>(isGM ? "/campaigns?system_id=" + systemId : null).data;
  const heroes = useResource<Character[]>(isGM && party ? "/characters?campaign_id=" + party : null).data;
  const [moveGreatness, setMoveGreatness] = useState(false);
  const [aspects, setAspects] = useState("");
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState("");
  const [tags, setTags] = useState("");
  const [statuses, setStatuses] = useState("");
  const [editing, setEditing] = useState(false);
  const [added, setAdded] = useState<CompendiumEntry>();
  const [reset, setReset] = useState(0);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferred, setTransferred] = useState(false);
  const lines = (value: string) => value.split("\n").map((s) => s.trim()).filter(Boolean);
  const transfer = moveGreatness && greatness > 0 ? 1 : 0;
  const adventureCount = Math.max(0, adventure + (transfer ? 1 : -1));
  const greatnessCount = Math.max(0, greatness - transfer);
  const aspectList = lines(aspects);
  const tagList = [...lines(tags), ...lines(statuses)];
  const statusTotal = lines(statuses).reduce((sum, text) => sum + (parseStatusTag(text)?.tier ?? 0), 0);
  const limitList = [
    ...DIFFICULTIES.flatMap(({ id, offset }) => rating && rating + offset > 0 && limits[id]?.trim() ? [{ name: limits[id].trim(), max: String(rating + offset) }] : []),
    ...(progress.trim() ? [{ name: progress.trim(), max: "4", arrow: true }] : []),
  ];
  const draft: LitmChallengeProfileData = {
    ...emptyChallengeProfile(name.trim() || "Новый вызов"),
    rating: rating ?? 1, limitList, roles,
    threatList: threat.trim() || consequences.trim() ? [{ name: "", lead: threat.trim(), consequences: lines(consequences) }] : [],
    tagList: tagList.map((text) => ({ text })),
    mightList: aspectList.map((name, i) => ({ name, level: i < adventureCount ? "adventure" : "greatness" })),
  };
  async function sendToScene(entry: CompendiumEntry) {
    if (!onSavedToScene) return;
    setTransferBusy(true);
    try { setTransferred(await onSavedToScene(entry)); }
    finally { setTransferBusy(false); }
  }

  function rollRating() {
    const roll = throwDice(timing === "middle" ? "d6" : "2d6");
    const value = timing === "start" ? Math.min(...roll.dice) : Math.max(...roll.dice);
    setDice({ ...roll, value });
    if (value === 6) {
      setRaises(raises + 1);
      setRating(undefined);
      record("Конструктор · рейтинг", "6", "Повысить Могущество и перебросить", true);
    } else {
      setRating(value);
      record("Конструктор · рейтинг", String(value), "Рейтинг " + value, true);
    }
  }
  const controls = [
    <div key="might" className="lo-form">
      {isGM && !!campaigns?.length && <label>Партия<select value={party} onChange={(e) => setParty(e.target.value)}>
        <option value="">Ввести числа вручную</option>
        {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>}
      {party && <PartyMight key={party} heroes={heroes ?? []} onApply={(a, g) => { setAdventure(a); setGreatness(g); }} />}
      <label>Тем Приключения <input type="number" min="0" value={adventure} onChange={(e) => setAdventure(Math.max(0, Math.trunc(e.target.valueAsNumber || 0)))} /></label>
      <label>Тем Величия <input type="number" min="0" value={greatness} onChange={(e) => setGreatness(Math.max(0, Math.trunc(e.target.valueAsNumber || 0)))} /></label>
      <label className="lo-check"><input type="checkbox" disabled={!greatness} checked={!!transfer} onChange={(e) => setMoveGreatness(e.target.checked)} /> Перенести одну тему Величия в Приключение</label>
      <small>Аспектов Приключения: {adventureCount} · Величия: {greatnessCount}{raises ? " · Повышений за броски: " + raises : ""}</small>
      <label>Аспекты Могущества, по одному на строке<textarea value={aspects} onChange={(e) => setAspects(e.target.value)} /></label>
    </div>,
    <RollBar key="rating">
      <DSeg label="Место в приключении" items={TIMING} value={timing} onChange={setTiming} />
      <RollButton onClick={rollRating}>{dice ? "Перебросить" : "Бросить рейтинг"}</RollButton>
      <DiceResult roll={dice} total={dice && String(dice.value)} />
      <span role="status">{dice?.value === 6 ? "Повысьте Могущество и перебросьте." : rating ? "Рейтинг " + rating : ""}</span>
      <label className="lo-control">Рейтинг <select value={rating ?? ""} onChange={(e) => setRating(Number(e.target.value) || undefined)}>
        <option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
    </RollBar>,
    <div key="limits" className="lo-form">
      {DIFFICULTIES.map(({ id, label, offset }) => <label key={id}>{label}{rating ? " · " + Math.max(0, rating + offset) : ""}
        <input value={limits[id] ?? ""} disabled={rating === 1 && offset === -1} onChange={(e) => setLimits({ ...limits, [id]: e.target.value })} /></label>)}
      <label>Предел-счётчик · 4 <input value={progress} onChange={(e) => setProgress(e.target.value)} /></label>
    </div>,
    <div key="tags" className="lo-form">
      <label>Теги, по одному на строке <textarea value={tags} onChange={(e) => setTags(e.target.value)} /></label>
      <label>Статусы, по одному на строке <textarea value={statuses} onChange={(e) => setStatuses(e.target.value)} placeholder="настороже-1" /></label>
      {rating && <small>Тегов: {lines(tags).length} / {rating} · уровней статусов: {statusTotal} / {rating}</small>}
    </div>,
    <div key="threats" className="lo-form">
      <div className="lo-actions" role="group" aria-label="Роли вызова">
        {ROLE_ORDER.map((role) => <button className="d-btn d-btn--sm" key={role} type="button" aria-pressed={roles.includes(role)}
          onClick={() => setRoles(roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role])}>{role}</button>)}
      </div>
      {actionPath && <Link to={actionPath + (roles[0] ? "&role=" + encodeURIComponent(roles[0]) : "")} target="_blank" rel="noopener">Открыть «Действие вызова» в новой вкладке</Link>}
      <label>Угроза<input value={threat} onChange={(e) => setThreat(e.target.value)} /></label>
      <label>Последствия, по одному на строке<textarea value={consequences} onChange={(e) => setConsequences(e.target.value)} /></label>
    </div>,
  ];
  return <div className="lo-layout">
    <div>
      <RollBar>
        <input className="lo-question" value={name} onChange={(e) => { setName(e.target.value); setAdded(undefined); setTransferred(false); }} aria-label="Название вызова" placeholder="Название вызова" />
        <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => {
          setTransferred(false); setName(""); setTiming("middle"); setRating(undefined); setDice(undefined); setRaises(0); setAdventure(0);
          setRoles([]); setThreat(""); setConsequences(""); setParty(campaignId == null ? "" : String(campaignId)); setGreatness(0); setMoveGreatness(false); setAspects(""); setLimits({}); setProgress(""); setTags(""); setStatuses(""); setAdded(undefined); setReset(reset + 1);
        }}>Начать заново</button>
      </RollBar>
      <ol key={reset} className="lo-builder">{data.steps.map((step, i) => <li key={step.key}>
        <details open={i < 2}><summary><OracleText text={step.name} en={step.nameEn} /></summary>
          <p className="lo-prose"><OracleText text={step.text} en={step.textEn} /></p>{controls[i]}</details>
      </li>)}</ol>
      <details className="lo-example"><summary>Пример · {data.example.name}</summary><p className="lo-prose"><OracleText text={data.example.text} en={data.example.textEn} /></p></details>
    </div>
    <aside className="lo-draft">
      <h4 className="lo-heading">Черновик вызова</h4>
      <strong>{draft.title}</strong>
      {rating && <Rating value={rating} />}
      {draft.roles.length > 0 && <Roles roles={draft.roles} />}
      {aspectList.length > 0 && <p>{aspectList.join(" · ")}</p>}
      {limitList.length > 0 && <p><b>Пределы</b><br />{limitList.map((l) => l.name + " " + l.max).join(" · ")}</p>}
      {tagList.length > 0 && <p><b>Теги и статусы</b><br />{tagList.join(" · ")}</p>}
      {consequences && <p><b>Последствия</b><br />{lines(consequences).join(" · ")}</p>}
      {isGM && challengesId && (added ? onSavedToScene ?
        <button type="button" className="d-btn" disabled={transferBusy || transferred} onClick={() => void sendToScene(added)}>
          {transferred ? "В «Препятствиях»" : "В «Препятствия»"}</button> :
        <Link to={"/compendium/" + added.id} className="d-btn">Открыть сохранённый вызов</Link> :
        <button type="button" className="d-btn" disabled={!name.trim() || !rating} onClick={() => setEditing(true)}>Сохранить как вызов</button>)}
    </aside>
    {editing && isGM && challengesId && <SaveChallenge systemId={systemId} initial={draft}
      onClose={() => setEditing(false)} onSaved={(entry) => { setAdded(entry); setEditing(false); void sendToScene(entry); }} />}
  </div>;
}

function SaveChallenge({ systemId, initial, onClose, onSaved }: {
  systemId: number; initial: LitmChallengeProfileData; onClose: () => void; onSaved: (entry: CompendiumEntry) => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = useAction();
  async function save(value: LitmChallengeProfileData) {
    setBusy(true);
    try {
      const p = cleanProfile({ ...value, title: value.title.trim() || initial.title });
      const entry = await run(() => write.post<CompendiumEntry>("/systems/" + systemId + "/litm-challenges", {
        name: p.title, name_original: p.titleEn, description: p.description, data: toEntryData(p), profile: toStatblockContent(p),
      }), { affects: [...compendiumMembershipAffects(systemId), { path: "/statblocks?owner_type=compendium_entry" }], retry: false });
      if (entry) onSaved(entry);
    } finally {
      setBusy(false);
    }
  }
  return <Modal className="litm-book lo-preview" wide ariaLabel="Сохранить как вызов" onClose={() => { if (!busy) onClose(); }} closeOnBackdropClick={false}>
    <h3>Сохранить как вызов</h3>
    <LitmChallengeEditor initial={initial} busy={busy} onSave={(p) => void save(p)} onCancel={onClose} />
  </Modal>;
}

function PartyMight({ heroes, onApply }: { heroes: Character[]; onApply: (adventure: number, greatness: number) => void }) {
  const ids = heroes.filter((hero) => !hero.archived_at).map((hero) => hero.id);
  const queries = useQueries({ queries: ids.map((id) => resourceQuery<Statblock[]>(statblockListPath("character", id))) });
  if (queries.some((query) => query.isLoading)) return <small>Загрузка листов…</small>;
  const values = queries.flatMap((query) => {
    const sheet = findLitmSheet(query.data);
    if (!sheet) return [];
    try {
      const data: Partial<LitMCharacterData> = JSON.parse(sheet.content);
      const themes = Array.isArray(data.themes) ? data.themes : [];
      return [{
        adventure: themes.filter((theme) => theme?.power === "adventure").length,
        greatness: themes.filter((theme) => theme?.power === "greatness").length,
      }];
    } catch {
      return [];
    }
  });
  if (!values.length) return <small>В партии пока нет листов LitM.</small>;
  const adventure = Math.round(values.reduce((sum, value) => sum + value.adventure, 0) / values.length);
  const greatness = Math.round(values.reduce((sum, value) => sum + value.greatness, 0) / values.length);
  return <div className="lo-actions">
    <small>В среднем: Приключение {adventure} · Величие {greatness}</small>
    <button type="button" className="d-btn d-btn--sm" onClick={() => onApply(adventure, greatness)}>Взять из партии</button>
  </div>;
}

const EMPTY_SETTINGS: Setting[] = [];
const EMPTY_ARCS: StoryArc[] = [];
export function SaveOracleScene({ systemId, text, onClose }: { systemId: number; text: string; onClose: () => void }) {
  const navigate = useNavigate();
  const run = useAction();
  const settings = useResource<Setting[]>("/settings").data ?? EMPTY_SETTINGS;
  const campaigns = useResource<Campaign[]>("/campaigns?system_id=" + systemId).data;
  const matching = new Set(campaigns?.filter((c) => c.system_id === systemId).map((c) => c.setting_id));
  const [settingId, setSettingId] = useState("");
  const [arcId, setArcId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const arcs = useResource<StoryArc[]>(settingId ? "/story/arcs?setting_id=" + settingId : null).data ?? EMPTY_ARCS;
  const adventures = arcs.filter((a) => a.kind === "adventure" && !a.is_default);
  async function save() {
    if (!name.trim() || !adventures.some((a) => a.id === Number(arcId))) return;
    setBusy(true);
    const scene = await run(() => write.post<{ id: number }>("/story/scenes", {
      setting_id: Number(settingId), arc_id: Number(arcId), name: name.trim(), summary: text,
    }), { affects: canvasStoryAffects(), retry: false });
    setBusy(false);
    if (scene) navigate("/scenes/" + scene.id);
  }
  return <Modal className="litm-book lo-preview" ariaLabel="Сохранить как сцену" onClose={() => { if (!busy) onClose(); }} closeOnBackdropClick={false}>
    <h3>Сохранить как сцену</h3>
    <form className="lo-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>Название сцены<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Сеттинг<select required value={settingId} onChange={(e) => { setSettingId(e.target.value); setArcId(""); }}>
        <option value="">Выбрать сеттинг</option>
        {[...settings].sort((a, b) => Number(matching.has(b.id)) - Number(matching.has(a.id))).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Приключение<select required value={arcId} onChange={(e) => setArcId(e.target.value)}>
        <option value="">Выбрать приключение</option>
        {adventures.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <div className="lo-actions">
        <button type="button" className="d-btn d-btn--ghost" disabled={busy} onClick={onClose}>Отмена</button>
        <button type="submit" className="d-btn" disabled={busy || !arcId || !name.trim()}>Сохранить</button>
      </div>
    </form>
  </Modal>;
}
