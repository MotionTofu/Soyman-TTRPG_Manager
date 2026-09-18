import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { readResource } from "../data/imperative";
import type { EntityKind } from "../data/entities";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import { FloatingActionBar } from "./FloatingActionBar";
import { EmptyState } from "./EmptyState";
import { LoadErrorCard } from "./Loadable";
import { Modal } from "./Modal";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useCampaignGrants, type GrantKey } from "../hooks/useCampaignGrants";
import { useCampaignSettingEntities } from "../hooks/useCampaignSettingEntities";
import { formatEventDate } from "../inworldCalendar";
import { buildSettingReaderGroups } from "./player/settingReaderEntries";
import { CampaignPlayerSectionsTab } from "./CampaignPlayerSectionsTab";
import type {
  PlayerPreview,
  PlayerSection,
  RosterPlayer,
  SettingBeing,
  SettingCalendarEvent,
  SettingCommunity,
  SettingLocation,
  VisibilityTargetType,
} from "../types";

// Одна «Выдача» кампании (Кабинет игрока, 2026-09-12, шаг 3): наверху Мир
// деревом сеттинга, ниже От мастера. Сводит две прежние вкладки «Для
// игроков» — у сеттинга (с выпадашкой «выбери кампанию», без которой она не
// работала вовсе) и у кампании. Мастер перед игрой думает «что я дам этим
// людям в четверг», а не «что открыто в сеттинге».
interface Props {
  campaignId: number;
  settingId: number | null;
  roster: RosterPlayer[];
}

type SortKey = "name" | "visibility";
type FilterKey = "all" | "visible" | "hidden";
type ModeKey = "include" | "visibility";

interface EntityItem {
  id: number;
  name: string;
  targetType: VisibilityTargetType;
  to?: string;
  folder?: string | null;
  sub?: string;
  getPlayerText: () => string;
  savePlayerText: (text: string) => Promise<boolean>;
}

interface TreeNode extends EntityItem {
  children: TreeNode[];
}

const NO_LOCATIONS: SettingLocation[] = [];
const NO_BEINGS: SettingBeing[] = [];
const NO_COMMUNITIES: SettingCommunity[] = [];
const NO_EVENTS: SettingCalendarEvent[] = [];

// Куда пишется «Текст игрокам» и чью карточку это задевает.
const PLAYER_TEXT_TARGETS: Record<"setting_location" | "setting_being" | "setting_community" | "setting_calendar_event", { base: string; kind: EntityKind }> = {
  setting_location: { base: "/setting-locations", kind: "location" },
  setting_being: { base: "/setting-beings", kind: "being" },
  setting_community: { base: "/setting-communities", kind: "community" },
  setting_calendar_event: { base: "/settings/calendar-events", kind: "setting_event" },
};

export function CampaignIssuanceTab({ campaignId, settingId, roster }: Props) {
  const run = useAction();
  const locationsState = useResource<SettingLocation[]>(settingId ? `/setting-locations?setting_id=${settingId}` : null);
  const beingsState = useResource<SettingBeing[]>(settingId ? `/setting-beings?setting_id=${settingId}` : null);
  const communitiesState = useResource<SettingCommunity[]>(settingId ? `/setting-communities?setting_id=${settingId}` : null);
  const eventsState = useResource<SettingCalendarEvent[]>(settingId ? `/settings/${settingId}/calendar-events` : null);
  const locations = locationsState.data ?? NO_LOCATIONS;
  const beings = beingsState.data ?? NO_BEINGS;
  const communities = communitiesState.data ?? NO_COMMUNITIES;
  const chronicleEvents = eventsState.data ?? NO_EVENTS;
  const worldStates = [locationsState, beingsState, communitiesState, eventsState];
  const loading = worldStates.some((w) => w.loading);
  const loadError = worldStates.find((w) => w.error)?.error ?? null;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [mode, setMode] = useState<ModeKey>("include");
  const [selected, setSelected] = useState<Set<GrantKey>>(new Set());
  const calendar = useSettingCalendar(settingId);
  const grants = useCampaignGrants(campaignId);
  const entities = useCampaignSettingEntities(campaignId);

  // «Глазами игрока»: выбранный игрок и его превью с сервера.
  const [previewPlayerId, setPreviewPlayerId] = useState<number | "">("");
  const [preview, setPreview] = useState<PlayerPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(new Set());
  }, [campaignId]);

  const personalities = useMemo(() => beings.filter((b) => b.category !== "bestiary"), [beings]);
  const bestiary = useMemo(() => beings.filter((b) => b.category === "bestiary"), [beings]);

  const q = query.trim().toLowerCase();
  const match = useCallback((name: string) => !q || name.toLowerCase().includes(q), [q]);

  const isVisible = useCallback(
    (targetType: VisibilityTargetType, targetId: number) => grants.isGrantedToAny(targetType, targetId),
    [grants]
  );

  const passFilter = useCallback(
    (targetType: VisibilityTargetType, targetId: number) => {
      if (mode === "visibility" && !entities.isIncluded(targetType, targetId)) return false;
      if (filter === "visible" && !isVisible(targetType, targetId)) return false;
      if (filter === "hidden" && isVisible(targetType, targetId)) return false;
      return true;
    },
    [mode, entities, filter, isVisible]
  );

  const sortItems = useCallback(
    <T extends { name: string }>(items: T[]): T[] => {
      if (sort === "name") return [...items].sort((a, b) => a.name.localeCompare(b.name, "ru"));
      return items;
    },
    [sort]
  );

  // Игроцкий текст правится здесь же, во вкладке выдачи: ступень говорит
  // НАСКОЛЬКО полно показано, текст — ЧТО именно показано вместо правды.
  const savePlayerText = useCallback(
    async (targetType: VisibilityTargetType, targetId: number, text: string): Promise<boolean> => {
      const target = PLAYER_TEXT_TARGETS[targetType as keyof typeof PLAYER_TEXT_TARGETS] ?? PLAYER_TEXT_TARGETS.setting_calendar_event;
      // Черновик в редакторе остаётся, пока запись не прошла; отказ — плашкой.
      const saved = await run(
        labelled("Текст игрокам", () => write.put(`${target.base}/${targetId}`, { player_text: text }).then(() => true)),
        { affects: [{ kind: target.kind, id: targetId }, { path: "/visibility-grants/preview" }, { path: "/player" }] }
      );
      return saved === true;
    },
    [run]
  );

  const toItems = useCallback(
    (list: (SettingLocation | SettingBeing | SettingCommunity)[], targetType: VisibilityTargetType, toPrefix: string): EntityItem[] =>
      list.map((e) => ({
        id: e.id,
        name: e.name,
        targetType,
        to: `${toPrefix}/${e.id}`,
        folder: (e as SettingLocation).folder_path ?? (e as SettingBeing).folder_path ?? null,
        getPlayerText: () => (e as SettingLocation).player_text ?? "",
        savePlayerText: (text: string) => savePlayerText(targetType, e.id, text),
      })),
    [savePlayerText]
  );

  const formatChronicleDate = useCallback(
    (e: SettingCalendarEvent) =>
      calendar ? formatEventDate(e.inworld_year, e.inworld_month, e.inworld_day, calendar.months) : `${e.inworld_year}.${e.inworld_month}.${e.inworld_day}`,
    [calendar]
  );

  const eventItems: EntityItem[] = useMemo(
    () =>
      [...chronicleEvents]
        .sort((a, b) => a.inworld_year - b.inworld_year || a.inworld_month - b.inworld_month || a.inworld_day - b.inworld_day)
        .map((e) => ({
          id: e.id,
          name: e.title,
          targetType: "setting_calendar_event" as VisibilityTargetType,
          sub: formatChronicleDate(e),
          getPlayerText: () => e.player_text ?? "",
          savePlayerText: (text: string) => savePlayerText("setting_calendar_event", e.id, text),
        })),
    [chronicleEvents, formatChronicleDate, savePlayerText]
  );

  const locationItems = useMemo(() => sortItems(toItems(locations, "setting_location", "/locations").filter((i) => match(i.name) && passFilter(i.targetType, i.id))), [locations, toItems, match, passFilter, sortItems]);
  const personalityItems = useMemo(() => sortItems(toItems(personalities, "setting_being", "/beings").filter((i) => match(i.name) && passFilter(i.targetType, i.id))), [personalities, toItems, match, passFilter, sortItems]);
  const bestiaryItems = useMemo(() => sortItems(toItems(bestiary, "setting_being", "/beings").filter((i) => match(i.name) && passFilter(i.targetType, i.id))), [bestiary, toItems, match, passFilter, sortItems]);
  const communityItems = useMemo(() => sortItems(toItems(communities, "setting_community", "/communities").filter((i) => match(i.name) && passFilter(i.targetType, i.id))), [communities, toItems, match, passFilter, sortItems]);
  const filteredEvents = useMemo(() => eventItems.filter((i) => match(i.name) && passFilter(i.targetType, i.id)), [eventItems, match, passFilter]);

  // Дерево локаций по parent_id (жалоба владельца: «сплошной список без
  // структуры»). Сироты с потерянным родителем — в корень, пропадать нельзя.
  const locationTree = useMemo(() => {
    const byId = new Map<number, TreeNode>();
    for (const item of locationItems) byId.set(item.id, { ...item, children: [] });
    const roots: TreeNode[] = [];
    const locById = new Map(locations.map((l) => [l.id, l]));
    for (const item of locationItems) {
      const parentId = locById.get(item.id)?.parent_id ?? null;
      const parent = parentId != null ? byId.get(parentId) : undefined;
      if (parent) parent.children.push(byId.get(item.id)!);
      else roots.push(byId.get(item.id)!);
    }
    return roots;
  }, [locationItems, locations]);

  // Дерево общин по parent_id — тем же правилом, что у локаций.
  const communityTree = useMemo(() => {
    const byId = new Map<number, TreeNode>();
    for (const item of communityItems) byId.set(item.id, { ...item, children: [] });
    const roots: TreeNode[] = [];
    const comById = new Map(communities.map((c) => [c.id, c]));
    for (const item of communityItems) {
      const parentId = comById.get(item.id)?.parent_id ?? null;
      const parent = parentId != null ? byId.get(parentId) : undefined;
      if (parent) parent.children.push(byId.get(item.id)!);
      else roots.push(byId.get(item.id)!);
    }
    return roots;
  }, [communityItems, communities]);

  const toggleSelect = useCallback((key: GrantKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((keys: GrantKey[]) => {
    setSelected((prev) => {
      const allSelected = keys.every((k) => prev.has(k));
      const next = new Set(prev);
      for (const k of keys) {
        if (allSelected) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const handleBatchGrant = useCallback(
    async (playerId: number) => {
      const targets = Array.from(selected).map((key) => {
        const [target_type, target_id] = key.split(":");
        return { target_type: target_type as VisibilityTargetType, target_id: Number(target_id) };
      });
      if (await grants.batchUpdate([playerId], targets, "grant")) setSelected(new Set());
    },
    [selected, grants]
  );

  const handleBatchRevoke = useCallback(
    async (playerId: number) => {
      const targets = Array.from(selected).map((key) => {
        const [target_type, target_id] = key.split(":");
        return { target_type: target_type as VisibilityTargetType, target_id: Number(target_id) };
      });
      if (await grants.batchUpdate([playerId], targets, "revoke")) setSelected(new Set());
    },
    [selected, grants]
  );

  const handleBatchInclude = useCallback(async () => {
    const targets = Array.from(selected).map((key) => {
      const [entity_type, entity_id] = key.split(":");
      return { entity_type: entity_type as VisibilityTargetType, entity_id: Number(entity_id) };
    });
    if (await entities.batchUpdate(targets, "add")) setSelected(new Set());
  }, [selected, entities]);

  const handleBatchExclude = useCallback(async () => {
    const targets = Array.from(selected).map((key) => {
      const [entity_type, entity_id] = key.split(":");
      return { entity_type: entity_type as VisibilityTargetType, entity_id: Number(entity_id) };
    });
    if (await entities.batchUpdate(targets, "remove")) setSelected(new Set());
  }, [selected, entities]);

  // «Глазами игрока»: превью считается ТЕМ ЖЕ кодом, что выдача игроку
  // (GET /visibility-grants/preview → services/playerContent.ts), а не своим
  // способом на клиенте. Сверка: списки превью и /player/* обязаны совпасть.
  const loadPreview = useCallback(async () => {
    if (!previewPlayerId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      // Свежее: превью открывают, чтобы сверить только что выданное.
      const data = await readResource<PlayerPreview>(
        `/visibility-grants/preview?campaign_id=${campaignId}&player_id=${previewPlayerId}`,
        { fresh: true }
      );
      setPreview(data);
    } catch (e: unknown) {
      setPreviewError(String(e instanceof Error ? e.message : e));
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [campaignId, previewPlayerId]);

  const previewPlayer = roster.find((p) => p.id === previewPlayerId);
  const previewGroups = useMemo(() => (preview ? buildSettingReaderGroups(preview.setting, preview.flagged) : []), [preview]);

  const rowShared = { campaignId, roster, grants, entities, selected, onSelect: toggleSelect, mode };

  return (
    <div className="stack">
      {/* Глазами игрока — рядом с выдачей, доступы раздаются не вслепую */}
      <div className="card stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <strong>Глазами игрока</strong>
          <select value={previewPlayerId} onChange={(e) => { setPreviewPlayerId(e.target.value ? Number(e.target.value) : ""); setPreview(null); }} aria-label="Игрок для предпросмотра">
            <option value="">Выберите игрока…</option>
            {roster.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button className="primary" onClick={loadPreview} disabled={!previewPlayerId || previewLoading}>
            {previewLoading ? "Смотрю…" : "Показать"}
          </button>
          {preview && previewPlayer && <span className="muted">Так видит «{previewPlayer.name}» — те же данные, что отдаёт ему сервер.</span>}
        </div>
        {previewError && <span style={{ color: "var(--danger, #c00)", fontSize: "var(--fs-meta)" }}>Не удалось загрузить превью: {previewError}</span>}
      </div>

      {settingId ? (
        <div className="stack">
          <h3>Мир</h3>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            Сначала включите нужные сущности в панель игроков, затем настройте видимость для каждого игрока.
          </p>
          {loading && <p className="muted">Загрузка…</p>}
          {loadError && (
            <LoadErrorCard
              message={<>Не удалось загрузить контент: {loadError}</>}
              onRetry={() => worldStates.forEach((w) => w.error && w.reload())}
            />
          )}
          {!loading && !loadError && (
            <>
              <div className="tabs">
                <button className={mode === "include" ? "active" : ""} onClick={() => { setMode("include"); setSelected(new Set()); }}>
                  Включение в панель
                </button>
                <button className={mode === "visibility" ? "active" : ""} onClick={() => { setMode("visibility"); setSelected(new Set()); }}>
                  Видимость для игроков
                </button>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input placeholder="Поиск по сеттингу…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: "1 1 200px" }} />
                {query && <button onClick={() => setQuery("")}>Сбросить</button>}
                {mode === "visibility" && (
                  <select value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)}>
                    <option value="all">Все</option>
                    <option value="visible">Показаны</option>
                    <option value="hidden">Скрыты</option>
                  </select>
                )}
                <div className="seg" role="group" aria-label="Сортировка">
                  <button className={sort === "name" ? "is-active" : ""} onClick={() => setSort("name")}>А-Я</button>
                  <button className={sort === "visibility" ? "is-active" : ""} onClick={() => setSort("visibility")}>По порядку</button>
                </div>
              </div>

              <Subsection title="Локации" count={locations.length} allKeys={locationItems.map((i) => `${i.targetType}:${i.id}` as GrantKey)} selected={selected} onSelectAll={toggleSelectAll} grants={grants}>
                {locationTree.map((node) => (
                  <TreeRow key={node.id} node={node} depth={0} {...rowShared} />
                ))}
                {locations.length === 0 && <span className="muted">Локаций пока нет.</span>}
              </Subsection>

              <Subsection title="Личности и фракции" count={personalities.length + communities.length} allKeys={[...personalityItems.map((i) => `${i.targetType}:${i.id}` as GrantKey), ...communityItems.map((i) => `${i.targetType}:${i.id}` as GrantKey)]} selected={selected} onSelectAll={toggleSelectAll} grants={grants}>
                {personalityItems.map((item) => (
                  <FlatRow key={`being-${item.id}`} item={item} {...rowShared} />
                ))}
                {communityTree.map((node) => (
                  <TreeRow key={`community-${node.id}`} node={node} depth={0} {...rowShared} />
                ))}
                {personalities.length === 0 && communities.length === 0 && <span className="muted">Пока никого нет.</span>}
              </Subsection>

              <Subsection title="Бестиарий" count={bestiary.length} allKeys={bestiaryItems.map((i) => `${i.targetType}:${i.id}` as GrantKey)} selected={selected} onSelectAll={toggleSelectAll} grants={grants}>
                {bestiaryItems.map((item) => (
                  <FlatRow key={item.id} item={item} {...rowShared} />
                ))}
                {bestiary.length === 0 && <span className="muted">Бестиарий пуст.</span>}
              </Subsection>

              <Subsection title="История" count={chronicleEvents.length} allKeys={filteredEvents.map((i) => `${i.targetType}:${i.id}` as GrantKey)} selected={selected} onSelectAll={toggleSelectAll} grants={grants}>
                {filteredEvents.map((item) => (
                  <FlatRow key={item.id} item={item} {...rowShared} />
                ))}
                {chronicleEvents.length === 0 && <span className="muted">В хронике мира пока нет событий.</span>}
              </Subsection>

              <FloatingActionBar
                selectedCount={selected.size}
                roster={roster}
                onGrant={mode === "visibility" ? handleBatchGrant : undefined}
                onRevoke={mode === "visibility" ? handleBatchRevoke : undefined}
                onInclude={mode === "include" ? handleBatchInclude : undefined}
                onExclude={mode === "include" ? handleBatchExclude : undefined}
                onClear={clearSelection}
              />
            </>
          )}
        </div>
      ) : (
        <EmptyState title="Кампания без сеттинга" hint="Привяжите сеттинг к кампании, чтобы выдавать игрокам Мир." />
      )}

      <h3>От мастера</h3>
      <CampaignPlayerSectionsTab campaignId={campaignId} roster={roster} defaultSettingId={settingId ?? undefined} />

      {preview && (
        <Modal onClose={() => setPreview(null)}>
          <div className="stack">
            <h3>Глазами игрока — {previewPlayer?.name}</h3>
            <p className="muted" style={{ maxWidth: "62ch" }}>Так видит игрок: только выданное ему. Данные — ответ сервера, тот же, что уходит игроку.</p>
            <PreviewSections sections={preview.sections} />
            {previewGroups.length === 0 && preview.sections.length === 0 && <p className="muted">Игроку пока ничего не выдано.</p>}
            {previewGroups.map((g) => (
              <div key={g.key} className="stack" style={{ gap: 4 }}>
                <strong style={{ fontFamily: "var(--font-ui)", textTransform: "uppercase", fontSize: "var(--fs-meta)" }}>{g.label}</strong>
                {g.entries.map((e) => (
                  <div key={e.key} className="card" style={{ padding: 12 }}>
                    <div style={{ fontWeight: 600 }}>{e.title}</div>
                    {e.body}
                  </div>
                ))}
              </div>
            ))}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="primary" onClick={() => setPreview(null)}>Закрыть</button>
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
    <div className="stack" style={{ gap: 4 }}>
      <strong style={{ fontFamily: "var(--font-ui)", textTransform: "uppercase", fontSize: "var(--fs-meta)" }}>От мастера</strong>
      {sections.map((s) => (
        <div key={s.id} className="card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 600 }}>{s.name} <span className="badge tag">{s.kind === "gallery" ? "Галерея" : "Статьи"}</span></div>
          {s.kind !== "gallery" && (s.articles ?? []).map((a) => (
            <div key={a.id} className="muted">· {a.title || "Без названия"}</div>
          ))}
          {s.kind === "gallery" && <div className="muted">· {(s.images ?? []).length} изо</div>}
        </div>
      ))}
    </div>
  );
}

const Subsection = memo(function Subsection({
  title,
  count,
  allKeys,
  selected,
  onSelectAll,
  grants,
  children,
}: {
  title: string;
  count: number;
  allKeys: GrantKey[];
  selected: Set<GrantKey>;
  onSelectAll: (keys: GrantKey[]) => void;
  grants: ReturnType<typeof useCampaignGrants>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = allKeys.some((k) => selected.has(k));
  const visibleCount = allKeys.filter((k) => {
    const [t, id] = k.split(":");
    return grants.isGrantedToAny(t as VisibilityTargetType, Number(id));
  }).length;

  return (
    <details className="card" open={open}>
      <summary className="chevron-summary" onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}>
        <span className={`chevron-icon${open ? " is-open" : ""}`} />
        {title}
        {count > 0 && <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", marginLeft: 4 }}>{count}</span>}
        {count > 0 && <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", marginLeft: 6 }} title="Показано хотя бы одному игроку">{visibleCount}/{count}</span>}
        {allKeys.length > 0 && (
          <label className="subsection-select-all" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
              onChange={() => onSelectAll(allKeys)}
            />
          </label>
        )}
      </summary>
      {open && <div className="stack" style={{ marginTop: 8 }}>{children}</div>}
    </details>
  );
});

interface RowShared {
  campaignId: number;
  roster: RosterPlayer[];
  grants: ReturnType<typeof useCampaignGrants>;
  entities: ReturnType<typeof useCampaignSettingEntities>;
  selected: Set<GrantKey>;
  onSelect: (key: GrantKey) => void;
  mode: ModeKey;
}

function LevelSummary({ item, grants }: { item: EntityItem; grants: ReturnType<typeof useCampaignGrants> }) {
  const { open, mentioned } = grants.getLevelCounts(item.targetType, item.id);
  if (open === 0 && mentioned === 0) return null;
  const parts: string[] = [];
  if (open > 0) parts.push(`открыта · ${open}`);
  if (mentioned > 0) parts.push(`упомянута · ${mentioned}`);
  return (
    <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", whiteSpace: "nowrap" }} title="Ступень выдачи и число игроков">
      {parts.join(" · ")}
    </span>
  );
}

function RowControls({ item, shared }: { item: EntityItem; shared: RowShared }) {
  const { grants, entities, mode, campaignId, roster } = shared;
  const key: GrantKey = `${item.targetType}:${item.id}`;
  const isChecked = shared.selected.has(key);
  const isIncl = entities.isIncluded(item.targetType, item.id);
  const grantedCount = grants.getGrantedPlayerIds(item.targetType, item.id).length;
  return (
    <>
      <label className="row" style={{ gap: 6, cursor: "pointer" }}>
        <input type="checkbox" checked={isChecked} onChange={() => shared.onSelect(key)} />
      </label>
      {item.to ? <Link to={item.to}>{item.name}</Link> : <span>{item.name}</span>}
      {item.sub && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{item.sub}</span>}
      {item.folder && <span className="muted" style={{ fontSize: "var(--fs-meta)" }} title="Папка">{item.folder}</span>}
      {mode === "visibility" && <LevelSummary item={item} grants={grants} />}
      {mode === "visibility" && roster.length > 0 && (
        <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", whiteSpace: "nowrap" }} title={`${grantedCount} из ${roster.length} игроков видят`}>
          {grantedCount}/{roster.length}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {mode === "include" ? (
        <button
          className={isIncl ? "active" : ""}
          onClick={() => isIncl ? entities.remove(item.targetType, item.id) : entities.add(item.targetType, item.id)}
          title={isIncl ? "Убрать из панели игроков" : "Добавить в панель игроков"}
          style={{ fontSize: "var(--fs-meta)", padding: "4px 10px", lineHeight: 1 }}
        >
          {isIncl ? "В панели" : "+ Добавить"}
        </button>
      ) : (
        <PlayerVisibilityPicker campaignId={campaignId} targetType={item.targetType} targetId={item.id} roster={roster} />
      )}
    </>
  );
}

function PlayerTextEditor({ item }: { item: EntityItem }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = item.getPlayerText();
  const dirty = draft !== null && draft !== current;
  return (
    <div style={{ width: "100%" }}>
      <button onClick={() => { setOpen((v) => !v); setDraft(current); }} style={{ fontSize: "var(--fs-meta)", padding: "2px 8px" }} title="Что рассказываем игрокам вместо правды">
        Текст игрокам{current ? " · есть" : ""}
      </button>
      {open && (
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          <textarea value={draft ?? ""} onChange={(e) => setDraft(e.target.value)} rows={3} placeholder="Слух, который знают игроки…" style={{ width: "100%" }} />
          <div className="row" style={{ gap: 6 }}>
            <button className="primary" disabled={!dirty || saving} onClick={async () => { setSaving(true); const ok = await item.savePlayerText(draft ?? ""); setSaving(false); if (ok) setDraft(null); }}>
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
            <button onClick={() => { setOpen(false); setDraft(null); }}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FlatRow({ item, ...shared }: { item: EntityItem } & RowShared) {
  const [textOpen, setTextOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row setting-player-row" style={{ justifyContent: "space-between" }}>
        <div className="row setting-player-row-select" style={{ gap: 6, flex: 1, minWidth: 0 }}>
          <RowControls item={item} shared={shared} />
        </div>
        <button onClick={() => setTextOpen((v) => !v)} style={{ fontSize: "var(--fs-meta)", padding: "2px 8px" }} title="Текст игрокам">
          Текст игрокам{item.getPlayerText() ? " ·" : ""}
        </button>
      </div>
      {textOpen && <PlayerTextEditor item={item} />}
    </div>
  );
}

function TreeRow({ node, depth, ...shared }: { node: TreeNode; depth: number } & RowShared) {
  const [textOpen, setTextOpen] = useState(false);
  const [kidsOpen, setKidsOpen] = useState(true);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row setting-player-row" style={{ justifyContent: "space-between", paddingLeft: depth * 18 }}>
        <div className="row setting-player-row-select" style={{ gap: 6, flex: 1, minWidth: 0 }}>
          {node.children.length > 0 ? (
            <button onClick={() => setKidsOpen((v) => !v)} style={{ fontSize: "var(--fs-meta)", padding: "0 6px" }} aria-label={kidsOpen ? "Свернуть" : "Развернуть"}>
              {kidsOpen ? "▾" : "▸"}
            </button>
          ) : (
            <span style={{ width: 22, display: "inline-block", textAlign: "center", color: "var(--muted)" }}>·</span>
          )}
          <RowControls item={node} shared={shared} />
        </div>
        <button onClick={() => setTextOpen((v) => !v)} style={{ fontSize: "var(--fs-meta)", padding: "2px 8px" }} title="Текст игрокам">
          Текст игрокам{node.getPlayerText() ? " ·" : ""}
        </button>
      </div>
      {textOpen && (
        <div style={{ paddingLeft: depth * 18 + 22 }}>
          <PlayerTextEditor item={node} />
        </div>
      )}
      {kidsOpen && node.children.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} {...shared} />
      ))}
    </div>
  );
}
