import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CAMPAIGN_ENTITY_STATES, campaignEntityStateLabel, campaignEntityStateTone, type CampaignEntityState } from "@shared/campaignWorld";
import { WORLD_GROUPS, type WorldEntity } from "../../campaignWorld";
import { stripMentions } from "../../mentions";
import { BEING_CATEGORY_LABELS } from "../../beingCategories";
import { aspectLabel } from "../../entityRecords";
import { sessionLabel } from "../../sessionLabel";
import { formatDateKeyRu } from "../../utils/date";
import { isSafeImageUrl } from "../../utils/safeUrl";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { TypeGlyph } from "../TypeGlyph";
import type { SessionSummary } from "../../types";

interface Props {
  entity: WorldEntity;
  campaignId: number;
  session?: SessionSummary;
  onState: (entity: WorldEntity, state: CampaignEntityState) => void;
  onRecord: (entity: WorldEntity) => void;
  onRemove: (entity: WorldEntity) => void;
  expanded?: boolean;
  onExpand?: () => void;
  records?: ReactNode;
}

/** Строка мира кампании; самостоятельна для компактного вида тетради. */
export function CampaignWorldRow({ entity: e, campaignId, session, onState, onRecord, onRemove, expanded, onExpand, records }: Props) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ x: number; y: number; state: boolean } | null>(null);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const group = WORLD_GROUPS.find((g) => g.type === e.entity_type)!;
  const category = e.entity_type === "being" ? BEING_CATEGORY_LABELS[e.category ?? ""] : e.category;
  const tone = campaignEntityStateTone(e.entity_type, e.state);
  const stateItems: ContextMenuItem[] = CAMPAIGN_ENTITY_STATES[e.entity_type].map((s) => ({
    label: `${s.key === e.state ? "✓ " : ""}${s.label}`,
    onClick: () => onState(e, s.key),
  }));
  const actions: ContextMenuItem[] = [
    { label: "Состояние в кампании", children: stateItems },
    { label: "Открыть основу в сеттинге", dividerBefore: true, onClick: () => navigate(`${group.path}/${e.entity_id}?campaign=base`) },
    { label: "+ Запись", onClick: () => onRecord(e) },
    ...(e.can_remove ? [{ label: "Убрать из кампании", onClick: () => onRemove(e), danger: true }] : []),
  ];
  function openMenu(event: MouseEvent<HTMLElement>, state: boolean) {
    event.preventDefault();
    trigger.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: event.type === "contextmenu" ? event.clientX : rect.right, y: event.type === "contextmenu" ? event.clientY : rect.bottom, state });
  }
  function closeMenu() {
    setMenu(null);
    trigger.current?.focus();
  }
  const image = e.image && e.image !== failedImage && isSafeImageUrl(e.image) ? e.image : null;
  return (
    <li className="world-row" onContextMenu={(event) => openMenu(event, true)}>
      <span className="world-row__portrait" aria-hidden="true">
        {image ? <img src={image} alt="" onError={() => setFailedImage(e.image)} /> : <TypeGlyph type={e.entity_type} />}
      </span>
      <div className="world-row__body">
        <div className="world-row__heading">
          <Link className="world-row__name" to={`${group.path}/${e.entity_id}?campaign=${campaignId}`}>{e.name}</Link>
          {tone && <button type="button" className={`world-state world-state--${tone}`} aria-label={`Состояние ${e.name}: ${campaignEntityStateLabel(e.entity_type, e.state)}. Изменить`} aria-haspopup="menu" aria-expanded={!!menu?.state} onClick={(event) => openMenu(event, true)}>{campaignEntityStateLabel(e.entity_type, e.state)} ▾</button>}
        </div>
        <p className="world-row__category d-mono">{group.kind}{category ? ` · ${category.toLowerCase()}` : ""}</p>
        <p className={`world-row__text${e.summary.from_setting ? " world-row__text--basis" : ""}`}>
          {e.summary.from_setting && <span className="world-row__source">из сеттинга · </span>}{stripMentions(e.summary.text)}
        </p>
        {onExpand && <button type="button" className="world-text-action world-row__expand" aria-expanded={expanded} onClick={onExpand}>{expanded ? "Свернуть" : "Записи"}</button>}
      </div>
      <div className="world-row__changes">
        {e.aspects.length ? <>
          <span className="world-row__label d-mono">Изменено:</span>
          <ul>{e.aspects.slice(0, 3).map((a) => <li key={a.key}>{aspectLabel(e.entity_type, a.key).toLowerCase()}{a.key === "state" && a.text ? ` (${a.text})` : ""}</li>)}</ul>
          {e.aspects.length > 3 && <span className="world-row__extra">ещё {e.aspects.length - 3}</span>}
        </> : <p className="world-row__empty">пока без записей · <button type="button" className="world-text-action" onClick={() => onRecord(e)}>+ Запись</button></p>}
        {e.last_session && <Link className="world-row__session" to={`/sessions/${e.last_session.id}`}>{sessionLabel(session ?? e.last_session)} · {formatDateKeyRu(e.last_session.date)}</Link>}
      </div>
      <button type="button" className="d-dots world-row__more" aria-label={`Действия: ${e.name}`} aria-haspopup="menu" aria-expanded={!!menu && !menu.state} onClick={(event) => openMenu(event, false)}>⋯</button>
      {expanded && <div className="campaign-world__card world-row__records" onContextMenu={(event) => event.stopPropagation()}>{records}</div>}
      {menu && <ContextMenu x={menu.x} y={menu.y} title={menu.state ? `Состояние: ${e.name}` : e.name} ariaLabel={menu.state ? `Состояние: ${e.name}` : `Действия: ${e.name}`} items={menu.state ? stateItems : actions} onClose={closeMenu} />}
    </li>
  );
}
