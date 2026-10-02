import { useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { readResource } from "../data/imperative";
import { campaignPaths, grantAffects } from "../data/campaigns";
import { EntityTabWorkspace } from "./EntityTabWorkspace";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import { Modal } from "./Modal";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { buildSettingReaderGroups } from "./player/settingReaderEntries";
import { CampaignPlayerSectionsTab } from "./CampaignPlayerSectionsTab";
import type { PlayerPreview, PlayerSection, RosterPlayer, SearchResult, VisibilityTargetType } from "../types";

// «Выдача» кампании (спека campaign-paper, Q30/Q34/Q35/Q40/Q41; доска 44):
// два раздела. «Сводка» — всё, что игроки уже видят, по видам; скрытого тут
// нет, дерева сеттинга тоже — открывают с профиля сущности или броском из
// поиска. «От мастера» — статьи для игроков, как были.
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
  { type: "campaign_player_section", label: "Разделы «От мастера»" },
  { type: "campaign_player_article", label: "Статьи «От мастера»" },
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
  const summary = useResource<SummaryItem[]>(campaignPaths.grantSummary(campaignId)).data;
  return (
    <EntityTabWorkspace
      sections={[
        { id: "summary", label: "Сводка", count: summary?.length ?? 0 },
        { id: "gm", label: "От мастера" },
      ]}
      selection={sel}
      onSelect={setSel}
      workspaceKey={campaignId}
    >
      {sel.section === "summary" ? (
        <IssuanceSummary campaignId={campaignId} roster={roster} items={summary} />
      ) : (
        <CampaignPlayerSectionsTab campaignId={campaignId} roster={roster} defaultSettingId={settingId ?? undefined} />
      )}
    </EntityTabWorkspace>
  );
}

function IssuanceSummary({ campaignId, roster, items }: { campaignId: number; roster: RosterPlayer[]; items: SummaryItem[] | undefined }) {
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
    if (await batch([{ target_type: target, target_id: item.id }], "grant", active, "Открыть игрокам")) {
      setNote(`«${item.title}» открыто всему составу.`);
    }
  }

  const byType = new Map<VisibilityTargetType, SummaryItem[]>();
  for (const i of items ?? []) byType.set(i.target_type, [...(byType.get(i.target_type) ?? []), i]);

  return (
    <div className="issuance-summary">
      <PlayerPreviewBar campaignId={campaignId} roster={roster} />
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
      {items && items.length === 0 && <p className="muted">Игрокам пока ничего не открыто.</p>}
      {GROUPS.map((g) => {
        const list = byType.get(g.type);
        if (!list?.length) return null;
        return (
          <section key={g.type} className="paper-list-group">
            <h3 className="paper-group__head">
              {g.label} <span className="paper-group__count">· {list.length}</span>
            </h3>
            <ul className="paper-rows issuance-rows">
              {list.map((i) => (
                <li key={`${i.target_type}:${i.target_id}`}>
                  <span className="paper-rows__main">{g.to ? <Link to={g.to(i.target_id)}>{i.name}</Link> : i.name}</span>
                  <span className="paper-rows__sub">
                    {i.all ? "всем" : i.players.map((p) => p.name).join(", ")}
                    {i.players.some((p) => p.access_level === "mentioned") ? " · есть «упомянут»" : ""}
                  </span>
                  <PlayerVisibilityPicker campaignId={campaignId} targetType={i.target_type} targetId={i.target_id} roster={roster} />
                  <button
                    type="button"
                    className="comp-mini"
                    onClick={() =>
                      void batch(
                        [{ target_type: i.target_type, target_id: i.target_id }],
                        "revoke",
                        i.players.map((p) => p.id),
                        "Скрыть от игроков"
                      )
                    }
                  >
                    Скрыть
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// «Глазами игрока»: превью считается ТЕМ ЖЕ кодом, что выдача игроку
// (GET /visibility-grants/preview → services/playerContent.ts), а не своим
// способом на клиенте.
function PlayerPreviewBar({ campaignId, roster }: { campaignId: number; roster: RosterPlayer[] }) {
  const [playerId, setPlayerId] = useState<number | "">("");
  const [preview, setPreview] = useState<PlayerPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const player = roster.find((p) => p.id === playerId);

  async function load() {
    if (!playerId) return;
    setLoading(true);
    setError(null);
    try {
      // Свежее: превью открывают, чтобы сверить только что выданное.
      setPreview(await readResource<PlayerPreview>(`/visibility-grants/preview?campaign_id=${campaignId}&player_id=${playerId}`, { fresh: true }));
    } catch (e: unknown) {
      setError(String(e instanceof Error ? e.message : e));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  const groups = preview ? buildSettingReaderGroups(preview.setting, preview.flagged) : [];
  return (
    <div className="issuance-preview">
      <span className="paper-label">Глазами игрока</span>
      <select
        value={playerId}
        onChange={(e) => {
          setPlayerId(e.target.value ? Number(e.target.value) : "");
          setPreview(null);
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
      <button type="button" onClick={() => void load()} disabled={!playerId || loading}>
        {loading ? "Смотрю…" : "Показать"}
      </button>
      {error && <span className="muted">Не удалось загрузить превью: {error}</span>}
      {preview && (
        <Modal onClose={() => setPreview(null)}>
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
              <button className="primary" onClick={() => setPreview(null)}>
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
      <span className="paper-label">От мастера</span>
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
