import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router-dom";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { journalAffects, playerCampaignPaths } from "../data/playerCampaign";
import { MentionText } from "../components/mentions/MentionText";
import { EntityPage } from "../components/EntityPage";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EmptyState } from "../components/EmptyState";
import { PlayerContentReader, type ReaderEntry } from "../components/PlayerContentReader";
import { toLocalDateKey } from "../utils/date";
import { useTabState } from "../hooks/useTabState";
import { CampaignJournal } from "../components/player/CampaignJournal";
import { buildSettingReaderGroups } from "../components/player/settingReaderEntries";
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

// Дневник кампании (Кабинет игрока, 2026-09-12, шаг 4): Лента и папки игрока,
// две постоянные — «Мир» (выдача из сеттинга) и «От мастера» (то, что Мастер
// выдаёт в руки) — плюс «Группа». Имена ровно эти: «Лор» означает и то и
// другое сразу, то есть не различает там, где нужно различать.
// Вкладка звалась «Путевые заметки», пока дневник делился по персонажам;
// сохранённые ссылки должны открывать Ленту, а не падать.
const TAB_ALIASES = { "Исследование мира": "Лента", "Путевые заметки": "Лента" } as const;

// Player-role campaign view: everything the GM has explicitly revealed.
// Всё через /api/player/*, где фильтрует сервер. Это то, что мастеру показала
// бы CampaignDetailPage; игрок в GM-роут /api/campaigns/:id не ходит вовсе
// (см. services/playerAccess.ts).
export function PlayerCampaignPage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const invalidCampaignId = !Number.isFinite(campaignId);
  // Всё выданное — ресурсами слоя: сигнал сервера «кампания изменилась»
  // перечитывает их на открытом экране сам (data/syncAffects.ts), игроку не
  // нужно перезагружать страницу, чтобы увидеть выданное Мастером.
  const id4 = invalidCampaignId ? null : campaignId;
  const contentState = useResource<VisibleCampaignContent>(id4 == null ? null : playerCampaignPaths.visible(id4));
  const sectionsState = useResource<PlayerSection[]>(id4 == null ? null : playerCampaignPaths.sections(id4));
  const settingState = useResource<SettingPlayerContent>(id4 == null ? null : playerCampaignPaths.setting(id4));
  const partyState = useResource<PartyMember[]>(id4 == null ? null : playerCampaignPaths.party(id4));
  const content = contentState.data ?? null;
  const sections = sectionsState.data ?? NO_SECTIONS;
  const setting = settingState.data ?? null;
  const party = partyState.data ?? NO_PARTY;
  const all = [contentState, sectionsState, settingState, partyState];
  // «Загрузка» — только первая: фоновое перечитывание по сигналу экран не гасит.
  const loading = all.some((q) => q.loading);
  const loadError = all.find((q) => q.error)?.error ?? null;
  const afterWrite = useAfterWrite();
  const [loreToast, setLoreToast] = useState<string | null>(null);
  // Чьим именем пишется новое и куда падает «+ В журнал» со статей лора.
  const [writingCharacterId, setWritingCharacterId] = useState<number | null>(null);
  // Вкладки-папки дневника — из записей (CampaignJournal докладывает).
  const [folders, setFolders] = useState<string[]>([]);

  const tabs = useMemo(() => ["Лента", ...folders, "Мир", "От мастера", "Группа"], [folders]);
  const [tab, setTab] = useTabState(tabs, "Лента", TAB_ALIASES);
  // Папка вкладки: именная — сама, остальное — Лента (null).
  const activeFolder = folders.includes(tab) ? tab : null;

  const handleFoldersKnown = useCallback((next: string[]) => {
    setFolders((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);

  // Всё производное считается здесь, ВЫШЕ ранних return ниже по файлу.
  // Порядок хуков в React обязан совпадать от рендера к рендеру: пока эти
  // useMemo стояли под `if (loading) return`, первый рендер выполнял их
  // меньше, чем второй, и страница целиком падала в ErrorBoundary
  // («Rendered more hooks than during the previous render»). Отсюда же и
  // `content?.` вместо `content.` — до загрузки его ещё нет.
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

  // «От мастера»: сессии, хроника, статьи лора, тайны и разделы. Мир сюда не
  // входит — у него своя постоянная вкладка.
  const contentGroups = useMemo(() => {
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
    return groups;
  }, [content, sections]);

  // Мир — общим строителем с превью «Глазами игрока»: превью обязано
  // показывать то же, что видит игрок, а не свой разбор тех же данных.
  const settingGroups = useMemo(() => buildSettingReaderGroups(setting), [setting]);

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
      // Итог — тостом, не плашкой: игрок читает, и сообщение должно быть
      // рядом с тем, что он нажал.
      try {
        await write.post(`/player/campaigns/${campaignId}/world-entries`, {
          character_id: writingCharacterId,
          kind,
          name: entry.title.slice(0, 80),
          description: "",
        });
        afterWrite(journalAffects(campaignId));
        setLoreToast(`«${entry.title}» — в путевых заметках`);
      } catch {
        setLoreToast("Не удалось записать — попробуйте ещё раз");
      }
    },
    [campaignId, writingCharacterId, afterWrite]
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
        <LoadErrorCard
          message="Кампания не найдена — проверьте ссылку."
          action={
            <Link to="/campaigns" className="primary" style={{ display: "inline-block", padding: "8px 16px", border: "1px solid var(--line)", background: "var(--paper-2)", color: "var(--ink)", textDecoration: "none" }}>
              К дневникам
            </Link>
          }
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="stack">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Загрузка…" }]} />
        <ListSkeleton variant="paragraph" label="Загрузка кампании" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="stack">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: content?.campaign.name ?? "Кампания" }]} />
        <LoadErrorCard
          message={<>Не удалось загрузить кампанию: {loadError}</>}
          onRetry={() => all.forEach((q) => q.error && q.reload())}
        />
      </div>
    );
  }

  if (!content) {
    return (
      <div className="stack">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Кампания" }]} />
        <LoadErrorCard
          message="Кампания не найдена."
          action={
            <Link to="/campaigns" style={{ padding: "8px 16px", border: "1px solid var(--line)", background: "var(--paper-2)", color: "var(--ink)", textDecoration: "none" }}>К дневникам</Link>
          }
        />
      </div>
    );
  }


  return (
    <EntityPage
      crumbs={[{ label: "Дневники", to: "/campaigns" }, { label: content.campaign.name }]}
      entityType="campaign"
      title={content.campaign.name}
      tabs={tabs}
      tab={tab}
      onTab={(t) => setTab(t)}
    >

      {(tab === "Лента" || activeFolder != null) && (
        <CampaignJournal
          campaignId={campaignId}
          schedule={content.schedule}
          activeFolder={activeFolder}
          folders={folders}
          onFoldersKnown={handleFoldersKnown}
          onOpenFolder={(f) => setTab(f ?? "Лента")}
          writingCharacterId={writingCharacterId}
          onWritingCharacterChange={setWritingCharacterId}
        />
      )}

      {tab === "Мир" && (
        <div className="stack">
          {settingGroups.length === 0 ? (
            <EmptyState
              title="Мастер пока молчит"
              hint="Мастер пока ничего не рассказал вам о мире — попросите его поделиться."
            />
          ) : (
            <LoreGroups groups={settingGroups} onAdd={handleAddFromLore} />
          )}
        </div>
      )}

      {tab === "От мастера" && (
        <div className="stack">
          {contentGroups.length === 0 ? (
            <EmptyState
              title="Мастер пока молчит"
              hint="Мастер пока ничего не открыл игрокам в этой кампании — попросите его поделиться лором."
            />
          ) : (
            <LoreGroups
              groups={contentGroups}
              recent={recentMaster}
              onAdd={handleAddFromLore}
              header={(openEntry) => (
                <div className="card stack" style={{ gap: 6 }}>
                  {prevSession && (
                    <div className="row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        Прошлая
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)" }}>{formatIsoDate(prevSession.date)}</span>
                      {prevSession.title && <span>— {prevSession.title}</span>}
                      {content?.sessions.some((s) => s.id === prevSession.id) && (
                        <button
                          type="button"
                          onClick={() => openEntry(`session-${prevSession.id}`)}
                          style={{ fontSize: "var(--fs-meta)", padding: "2px 8px", height: 24 }}
                        >
                          Чем кончилось
                        </button>
                      )}
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
              )}
            />
          )}
        </div>
      )}

      {tab === "Группа" && (
        <div className="stack">
          {party.length === 0 && (
            <EmptyState
              title="Группа пока одна"
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
            <button className="archive-toast__undo" onClick={() => setTab("Лента")}>
              Открыть
            </button>
          </div>
        </div>
      )}
    </EntityPage>
  );
}

// Группы лора со своей читалкой: Мир и От мастера — два независимых списка,
// читалка открывается из обоих. Поиск живёт внутри, у каждой вкладки свой.
function LoreGroups({
  groups,
  recent,
  onAdd,
  header,
}: {
  groups: { key: string; label: string; entries: ReaderEntry[] }[];
  recent?: ReaderEntry[];
  onAdd: (entry: ReaderEntry) => void;
  /** Шапка над списками с доступом к открытию записи (сводка прошлой сессии). */
  header?: (openEntry: (key: string) => void) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // Читалка держится за ключ записи, а не за номер в списке: список может
  // перечитаться по сигналу, пока игрок читает, и номер тогда указал бы на
  // чужую запись.
  const [readerKey, setReaderKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups.map((g, idx, arr) => {
      let off = 0;
      for (let i = 0; i < idx; i++) off += arr[i].entries.length;
      return { ...g, offset: off };
    });
    return groups
      .map((g) => ({
        ...g,
        entries: g.entries.filter(
          (e) => e.title.toLowerCase().includes(q) || e.section.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.entries.length > 0)
      .map((g, idx, arr) => {
        let off = 0;
        for (let i = 0; i < idx; i++) off += arr[i].entries.length;
        return { ...g, offset: off };
      });
  }, [groups, query]);

  const flatEntries = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  const readerEntries = query.trim() ? filtered.flatMap((g) => g.entries) : flatEntries;
  const readerIndex = readerKey == null ? null : readerEntries.findIndex((e) => e.key === readerKey);
  const setReaderIndex = useCallback(
    (index: number | null) => setReaderKey(index == null ? null : (readerEntries[index]?.key ?? null)),
    [readerEntries]
  );

  // Открыть запись по ключу (виджет «Последнее от мастера» и сводка прошлой
  // сессии): ищет в полном списке, при активном поиске снимает фильтр, иначе
  // индекс полного списка попал бы в отфильтрованный.
  const openByKey = useCallback(
    (key: string) => {
      if (readerEntries.some((fe) => fe.key === key)) {
        setReaderKey(key);
        return;
      }
      if (!flatEntries.some((fe) => fe.key === key)) return;
      setQuery("");
      setReaderKey(key);
    },
    [readerEntries, flatEntries]
  );

  return (
    <div className="stack">
      {header?.(openByKey)}
      {recent && recent.length > 0 && (
        <div className="card stack" style={{ gap: 8, borderLeft: "3px solid var(--accent)" }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
            Последнее от мастера
          </span>
          {recent.map((e) => (
            <button
              key={e.key}
              type="button"
              className="player-section-item"
              style={{ textAlign: "left" }}
              // Ключи виджета — с префиксом recent-, записи в ленте — без него.
              onClick={() => openByKey(e.key.replace(/^recent-/, ""))}
            >
              <span style={{ fontSize: "var(--fs-meta)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{e.section}</span> — {e.title}
            </button>
          ))}
        </div>
      )}

      {flatEntries.length > 0 && (
        <div className="row" style={{ gap: 8 }}>
          <input
            className="res-toolbar__search"
            placeholder="Поиск по открытому…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Поиск по открытому лору"
            style={{ flex: 1 }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ fontSize: "var(--fs-meta)", padding: "2px 8px", height: 26 }}>
              Сбросить
            </button>
          )}
          <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", whiteSpace: "nowrap" }}>
            {readerEntries.length} / {flatEntries.length}
          </span>
        </div>
      )}

      {filtered.length === 0 && query.trim() && (
        <p className="muted">По «{query.trim()}» ничего не найдено.</p>
      )}

      {filtered.map((g) => (
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
                    onClick={() => onAdd(e)}
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

      {readerIndex != null && readerIndex !== -1 && (
        <PlayerContentReader
          entries={readerEntries}
          index={readerIndex}
          onNavigate={setReaderIndex}
          onClose={() => setReaderKey(null)}
        />
      )}
      {readerIndex === -1 && <HiddenEntryNotice onBack={() => setReaderKey(null)} />}
    </div>
  );
}

// Запись пропала из выданного, пока игрок её читал: Мастер снял доступ. Текст
// не остаётся на экране (скрытое должно скрываться), но и страница не
// пропадает молча — игрок видит, что случилось, и возвращается к списку.
function HiddenEntryNotice({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
  return createPortal(
    <div className="player-reader-overlay" role="dialog" aria-modal="true" aria-label="Мастер скрыл это">
      <div className="player-reader-topbar">
        <span className="player-reader-section muted">&nbsp;</span>
        <button type="button" className="player-reader-close" onClick={onBack} aria-label="Закрыть">
          ×
        </button>
      </div>
      <div className="player-reader-body stack" style={{ gap: 16 }}>
        <h2 className="player-reader-title">Мастер скрыл это</h2>
        <p className="muted" style={{ margin: 0 }}>Эта запись больше не открыта вам.</p>
        <button type="button" className="primary" onClick={onBack} style={{ alignSelf: "flex-start" }}>
          ← К списку
        </button>
      </div>
    </div>,
    document.body
  );
}

const NO_SECTIONS: PlayerSection[] = [];
const NO_PARTY: PartyMember[] = [];
