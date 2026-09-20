import { useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "../data/search";
import { SectionDropZone } from "../components/SectionDropZone";
import { ObstacleDropZone } from "../components/ObstacleDropZone";
import { LazyDetails } from "../components/LazyDetails";
import { RemindersWidget } from "../components/RemindersWidget";
import { MarkTargetPicker } from "../components/MarkTargetPicker";
import { EntityPreviewModal } from "../components/EntityPreviewModal";
import { MentionText } from "../components/mentions/MentionText";
import { openPreviewDockCard } from "../previewDockStore";
import { dataKeys } from "../data/entities";
import { useAction, useResource, write } from "../data/hooks";
import { secretStateAffects, sessionPaths } from "../data/sessions";
import { ToInitiativeButton } from "../components/ToInitiativeButton";
import { kindLabel } from "../compendium";
import type {
  CampaignDetail,
  CampaignGrouped,
  Character,
  SessionDetail,
  SessionUnionRow,
  StorySecret,
} from "../types";

// Same module-level constants as SessionDetailPage.tsx — SectionDropZone is
// React.memo'd, so an inline array literal here would be a new reference
// every render, defeating the memo on every unrelated keystroke.
const PLOT_CHARACTER_TYPES = ["being", "character"];
const LOCATION_TYPES = ["location"];
const LOOT_TYPES = ["resource", "artifact"];

// Место на пульте — в докстанцию, а не превью-модалкой (решения 2026-09-11,
// §2): модалка закрывает пульт и требует закрытия перед следующей сценой.
// Ctrl+клик — полная страница новым окном: уход из пульта сбросил бы док.
// Функция модульная — SectionDropZone мемоизирован.
//
// Только на самом пульте: та же панель живёт в окне попаута
// (/sessions/:id/live/panel/:key), где докстанции нет, — там щелчок остаётся
// превью, как было, иначе он не делал бы ничего видимого.
const LIVE_PULT_PATH = /^\/sessions\/\d+\/live$/;
function openLocationInDock(type: string, id: number, event: React.MouseEvent): boolean {
  if (type !== "location") return false;
  if (!LIVE_PULT_PATH.test(window.location.pathname)) return false;
  if (event.ctrlKey || event.metaKey) {
    window.open(`/locations/${id}`, "_blank", "noopener");
    return true;
  }
  openPreviewDockCard({ type, id });
  return true;
}

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
  plotCharacters: "НПЦ",
  obstacles: "Препятствия",
  loot: "Лут",
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
  /**
   * Состав всех сцен сессии. Панели показывают его строками наравне со
   * связями: Мастеру полезнее видеть весь вечер сразу, а не состав одной
   * запущенной сцены — у самого большого приключения 29 сцен и 10 разных
   * участников, так что объединение это два десятка строк, а не сотня.
   */
  union?: SessionUnionRow[];
}

/** Строки объединения для одной панели. */
function forPanel(union: SessionUnionRow[] | undefined, panel: string): SessionUnionRow[] {
  return (union ?? []).filter((u) => u.panel === panel);
}
// Панели не знают про запуск сцены: он задевает связи и состав сессии
// (data/sessions.ts), и зоны перечитываются сами. Строки объединения — через
// useMemo, иначе новый массив на каждой отрисовке сбивал бы memo зоны.

function LocationsContent({ sessionId, session }: PanelProps) {
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
      onEntityClick={openLocationInDock}
    />
  );
}

function PlotCharactersContent({ sessionId, session, union }: PanelProps) {
  const rows = useMemo(() => forPanel(union, "plot_characters"), [union]);
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
      unionRows={rows}
      toInitiative
    />
  );
}

function ObstaclesContent({ sessionId, union }: PanelProps) {
  const rows = useMemo(() => forPanel(union, "enemies"), [union]);
  return <ObstacleDropZone sessionId={sessionId} origin="live" unionRows={rows} toInitiative />;
}

function LootContent({ sessionId, union }: PanelProps) {
  const rows = useMemo(() => forPanel(union, "loot"), [union]);
  return (
    <SectionDropZone
      entityType="session"
      entityId={sessionId}
      section="loot"
      acceptTypes={LOOT_TYPES}
      placeholder="Перетащите сюда ресурс или артефакт из поиска"
      origin="live"
      unionRows={rows}
    />
  );
}

function RosterContent({ campaign, characters }: PanelProps) {
  if (campaign.roster.length === 0) return <span className="muted">Состав кампании пуст.</span>;
  return (
    <div className="stack roster-rows" style={{ gap: 0 }}>
      {campaign.roster.map((p) => {
        const playerCharacters = characters.filter((c) => c.player_id === p.id);
        const avatar = p.thumbnail_image_url ?? p.avatar_image_url;
        return (
          <div key={p.id} className="row" style={{ alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <div className="row" style={{ alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
              {avatar ? (
                <img src={avatar} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--paper-2)", flexShrink: 0 }} />
              )}
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 2 }}>
                {playerCharacters.length ? playerCharacters.map((c) => (
                  <span key={c.id} className="row" style={{ gap: 6, alignItems: "center", minWidth: 0 }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
                      <Link to={`/characters/${c.id}`} style={{ color: "var(--ink)", textDecoration: "none" }}>{c.character_name}</Link>
                    </span>
                    <ToInitiativeButton item={{ type: "character", id: c.id, title: c.character_name }} />
                  </span>
                )) : (
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", fontWeight: 700, lineHeight: 1.1 }}>—</span>
                )}
                <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em", lineHeight: 1 }}>{p.name}</span>
              </div>
              <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{playerCharacters.length === 0 ? <Link to={`/players/${p.id}`} className="muted">профиль</Link> : null}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type SecretWithState = StorySecret & { state?: { revealed?: number; pinned?: number; note?: string } | null };
const NO_SECRETS: CampaignGrouped<SecretWithState> = { groups: [], own: [] };

function SecretsContent({ campaign }: PanelProps) {
  // Пульт — боевая подсказка, не подготовка: показываем только нераскрытые по умолчанию, категории сворачиваемы, важные звездочкой наверх
  const client = useQueryClient();
  const run = useAction();
  const secretsPath = sessionPaths.campaignSecrets(campaign.id);
  // Тот же ключ кэша, что у «Обзора» профиля сессии: раскрытое здесь видно там сразу.
  const data = useResource<CampaignGrouped<SecretWithState>>(secretsPath).data ?? NO_SECRETS;
  const [showRevealed, setShowRevealed] = useState(false);
  const [pendingReveal, setPendingReveal] = useState<StorySecret | null>(null);

  const total = data.own.length + data.groups.reduce((n, g) => n + g.items.length, 0);
  const revealedCount = [...data.own, ...data.groups.flatMap((g) => g.items)].filter((s: any) => s.state?.revealed === 1).length;
  const unrevealedCount = total - revealedCount;

  const sortPinnedFirst = (items: StorySecret[]) => [...items].sort((a: any, b: any) => (b.state?.pinned ? 1 : 0) - (a.state?.pinned ? 1 : 0));
  const filterAndSort = (items: StorySecret[]) => {
    const filtered = showRevealed ? items : items.filter((s: any) => s.state?.revealed !== 1);
    return sortPinnedFirst(filtered);
  };

  // Отметка встаёт сразу — правкой кэша, до ответа сервера; отказ сервера
  // перечитывает тайны обратно.
  const patchData = (fn: (prev: CampaignGrouped<SecretWithState>) => CampaignGrouped<SecretWithState>) => {
    client.setQueryData<CampaignGrouped<SecretWithState>>(dataKeys.resource(secretsPath), (prev) => (prev ? fn(prev) : prev));
  };

  const saveState = (secretId: number, body: { revealed?: boolean; pinned?: boolean }) => {
    void run(
      async () => {
        await write.put(`/story/secrets/${secretId}/state`, { campaign_id: campaign.id, ...body });
        return true;
      },
      { affects: secretStateAffects(campaign.id) }
    );
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
    patchData((prev) => ({ own: patch(prev.own), groups: prev.groups.map((g) => { const items = patch(g.items); return items === g.items ? g : { ...g, items }; }) }));
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
    patchData((prev) => ({ own: patch(prev.own), groups: prev.groups.map((g) => { const items = patch(g.items); return items === g.items ? g : { ...g, items }; }) }));
  };

  const toggle = (s: StorySecret, checked: boolean) => {
    if (checked) { setPendingReveal(s); return; }
    patchRevealed(s.id, false);
    saveState(s.id, { revealed: false });
  };

  const confirmReveal = () => {
    if (!pendingReveal) return;
    const s = pendingReveal;
    setPendingReveal(null);
    patchRevealed(s.id, true);
    saveState(s.id, { revealed: true });
  };

  const togglePinned = (s: any) => {
    const next = !(s.state?.pinned === 1);
    patchPinned(s.id, next);
    saveState(s.id, { pinned: next });
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

function RemindersContent({ campaign, sessionId }: PanelProps) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <MarkTargetPicker sessionId={sessionId} campaignId={campaign.id} />
      <RemindersWidget targetType="campaign" targetId={campaign.id} />
    </div>
  );
}

// Раздел из контекста поиска («Система: D&D 5.5 — Ловушки» → «Ловушки»).
// Систему не показываем: она уже названа в шапке панели. Без « — »
// (нет родителя) — раздела нет, только вид.
function sectionOf(context: string | null | undefined): string | null {
  if (!context) return null;
  const i = context.indexOf(" — ");
  return i < 0 ? null : context.slice(i + 3).trim() || null;
}

function CompendiumContent({ campaign }: PanelProps) {  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<{ type: string; id: number } | null>(null);
  const search = useSearch(
    campaign.system_id && q.trim().length >= 2
      ? `/search?q=${encodeURIComponent(q.trim())}&types=compendium_entry&system_id=${campaign.system_id}`
      : null,
    250
  );
  const items = search.results.slice(0, 12);
  const loading = search.searching;

  if (!campaign.system_id) return <span className="muted">Система не выбрана.</span>;

  return (
    <div className="stack">
      <Link to={`/systems/${campaign.system_id}`}>Компендиум «{campaign.system_name}» →</Link>
      <input placeholder="Поиск в компендиуме — 2+ символа" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading && <span className="muted">Поиск…</span>}
      {!loading && q.trim().length >= 2 && items.length === 0 && <span className="muted">Ничего не найдено.</span>}
      {items.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          {items.map((r) => {
            const section = sectionOf(r.context);
            return (
              <button key={`${r.type}:${r.id}`} type="button" className="sp-comp-hit" style={{ textAlign: "left", border: "1px solid var(--line)", padding: "6px 8px", background: "var(--paper)", cursor: "pointer" }} onClick={() => setPreview({ type: r.type, id: r.id })}>
                <span className="sp-comp-hit__title"><strong>{r.title}</strong></span>
                {section ? (
                  <span className="muted sp-comp-hit__section">{section}</span>
                ) : (
                  // Пустая ячейка держит колонки: без неё чип уедет в середину.
                  <span aria-hidden="true" />
                )}
                <span className="sp-comp-hit__chip">{r.kind === "mechanic_item" ? "механ" : kindLabel(r.kind ?? r.type)}</span>
              </button>
            );
          })}
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
    <LazyDetails title={SESSION_PANEL_TITLES.locations} summaryClassName="pult-drag-handle" className="card stack sp-card--location" defaultOpen>
      <LocationsContent {...props} />
    </LazyDetails>
  );
}

export function PlotCharactersPanel(props: PanelProps) {
  return (
    <LazyDetails
      title={SESSION_PANEL_TITLES.plotCharacters} summaryClassName="pult-drag-handle"
      className="card stack sp-card--plot"
      defaultOpen
    >
      <PlotCharactersContent {...props} />
    </LazyDetails>
  );
}

export function ObstaclesPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.obstacles} summaryClassName="pult-drag-handle" className="card stack sp-card--enemies">
      <ObstaclesContent {...props} />
    </LazyDetails>
  );
}

export function LootPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.loot} summaryClassName="pult-drag-handle" className="card stack sp-card--loot">
      <LootContent {...props} />
    </LazyDetails>
  );
}

export function RosterPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.roster} summaryClassName="pult-drag-handle">
      <RosterContent {...props} />
    </LazyDetails>
  );
}

export function SecretsPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.secrets} summaryClassName="pult-drag-handle" defaultOpen>
      <SecretsContent {...props} />
    </LazyDetails>
  );
}

export function RemindersPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.reminders} summaryClassName="pult-drag-handle">
      <RemindersContent {...props} />
    </LazyDetails>
  );
}

export function CompendiumPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.compendium} summaryClassName="pult-drag-handle">
      <CompendiumContent {...props} />
    </LazyDetails>
  );
}
