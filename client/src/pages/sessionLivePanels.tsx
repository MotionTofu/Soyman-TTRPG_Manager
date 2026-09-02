import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { SectionDropZone } from "../components/SectionDropZone";
import { ObstacleDropZone } from "../components/ObstacleDropZone";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { LazyDetails } from "../components/LazyDetails";
import { CampaignSecrets } from "../components/CampaignSecrets";
import { RemindersWidget } from "../components/RemindersWidget";
import { EntityPreviewModal } from "../components/EntityPreviewModal";
import { MentionText } from "../components/mentions/MentionText";
import type { CampaignDetail, CampaignGrouped, Character, SearchResult, SessionDetail, SessionUnionRow, StorySecret } from "../types";

// Same module-level constants as SessionDetailPage.tsx — SectionDropZone is
// React.memo'd, so an inline array literal here would be a new reference
// every render, defeating the memo on every unrelated keystroke.
const PLOT_CHARACTER_TYPES = ["being", "character"];
const LOCATION_TYPES = ["location"];
const LOOT_TYPES = ["resource", "artifact"];

export type SessionPanelKey =
  | "locations"
  | "plotCharacters"
  | "obstacles"
  | "loot"
  | "roster"
  | "secrets"
  | "reminders"
  | "compendium";

export const SESSION_PANEL_TITLES: Record<SessionPanelKey, string> = {
  locations: "Локации",
  plotCharacters: "Сюжетные персонажи",
  obstacles: "Препятствия",
  loot: "Потенциальный лут",
  roster: "Персонажи игроков",
  secrets: "Тайны и зацепки",
  reminders: "Напоминания",
  compendium: "Компендиум",
};

interface PanelProps {
  sessionId: number;
  session: SessionDetail;
  campaign: CampaignDetail;
  characters: Character[];
  /** Счётчик запусков сцен: панели перечитываются, когда сцена сменилась. */
  launches: number;
  /**
   * Состав всех сцен сессии. Панели показывают его строками наравне со
   * связями: Мастеру полезнее видеть весь вечер сразу, а не состав одной
   * запущенной сцены — у самого большого приключения 29 сцен и 10 разных
   * участников, так что объединение это два десятка строк, а не сотня.
   */
  union?: SessionUnionRow[];
  onChanged?: () => void;
}

/** Строки объединения для одной панели. */
function forPanel(union: SessionUnionRow[] | undefined, panel: string): SessionUnionRow[] {
  return (union ?? []).filter((u) => u.panel === panel);
}

// Popped-out panel windows are opened by name, so re-clicking the same
// button focuses the existing window instead of spawning duplicates.
function PopoutButton({ sessionId, panelKey }: { sessionId: number; panelKey: SessionPanelKey }) {
  return (
    <button
      type="button"
      className="comp-mini"
      title="Открыть в отдельном окне"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(
          `/sessions/${sessionId}/live/panel/${panelKey}`,
          `panel-${panelKey}-${sessionId}`,
          "width=420,height=640"
        );
      }}
    >
      ⇱
    </button>
  );
}

function LocationsContent({ sessionId, session, launches }: PanelProps) {
  return (
    <SectionDropZone
      entityType="session"
      entityId={sessionId}
      section="locations"
      acceptTypes={LOCATION_TYPES}
      placeholder="Перетащите сюда локацию из поиска"
      mentionText={session.idea_notes}
      mentionTypes={LOCATION_TYPES}
      origin="live"
      version={launches}
    />
  );
}

function PlotCharactersContent({ sessionId, session, launches, union }: PanelProps) {
  return (
    <SectionDropZone
      entityType="session"
      entityId={sessionId}
      section="plot_characters"
      acceptTypes={PLOT_CHARACTER_TYPES}
      placeholder="Перетащите сюда существо или персонажа из поиска"
      mentionText={session.idea_notes}
      mentionTypes={PLOT_CHARACTER_TYPES}
      origin="live"
      version={launches}
      unionRows={forPanel(union, "plot_characters")}
      toInitiative
    />
  );
}

function ObstaclesContent({ sessionId, launches, union }: PanelProps) {
  return (
    <ObstacleDropZone
      sessionId={sessionId}
      origin="live"
      version={launches}
      unionRows={forPanel(union, "enemies")}
      toInitiative
    />
  );
}

function LootContent({ sessionId, launches, union }: PanelProps) {
  return (
    <SectionDropZone
      entityType="session"
      entityId={sessionId}
      section="loot"
      acceptTypes={LOOT_TYPES}
      placeholder="Перетащите сюда ресурс или артефакт из поиска"
      origin="live"
      version={launches}
      unionRows={forPanel(union, "loot")}
    />
  );
}

function RosterContent({ campaign, characters, session, sessionId, onChanged }: PanelProps) {
  async function updateAttendance(playerId: number, field: "attended" | "amount_paid", value: number) {
    const base = session.attendance.length > 0 ? session.attendance : campaign.roster.map((p) => ({ player_id: p.id, name: p.name, attended: 0, amount_paid: 0 }));
    const next = base.map((a) => (a.player_id === playerId ? { ...a, [field]: value } : a));
    // если игрока ещё нет в attendance (новый в ростере) — добавляем
    if (!next.find((a) => a.player_id === playerId)) next.push({ player_id: playerId, name: campaign.roster.find((p) => p.id === playerId)?.name ?? "", attended: field === "attended" ? value : 0, amount_paid: field === "amount_paid" ? value : 0 } as any);
    await api.put(`/sessions/${sessionId}/attendance`, {
      attendance: next.map((a) => ({ player_id: a.player_id, attended: !!a.attended, amount_paid: a.amount_paid })),
    });
    onChanged?.();
  }

  if (campaign.roster.length === 0) return <span className="muted">Состав кампании пуст.</span>;
  return (
    <div className="stack" style={{ gap: 0 }}>
      {campaign.roster.map((p) => {
        const playerCharacters = characters.filter((c) => c.player_id === p.id);
        const att = session.attendance.find((a) => a.player_id === p.id);
        const charNames = playerCharacters.length ? playerCharacters.map((c) => c.character_name).join(", ") : "—";
        const avatar = p.thumbnail_image_url ?? p.avatar_image_url;
        return (
          <div key={p.id} className="row" style={{ alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <div className="row" style={{ alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
              {avatar ? (
                <img src={avatar} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--paper-2)", flexShrink: 0 }} />
              )}
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {playerCharacters.length ? playerCharacters.map((c, idx) => (
                    <span key={c.id}>
                      {idx > 0 && ", "}
                      <Link to={`/characters/${c.id}`} style={{ color: "var(--ink)", textDecoration: "none" }}>{c.character_name}</Link>
                    </span>
                  )) : "—"}
                </span>
                <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em", lineHeight: 1 }}>{p.name}</span>
              </div>
              <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{playerCharacters.length === 0 ? <Link to={`/players/${p.id}`} className="muted">профиль</Link> : null}</span>
            </div>
            <label className="row" style={{ gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={!!att?.attended} onChange={(e) => updateAttendance(p.id, "attended", e.target.checked ? 1 : 0)} />
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Пришёл</span>
            </label>
            <input type="number" placeholder="0" value={att?.amount_paid || ""} onChange={(e) => updateAttendance(p.id, "amount_paid", Number(e.target.value) || 0)} style={{ width: 72, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", textAlign: "right" }} />
          </div>
        );
      })}
      <span className="muted" style={{ fontSize: "var(--fs-micro)", marginTop: 6 }}>Отметки уйдут в «Резюме» сессии.</span>
    </div>
  );
}

function SecretsContent({ campaign }: PanelProps) {
  // Пульт — боевая подсказка, не подготовка: показываем только нераскрытые по умолчанию, категории сворачиваемы, важные звездочкой наверх
  const [data, setData] = useState<CampaignGrouped<StorySecret & { state?: { revealed?: number; pinned?: number; note?: string } }>>({ groups: [], own: [] });
  const [showRevealed, setShowRevealed] = useState(false);
  const [pendingReveal, setPendingReveal] = useState<StorySecret | null>(null);

  const refresh = () => {
    api.get<CampaignGrouped<StorySecret>>(`/story/campaign-secrets?campaign_id=${campaign.id}`).then(setData as any).catch(() => {});
  };
  useEffect(refresh, [campaign.id]);

  const total = data.own.length + data.groups.reduce((n, g) => n + g.items.length, 0);
  const revealedCount = [...data.own, ...data.groups.flatMap((g) => g.items)].filter((s: any) => s.state?.revealed === 1).length;
  const unrevealedCount = total - revealedCount;

  const sortPinnedFirst = (items: StorySecret[]) => [...items].sort((a: any, b: any) => (b.state?.pinned ? 1 : 0) - (a.state?.pinned ? 1 : 0));
  const filterAndSort = (items: StorySecret[]) => {
    const filtered = showRevealed ? items : items.filter((s: any) => s.state?.revealed !== 1);
    return sortPinnedFirst(filtered);
  };

  const patchRevealed = (id: number, revealed: boolean) => {
    const patch = (list: any[]) => {
      const i = list.findIndex((x: any) => x.id === id);
      if (i === -1) return list;
      const next = list.slice();
      const prev = next[i].state ?? {};
      next[i] = { ...next[i], state: { ...prev, revealed: revealed ? 1 : 0, note: prev.note ?? "" } };
      return next;
    };
    setData((prev) => ({ own: patch(prev.own), groups: prev.groups.map((g) => { const items = patch(g.items); return items === g.items ? g : { ...g, items }; }) } as any));
  };

  const patchPinned = (id: number, pinned: boolean) => {
    const patch = (list: any[]) => {
      const i = list.findIndex((x: any) => x.id === id);
      if (i === -1) return list;
      const next = list.slice();
      const prev = next[i].state ?? {};
      next[i] = { ...next[i], state: { ...prev, pinned: pinned ? 1 : 0, revealed: prev.revealed ?? 0, note: prev.note ?? "" } };
      return next;
    };
    setData((prev) => ({ own: patch(prev.own), groups: prev.groups.map((g) => { const items = patch(g.items); return items === g.items ? g : { ...g, items }; }) } as any));
  };

  const toggle = (s: StorySecret, checked: boolean) => {
    if (checked) { setPendingReveal(s); return; }
    patchRevealed(s.id, false);
    void api.put(`/story/secrets/${s.id}/state`, { campaign_id: campaign.id, revealed: false });
  };

  const confirmReveal = () => {
    if (!pendingReveal) return;
    const s = pendingReveal;
    setPendingReveal(null);
    patchRevealed(s.id, true);
    void api.put(`/story/secrets/${s.id}/state`, { campaign_id: campaign.id, revealed: true });
  };

  const togglePinned = (s: any) => {
    const next = !(s.state?.pinned === 1);
    patchPinned(s.id, next);
    void api.put(`/story/secrets/${s.id}/state`, { campaign_id: campaign.id, pinned: next });
  };

  const SecretRow = ({ s }: { s: any }) => (
    <div className="row" style={{ gap: 8, alignItems: "flex-start", justifyContent: "space-between" }}>
      <label className="row" style={{ gap: 8, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
        <input type="checkbox" checked={s.state?.revealed === 1} onChange={(e) => toggle(s, e.target.checked)} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: "var(--fs-meta)" }}>{s.title}</strong>
          {s.content && <div className="muted" style={{ fontSize: "var(--fs-meta)", whiteSpace: "pre-wrap" }}><MentionText text={s.content} /></div>}
        </span>
      </label>
      <button type="button" className="comp-mini" title={s.state?.pinned ? "Убрать из важных" : "Важно — наверх"} onClick={() => togglePinned(s)} style={s.state?.pinned ? { background: "var(--surface)", color: "var(--on-surface)", borderColor: "var(--surface)" } : undefined}>
        {s.state?.pinned ? "★" : "☆"}
      </button>
    </div>
  );

  const ownFiltered = filterAndSort(data.own as StorySecret[]);
  const groupsFiltered = data.groups.map((g) => ({ ...g, items: filterAndSort(g.items as StorySecret[]) })).filter((g) => g.items.length > 0 || showRevealed);

  if (total === 0) return <span className="muted">Пока пусто.</span>;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>
          Нераскрыто {unrevealedCount} из {total}
        </span>
        {revealedCount > 0 && (
          <label className="row muted" style={{ gap: 6, alignItems: "center", cursor: "pointer", fontSize: "var(--fs-micro)" }}>
            <input type="checkbox" checked={showRevealed} onChange={(e) => setShowRevealed(e.target.checked)} />
            Показать раскрытые
          </label>
        )}
      </div>
      {ownFiltered.length > 0 && (
        <details className="card" open style={{ padding: 0, overflow: "hidden" }}>
          <summary style={{ padding: "7px 10px", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em", background: "var(--accent)", color: "var(--accent-text)", borderBottom: "1px solid var(--accent)" }}>Тайны кампании · {ownFiltered.length}</summary>
          <div className="stack" style={{ padding: 10, gap: 6 }}>
            {ownFiltered.map((s) => <SecretRow key={s.id} s={s} />)}
          </div>
        </details>
      )}
      {groupsFiltered.map((g) => (
        <details key={g.arc.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
          <summary style={{ padding: "7px 10px", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em", background: "var(--accent)", color: "var(--accent-text)", borderBottom: "1px solid var(--accent)" }}>{g.arc.name} · {g.items.length}</summary>
          <div className="stack" style={{ padding: 10, gap: 6 }}>
            {g.items.map((s) => <SecretRow key={s.id} s={s as any} />)}
          </div>
        </details>
      ))}
      {unrevealedCount === 0 && !showRevealed && <span className="muted">Все раскрыты — включите «Показать раскрытые» чтобы увидеть.</span>}
      {pendingReveal && (
        <div className="card" style={{ borderColor: "var(--ink)", background: "var(--paper)" }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Раскрыть «{pendingReveal.title}»?</p>
          <p className="muted" style={{ margin: "4px 0 8px" }}>Отметка уйдёт игрокам и попадёт в резюме сессии.</p>
          <div className="row">
            <button className="primary" onClick={confirmReveal}>Раскрыть</button>
            <button onClick={() => setPendingReveal(null)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RemindersContent({ campaign }: PanelProps) {
  return <RemindersWidget targetType="campaign" targetId={campaign.id} />;
}

function CompendiumContent({ campaign }: PanelProps) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ type: string; id: number } | null>(null);

  useEffect(() => {
    if (!campaign.system_id) return;
    if (q.trim().length < 2) { setItems([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.get<SearchResult[]>(`/search?q=${encodeURIComponent(q.trim())}&types=compendium_entry&system_id=${campaign.system_id}`)
        .then((rows) => setItems(rows.slice(0, 12)))
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, campaign.system_id]);

  if (!campaign.system_id) return <span className="muted">Система не выбрана.</span>;

  return (
    <div className="stack">
      <Link to={`/systems/${campaign.system_id}`}>Компендиум «{campaign.system_name}» →</Link>
      <input placeholder="Поиск в компендиуме — 2+ символа" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading && <span className="muted">Поиск…</span>}
      {!loading && q.trim().length >= 2 && items.length === 0 && <span className="muted">Ничего не найдено.</span>}
      {items.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          {items.map((r) => (
            <button key={`${r.type}:${r.id}`} type="button" className="row" style={{ justifyContent: "space-between", textAlign: "left", border: "1px solid var(--line)", padding: "6px 8px", background: "var(--paper)", cursor: "pointer" }} onClick={() => setPreview({ type: r.type, id: r.id })}>
              <span><strong>{r.title}</strong>{r.context && <span className="muted"> — {r.context}</span>}</span>
              <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>{r.kind ?? r.type}</span>
            </button>
          ))}
        </div>
      )}
      {preview && <EntityPreviewModal type={preview.type} id={preview.id} onClose={() => setPreview(null)} />}
    </div>
  );
}

// Keyed lookup used by the standalone pop-out page (SessionPanelPopoutPage)
// to render just one panel's content, bare, without any of the embedded
// wrappers below.
export const SESSION_PANEL_CONTENT: Record<SessionPanelKey, (props: PanelProps) => ReactElement> = {
  locations: LocationsContent,
  plotCharacters: PlotCharactersContent,
  obstacles: ObstaclesContent,
  loot: LootContent,
  roster: RosterContent,
  secrets: SecretsContent,
  reminders: RemindersContent,
  compendium: CompendiumContent,
};

// Embedded versions below — each keeps the exact look it had inline in
// SessionLivePage before this file existed, just with a pop-out button added.

export function LocationsPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.locations} className="card stack sp-card--location" defaultOpen actions={<PopoutButton sessionId={props.sessionId} panelKey="locations" />}>
      <LocationsContent {...props} />
    </LazyDetails>
  );
}

export function PlotCharactersPanel(props: PanelProps) {
  return (
    <LazyDetails
      title={SESSION_PANEL_TITLES.plotCharacters}
      className="card stack sp-card--plot"
      defaultOpen
      actions={<PopoutButton sessionId={props.sessionId} panelKey="plotCharacters" />}
    >
      <PlotCharactersContent {...props} />
    </LazyDetails>
  );
}

export function ObstaclesPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.obstacles} className="card stack sp-card--enemies" actions={<PopoutButton sessionId={props.sessionId} panelKey="obstacles" />}>
      <ObstaclesContent {...props} />
    </LazyDetails>
  );
}

export function LootPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.loot} className="card stack sp-card--loot" actions={<PopoutButton sessionId={props.sessionId} panelKey="loot" />}>
      <LootContent {...props} />
    </LazyDetails>
  );
}

export function RosterPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.roster} actions={<PopoutButton sessionId={props.sessionId} panelKey="roster" />}>
      <RosterContent {...props} />
    </LazyDetails>
  );
}

export function SecretsPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.secrets} defaultOpen actions={<PopoutButton sessionId={props.sessionId} panelKey="secrets" />}>
      <SecretsContent {...props} />
    </LazyDetails>
  );
}

export function RemindersPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.reminders} actions={<PopoutButton sessionId={props.sessionId} panelKey="reminders" />}>
      <RemindersContent {...props} />
    </LazyDetails>
  );
}

export function CompendiumPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.compendium} actions={<PopoutButton sessionId={props.sessionId} panelKey="compendium" />}>
      <CompendiumContent {...props} />
    </LazyDetails>
  );
}
