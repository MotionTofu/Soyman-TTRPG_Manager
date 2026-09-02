import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "../components/mentions/MentionText";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EmptyState } from "../components/EmptyState";
import { PlayerContentReader, type ReaderEntry } from "../components/PlayerContentReader";
import { toLocalDateKey } from "../utils/date";
import { useTabState } from "../hooks/useTabState";
import { CharacterJournal } from "../components/player/CharacterJournal";
import type {
  PartyMember,
  PlayerSection,
  SettingPlayerContent,
  VisibleCampaignContent,
  WorldExplorationTag,
} from "../types";

function formatDate(y: number, m: number, d: number): string {
  return `${d}.${m}.${y}`;
}

// Даты сессий приходят как `YYYY-MM-DD`; на экране рядом с ними живут внутримировые
// даты в виде `д.м.год`, и два разных формата в одной карточке читаются как ошибка.
function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

const TABS = ["От мастера", "Путевые заметки", "Группа"] as const;
type Tab = (typeof TABS)[number];

// Вкладка звалась «Исследование мира», пока была картотекой мира на всю
// партию. Сохранённые ссылки на прежнее имя должны открывать её же, а не
// падать на «От мастера».
const TAB_ALIASES = { "Исследование мира": "Путевые заметки" } as const;

// Player-role campaign view: everything the GM has explicitly revealed
// (sessions, secrets, lore articles, "Для игроков" sections), плюс «Путевые
// заметки» — личный дневник персонажа (components/player/CharacterJournal) —
// и остальная партия. Всё через /api/player/*, где фильтрует сервер. Это то,
// что мастеру показала бы CampaignDetailPage; игрок в GM-роут
// /api/campaigns/:id не ходит вовсе (см. services/playerAccess.ts).
export function PlayerCampaignPage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const invalidCampaignId = !Number.isFinite(campaignId);
  const [tab, setTab] = useTabState<Tab>(TABS, "От мастера", TAB_ALIASES);
  const [content, setContent] = useState<VisibleCampaignContent | null>(null);
  const [sections, setSections] = useState<PlayerSection[]>([]);
  const [setting, setSetting] = useState<SettingPlayerContent | null>(null);
  const [party, setParty] = useState<PartyMember[]>([]);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [readerIndex, setReaderIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [masterQuery, setMasterQuery] = useState("");
  // Счётчик, а не общий стейт записей: страница заметки не показывает и не
  // хранит — ей нужно только сказать вкладке «перечитайся», когда со статьи
  // лора ушла новая заметка.
  const [journalRefresh, setJournalRefresh] = useState(0);
  const [loreToast, setLoreToast] = useState<string | null>(null);
  // Чьи заметки сейчас открыты — знает вкладка, а нужно это и здесь: запись
  // со статьи лора должна лечь к тому же персонажу, а не в «ничьи».
  const [journalCharacterId, setJournalCharacterId] = useState<number | null>(null);

  useEffect(() => {
    if (invalidCampaignId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setLoadError(null);

    Promise.all([
      api.get<VisibleCampaignContent>(`/player/campaigns/${campaignId}/visible`, { signal: ac.signal } as RequestInit).then(setContent),
      api.get<PlayerSection[]>(`/player/campaigns/${campaignId}/player-sections`, { signal: ac.signal } as RequestInit).then(setSections),
      api.get<SettingPlayerContent>(`/player/campaigns/${campaignId}/setting-player-content`, { signal: ac.signal } as RequestInit).then(setSetting),
      api.get<PartyMember[]>(`/player/campaigns/${campaignId}/party`, { signal: ac.signal } as RequestInit).then(setParty),
    ])
      .then(() => setLoading(false))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setLoadError(String(e instanceof Error ? e.message : e));
        setLoading(false);
      });

    return () => ac.abort();
  }, [campaignId, invalidCampaignId]);

  // Всё производное считается здесь, ВЫШЕ ранних return ниже по файлу.
  // Порядок хуков в React обязан совпадать от рендера к рендеру: пока эти
  // useMemo стояли под `if (loading) return`, первый рендер выполнял их
  // меньше, чем второй, и страница целиком падала в ErrorBoundary
  // («Rendered more hooks than during the previous render»). Отсюда же и
  // `content?.` вместо `content.` — до загрузки его ещё нет.
  const nothingVisible =
    (content?.sessions?.length ?? 0) === 0 &&
    (content?.secrets?.length ?? 0) === 0 &&
    (content?.locationArticles?.length ?? 0) === 0 &&
    (content?.beingArticles?.length ?? 0) === 0 &&
    (content?.chronicleEvents?.length ?? 0) === 0 &&
    (sections?.length ?? 0) === 0 &&
    (!setting ||
      ((setting.locations?.length ?? 0) === 0 &&
        (setting.beings?.length ?? 0) === 0 &&
        (setting.communities?.length ?? 0) === 0 &&
        (setting.chronicleEvents?.length ?? 0) === 0));

  const today = toLocalDateKey();
  const nextSession = useMemo(
    () =>
      content
        ? [...content.schedule]
            .filter((s) => s.status === "planned" && s.date >= today)
            .sort((a, b) => a.date.localeCompare(b.date))[0]
        : undefined,
    [content, today]
  );

  // Прошлая сессия рядом со следующей: игрок открывает раздел, чтобы
  // вспомнить, чем кончилось, а не только узнать, когда собираемся. Отменённые
  // не в счёт — они не «были». Данные лежали в `schedule` с самого начала.
  const prevSession = useMemo(
    () =>
      content
        ? [...content.schedule]
            .filter((s) => s.status !== "cancelled" && s.date < today)
            .sort((a, b) => b.date.localeCompare(a.date))[0]
        : undefined,
    [content, today]
  );

  // Flat, ordered entries for the full-screen reader (see
  // components/PlayerContentReader.tsx) grouped back into accordion
  // sections for the collapsed list view — each group only shows its item
  // titles until opened, and clicking an item jumps the reader straight to
  // its position in the flat list so prev/next carries across section
  // boundaries instead of stopping at the section it was opened from.
  // Memoized — building ReaderEntry bodies allocates arrays on every keystroke (newName) otherwise.
  const { groupsWithOffset, flatEntries } = useMemo(() => {
    const groups: { key: string; label: string; entries: ReaderEntry[] }[] = [];
    if (content) {
      if (content.sessions.length > 0) {
        groups.push({
          key: "sessions",
          label: "Сессии",
          entries: content.sessions.map((s) => ({
            key: `session-${s.id}`,
            section: "Сессии",
            title: s.title ? `${s.date} — ${s.title}` : s.date,
            body: (
              <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={s.main_events} />
              </div>
            ),
          })),
        });
      }
      if (content.chronicleEvents.length > 0) {
        groups.push({
          key: "chronicle",
          label: "Хроника мира",
          entries: content.chronicleEvents.map((e) => ({
            key: `chronicle-${e.id}`,
            section: "Хроника мира",
            title: e.title,
            body: (
              <div className="stack" style={{ gap: 10 }}>
                <span className="muted">{formatDate(e.inworld_year, e.inworld_month, e.inworld_day)}</span>
                {e.description && (
                  <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                    <MentionText text={e.description} />
                  </div>
                )}
              </div>
            ),
          })),
        });
      }
      if (content.locationArticles.length > 0) {
        groups.push({
          key: "locations",
          label: "Локации",
          entries: content.locationArticles.map((a) => ({
            key: `loc-${a.id}`,
            section: "Локации",
            title: a.title ? `${a.location_name} — ${a.title}` : a.location_name ?? "Локация",
            body: (
              <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={a.content} />
              </div>
            ),
          })),
        });
      }
      if (content.beingArticles.length > 0) {
        groups.push({
          key: "beings",
          label: "НПЦ",
          entries: content.beingArticles.map((a) => ({
            key: `being-${a.id}`,
            section: "НПЦ",
            title: a.title ? `${a.being_name} — ${a.title}` : a.being_name ?? "НПЦ",
            body: (
              <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={a.content} />
              </div>
            ),
          })),
        });
      }
      if (content.secrets.length > 0) {
        groups.push({
          key: "secrets",
          label: "Раскрытые тайны",
          entries: content.secrets.map((s) => ({
            key: `secret-${s.id}`,
            section: "Раскрытые тайны",
            title: s.title,
            body: s.content ? (
              <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={s.content} />
              </div>
            ) : null,
          })),
        });
      }
    }
    for (const s of sections) {
      if (s.kind === "gallery") {
        const imgs = s.images ?? [];
        if (imgs.length === 0) continue;
        groups.push({
          key: `section-${s.id}`,
          label: s.name,
          entries: imgs.map((img) => ({
            key: `section-${s.id}-img-${img.id}`,
            section: s.name,
            title: img.caption || "Изображение",
            body: <img src={img.image_url} alt={img.caption} style={{ maxWidth: "100%" }} />,
          })),
        });
      } else {
        const arts = s.articles ?? [];
        if (arts.length === 0) continue;
        groups.push({
          key: `section-${s.id}`,
          label: s.name,
          entries: arts.map((a) => ({
            key: `section-${s.id}-art-${a.id}`,
            section: s.name,
            title: a.title || "Без названия",
            body: (
              <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={a.content} />
              </div>
            ),
          })),
        });
      }
    }
    if (setting) {
      if (setting.locations.length > 0) {
        groups.push({
          key: "setting-locations",
          label: "Локации сеттинга",
          entries: setting.locations.map((l) => ({
            key: `setting-loc-${l.id}`,
            section: "Локации сеттинга",
            title: l.name,
            body: l.description ? (
              <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={l.description} />
              </div>
            ) : null,
          })),
        });
      }
      if (setting.beings.length > 0 || setting.communities.length > 0) {
        groups.push({
          key: "setting-factions",
          label: "Личности и фракции",
          entries: [
            ...setting.beings.map((b) => ({
              key: `setting-being-${b.id}`,
              section: "Личности и фракции",
              title: b.name,
              body: b.history ? (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={b.history} />
                </div>
              ) : null,
            })),
            ...setting.communities.map((c) => ({
              key: `setting-community-${c.id}`,
              section: "Личности и фракции",
              title: c.name,
              body: c.description ? (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={c.description} />
                </div>
              ) : null,
            })),
          ],
        });
      }
      if (setting.chronicleEvents.length > 0) {
        groups.push({
          key: "setting-history",
          label: "История",
          entries: setting.chronicleEvents.map((e) => ({
            key: `setting-event-${e.id}`,
            section: "История",
            title: e.title,
            body: (
              <div className="stack" style={{ gap: 10 }}>
                <span className="muted">{formatDate(e.inworld_year, e.inworld_month, e.inworld_day)}</span>
                {e.description && (
                  <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                    <MentionText text={e.description} />
                  </div>
                )}
              </div>
            ),
          })),
        });
      }
    }
    let runningOffset = 0;
    const groupsWithOffset = groups.map((g) => {
      const offset = runningOffset;
      runningOffset += g.entries.length;
      return { ...g, offset };
    });
    const flatEntries = groupsWithOffset.flatMap((g) => g.entries);
    return { groupsWithOffset, flatEntries };
  }, [content, sections, setting]);

  // Phase 3.1 — последние 3 раскрытия от мастера для виджета «вспомнить за минуту»
  const recentMaster = useMemo(() => {
    if (!content) return [];
    const out: ReaderEntry[] = [];
    // sessions are already visible only if main_events_visible=1, sorted DESC on server
    for (const s of content.sessions.slice(0, 2)) {
      out.push({
        key: `recent-session-${s.id}`,
        section: "Сессии",
        title: s.title ? `${s.date} — ${s.title}` : s.date,
        body: (
          <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={s.main_events} />
          </div>
        ),
      });
    }
    for (const sec of content.secrets.slice(0, 2)) {
      out.push({
        key: `recent-secret-${sec.id}`,
        section: "Раскрытые тайны",
        title: sec.title,
        body: sec.content ? (
          <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={sec.content} />
          </div>
        ) : null,
      });
    }
    for (const ev of content.chronicleEvents.slice(0, 2)) {
      out.push({
        key: `recent-chronicle-${ev.id}`,
        section: "Хроника мира",
        title: ev.title,
        body: (
          <div className="stack" style={{ gap: 10 }}>
            <span className="muted">{formatDate(ev.inworld_year, ev.inworld_month, ev.inworld_day)}</span>
            {ev.description && (
              <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={ev.description} />
              </div>
            )}
          </div>
        ),
      });
    }
    return out.slice(0, 3);
  }, [content]);

  // Phase 3.3 — фильтр «От мастера» по заголовку/секции
  const filteredGroupsWithOffset = useMemo(() => {
    const q = masterQuery.trim().toLowerCase();
    if (!q) return groupsWithOffset;
    return groupsWithOffset
      .map((g) => ({
        ...g,
        entries: g.entries.filter(
          (e) => e.title.toLowerCase().includes(q) || e.section.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.entries.length > 0)
      .map((g, idx, arr) => {
        // recompute offsets after filtering
        let off = 0;
        for (let i = 0; i < idx; i++) off += arr[i].entries.length;
        return { ...g, offset: off };
      });
  }, [groupsWithOffset, masterQuery]);

  const filteredFlatEntries = useMemo(
    () => filteredGroupsWithOffset.flatMap((g) => g.entries),
    [filteredGroupsWithOffset]
  );

  // Один и тот же список отдаётся читалке и адресуется индексами: пока
  // «Последнее от мастера» искало индекс в полном flatEntries, а читалка
  // получала отфильтрованный, при активном поиске открывалась чужая статья.
  const readerEntries = masterQuery.trim() ? filteredFlatEntries : flatEntries;

  // «+ В журнал» на строке лора. Заголовком становится название статьи, текст
  // остаётся пустым — дневник про то, что человек подумал, а не про то, откуда
  // он это взял. Вкладка НЕ переключается: игрок читает, и выдёргивать его из
  // чтения ради подтверждения нельзя — вместо этого всплывает тост.
  const handleAddFromLore = useCallback(
    async (entry: ReaderEntry) => {
      const section = entry.section.toLowerCase();
      let kind: WorldExplorationTag = "";
      if (section.includes("локац")) kind = "location";
      else if (section.includes("нпц") || section.includes("личност")) kind = "being";
      else if (section.includes("сесс") || section.includes("хроник") || section.includes("истор") || section.includes("тайн")) kind = "event";
      try {
        await api.post(`/player/campaigns/${campaignId}/world-entries`, {
          character_id: journalCharacterId,
          kind,
          name: entry.title.slice(0, 80),
          description: "",
        });
        setJournalRefresh((n) => n + 1);
        setLoreToast(`«${entry.title}» — в путевых заметках`);
      } catch {
        setLoreToast("Не удалось записать — попробуйте ещё раз");
      }
    },
    [campaignId, journalCharacterId]
  );

  // Тост живёт четыре секунды: он сообщает об уже случившемся и ничего не
  // спрашивает, поэтому перекрывать им чтение дольше незачем.
  useEffect(() => {
    if (!loreToast) return;
    const t = window.setTimeout(() => setLoreToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [loreToast]);

  if (invalidCampaignId) {
    return (
      <div className="stack">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Кампания" }]} />
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Кампания не найдена — проверьте ссылку.</span>
          <Link to="/campaigns" className="primary" style={{ display: "inline-block", padding: "8px 16px", border: "1px solid var(--line)", background: "var(--paper-2)", color: "var(--ink)", textDecoration: "none" }}>
            К списку кампаний
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка кампании">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Загрузка…" }]} />
        <div className="card" style={{ height: 28, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate" }} />
        <div className="card" style={{ height: 44, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate", animationDelay: "80ms" }} />
        <div className="card" style={{ height: 160, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate", animationDelay: "160ms" }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="stack">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: content?.campaign.name ?? "Кампания" }]} />
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Не удалось загрузить кампанию: {loadError}</span>
          <button className="primary" onClick={() => window.location.reload()}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="stack">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Кампания" }]} />
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Кампания не найдена.</span>
          <Link to="/campaigns" style={{ padding: "8px 16px", border: "1px solid var(--line)", background: "var(--paper-2)", color: "var(--ink)", textDecoration: "none" }}>К списку кампаний</Link>
        </div>
      </div>
    );
  }


  return (
    <div className="stack">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Кампании", to: "/campaigns" }, { label: content.campaign.name }]} />
      <h1 style={{ margin: 0 }}>{content.campaign.name}</h1>

      <div className="tabs" role="tablist" aria-label="Разделы кампании">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "От мастера" && (
        <div className="stack">
          <div className="card stack" style={{ gap: 6 }}>
            {prevSession && (
              <div className="row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Прошлая
                </span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{formatIsoDate(prevSession.date)}</span>
                {prevSession.title && <span>— {prevSession.title}</span>}
                {(() => {
                  // Сводка прошлой сессии показывается, только если мастер её
                  // открыл (main_events_visible) — тогда она уже лежит в ленте
                  // читалки, и её место в ней мы и открываем.
                  const idx = flatEntries.findIndex((e) => e.key === `session-${prevSession.id}`);
                  if (idx === -1) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setMasterQuery("");
                        setReaderIndex(idx);
                      }}
                      style={{ fontSize: "var(--fs-meta)", padding: "2px 8px", height: 24 }}
                    >
                      Чем кончилось
                    </button>
                  );
                })()}
              </div>
            )}
            <div className="row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Следующая
              </span>
              {nextSession ? (
                <>
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {formatIsoDate(nextSession.date)}
                    {nextSession.start_time ? ` ${nextSession.start_time}` : ""}
                  </span>
                  {nextSession.title && <span>— {nextSession.title}</span>}
                </>
              ) : (
                <span className="muted">пока не назначена</span>
              )}
            </div>
          </div>

          {nothingVisible && (
            <EmptyState
              icon="issueStamp"
              title="МАСТЕР ПОКА МОЛЧИТ"
              hint="Мастер пока ничего не открыл игрокам в этой кампании — попросите его поделиться лором."
            />
          )}

          {!nothingVisible && recentMaster.length > 0 && (
            <div className="card stack" style={{ gap: 8, borderLeft: "3px solid var(--accent)" }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
                Последнее от мастера
              </span>
              {recentMaster.map((e) => (
                <button
                  key={e.key}
                  type="button"
                  className="player-section-item"
                  style={{ textAlign: "left" }}
                  onClick={() => {
                    const inReader = readerEntries.findIndex((fe) => fe.key === e.key);
                    if (inReader !== -1) {
                      setReaderIndex(inReader);
                      return;
                    }
                    // Статья отфильтрована поиском: снимаем фильтр, иначе индекс
                    // полного списка попадёт в отфильтрованный.
                    const idx = flatEntries.findIndex((fe) => fe.key === e.key);
                    if (idx === -1) return;
                    setMasterQuery("");
                    setReaderIndex(idx);
                  }}
                >
                  <span style={{ fontSize: "var(--fs-meta)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{e.section}</span> — {e.title}
                </button>
              ))}
            </div>
          )}

          {!nothingVisible && groupsWithOffset.length > 0 && (
            <div className="row" style={{ gap: 8 }}>
              <input
                className="res-toolbar__search"
                placeholder="Поиск по открытому…"
                value={masterQuery}
                onChange={(e) => setMasterQuery(e.target.value)}
                aria-label="Поиск по открытому лору"
                style={{ flex: 1 }}
              />
              {masterQuery && (
                <button onClick={() => setMasterQuery("")} style={{ fontSize: "var(--fs-meta)", padding: "2px 8px", height: 26 }}>
                  Сбросить
                </button>
              )}
              <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", whiteSpace: "nowrap" }}>
                {filteredFlatEntries.length} / {flatEntries.length}
              </span>
            </div>
          )}

          {filteredGroupsWithOffset.length === 0 && !nothingVisible && masterQuery.trim() && (
            <p className="muted">По «{masterQuery.trim()}» ничего не найдено.</p>
          )}

          {filteredGroupsWithOffset.map((g) => (
            <div key={g.key} className="stack" style={{ gap: 4 }}>
              <button
                type="button"
                className={`player-section-header${openGroup === g.key ? " open" : ""}`}
                onClick={() => setOpenGroup(openGroup === g.key ? null : g.key)}
                aria-expanded={openGroup === g.key}
                aria-controls={`player-section-${g.key}`}
              >
                {g.label} <span className="muted" style={{ fontFamily: "var(--font-mono)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>· {g.entries.length}</span>
              </button>
              {openGroup === g.key && (
                <div id={`player-section-${g.key}`} className="player-section-items">
                  {g.entries.map((e, i) => (
                    <div key={e.key} className="row" style={{ gap: 4, alignItems: "stretch" }}>
                      <button
                        type="button"
                        className="player-section-item"
                        onClick={() => setReaderIndex(g.offset + i)}
                        style={{ flex: "1 1 0", minWidth: 0 }}
                      >
                        {e.title}
                      </button>
                      <button
                        type="button"
                        title="Добавить в мой журнал"
                        aria-label={`Добавить «${e.title}» в мой журнал`}
                        onClick={() => handleAddFromLore(e)}
                        style={{ flex: "0 0 auto", fontSize: "var(--fs-meta)", padding: "6px 8px", border: "1px solid var(--line)", background: "var(--paper-2)", color: "var(--muted)" }}
                      >
                        + В журнал
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {readerIndex != null && (
        <PlayerContentReader
          entries={readerEntries}
          index={readerIndex}
          onNavigate={setReaderIndex}
          onClose={() => setReaderIndex(null)}
        />
      )}

      {tab === "Путевые заметки" && (
        <CharacterJournal
          campaignId={campaignId}
          schedule={content.schedule}
          refreshKey={journalRefresh}
          onActiveCharacterChange={setJournalCharacterId}
        />
      )}

      {tab === "Группа" && (
        <div className="stack">
          {party.length === 0 && (
            <EmptyState
              icon="splatter"
              title="ГРУППА ПОКА ОДНА"
              hint="Кроме вас, в кампании пока нет других персонажей."
            />
          )}
          <div className="grid-cards">
            {party.map((m) => (
              <div key={m.id} className="card row">
                {m.avatar_image_url ? (
                  <img
                    src={m.avatar_image_url}
                    alt=""
                    style={{ width: 48, height: 48, borderRadius: 0, objectFit: "cover", border: "1px solid var(--line)" }}
                  />
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: 0, background: "var(--bg-elevated)", border: "1px solid var(--line)" }} />
                )}
                <div className="stack" style={{ gap: 2 }}>
                  <strong>{m.character_name}</strong>
                  <span className="muted">{m.player_name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {loreToast && (
        <div className="archive-toast" role="status" aria-live="polite">
          <span className="archive-toast__msg">{loreToast}</span>
          <div className="archive-toast__actions">
            <button className="archive-toast__undo" onClick={() => setTab("Путевые заметки")}>
              Открыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
