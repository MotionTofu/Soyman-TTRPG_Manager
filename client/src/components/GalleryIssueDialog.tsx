import { useState } from "react";
import { Modal } from "./Modal";
import { useResource, write, errorText } from "../data/hooks";
import type { CampaignDetail } from "../types";

export type IssueCampaign = { id: number; name: string };
type Section = { id: number; name: string; kind: string; archived_at: string | null };

function rememberedSection(campaignId: number) {
  try { return Number(localStorage.getItem(`gallery-issue-section:${campaignId}`)) || null; } catch { return null; }
}

export function GalleryIssueDialog({ imageId, campaigns, campaignId, onClose, onIssued }: {
  imageId: number; campaigns: IssueCampaign[]; campaignId?: number; onClose: () => void; onIssued: () => void;
}) {
  const [selected, setSelected] = useState(campaignId ?? campaigns[0]?.id);
  const choices = campaignId ? campaigns.filter((c) => c.id === campaignId) : campaigns;
  return <Modal className="modal-sheet gallery-issue-modal" onClose={onClose} ariaLabel="Выдать игрокам"><h2>Выдать игрокам</h2>
    {choices.length > 1 ? <label>Кампания<select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>{choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : <p>{choices[0]?.name}</p>}
    {selected && <IssueForm key={selected} imageId={imageId} campaignId={selected} onIssued={onIssued} />}
  </Modal>;
}

function IssueForm({ imageId, campaignId, onIssued }: { imageId: number; campaignId: number; onIssued: () => void }) {
  const sections = useResource<Section[]>(`/campaign-player-sections?campaign_id=${campaignId}`);
  const campaign = useResource<CampaignDetail>(`/campaigns/${campaignId}`);
  const galleries = (sections.data ?? []).filter((s) => s.kind === "gallery" && !s.archived_at);
  const roster = (campaign.data?.roster ?? []).filter((p) => p.roster_status !== "left");
  const [section, setSection] = useState<number | null>(() => rememberedSection(campaignId));
  const selectedSection = galleries.find((s) => s.id === section)?.id ?? galleries[0]?.id ?? null;
  const [players, setPlayers] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const readError = sections.error || campaign.error;
  return <form className="stack gallery-issue-form" onSubmit={async (e) => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      const result = await write.post<{ section_id: number }>(`/gallery/${imageId}/issue`, { campaign_id: campaignId, section_id: selectedSection, player_ids: players });
      try { localStorage.setItem(`gallery-issue-section:${campaignId}`, String(result.section_id)); } catch { /* storage may be disabled */ }
      onIssued();
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  }}>
    {galleries.length ? <label>Раздел<select value={selectedSection ?? ""} onChange={(e) => setSection(Number(e.target.value))}>{galleries.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : !sections.loading && <p>Будет создан раздел «Изображения»</p>}
    <fieldset disabled={saving}><legend>Игроки</legend><button type="button" className="d-btn d-btn--sm" onClick={() => setPlayers(roster.map((p) => p.id))}>Всем</button>
      {roster.map((p) => <label className="row" key={p.id}><input type="checkbox" checked={players.includes(p.id)} onChange={(e) => setPlayers((ids) => e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id))} />{p.name}</label>)}
      {!roster.length && <p className="muted">В ростере пока нет игроков.</p>}
    </fieldset>
    <p className="d-note">Без отметок картинка останется в разделе, без выдачи.</p>
    {(error || readError) && <p role="alert">{error || readError}</p>}
    {readError && <button type="button" onClick={() => { sections.reload(); campaign.reload(); }}>Повторить</button>}
    <button className="d-btn d-btn--primary" disabled={saving || sections.loading || campaign.loading || !!readError}>{saving ? "Выдача…" : "Выдать"}</button>
  </form>;
}
