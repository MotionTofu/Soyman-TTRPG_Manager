import { useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { readResource } from "../data/imperative";
import { campaignPaths, grantAffects } from "../data/campaigns";
import { IssuanceColumns } from "./IssuanceColumns";
import { MentionText } from "./mentions/MentionText";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import { Modal } from "./Modal";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { buildSettingReaderGroups } from "./player/settingReaderEntries";
import { CampaignPlayerSectionsTab } from "./CampaignPlayerSectionsTab";
import type { PlayerPreview, PlayerSection, RosterPlayer, SearchResult, VisibilityTargetType } from "../types";

// «Выдача» кампании (спека campaign-paper, Q30/Q34/Q35/Q40/Q41; доска 44):
// два раздела. «Сущности мира» — всё, что игроки уже видят, по видам; скрытого тут
// нет, дерева сеттинга тоже — открывают с профиля сущности или броском из
// поиска. «Раздатка» — разделы со статьями и изображениями.
interface Props {
  campaignId: number;
  settingId: number | null;
  roster: RosterPlayer[];
}

interface SummaryItem {
  target_type: VisibilityTargetType;
  target_id: number;
  name: string;
  all: boolean;
  players: { id: number; name: string; access_level: string }[];
}

const GROUPS: { type: VisibilityTargetType; label: string; to?: (id: number) => string }[] = [
  { type: "setting_location", label: "Места", to: (id) => `/locations/${id}` },
  { type: "setting_being", label: "Существа", to: (id) => `/beings/${id}` },
  { type: "setting_community", label: "Сообщества", to: (id) => `/communities/${id}` },
  { type: "setting_artifact", label: "Артефакты", to: (id) => `/artifacts/${id}` },
  { type: "setting_calendar_event", label: "События", to: (id) => `/events/${id}` },
];

/** Вид результата поиска → цель выдачи. Чего тут нет, игрокам пока не открыть. */
const DROP_TARGETS: Record<string, VisibilityTargetType> = {
  location: "setting_location",
  being: "setting_being",
  community: "setting_community",
  artifact: "setting_artifact",
  setting_event: "setting_calendar_event",
};

export function CampaignIssuanceTab({ campaignId, settingId, roster }: Props) {
  const [sel, setSel] = useState<{ section: string; item?: string }>({ section: "summary" });
  const [creatingSection, setCreatingSection] = useState(false);
  const summaryState = useResource<SummaryItem[]>(campaignPaths.grantSummary(campaignId));
  const summary = summaryState.data;
  return (
    <div className="stack">
      <div className="issuance-roots" aria-label="Разделы выдачи">
        <button type="button" className={sel.section === "summary" ? "is-selected" : ""} aria-pressed={sel.section === "summary"} onClick={() => setSel({ section: "summary" })}>Сущности мира</button>
        <button type="button" className={sel.section === "gm" ? "is-selected" : ""} aria-pressed={sel.section === "gm"} onClick={() => setSel({ section: "gm" })}>Раздатка</button>
        {sel.section === "summary" && <PlayerPreviewBar campaignId={campaignId} roster={roster} />}
        {sel.section === "gm" && <button type="button" className="issuance-roots__add" onClick={() => setCreatingSection(v => !v)} aria-expanded={creatingSection}>+ Раздел</button>}
      </div>
      {sel.section === "summary" ? (
        summaryState.error ? <p role="alert">Не удалось загрузить выдачу. <button onClick={summaryState.reload}>Повторить</button></p> : <IssuanceSummary campaignId={campaignId} roster={roster} items={summary} />
      ) : (
        <CampaignPlayerSectionsTab campaignId={campaignId} roster={roster} defaultSettingId={settingId ?? undefined} showCreation={creatingSection} onCreateSection={() => setCreatingSection(true)} onCreated={() => setCreatingSection(false)} />
      )}
    </div>
  );
}

function IssuanceSummary({ campaignId, roster, items }: { campaignId: number; roster: RosterPlayer[]; items: SummaryItem[] | undefined }) {
  const [category, setCategory] = useState<VisibilityTargetType>("setting_location");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const run = useAction();
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const active = roster.filter((p) => p.roster_status !== "left").map((p) => p.id);

  async function batch(targets: { target_type: VisibilityTargetType; target_id: number }[], action: "grant" | "revoke", playerIds: number[], label: string) {
    if (playerIds.length === 0) return false;
    return (
      (await run(labelled(label, () => write.post("/visibility-grants/batch", { campaign_id: campaignId, player_ids: playerIds, targets, action })), {
        affects: grantAffects(campaignId),
      })) !== undefined
    );
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const item = JSON.parse(raw) as SearchResult;
    const target = DROP_TARGETS[item.type];
    if (!target) {
      setNote(`«${item.title}» игрокам пока не открыть: выдаются места, существа, сообщества, артефакты и события.`);
      return;
    }
    if (active.length === 0) {
      setNote("В составе кампании нет игроков — открывать некому.");
      return;
    }
    setNote(null);
    await batch([{ target_type: target, target_id: item.id }], "grant", active, "Открыть игрокам");
  }

  const byType = new Map<VisibilityTargetType, SummaryItem[]>();
  for (const i of items ?? []) byType.set(i.target_type, [...(byType.get(i.target_type) ?? []), i]);

  return (
    <div className="issuance-summary">
      <div
        className={`issuance-drop${over ? " is-over" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(SEARCH_DRAG_MIME)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => void onDrop(e)}
      >
        Бросьте сюда сущность из поиска — откроется всему составу
      </div>
      {note && (
        <p className="muted" role="status">
          {note}
        </p>
      )}
      <IssuanceColumns
        sections={GROUPS.map(g => ({ id: g.type, label: g.label, count: byType.get(g.type)?.length ?? 0 }))}
        selectedSection={category}
        onSection={id => { setCategory(id as VisibilityTargetType); setSelectedId(null); }}
        items={(byType.get(category) ?? []).map(i => ({ id: String(i.target_id), label: i.name }))}
        selectedItem={selectedId == null ? undefined : String(selectedId)}
        onItem={id => setSelectedId(Number(id))}
        title={GROUPS.find(g => g.type === category)?.label ?? "Сущности"}
        loading={!items}
      >
        {selectedId != null && byType.get(category)?.some(i => i.target_id === selectedId) ? (
          <WorldEntityPreview key={`${category}:${selectedId}`} item={byType.get(category)!.find(i => i.target_id === selectedId)!} campaignId={campaignId} roster={roster} />
        ) : <div className="stack">
          <h2 className="paper-group__head">{GROUPS.find(g => g.type === category)?.label}</h2>
          <p className="muted">Сущностей: {byType.get(category)?.length ?? 0}</p>
          <ul className="paper-rows">{(byType.get(category) ?? []).map(i => <li key={i.target_id}>
            <div className="paper-rows__main"><button className="ghost" onClick={() => setSelectedId(i.target_id)}>{i.name}</button><span className="issuance-added">{i.all ? "Всем игрокам" : i.players.map(p => p.name).join(", ")}</span></div>
            <PlayerVisibilityPicker campaignId={campaignId} targetType={i.target_type} targetId={i.target_id} roster={roster} />
          </li>)}</ul>
        </div>}
      </IssuanceColumns>
    </div>
  );
}

const WORLD_PATHS: Partial<Record<VisibilityTargetType, string>> = {
  setting_location: "/setting-locations", setting_being: "/setting-beings", setting_community: "/setting-communities",
  setting_artifact: "/artifacts", setting_calendar_event: "/settings/calendar-events",
};
function WorldEntityPreview({ item, campaignId, roster }: { item: SummaryItem; campaignId: number; roster: RosterPlayer[] }) {
  const detail = useResource<Record<string, unknown>>(`${WORLD_PATHS[item.target_type]}/${item.target_id}`);
  const value = detail.data;
  const body = value ? [value.description, value.history, value.player_text].filter((v): v is string => typeof v === "string" && !!v).join("\n\n") : "";
  const to = GROUPS.find(g => g.type === item.target_type)?.to?.(item.target_id);
  return <div className="stack">
    <h2 className="paper-group__head">{item.name}</h2>
    <PlayerVisibilityPicker campaignId={campaignId} targetType={item.target_type} targetId={item.target_id} roster={roster} />
    {detail.loading ? <p className="muted">Загрузка…</p> : detail.error ? <p role="alert">Не удалось загрузить сущность. <button onClick={detail.reload}>Повторить</button></p> : <div className="reading-text"><MentionText text={body || "Описание пока не заполнено."} /></div>}
    {to && <Link className="primary" to={to}>Открыть сущность →</Link>}
  </div>;
}

// «Глазами игрока»: превью считается ТЕМ ЖЕ кодом, что выдача игроку
// (GET /visibility-grants/preview → services/playerContent.ts), а не своим
// способом на клиенте.
function PlayerPreviewBar({ campaignId, roster }: { campaignId: number; roster: RosterPlayer[] }) {
  const latestRequest = useRef(0);
  const [playerId, setPlayerId] = useState<number | "">("");
  const [preview, setPreview] = useState<PlayerPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const player = roster.find((p) => p.id === playerId);

  async function load(selectedId: number) {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError(null);
    try {
      // Свежее: превью открывают, чтобы сверить только что выданное.
      const result = await readResource<PlayerPreview>(`/visibility-grants/preview?campaign_id=${campaignId}&player_id=${selectedId}`, { fresh: true });
      if (requestId === latestRequest.current) setPreview(result);
    } catch (e: unknown) {
      if (requestId === latestRequest.current) {
        setError(String(e instanceof Error ? e.message : e));
        setPreview(null);
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }

  const groups = preview ? buildSettingReaderGroups(preview.setting, preview.flagged) : [];
  function close() {
    latestRequest.current++;
    setPreview(null);
    setPlayerId("");
    setLoading(false);
    setError(null);
  }
  return (
    <div className="issuance-preview">
      <span className="paper-label">Глазами игрока</span>
      <select
        value={playerId}
        onChange={(e) => {
          const id = e.target.value ? Number(e.target.value) : "";
          setPlayerId(id);
          setPreview(null);
          setError(null);
          if (id) void load(id);
          else { latestRequest.current++; setLoading(false); }
        }}
        aria-label="Игрок для предпросмотра"
      >
        <option value="">Выберите игрока…</option>
        {roster.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {loading && <span className="muted" role="status">Загрузка…</span>}
      {error && <span className="muted">Не удалось загрузить превью: {error}</span>}
      {preview && (
        <Modal onClose={close}>
          <div className="stack">
            <h3>Глазами игрока — {player?.name}</h3>
            <p className="muted">Так видит игрок: только выданное ему. Данные — ответ сервера, тот же, что уходит игроку.</p>
            <PreviewSections sections={preview.sections} />
            {groups.length === 0 && preview.sections.length === 0 && <p className="muted">Игроку пока ничего не выдано.</p>}
            {groups.map((g) => (
              <div key={g.key} className="stack">
                <span className="paper-label">{g.label}</span>
                {g.entries.map((e) => (
                  <div key={e.key} className="card">
                    <strong>{e.title}</strong>
                    {e.body}
                  </div>
                ))}
              </div>
            ))}
            <div className="row">
              <button className="primary" onClick={close}>
                Закрыть
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PreviewSections({ sections }: { sections: PlayerSection[] }) {
  if (sections.length === 0) return null;
  return (
    <div className="stack">
      <span className="paper-label">Раздатка</span>
      {sections.map((s) => (
        <div key={s.id} className="card">
          <strong>
            {s.name} <span className="badge tag">{s.kind === "gallery" ? "Галерея" : "Статьи"}</span>
          </strong>
          {s.kind !== "gallery" &&
            (s.articles ?? []).map((a) => (
              <div key={a.id} className="muted">
                · {a.title || "Без названия"}
              </div>
            ))}
          {s.kind === "gallery" && <div className="muted">· {(s.images ?? []).length} изо</div>}
        </div>
      ))}
    </div>
  );
}
