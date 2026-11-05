import { useRef, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { readResource } from "../data/imperative";
import { campaignPaths, grantAffects } from "../data/campaigns";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import { Modal } from "./Modal";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { buildSettingReaderGroups } from "./player/settingReaderEntries";
import { CampaignPlayerSectionsTab } from "./CampaignPlayerSectionsTab";
import { DSeg } from "./DSeg";
import { TypeGlyph } from "./TypeGlyph";
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

const GROUPS: { type: VisibilityTargetType; label: string; one: string; glyph: string; to?: (id: number) => string }[] = [
  { type: "setting_location", label: "Места", one: "место", glyph: "location", to: (id) => `/locations/${id}` },
  { type: "setting_being", label: "Существа", one: "существо", glyph: "being", to: (id) => `/beings/${id}` },
  { type: "setting_community", label: "Сообщества", one: "сообщество", glyph: "community", to: (id) => `/communities/${id}` },
  { type: "setting_artifact", label: "Артефакты", one: "артефакт", glyph: "artifact", to: (id) => `/artifacts/${id}` },
  { type: "setting_calendar_event", label: "События", one: "событие", glyph: "setting_event", to: (id) => `/events/${id}` },
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
  const [params] = useSearchParams();
  const [sel, setSel] = useState<{ section: string; item?: string }>(() => ({ section: Number(params.get("section")) > 0 ? "gm" : "summary" }));
  const [creatingSection, setCreatingSection] = useState(false);
  const summaryState = useResource<SummaryItem[]>(campaignPaths.grantSummary(campaignId));
  const summary = summaryState.data;
  // Подразделы сегментом (макеты Camp-Issuance, Camp-Handout); справа — то,
  // что нужно подразделу: «Глазами игрока» или «+ Раздел».
  const sections = useResource<PlayerSection[]>(campaignPaths.playerSections(campaignId)).data;
  return (
    <div className="stack">
      <div className="issuance-roots">
        <DSeg
          label="Разделы выдачи"
          items={[{ id: "summary", label: "Сущности мира" }, { id: "gm", label: "Раздатка", count: sections?.length }]}
          value={sel.section}
          onChange={(section) => setSel({ section })}
        />
        {sel.section === "summary" && <PlayerPreviewBar campaignId={campaignId} roster={roster} />}
        {sel.section === "gm" && <button type="button" className="d-btn d-btn--sm issuance-roots__add" onClick={() => setCreatingSection(v => !v)} aria-expanded={creatingSection}>+ Раздел</button>}
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
  const current = GROUPS.find((g) => g.type === category)!;
  const list = byType.get(category) ?? [];

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
      {/* Две колонки (макет Camp-Issuance): виды слева, выданное справа
          строками — знак, имя, кому открыто и «глаз» с числом. */}
      <div className="issuance-world">
        <nav className="campaign-col" aria-label="Виды сущностей">
          <h3 className="d-plate">Разделы</h3>
          {GROUPS.map((g) => (
            <button key={g.type} type="button" className={g.type === category ? "is-on" : ""} aria-pressed={g.type === category} onClick={() => setCategory(g.type)}>
              <TypeGlyph type={g.glyph} />
              <span>{g.label}</span>
              <span className="campaign-col__n">{byType.get(g.type)?.length ?? 0}</span>
            </button>
          ))}
        </nav>
        <section>
          <div className="d-gh">
            <h3 className="d-plate">{current.label}</h3>
            <span className="d-note">{list.length} · всем {list.filter((i) => i.all).length}</span>
          </div>
          {!items ? (
            <p className="muted">Загрузка…</p>
          ) : list.length === 0 ? (
            <p className="muted issuance-world__empty">Игрокам пока ничего не открыто — бросьте сущность из поиска в рамку выше.</p>
          ) : (
            <ul className="issuance-world__rows">
              {list.map((i) => (
                <li key={i.target_id}>
                  <span className="issuance-world__glyph"><TypeGlyph type={current.glyph} /></span>
                  <span className="issuance-world__name">
                    {current.to ? <Link to={current.to(i.target_id)}>{i.name}</Link> : i.name}
                    <span className="d-mono">{current.one}</span>
                  </span>
                  <span className="issuance-world__who">
                    {i.all ? <span className="issuance-chip">Всем игрокам</span> : i.players.length ? i.players.map((p) => <span key={p.id} className="issuance-chip is-one">{p.name}</span>) : <span className="issuance-chip is-none">никому</span>}
                  </span>
                  <PlayerVisibilityPicker campaignId={campaignId} targetType={i.target_type} targetId={i.target_id} roster={roster} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
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
      <span className="d-mono">Глазами игрока</span>
      <select
        className="d-select"
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
