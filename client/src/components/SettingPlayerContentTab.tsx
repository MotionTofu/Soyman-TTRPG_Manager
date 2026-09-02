import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import { PlayerContentReader, type ReaderEntry } from "./PlayerContentReader";
import { FloatingActionBar } from "./FloatingActionBar";
import { MentionText } from "./mentions/MentionText";
import { EmptyState } from "./EmptyState";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useCampaignGrants, type GrantKey } from "../hooks/useCampaignGrants";
import { useCampaignSettingEntities } from "../hooks/useCampaignSettingEntities";
import { formatEventDate } from "../inworldCalendar";
import { useAlert } from "../hooks/useConfirm";
import type {
  Campaign,
  CampaignDetail,
  RosterPlayer,
  SettingBeing,
  SettingCalendarEvent,
  SettingCommunity,
  SettingLocation,
  VisibilityTargetType,
} from "../types";

interface Props {
  settingId: number;
  campaigns: Campaign[];
}

type SortKey = "name" | "visibility";
type FilterKey = "all" | "visible" | "hidden";
type ModeKey = "include" | "visibility";

export function SettingPlayerContentTab({ settingId, campaigns }: Props) {
  const [campaignId, setCampaignId] = useState<number | "">("");
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const [beings, setBeings] = useState<SettingBeing[]>([]);
  const [communities, setCommunities] = useState<SettingCommunity[]>([]);
  const [chronicleEvents, setChronicleEvents] = useState<SettingCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [readerIndex, setReaderIndex] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>("name");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [mode, setMode] = useState<ModeKey>("include");
  const [selected, setSelected] = useState<Set<GrantKey>>(new Set());
  const calendar = useSettingCalendar(settingId);
  const grants = useCampaignGrants(campaignId);
  const entities = useCampaignSettingEntities(campaignId);
  const [alertDialog, showAlert] = useAlert();

  // Roster cache — avoid re-fetching when switching back to a campaign
  const rosterCache = useRef<Map<number, RosterPlayer[]>>(new Map());

  useEffect(() => {
    if (!Number.isFinite(settingId)) {
      setLoadError("Некорректный ID сеттинга.");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    const opts = { signal: controller.signal };
    Promise.all([
      api.get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`, opts),
      api.get<SettingBeing[]>(`/setting-beings?setting_id=${settingId}`, opts),
      api.get<SettingCommunity[]>(`/setting-communities?setting_id=${settingId}`, opts),
      api.get<SettingCalendarEvent[]>(`/settings/${settingId}/calendar-events`, opts),
    ])
      .then(([locs, b, comm, events]) => {
        setLocations(locs);
        setBeings(b);
        setCommunities(comm);
        setChronicleEvents(events);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setLoadError(String(e instanceof Error ? e.message : e));
        setLoading(false);
      });
    return () => controller.abort();
  }, [settingId]);

  // Clear selection when switching campaign — keys are per-campaign
  useEffect(() => {
    setSelected(new Set());
  }, [campaignId]);

  // Clear selection and filters when switching setting — stale keys
  useEffect(() => {
    setSelected(new Set());
    setQuery("");
    setFilter("all");
  }, [settingId]);

  useEffect(() => {
    if (!campaignId) {
      setRoster([]);
      return;
    }
    // Check cache first
    const cached = rosterCache.current.get(campaignId);
    if (cached) {
      setRoster(cached);
      return;
    }
    const controller = new AbortController();
    api
      .get<CampaignDetail>(`/campaigns/${campaignId}`, { signal: controller.signal })
      .then((c) => {
        rosterCache.current.set(campaignId, c.roster);
        setRoster(c.roster);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setRoster([]);
      });
    return () => controller.abort();
  }, [campaignId]);

  const personalities = useMemo(() => beings.filter((b) => b.category !== "bestiary"), [beings]);
  const bestiary = useMemo(() => beings.filter((b) => b.category === "bestiary"), [beings]);

  // Search filter
  const q = query.trim().toLowerCase();
  const match = useCallback((name: string) => !q || name.toLowerCase().includes(q), [q]);

  // Sort helper
  const sortBy = useCallback(
    <T extends { name: string }>(items: T[]): T[] => {
      if (sort === "name") return [...items].sort((a, b) => a.name.localeCompare(b.name, "ru"));
      return items;
    },
    [sort]
  );
  const sortEvents = useCallback(
    (events: SettingCalendarEvent[]): SettingCalendarEvent[] => {
      if (sort === "name") return [...events].sort((a, b) => a.title.localeCompare(b.title, "ru"));
      return events;
    },
    [sort]
  );

  // Visibility filter helper
  const isVisible = useCallback(
    (targetType: VisibilityTargetType, targetId: number) => grants.isGrantedToAny(targetType, targetId),
    [grants]
  );

  const applyFilter = useCallback(
    <T extends { id: number; name: string }>(
      items: T[],
      targetType: VisibilityTargetType
    ): T[] => {
      let result = items;
      if (mode === "visibility") {
        result = result.filter((i) => entities.isIncluded(targetType, i.id));
      }
      if (q) result = result.filter((i) => match(i.name));
      if (filter === "visible") result = result.filter((i) => isVisible(targetType, i.id));
      if (filter === "hidden") result = result.filter((i) => !isVisible(targetType, i.id));
      return sortBy(result);
    },
    [q, match, filter, isVisible, sortBy, mode, entities]
  );

  const filteredLocations = useMemo(() => applyFilter(locations, "setting_location"), [locations, applyFilter]);
  const filteredPersonalities = useMemo(() => applyFilter(personalities, "setting_being"), [personalities, applyFilter]);
  const filteredCommunities = useMemo(() => applyFilter(communities, "setting_community"), [communities, applyFilter]);
  const filteredBestiary = useMemo(() => applyFilter(beings.filter((b) => b.category === "bestiary"), "setting_being"), [beings, applyFilter]);
  const filteredEvents = useMemo(
    () =>
      applyFilter(
        chronicleEvents.map((e) => ({ ...e, name: e.title })) as (SettingCalendarEvent & { name: string })[],
        "setting_calendar_event"
      ).map((e) => e as SettingCalendarEvent),
    [chronicleEvents, applyFilter]
  );

  // Visible counts (для шапок в режиме "Видимость") — сколько из общего уже показано хотя бы одному игроку
  const visibleLocCount = useMemo(() => locations.filter((l) => isVisible("setting_location", l.id)).length, [locations, isVisible]);
  const visiblePersonalityCount = useMemo(() => personalities.filter((b) => isVisible("setting_being", b.id)).length, [personalities, isVisible]);
  const visibleCommunityCount = useMemo(() => communities.filter((c) => isVisible("setting_community", c.id)).length, [communities, isVisible]);
  const visibleBestiaryCount = useMemo(() => bestiary.filter((b) => isVisible("setting_being", b.id)).length, [bestiary, isVisible]);
  const visibleEventCount = useMemo(() => chronicleEvents.filter((e) => isVisible("setting_calendar_event", e.id)).length, [chronicleEvents, isVisible]);

  // Selection helpers
  const toggleSelect = useCallback((key: GrantKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(
    (keys: GrantKey[]) => {
      setSelected((prev) => {
        const allSelected = keys.every((k) => prev.has(k));
        const next = new Set(prev);
        for (const k of keys) {
          if (allSelected) next.delete(k);
          else next.add(k);
        }
        return next;
      });
    },
    []
  );

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Batch grant/revoke — keep selection on failure so user can retry
  const handleBatchGrant = useCallback(
    async (playerId: number) => {
      const targets = Array.from(selected).map((key) => {
        const [target_type, target_id] = key.split(":");
        return { target_type: target_type as VisibilityTargetType, target_id: Number(target_id) };
      });
      const ok = await grants.batchUpdate([playerId], targets, "grant");
      if (ok) setSelected(new Set());
      else void showAlert("Не удалось показать игрокам. Попробуйте ещё раз.");
    },
    [selected, grants, showAlert]
  );

  const handleBatchRevoke = useCallback(
    async (playerId: number) => {
      const targets = Array.from(selected).map((key) => {
        const [target_type, target_id] = key.split(":");
        return { target_type: target_type as VisibilityTargetType, target_id: Number(target_id) };
      });
      const ok = await grants.batchUpdate([playerId], targets, "revoke");
      if (ok) setSelected(new Set());
      else void showAlert("Не удалось скрыть у игроков. Попробуйте ещё раз.");
    },
    [selected, grants, showAlert]
  );

  const handleBatchInclude = useCallback(async () => {
    const targets = Array.from(selected).map((key) => {
      const [entity_type, entity_id] = key.split(":");
      return { entity_type: entity_type as VisibilityTargetType, entity_id: Number(entity_id) };
    });
    const ok = await entities.batchUpdate(targets, "add");
    if (ok) setSelected(new Set());
    else void showAlert("Не удалось добавить в панель игроков.");
  }, [selected, entities, showAlert]);

  const handleBatchExclude = useCallback(async () => {
    const targets = Array.from(selected).map((key) => {
      const [entity_type, entity_id] = key.split(":");
      return { entity_type: entity_type as VisibilityTargetType, entity_id: Number(entity_id) };
    });
    const ok = await entities.batchUpdate(targets, "remove");
    if (ok) setSelected(new Set());
    else void showAlert("Не удалось убрать из панели игроков.");
  }, [selected, entities, showAlert]);

  // Flat entries for PlayerContentReader
  const formatChronicleDate = useCallback(
    (e: SettingCalendarEvent) =>
      calendar ? formatEventDate(e.inworld_year, e.inworld_month, e.inworld_day, calendar.months) : `${e.inworld_year}.${e.inworld_month}.${e.inworld_day}`,
    [calendar]
  );

  const flatEntries: ReaderEntry[] = useMemo(() => {
    const entries: ReaderEntry[] = [];
    for (const l of locations) {
      if (!entities.isIncluded("setting_location", l.id)) continue;
      entries.push({
        key: `location-${l.id}`,
        section: "Локации",
        title: l.name,
        body: l.description ? <div className="muted" style={{ whiteSpace: "pre-wrap" }}><MentionText text={l.description} /></div> : null,
      });
    }
    for (const b of personalities) {
      if (!entities.isIncluded("setting_being", b.id)) continue;
      entries.push({
        key: `being-${b.id}`,
        section: "Личности и Фракции",
        title: b.name,
        body: b.history ? <div className="muted" style={{ whiteSpace: "pre-wrap" }}><MentionText text={b.history} /></div> : null,
      });
    }
    for (const c of communities) {
      if (!entities.isIncluded("setting_community", c.id)) continue;
      entries.push({
        key: `community-${c.id}`,
        section: "Личности и Фракции",
        title: c.name,
        body: c.description ? <div className="muted" style={{ whiteSpace: "pre-wrap" }}><MentionText text={c.description} /></div> : null,
      });
    }
    for (const e of chronicleEvents) {
      if (!entities.isIncluded("setting_calendar_event", e.id)) continue;
      entries.push({
        key: `event-${e.id}`,
        section: "История",
        title: `${formatChronicleDate(e)} — ${e.title}`,
        body: e.description ? <div className="muted" style={{ whiteSpace: "pre-wrap" }}><MentionText text={e.description} /></div> : null,
      });
    }
    return entries;
  }, [locations, personalities, communities, chronicleEvents, formatChronicleDate, entities]);

  const hasSearchResults = q
    ? filteredLocations.length + filteredPersonalities.length + filteredCommunities.length + filteredBestiary.length + filteredEvents.length > 0
    : true;

  if (loading) {
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка">
        <div className="card" style={{ height: 48, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate" }} />
        <div className="card" style={{ height: 48, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate", animationDelay: "120ms" }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span>Не удалось загрузить контент: {loadError}</span>
        <button className="primary" onClick={() => window.location.reload()}>Повторить</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted" style={{ maxWidth: "62ch" }}>
        Сначала включите нужные сущности в панель игроков, затем настройте видимость для каждого игрока.
      </p>
      <label className="row">
        Кампания
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Выберите кампанию…</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.player_count != null ? ` · ${c.player_count} игроков` : ""}{c.system_name ? ` · ${c.system_name}` : ""}
            </option>
          ))}
        </select>
      </label>

      {!campaignId ? (
        campaigns.length === 0 ? (
          <EmptyState
            icon="issueStamp"
            title="КАМПАНИЙ НЕТ"
            hint="Привяжите кампанию к сеттингу, чтобы настроить видимость контента для игроков."
          />
        ) : (
          <p className="muted">Выберите кампанию, чтобы настроить видимость.</p>
        )
      ) : (
        <div className="stack">
          {/* Mode toggle — язычки разделов */}
          <div className="tabs">
            <button className={mode === "include" ? "active" : ""} onClick={() => { setMode("include"); setSelected(new Set()); }}>
              Включение в панель
            </button>
            <button className={mode === "visibility" ? "active" : ""} onClick={() => { setMode("visibility"); setSelected(new Set()); }}>
              Видимость для игроков
            </button>
          </div>

          {/* Toolbar */}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Поиск по сеттингу…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: "1 1 200px" }}
            />
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
            {mode === "visibility" && flatEntries.length > 0 && (
              <button onClick={() => setReaderIndex(0)}>Предпросмотр как игрок</button>
            )}
          </div>

          {q && !hasSearchResults && <p className="muted">Ничего не найдено по «{query}».</p>}

          <Subsection
            title="Локации"
            storageKey={`sp-loc-${settingId}`}
            count={locations.length}
            visibleCount={mode === "visibility" ? visibleLocCount : undefined}
            allKeys={filteredLocations.map((l) => `setting_location:${l.id}` as GrantKey)}
            selected={selected}
            onSelectAll={toggleSelectAll}
          >
            {filteredLocations.map((l) => (
              <Row
                key={l.id}
                to={`/locations/${l.id}`}
                name={l.name}
                campaignId={campaignId}
                targetType="setting_location"
                targetId={l.id}
                roster={roster}
                grants={grants}
                entities={entities}
                selected={selected}
                onSelect={toggleSelect}
                mode={mode}
              />
            ))}
            {locations.length === 0 && <span className="muted">Локаций пока нет.</span>}
            {locations.length > 0 && filteredLocations.length === 0 && q && <span className="muted">Нет совпадений.</span>}
          </Subsection>

          <Subsection
            title="Личности и Фракции"
            storageKey={`sp-pop-${settingId}`}
            count={personalities.length + communities.length}
            visibleCount={mode === "visibility" ? (visiblePersonalityCount + visibleCommunityCount) : undefined}
            allKeys={[
              ...filteredPersonalities.map((b) => `setting_being:${b.id}` as GrantKey),
              ...filteredCommunities.map((c) => `setting_community:${c.id}` as GrantKey),
            ]}
            selected={selected}
            onSelectAll={toggleSelectAll}
          >
            {filteredPersonalities.map((b) => (
              <Row
                key={`being-${b.id}`}
                to={`/beings/${b.id}`}
                name={b.name}
                campaignId={campaignId}
                targetType="setting_being"
                targetId={b.id}
                roster={roster}
                grants={grants}
                entities={entities}
                selected={selected}
                onSelect={toggleSelect}
                mode={mode}
              />
            ))}
            {filteredCommunities.map((c) => (
              <Row
                key={`community-${c.id}`}
                to={`/communities/${c.id}`}
                name={c.name}
                campaignId={campaignId}
                targetType="setting_community"
                targetId={c.id}
                roster={roster}
                grants={grants}
                entities={entities}
                selected={selected}
                onSelect={toggleSelect}
                mode={mode}
              />
            ))}
            {personalities.length === 0 && communities.length === 0 && <span className="muted">Пока никого нет.</span>}
            {(personalities.length > 0 || communities.length > 0) && filteredPersonalities.length === 0 && filteredCommunities.length === 0 && q && <span className="muted">Нет совпадений.</span>}
          </Subsection>

          <Subsection
            title="Бестиарий"
            storageKey={`sp-best-${settingId}`}
            count={bestiary.length}
            visibleCount={mode === "visibility" ? visibleBestiaryCount : undefined}
            allKeys={filteredBestiary.map((b) => `setting_being:${b.id}` as GrantKey)}
            selected={selected}
            onSelectAll={toggleSelectAll}
          >
            {filteredBestiary.map((b) => (
              <Row
                key={b.id}
                to={`/beings/${b.id}`}
                name={b.name}
                campaignId={campaignId}
                targetType="setting_being"
                targetId={b.id}
                roster={roster}
                grants={grants}
                entities={entities}
                selected={selected}
                onSelect={toggleSelect}
                mode={mode}
              />
            ))}
            {bestiary.length === 0 && <span className="muted">Бестиарий пуст.</span>}
            {bestiary.length > 0 && filteredBestiary.length === 0 && q && <span className="muted">Нет совпадений.</span>}
          </Subsection>

          <Subsection
            title="История"
            storageKey={`sp-hist-${settingId}`}
            count={chronicleEvents.length}
            visibleCount={mode === "visibility" ? visibleEventCount : undefined}
            allKeys={filteredEvents.map((e) => `setting_calendar_event:${e.id}` as GrantKey)}
            selected={selected}
            onSelectAll={toggleSelectAll}
          >
            {filteredEvents.map((e) => (
              <Row
                key={e.id}
                name={e.title}
                campaignId={campaignId}
                targetType="setting_calendar_event"
                targetId={e.id}
                roster={roster}
                grants={grants}
                entities={entities}
                selected={selected}
                onSelect={toggleSelect}
                mode={mode}
              />
            ))}
            {chronicleEvents.length === 0 && <span className="muted">В хронике мира пока нет событий.</span>}
            {chronicleEvents.length > 0 && filteredEvents.length === 0 && q && <span className="muted">Нет совпадений.</span>}
          </Subsection>
        </div>
      )}

      {readerIndex != null && (
        <PlayerContentReader
          entries={flatEntries}
          index={readerIndex}
          onNavigate={setReaderIndex}
          onClose={() => setReaderIndex(null)}
        />
      )}

      <FloatingActionBar
        selectedCount={selected.size}
        roster={roster}
        onGrant={mode === "visibility" ? handleBatchGrant : undefined}
        onRevoke={mode === "visibility" ? handleBatchRevoke : undefined}
        onInclude={mode === "include" ? handleBatchInclude : undefined}
        onExclude={mode === "include" ? handleBatchExclude : undefined}
        onClear={clearSelection}
      />
      {alertDialog}
    </div>
  );
}

const Subsection = memo(function Subsection({
  title,
  storageKey,
  count,
  visibleCount,
  allKeys,
  selected,
  onSelectAll,
  children,
}: {
  title: string;
  storageKey: string;
  count: number;
  visibleCount?: number;
  allKeys: GrantKey[];
  selected: Set<GrantKey>;
  onSelectAll: (keys: GrantKey[]) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) !== "closed"; } catch { return true; }
  });

  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      setOpen(v !== "closed");
    } catch { /* noop */ }
  }, [storageKey]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(storageKey, next ? "open" : "closed"); } catch { /* noop */ }
      return next;
    });
  }, [storageKey]);

  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = allKeys.some((k) => selected.has(k));

  return (
    <details className="card" open={open}>
      <summary className="chevron-summary" onClick={(e) => { e.preventDefault(); handleToggle(); }}>
        <span className={`chevron-icon${open ? " is-open" : ""}`} />
        {title}
        {count > 0 && <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", marginLeft: 4 }}>{count}</span>}
        {visibleCount !== undefined && count > 0 && <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", marginLeft: 6 }} title="Показано хотя бы одному игроку">{visibleCount}/{count}</span>}
        {allKeys.length > 0 && (
          <label
            className="subsection-select-all"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
              onChange={() => onSelectAll(allKeys)}
            />
          </label>
        )}
      </summary>
      {open && (
        <div className="stack" style={{ marginTop: 8 }}>
          {children}
        </div>
      )}
    </details>
  );
});

const Row = memo(function Row({
  to,
  name,
  campaignId,
  targetType,
  targetId,
  roster,
  grants,
  entities,
  selected,
  onSelect,
  mode,
}: {
  to?: string;
  name: string;
  campaignId: number;
  targetType: VisibilityTargetType;
  targetId: number;
  roster: RosterPlayer[];
  grants: ReturnType<typeof useCampaignGrants>;
  entities: ReturnType<typeof useCampaignSettingEntities>;
  selected: Set<GrantKey>;
  onSelect: (key: GrantKey) => void;
  mode: ModeKey;
}) {
  const key: GrantKey = `${targetType}:${targetId}`;
  const isChecked = selected.has(key);
  const isIncl = entities.isIncluded(targetType, targetId);
  const grantedToAny = grants.isGrantedToAny(targetType, targetId);
  const grantedCount = grants.getGrantedPlayerIds(targetType, targetId).length;

  return (
    <div className="row setting-player-row" style={{ justifyContent: "space-between" }}>
      <div className="row setting-player-row-select" style={{ gap: 6, flex: 1, minWidth: 0 }}>
        <label className="row" style={{ gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onSelect(key)}
          />
        </label>
        {to ? <Link to={to}>{name}</Link> : <span>{name}</span>}
        {mode === "visibility" && grantedToAny && <span className="visibility-dot" title="Показано игроку" />}
        {mode === "visibility" && roster.length > 0 && (
          <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", whiteSpace: "nowrap" }} title={`${grantedCount} из ${roster.length} игроков видят`}>
            {grantedCount}/{roster.length}
          </span>
        )}
      </div>
      {mode === "include" ? (
        <button
          className={isIncl ? "active" : ""}
          onClick={() => isIncl ? entities.remove(targetType, targetId) : entities.add(targetType, targetId)}
          title={isIncl ? "Убрать из панели игроков" : "Добавить в панель игроков"}
          style={{ fontSize: "var(--fs-meta)", padding: "4px 10px", lineHeight: 1 }}
        >
          {isIncl ? "В панели" : "+ Добавить"}
        </button>
      ) : (
        <PlayerVisibilityPicker campaignId={campaignId} targetType={targetType} targetId={targetId} roster={roster} />
      )}
    </div>
  );
});
