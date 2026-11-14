import { Fragment, useContext, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addToBag } from "../../bag";
import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import { statblockListPath } from "../../data/statblocks";
import type { CompendiumEntry, Statblock, SystemSection } from "../../types";
import { DSeg } from "../DSeg";
import { Modal } from "../Modal";
import { Consequence, Rating, Roles } from "./LitmBook";
import { norm } from "./litmBookText";
import { LitmChallengeProfile } from "./LitmChallengeProfile";
import { challengeProfile } from "./litmChallenge";
import { journeyOf, journeysOf, type Vignette } from "./litmJourneys";
import { DiceResult, OracleTable, OracleText, RollBar, RollButton } from "./LitmOracleParts";
import { OracleHistory, rollFrom, type Picked } from "./useLitmOracle";
import { findByOriginal, oraclePath, type Area, type Premade, type ProfileColumn, type ProfileRow, type VignetteRow, type VignetteTable } from "./litmOracles";

const EMPTY: CompendiumEntry[] = [];
export type OracleCardTarget = { entry: CompendiumEntry; vignette?: Vignette };

export function PremadeOracle({ data, systemId, sections, initialArea, isGM, onTransfer }: {
  data: Premade; systemId: number; sections: SystemSection[]; initialArea: string | null; isGM: boolean; onTransfer?: (target: OracleCardTarget) => Promise<boolean>;
}) {
  const record = useContext(OracleHistory);
  const challengesId = sections.find((s) => s.kind === "monster")?.id;
  const journeysId = sections.find((s) => s.kind === "journey")?.id;
  const challenges = useResource<CompendiumEntry[]>(challengesId ? compendiumPaths.sectionEntries(systemId, challengesId) : null).data ?? EMPTY;
  const journeyEntries = useResource<CompendiumEntry[]>(journeysId ? compendiumPaths.sectionEntries(systemId, journeysId) : null).data ?? EMPTY;
  const journeys = useMemo(() => journeysOf(journeyEntries), [journeyEntries]);
  const [areaPicks, setAreaPicks] = useState<Picked<Area>[]>([]);
  const defaultArea = findByOriginal(data.areas, initialArea ?? undefined) ?? data.areas[0];
  const [current, setCurrent] = useState<Area>(defaultArea);
  const [category, setCategory] = useState<ProfileColumn>("creatures");
  const [profile, setProfile] = useState<Picked<ProfileRow>>();
  const [vignetteTable, setVignetteTable] = useState<Picked<VignetteTable>>();
  const [vignettePick, setVignettePick] = useState<Picked<VignetteRow>>();
  const [randomVignette, setRandomVignette] = useState<OracleCardTarget>();
  const [preview, setPreview] = useState<OracleCardTarget>();
  const placeEntries = journeys.flatMap((group) => group.journeys);

  function chooseAreas(pick: Picked<Area>) {
    const regular = data.areas.filter((a) => !a.again);
    const another = () => {
      let result = rollFrom(data.areas, "d66");
      while (result?.row.again) result = rollFrom(data.areas, "d66");
      return result ?? { row: regular[0] };
    };
    const picks = pick.row.again ? [another(), another()] : [pick];
    setAreaPicks(picks);
    setCurrent(picks[0].row);
    setProfile(undefined);
    record("Готовый профиль · область", picks.map((p) => p.dice?.value ?? p.row.roll).join(" / "), picks.map((p) => p.row.name).join(" · "), !!pick.dice);
  }
  function chooseProfile(row: ProfileRow, dice?: Picked<ProfileRow>["dice"]) {
    setProfile({ row, dice });
    record("Готовый профиль · " + current.name, String(dice?.value ?? row.roll), row.name, !!dice);
    if (row.kind === "vignettes") {
      const traps = findByOriginal(data.vignettes, "Locks & Traps");
      if (traps) {
        chooseVignetteTable(traps);
        document.getElementById("lo-vignettes")?.scrollIntoView({ block: "nearest" });
      }
    }
  }
  function targets(row: ProfileRow) {
    const inputs = row.kind === "challenge"
      ? challenges.filter((entry) => entry.data?.locationEn && entry.data?.page)
      : placeEntries.map((j) => j.entry);
    return (row.refs ?? []).flatMap((ref) => {
      const entry = inputs.find((e) => norm(e.name_original) === norm(ref));
      return entry ? [entry] : [];
    });
  }
  function chooseVignetteTable(row: VignetteTable, dice?: Picked<VignetteTable>["dice"]) {
    setVignetteTable({ row, dice });
    setVignettePick(undefined);
    setRandomVignette(undefined);
    record("Готовый профиль · виньетки", String(dice?.value ?? row.roll), row.name, !!dice);
  }
  function chooseVignette(row: VignetteRow, dice?: Picked<VignetteRow>["dice"]) {
    setVignettePick({ row, dice });
    record("Готовый профиль · виньетка", String(dice?.value ?? row.roll), row.name, !!dice);
  }
  function vignetteTargets(row: VignetteRow): OracleCardTarget[] {
    const group = journeys.find((g) => g.vignetteGroups.some((table) => norm(table.nameEn) === norm(vignetteTable?.row.nameEn ?? "")));
    const table = group?.vignetteGroups.find((g) => norm(g.nameEn) === norm(vignetteTable?.row.nameEn ?? ""));
    if (!group || !table) return [];
    const names = row.refs?.length ? row.refs : (row.nameEn ?? "").split(/\s+(?:or|\/)\s+/i);
    return names.flatMap((name) => {
      const vignette = findByOriginal(table.vignettes, name);
      return vignette ? [{ entry: group.entry, vignette }] : [];
    });
  }
  function rollVignette() {
    if (!vignetteTable) return;
    if (vignetteTable.row.items.length) {
      const pick = rollFrom(vignetteTable.row.items, "d6");
      if (pick) chooseVignette(pick.row, pick.dice);
      return;
    }
    const withVignettes = placeEntries.filter((j) => j.vignettes.length > 0);
    if (!withVignettes.length) return;
    const journey = withVignettes[Math.floor(Math.random() * withVignettes.length)];
    const vignette = journey.vignettes[Math.floor(Math.random() * journey.vignettes.length)];
    setRandomVignette({ entry: journey.entry, vignette });
    record("Готовый профиль · " + journey.entry.name, "—", vignette.name, true);
  }
  const profileTargets = profile ? targets(profile.row) : [];
  const now = data.columns.find((r) => r.key === category);
  return <>
    <RollBar>
      <RollButton onClick={() => { const p = rollFrom(data.areas, "d66"); if (p) chooseAreas(p); }}>Бросить область</RollButton>
      {areaPicks.map((p, i) => <span className="lo-actions" key={i}>
        <DiceResult roll={p.dice} total={p.dice && String(p.dice.value)} />
        <button type="button" className="d-btn d-btn--sm" aria-pressed={p.row === current} onClick={() => { setCurrent(p.row); setProfile(undefined); }}>{p.row.name}</button>
      </span>)}
      <DSeg label="Тип профиля" items={data.columns.map((c) => ({ id: c.key, label: c.name }))} value={category}
        onChange={(id) => { setCategory(id); setProfile(undefined); }} />
      <RollButton onClick={() => { const p = rollFrom(current[category] ?? [], "d6"); if (p) chooseProfile(p.row, p.dice); }}>Бросить d6</RollButton>
      <DiceResult roll={profile?.dice} /><b role="status">{profile?.row.name}</b>
    </RollBar>
    {profile && <div className="lo-result">
      <div><b><OracleText text={profile.row.name} en={profile.row.nameEn} /></b><small>{current.name} · с. {profile.row.page}</small></div>
      <div className="lo-actions">{profileTargets.map((entry) => <button type="button" className="d-btn"
        key={entry.id} onClick={() => setPreview({ entry })}>{profileTargets.length > 1 ? entry.name : "Открыть карточку"}</button>)}</div>
    </div>}
    <div className="lo-area">
      <OracleTable rows={data.areas} columnNames={["d66", "Область"]} selected={areaPicks.length ? areaPicks.map(({ row }) => row) : current} onPick={(row) => chooseAreas({ row })}
        columns={(r) => [<Fragment key="area"><OracleText text={r.name} en={r.nameEn} /> {r.page && <small className="lo-secondary">{r.page}</small>}</Fragment>]} />
      <div><h4 className="lo-heading">{current.name} {current.page && <small>· с. {current.page}</small>}</h4>
        <div className="lo-profiles">{data.columns.map((c) => <OracleTable key={c.key} rows={current[c.key] ?? []}
          columnNames={["d6", c.name]} selected={profile?.row} onPick={(row) => { setCategory(c.key); chooseProfile(row); }}
          className={now?.key === c.key ? "lo-active-column" : undefined}
          columns={(r) => {
            const found = targets(r);
            return [<Fragment key="profile"><OracleText text={r.name} en={r.nameEn} /><small className="lo-secondary">{r.kind === "journey" ? "Путешествие · " : ""}{r.page}</small>
              {found.map((entry) => <button key={entry.id} type="button" className="lo-link" onClick={() => setPreview({ entry })}>
                {found.length > 1 ? entry.name : "Открыть карточку"}</button>)}</Fragment>];
          }} />)}</div>
      </div>
    </div>
    <h4 id="lo-vignettes" className="lo-heading">Виньетки · d6, затем d6</h4>
    <RollBar>
      <RollButton onClick={() => { const pick = rollFrom(data.vignettes, "d6"); if (pick) chooseVignetteTable(pick.row, pick.dice); }}>Бросить разряд</RollButton>
      <DiceResult roll={vignetteTable?.dice} /><b>{vignetteTable?.row.name}</b>
      <RollButton disabled={!vignetteTable} onClick={rollVignette}>Бросить виньетку</RollButton>
      <DiceResult roll={vignettePick?.dice} />
      <span role="status">{vignettePick?.row.name ?? randomVignette?.vignette?.name}</span>
    </RollBar>
    {(vignettePick || randomVignette) && <div className="lo-result">
      <b>{vignettePick?.row.name ?? randomVignette?.vignette?.name}</b>
      <div className="lo-actions">{(vignettePick ? vignetteTargets(vignettePick.row) : randomVignette ? [randomVignette] : []).map((target) =>
        <button key={target.vignette?.name} type="button" className="d-btn" onClick={() => setPreview(target)}>
          Открыть: {target.vignette?.name}</button>)}</div>
    </div>}
    <OracleTable rows={data.vignettes} columnNames={["d6", "Разряд", "Виньетка"]} selected={vignetteTable?.row}
      onPick={chooseVignetteTable} columns={(r) => [<OracleText key="category" text={r.name} en={r.nameEn} />,
        <div key="vignettes" className="lo-specific">{r.items.map((v) => <button key={v.roll} type="button" className={v === vignettePick?.row ? "is-picked" : undefined}
          onClick={() => { if (r !== vignetteTable?.row) chooseVignetteTable(r); chooseVignette(v); }}>
          <small>{v.roll}</small> <OracleText text={v.name} en={v.nameEn} /></button>)}</div>]} />
    {preview && <OracleCard target={preview} isGM={isGM} onTransfer={onTransfer} onClose={() => setPreview(undefined)} />}
  </>;
}

function OracleCard({ target, isGM, onClose, onTransfer }: {
  target: OracleCardTarget; isGM: boolean; onClose: () => void; onTransfer?: (target: OracleCardTarget) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  async function transfer() {
    setBusy(true);
    try {
      if (await onTransfer?.(target)) onClose();
    } finally {
      setBusy(false);
    }
  }
  const { entry, vignette } = target;
  const isChallenge = entry.kind === "monster";
  const gmCard = useResource<Statblock[]>(isChallenge && isGM ? statblockListPath("compendium_entry", entry.id) : null);
  const bookCard = useResource<{ content: string }>(isChallenge && !isGM ? "/systems/" + entry.system_id + "/litm-book-challenges/" + entry.id : null);
  const statblock = isGM ? gmCard.data?.find((row) => row.format === "litm_challenge") : bookCard.data;
  const profile = isChallenge && statblock ? challengeProfile(entry, statblock) : null;
  const loading = isGM ? gmCard.loading : bookCard.loading;
  const journey = !isChallenge && !vignette ? journeyOf(entry) : undefined;
  const href = isChallenge && isGM ? "/compendium/" + entry.id : oraclePath(entry.system_id, entry.section_id, entry.id);
  return <Modal className="litm-book lo-preview" wide ariaLabel={vignette?.name ?? entry.name} onClose={() => { if (!busy) onClose(); }}>
    <div className="lb-art__head"><h3>{vignette?.name ?? entry.name}<span className="lb-orig">[{vignette?.nameEn ?? entry.name_original}]</span></h3></div>
    <div className="lo-actions">
      {onTransfer && <button type="button" className="d-btn" disabled={busy} onClick={() => void transfer()}>В сцену</button>}
      {(!isChallenge || isGM) && <Link target={onTransfer ? "_blank" : undefined} rel={onTransfer ? "noopener" : undefined} to={href} className="d-btn">Открыть в «{isChallenge ? "Вызовах" : "Путешествиях"}»</Link>}
      {isGM && !vignette && <button type="button" className="d-btn d-btn--ghost" onClick={() => addToBag({
        id: entry.id, title: entry.name, type: "compendium_entry", kind: entry.kind, system_id: entry.system_id, section_id: entry.section_id,
      })}>В мешок</button>}
      <button type="button" className="d-btn" disabled={busy} onClick={onClose}>Закрыть</button>
    </div>
    {vignette ? <>
      <p className="lo-prose"><OracleText text={vignette.threat} /></p>
      <ul>{vignette.consequences.map((text, i) => <li key={i}><Consequence text={text} /></li>)}</ul>
    </> : profile ? <>
      <div className="lo-actions"><Roles roles={profile.roles} /><Rating value={profile.rating} /></div>
      <LitmChallengeProfile profile={profile} />
    </> : journey ? <>
      <p className="lo-prose"><OracleText text={entry.description} /></p>
      {journey.tags.length > 0 && <p><b>Теги</b> · {journey.tags.join(" · ")}</p>}
      {journey.consequences.length > 0 && <ul>{journey.consequences.map((text, i) => <li key={i}><Consequence text={text} /></li>)}</ul>}
      {journey.benefits && <p><OracleText text={journey.benefits} /></p>}
    </> : <p className="lo-prose">{loading ? "Загрузка карточки…" : entry.description}</p>}
  </Modal>;
}
