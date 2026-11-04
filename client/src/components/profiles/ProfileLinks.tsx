import { useState, type ReactNode } from "react";
import { useResource } from "../../data/hooks";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { EntityRelation, EntityRelationsResponse, RelationEntityType, SearchResult } from "../../types";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { TypeGlyph } from "../TypeGlyph";
import { EntityMenuButton } from "../PageContextMenu";
import { RelationsTab } from "../RelationsTab";
import { GraphNeighbourhoodLink } from "../GraphNeighbourhoodLink";
import { Modal } from "../Modal";
import { ProfileEntityLink } from "./ProfileParts";
import { RELATION_TONE_LABELS } from "../../relations";

export interface ProfileLinkRow { key: string; type: string; id: number; name: string; note?: ReactNode; tone?: string; to?: string; actions?: { label: string; danger?: boolean; onClick: () => void }[] }
export interface ProfileLinkGroup { title: string; rows: ProfileLinkRow[] }

export function profileRelationGroups(type: string, relations: EntityRelation[], groups: ProfileLinkGroup[]) {
  const map = new Map(groups.map((g) => [g.title, [...g.rows]]));
  const groupOf = (other: string) => type === "artifact" ? "С кем · что" : type === "location" ? "Отношения" : other === "location" ? "Где" : type === "being" && other === "artifact" ? "Что" : "С кем";
  for (const r of relations) {
    const title = groupOf(r.other_type);
    const rows = map.get(title) ?? [];
    rows.push({ key: `relation:${r.id}`, type: r.other_type, id: r.other_id, name: r.other_name ?? "Удалённая сущность", note: [r.label,r.description].filter(Boolean).join(" · "), tone: RELATION_TONE_LABELS[r.tone] });
    map.set(title,rows);
  }
  return [...map].map(([title,rows]) => ({ title,rows })).filter((g) => g.rows.length > 0);
}

export function ProfileLinks({ type, id, name, settingId, groups = [], tools, children, onEntityDrop }: {
  type: RelationEntityType; id: number; name: string; settingId: number; groups?: ProfileLinkGroup[]; tools?: ReactNode; children?: ReactNode; onEntityDrop?: (entity: SearchResult) => boolean;
}) {
  const data = useResource<EntityRelationsResponse>(`/entity-relations?entity_type=${type}&entity_id=${id}`).data;
  const [editing, setEditing] = useState(false);
  const [dropped,setDropped] = useState<SearchResult | undefined>();
  const adventures = useResource<{ adventures: { id: number; name: string; goal: string; scenes: {id:number;name:string;role:string;tactic:string}[] }[] }>(type === "being" || type === "community" ? `/participations/entity/${type}/${id}` : null).data?.adventures ?? [];
  const mobile = useIsMobile();
  const campaignScenes = new Set(adventures.flatMap((a) => a.scenes.map((s) => s.id)));
  const enriched = groups.map((g) => ({...g,rows:g.rows.filter((r) => r.type !== "scene" || !campaignScenes.has(r.id))}));
  const adventureRows = adventures.map((a) => ({ key:`adventure:${a.id}`,type:"adventure",id:a.id,name:a.name,note:<>{a.goal}{a.scenes.map((s) => <span key={s.id}> · <ProfileEntityLink type="scene" id={s.id} name={s.name} />{s.role && ` — ${s.role}`}{s.tactic && ` · ${s.tactic}`}</span>)}</> }));
  if (adventureRows.length) {
    const group = enriched.find((g) => g.title === "В приключениях");
    if (group) group.rows.push(...adventureRows); else enriched.push({title:"В приключениях",rows:adventureRows});
  }
  const visible = profileRelationGroups(type,[...(data?.outgoing ?? []),...(data?.incoming ?? [])],enriched);
  return <div className="profile-links" onDragOver={(e) => { if (e.dataTransfer.types.includes(SEARCH_DRAG_MIME)) e.preventDefault(); }} onDrop={(e) => {
    if (e.defaultPrevented) return;
    const raw=e.dataTransfer.getData(SEARCH_DRAG_MIME); if (!raw) return;
    e.preventDefault();
    try { const entity=JSON.parse(raw) as SearchResult; if (onEntityDrop?.(entity)) return; setDropped(entity); setEditing(true); } catch { /* Чужой формат не меняет связи. */ }
  }}>
    <div className="profile-links__head"><h2 className="d-plate">Связи</h2><GraphNeighbourhoodLink type={type} id={id} /><button type="button" className="d-btn d-btn--sm" onClick={() => setEditing(true)}>+ Связь</button></div>
    {visible.map((g,index) => <details key={`${g.title}:${mobile}`} className="profile-link-group" open={!mobile || index === 0}><summary><span className="d-plate">{g.title}</span><span className="d-note">{g.rows.length}</span></summary>
      {g.rows.map((r) => <div key={r.key} className="profile-link-row"><TypeGlyph type={r.type} /><ProfileEntityLink type={r.type} id={r.id} name={r.name} to={r.to} /><span className="profile-link-row__note">{r.note}</span>{r.tone ? <span className="profile-link-row__tone">{r.tone}</span> : <span aria-hidden="true" />}<EntityMenuButton entity={{ type:r.type,id:r.id,name:r.name }} local={r.actions ?? (r.key.startsWith("relation:") ? [{ label:"Править связь", onClick:() => setEditing(true) }] : undefined)} /></div>)}
    </details>)}
    {!visible.length && <p className="muted">Добавьте связь или перетащите сущность в окно выбора.</p>}
    {children}
    {editing && <Modal wide onClose={() => { setEditing(false); setDropped(undefined); }} ariaLabel="Связи"><h2>Связи</h2>{tools}<RelationsTab initialTarget={dropped} entityType={type} entityId={id} entityName={name} defaultSettingId={settingId} /><button type="button" className="d-btn" onClick={() => { setEditing(false); setDropped(undefined); }}>Готово</button></Modal>}
  </div>;
}
