import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "../components/mentions/MentionText";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { formatEventDate } from "../inworldCalendar";
import { PlayerContentReader, type ReaderEntry } from "../components/PlayerContentReader";
import type {
  SettingPlayerBeing,
  SettingPlayerChronicleEvent,
  SettingPlayerCommunity,
  SettingPlayerLocation,
} from "../types";

interface PlayerSettingDetail {
  setting: { id: number; name: string };
  locations: SettingPlayerLocation[];
  beings: SettingPlayerBeing[];
  communities: SettingPlayerCommunity[];
  chronicleEvents: SettingPlayerChronicleEvent[];
}

// Player-role setting view — what's been revealed across every campaign of
// theirs that uses this setting (grants are per campaign+player, a location
// can be shown in one campaign and hidden in another sharing the same
// setting; see GET /api/player/settings/:id for the union logic).
export function PlayerSettingPage() {
  const { id } = useParams();
  const settingId = Number(id);
  const [data, setData] = useState<PlayerSettingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [readerIndex, setReaderIndex] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const calendar = useSettingCalendar(Number.isFinite(settingId) ? settingId : 0);

  useEffect(() => {
    if (!Number.isFinite(settingId)) {
      setLoadError("Некорректный ID сеттинга.");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    api
      .get<PlayerSettingDetail>(`/player/settings/${settingId}`, { signal: controller.signal })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setLoadError(String(e instanceof Error ? e.message : e));
        setLoading(false);
      });
    return () => controller.abort();
  }, [settingId]);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = useCallback(() => window.scrollTo({ top: 0, behavior: "smooth" }), []);

  if (loading) {
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка сеттинга">
        <Breadcrumbs items={[{ label: "Сеттинги", to: "/player/settings" }]} />
        <div className="card" style={{ height: 48, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate" }} />
        <div className="card" style={{ height: 220, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate", animationDelay: "120ms" }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="stack">
        <Breadcrumbs items={[{ label: "Сеттинги", to: "/player/settings" }]} />
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Не удалось загрузить сеттинг: {loadError}</span>
          <button className="primary" onClick={() => window.location.reload()}>Повторить</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const nothingVisible =
    data.locations.length === 0 &&
    data.beings.length === 0 &&
    data.communities.length === 0 &&
    data.chronicleEvents.length === 0;

  const formatChronicleDate = (e: SettingPlayerChronicleEvent) =>
    calendar ? formatEventDate(e.inworld_year, e.inworld_month, e.inworld_day, calendar.months) : `${e.inworld_year}.${e.inworld_month}.${e.inworld_day}`;

  const q = query.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);

  // Filtered views for search
  const filteredLocations = data ? data.locations.filter((l) => match(l.name)) : [];
  const filteredBeings = data ? data.beings.filter((b) => match(b.name)) : [];
  const filteredCommunities = data ? data.communities.filter((c) => match(c.name)) : [];
  const filteredEvents = data ? data.chronicleEvents.filter((e) => match(e.title)) : [];
  const hasResults = filteredLocations.length + filteredBeings.length + filteredCommunities.length + filteredEvents.length > 0;

  const flatEntries: ReaderEntry[] = [];
  if (data) {
    for (const l of filteredLocations) {
      flatEntries.push({
        key: `location-${l.id}`,
        section: "Локации",
        title: l.name,
        body: l.description ? <div className="muted" style={{ whiteSpace: "pre-wrap" }}><MentionText text={l.description} /></div> : null,
      });
    }
    for (const b of filteredBeings) {
      flatEntries.push({
        key: `being-${b.id}`,
        section: "Личности и Фракции",
        title: b.name,
        body: b.history ? <div className="muted" style={{ whiteSpace: "pre-wrap" }}><MentionText text={b.history} /></div> : null,
      });
    }
    for (const c of filteredCommunities) {
      flatEntries.push({
        key: `community-${c.id}`,
        section: "Личности и Фракции",
        title: c.name,
        body: c.description ? <div className="muted" style={{ whiteSpace: "pre-wrap" }}><MentionText text={c.description} /></div> : null,
      });
    }
    for (const e of filteredEvents) {
      flatEntries.push({
        key: `event-${e.id}`,
        section: "История",
        title: `${formatChronicleDate(e)} — ${e.title}`,
        body: e.description ? <div className="muted" style={{ whiteSpace: "pre-wrap" }}><MentionText text={e.description} /></div> : null,
      });
    }
  }

  return (
    <div className="stack">
      <Breadcrumbs items={[{ label: "Сеттинги", to: "/player/settings" }, { label: data.setting.name }]} />
      <h1 style={{ margin: 0 }}>{data.setting.name}</h1>
      {!nothingVisible && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="Поиск по сеттингу…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: "1 1 200px" }}
            aria-label="Поиск по сеттингу"
          />
          {query && <button onClick={() => setQuery("")}>Сбросить</button>}
          {flatEntries.length > 0 && (
            <button onClick={() => setReaderIndex(0)}>Читать как книгу</button>
          )}
        </div>
      )}
      {!nothingVisible && (
        <nav className="row" style={{ gap: 8, flexWrap: "wrap" }} aria-label="Разделы">
          {data.locations.length > 0 && <a href="#ps-locations">Локации ({data.locations.length})</a>}
          {(data.beings.length > 0 || data.communities.length > 0) && <a href="#ps-population">Личности и фракции ({data.beings.length + data.communities.length})</a>}
          {data.chronicleEvents.length > 0 && <a href="#ps-history">История ({data.chronicleEvents.length})</a>}
        </nav>
      )}
      {q && !hasResults && <p className="muted">Ничего не найдено по «{query}».</p>}

      {nothingVisible && (
        <div className="empty-state">
          <h2 className="empty-state-title">ПОКА НИЧЕГО</h2>
          <p className="empty-state-hint muted">Мастер ещё не открыл вам записи этого сеттинга.<br />По мере приключений контент будет появляться здесь.</p>
        </div>
      )}

      {filteredLocations.length > 0 && (
        <div id="ps-locations" className="card stack" style={{ scrollMarginTop: 60 }}>
          <div className="card-header--inverted">
            <span className="card-header--inverted-label">Локации</span>
            <span className="card-header--inverted-count">{filteredLocations.length}{q ? ` / ${data.locations.length}` : ""}</span>
          </div>
          {filteredLocations.map((l) => (
            <div key={l.id} className="stack" style={{ gap: 2 }}>
              <strong>{l.name}</strong>
              {l.description && (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={l.description} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {q && data.locations.length > 0 && filteredLocations.length === 0 && <p className="muted">В Локациях нет совпадений.</p>}

      {(filteredBeings.length > 0 || filteredCommunities.length > 0) && (
        <div id="ps-population" className="card stack" style={{ scrollMarginTop: 60 }}>
          <div className="card-header--inverted">
            <span className="card-header--inverted-label">Личности и фракции</span>
            <span className="card-header--inverted-count">{filteredBeings.length + filteredCommunities.length}{q ? ` / ${data.beings.length + data.communities.length}` : ""}</span>
          </div>
          {filteredBeings.map((b) => (
            <div key={`being-${b.id}`} className="stack" style={{ gap: 2 }}>
              <strong>{b.name}</strong>
              {b.history && (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={b.history} />
                </div>
              )}
            </div>
          ))}
          {filteredCommunities.map((c) => (
            <div key={`community-${c.id}`} className="stack" style={{ gap: 2 }}>
              <strong>{c.name}</strong>
              {c.description && (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={c.description} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {q && (data.beings.length + data.communities.length) > 0 && filteredBeings.length === 0 && filteredCommunities.length === 0 && <p className="muted">В Личностях и фракциях нет совпадений.</p>}

      {filteredEvents.length > 0 && (
        <div id="ps-history" className="card stack" style={{ scrollMarginTop: 60 }}>
          <div className="card-header--inverted">
            <span className="card-header--inverted-label">История</span>
            <span className="card-header--inverted-count">{filteredEvents.length}{q ? ` / ${data.chronicleEvents.length}` : ""}</span>
          </div>
          {filteredEvents.map((e) => (
            <div key={e.id} className="stack" style={{ gap: 2 }}>
              <span>
                {formatChronicleDate(e)} — <strong>{e.title}</strong>
              </span>
              {e.description && (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={e.description} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {q && data.chronicleEvents.length > 0 && filteredEvents.length === 0 && <p className="muted">В Истории нет совпадений.</p>}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="setting-scroll-top"
          aria-label="Наверх"
        >
          ↑
        </button>
      )}
      {readerIndex != null && (
        <PlayerContentReader
          entries={flatEntries}
          index={readerIndex}
          onNavigate={setReaderIndex}
          onClose={() => setReaderIndex(null)}
        />
      )}
    </div>
  );
}
