import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { sessionLabel } from "../../sessionLabel";
import { formatDateKeyRu } from "../../utils/date";
import { aspectLabel, recordSummary, type RecordChain, type RecordOwnerType } from "../../entityRecords";
import { EntityRecordItem } from "../records/EntityRecordItem";
import { RecordFormModal } from "../records/RecordFormModal";
import { MentionText } from "../mentions/MentionText";
import type { EngagedCampaign, SessionSummary } from "../../types";

// Профиль существа, сообщества, места в контексте кампании (ADR-0006, спека
// .scratch/campaign-layer, задача 05): части экрана. Сам контекст, крошки и
// записи владельца — в campaignProfile.tsx.

/** «Смотреть: Основа сеттинга · кампании…» — только если сущность где-то задействована. */
export function ContextSwitch({
  engaged,
  campaign,
  onSelect,
}: {
  engaged: EngagedCampaign[] | undefined;
  campaign: EngagedCampaign | null;
  onSelect: (id: number | null) => void;
}) {
  if (!engaged?.length) return null;
  return (
    <div className="context-switch" role="group" aria-label="Контекст профиля">
      <span className="paper-label">Смотреть</span>
      <button type="button" className={`population__chip${!campaign ? " is-on" : ""}`} aria-pressed={!campaign} onClick={() => onSelect(null)}>
        Основа сеттинга
      </button>
      {engaged.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`population__chip${campaign?.id === c.id ? " is-on" : ""}`}
          aria-pressed={campaign?.id === c.id}
          onClick={() => onSelect(c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function LastSession({ session }: { session: EngagedCampaign["last_session"] }) {
  if (!session) return <span className="paper-rows__sub">—</span>;
  return (
    <Link className="paper-rows__sub" to={`/sessions/${session.id}`}>
      {session.title?.trim() || formatDateKeyRu(session.date)}
    </Link>
  );
}

/** Профиль в основе: где сущность задействована и что о ней там записано. */
export function EngagedCampaigns({
  campaigns,
  onOpen,
  title = "Задействована в кампаниях",
}: {
  campaigns: EngagedCampaign[] | undefined;
  onOpen: (id: number) => void;
  /** Род по сущности: место и сообщество — «Задействовано». */
  title?: string;
}) {
  if (!campaigns?.length) return null;
  return (
    <section className="engaged-campaigns">
      <h3 className="paper-group__head">
        {title} <span className="paper-group__count">· {campaigns.length}</span>
      </h3>
      <ul className="paper-rows">
        {campaigns.map((c) => (
          <li key={c.id}>
            <span className="paper-rows__main">
              <button type="button" className="engaged-campaigns__open" onClick={() => onOpen(c.id)}>
                {c.name} ›
              </button>{" "}
              <span className="paper-rows__sub">{recordSummary(c)}</span>
            </span>
            <LastSession session={c.last_session} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Раздел записей кампании: по графам из `aspects` (подпись графы — когда их
 * больше одной), «+ запись», пустые графы из `emptyKeys` — одной строкой
 * «Не заполнено: … · Заполнить», как паспорт.
 */
export function CampaignRecords({
  campaignId,
  settingId,
  ownerType,
  ownerId,
  chains,
  title,
  aspects,
  emptyKeys = [],
  empty,
}: {
  campaignId: number;
  settingId: number | null;
  ownerType: RecordOwnerType;
  ownerId: number;
  chains: RecordChain[];
  title: string;
  aspects: readonly string[];
  emptyKeys?: readonly string[];
  empty?: ReactNode;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const groups = aspects.map((a) => [a, chains.filter((c) => c.record.aspect === a)] as const).filter(([, list]) => list.length);
  const unfilled = emptyKeys.filter((k) => !chains.some((c) => c.record.aspect === k));
  const count = groups.reduce((n, [, list]) => n + list.length, 0);
  return (
    <section className="campaign-records">
      <h3 className="paper-group__head">
        {title} <span className="paper-group__count">· {count}</span>
        <button type="button" className="campaign-records__add" onClick={() => setAdding(aspects[0] ?? "note")}>
          + запись
        </button>
      </h3>
      {groups.map(([aspect, list]) => (
        <div key={aspect} className="campaign-records__group">
          {aspects.length > 1 && <span className="paper-label">{aspectLabel(ownerType, aspect)}</span>}
          {list.map((c) => (
            <EntityRecordItem key={c.record.id} chain={c} settingId={settingId} was />
          ))}
        </div>
      ))}
      {!count && !unfilled.length && <p className="muted">{empty ?? "Записей в этой кампании пока нет."}</p>}
      {unfilled.length > 0 && (
        <p className="muted campaign-records__unfilled">
          Не заполнено: {unfilled.map((k) => aspectLabel(ownerType, k).toLowerCase()).join(", ")} ·{" "}
          <button type="button" onClick={() => setAdding(unfilled[0])}>
            Заполнить
          </button>
        </p>
      )}
      {adding && (
        <RecordFormModal campaignId={campaignId} settingId={settingId} ownerType={ownerType} ownerId={ownerId} aspect={adding} onClose={() => setAdding(null)} />
      )}
    </section>
  );
}

/** «Хроника» в кампании: записи по встречам, новые встречи сверху; вне встречи — в конце. */
export function CampaignChronicle({ campaign, settingId, chains }: { campaign: EngagedCampaign; settingId: number | null; chains: RecordChain[] }) {
  const sessions = useResource<SessionSummary[]>(campaignPaths.sessions(campaign.id)).data;
  const groups = useMemo(() => {
    const byId = new Map((sessions ?? []).map((s) => [s.id, s]));
    const map = new Map<number | null, RecordChain[]>();
    for (const c of chains) map.set(c.record.session_id, [...(map.get(c.record.session_id) ?? []), c]);
    return [...map.entries()]
      .map(([id, list]) => ({ id, session: id != null ? byId.get(id) : undefined, list }))
      .sort((a, b) => (a.id == null ? 1 : b.id == null ? -1 : (b.session?.date ?? "").localeCompare(a.session?.date ?? "")));
  }, [chains, sessions]);
  return (
    <section className="campaign-records">
      <h3 className="paper-group__head">
        Что изменилось в «{campaign.name}» <span className="paper-group__count">· {chains.length}</span>
      </h3>
      {!chains.length && <p className="muted">Записей в этой кампании пока нет.</p>}
      {groups.map((g) => (
        <div key={g.id ?? "none"} className="campaign-records__group">
          <span className="paper-label">
            {g.id == null ? "Вне встречи" : g.session ? `${sessionLabel(g.session)} · ${formatDateKeyRu(g.session.date)}` : "Встреча"}
          </span>
          {g.list.map((c) => (
            <EntityRecordItem key={c.record.id} chain={c} settingId={settingId} />
          ))}
        </div>
      ))}
    </section>
  );
}

/** Основа в контексте кампании — свёрткой и только для чтения. */
export function BaseFold({ description, chapters }: { description: string; chapters: { title: string; items: { id: number; title: string; content: string }[] }[] }) {
  const shown = chapters.filter((c) => c.items.length);
  return (
    <details className="paper-fold">
      <summary>Основа: {["описание", ...chapters.map((c) => c.title.toLowerCase())].join(", ")}</summary>
      <div className="paper-fold__body stack">
        <p className="muted">Основа сеттинга — правится в «Основе сеттинга».</p>
        {description.trim() ? <MentionText text={description} /> : <span className="muted">Описания нет.</span>}
        {shown.map((c) => (
          <div key={c.title} className="stack">
            <span className="paper-label">{c.title}</span>
            {c.items.map((ch) => (
              <div key={ch.id}>
                {ch.title.trim() && <strong>{ch.title}</strong>}
                <MentionText text={ch.content} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
