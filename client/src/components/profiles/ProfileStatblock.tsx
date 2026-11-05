import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { creatureCardQuery } from "../../data/creatureCard";
import { DndCreatureView, normalizeDndCreature } from "../dnd/DndCreatureForm";
import { StatblockList } from "../StatblockList";
import { Modal } from "../Modal";
import { ProfileBlock } from "./ProfileParts";

export function ProfileStatblock({ id, name, settingId, compendiumId }: { id: number; name: string; settingId: number; compendiumId?: number | null }) {
  const card = useQuery(creatureCardQuery("being",id)).data;
  const [editing,setEditing] = useState(false);
  const sb = card?.statblock;
  let parsed: unknown = {};
  try { parsed = JSON.parse(sb?.content || "{}"); } catch { /* Сырой текст показан ниже. */ }
  return <ProfileBlock title="Статблок" actions={<>{compendiumId && <Link className="d-btn d-btn--sm d-btn--ghost" to={`/compendium/${compendiumId}`}>Из компендиума ›</Link>}<button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => setEditing(true)}>Править</button></>}>
    {sb ? sb.format === "dnd_creature" ? <DndCreatureView value={normalizeDndCreature(parsed)} /> : <div className="profile-prose">{sb.content}</div> : <p className="muted">Добавьте статблок существа.</p>}
    {editing && <Modal wide onClose={() => setEditing(false)} ariaLabel="Статблок"><h2>Статблок</h2><StatblockList ownerType="being" ownerId={id} ownerName={name} settingId={settingId} /><button type="button" className="d-btn" onClick={() => setEditing(false)}>Готово</button></Modal>}
  </ProfileBlock>;
}
