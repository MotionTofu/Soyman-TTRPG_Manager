import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { LinkDropZone } from "../components/LinkDropZone";
import { EditableTextCard } from "../components/EditableTextCard";
import { ResourcesSection } from "../components/ResourcesSection";
import { LocationTree } from "../components/LocationTree";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { SettingCalendarEditor } from "../components/SettingCalendarEditor";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { useTabState } from "../hooks/useTabState";
import { Modal } from "../components/Modal";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { InworldDatedItem } from "../components/InworldCalendar";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { formatEventDate } from "../inworldCalendar";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { useImageCrop } from "../hooks/useImageCrop";
import { downloadJson } from "../downloadJson";
import { loadThumbnailStyles } from "../thumbnailStyles";
import { TagChips } from "../components/TagChips";
import { LocationFilter } from "../components/LocationCascadePicker";
import { SettingEntryList } from "../components/SettingEntryList";
import { BeingEntityRowList } from "../components/BeingEntityRowList";
import { EntityWizard } from "../components/entityWizard/EntityWizard";
import { AdventuresTab } from "../components/AdventuresTab";
import { CrossLinksCard } from "../components/CrossLinksCard";
import { RelationGraph } from "../components/RelationGraph";
import { SettingPlayerContentTab } from "../components/SettingPlayerContentTab";
import type { GraphData } from "../graphTypes";
import { NAMED_BEING_CATEGORIES } from "../beingCategories";
import type {
  Artifact,
  BeingCategory,
  Campaign,
  Character,
  Resource,
  Setting,
  SettingBeing,
  SettingCalendarEra,
  SettingCalendarEvent,
  SettingCommunity,
  SettingLocation,
} from "../types";

const TABS = [
  "Обзор",
  "География",
  "Население",
  "Приключения",
  "Сокровищница",
  "Граф связей",
  "Хроника мира",
  "Заметки",
  "Для игроков",
  "Ресурсы",
] as const;

// Хроника мира groups events as Эпоха > Столетие > Десятилетие > Года >
// События instead of one flat chronological list. An era covers its own
// start_year up to (not including) the next era's start_year — sorting by
// start_year alone defines the ranges, no separate end_year needed. Events
// older than the first era (or every event, if no eras are defined yet)
// fall into a synthetic "Без эпохи" bucket rather than being hidden.
interface EraBucket {
  era: SettingCalendarEra | null;
  startYear: number;
  endYear: number | null;
  events: SettingCalendarEvent[];
}

function buildEraBuckets(eras: SettingCalendarEra[], events: SettingCalendarEvent[]): EraBucket[] {
  const sorted = [...eras].sort((a, b) => a.start_year - b.start_year);
  const buckets: EraBucket[] = sorted.map((era, i) => ({
    era,
    startYear: era.start_year,
    endYear: i + 1 < sorted.length ? sorted[i + 1].start_year - 1 : null,
    events: [],
  }));
  const noEra: EraBucket = {
    era: null,
    startYear: -Infinity,
    endYear: sorted.length > 0 ? sorted[0].start_year - 1 : null,
    events: [],
  };
  for (const ev of events) {
    let placed = false;
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (ev.inworld_year >= buckets[i].startYear) {
        buckets[i].events.push(ev);
        placed = true;
        break;
      }
    }
    if (!placed) noEra.events.push(ev);
  }
  return noEra.events.length > 0 || sorted.length === 0 ? [noEra, ...buckets] : buckets;
}

function groupByYear(events: SettingCalendarEvent[]): [number, SettingCalendarEvent[]][] {
  const map = new Map<number, SettingCalendarEvent[]>();
  for (const ev of events) {
    const list = map.get(ev.inworld_year) ?? [];
    list.push(ev);
    map.set(ev.inworld_year, list);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

function groupByDecade(events: SettingCalendarEvent[]): [number, SettingCalendarEvent[]][] {
  const map = new Map<number, SettingCalendarEvent[]>();
  for (const ev of events) {
    const key = Math.floor(ev.inworld_year / 10) * 10;
    const list = map.get(key) ?? [];
    list.push(ev);
    map.set(key, list);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

function groupByCentury(events: SettingCalendarEvent[]): [number, SettingCalendarEvent[]][] {
  const map = new Map<number, SettingCalendarEvent[]>();
  for (const ev of events) {
    const centuryStart = Math.floor((ev.inworld_year - 1) / 100) * 100 + 1;
    const list = map.get(centuryStart) ?? [];
    list.push(ev);
    map.set(centuryStart, list);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

export function SettingDetailPage() {
  const { id } = useParams();
  const settingId = Number(id);
  const navigate = useNavigate();
  const [setting, setSetting] = useState<Setting | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  // Фон и тамбнейл живут в карточке «Изображения сеттинга» внизу «Обзора» и
  // заливаются сразу по выбору файла — не откладываются до «Сохранить» рядом с
  // именем, как было раньше.
  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const bgCrop = useImageCrop("background", (file) => uploadImage("background", file));
  const thumbCrop = useImageCrop("thumbnail", (file) => uploadImage("thumbnail", file));
  const [tab, selectTab] = useTabState(TABS, "Обзор");
  const [showExport, setShowExport] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);

  const calendar = useSettingCalendar(settingId);
  const [calendarEvents, setCalendarEvents] = useState<SettingCalendarEvent[]>([]);
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());
  const [calendarMenu, setCalendarMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(
    null
  );
  const [eventModal, setEventModal] = useState<{
    id?: number;
    year: number;
    month: number;
    day: number;
    title: string;
    description: string;
    important: boolean;
  } | null>(null);

  function refreshCalendarEvents() {
    api.get<SettingCalendarEvent[]>(`/settings/${settingId}/calendar-events`).then(setCalendarEvents);
  }
  useEffect(refreshCalendarEvents, [settingId]);

  const [eras, setEras] = useState<SettingCalendarEra[]>([]);
  const [addingEra, setAddingEra] = useState(false);
  const [eraName, setEraName] = useState("");
  const [eraStartYear, setEraStartYear] = useState("");

  function refreshEras() {
    api.get<SettingCalendarEra[]>(`/settings/${settingId}/calendar-eras`).then(setEras);
  }
  useEffect(refreshEras, [settingId]);

  async function createEra() {
    if (!eraName.trim() || !eraStartYear.trim()) return;
    await api.post(`/settings/${settingId}/calendar-eras`, {
      name: eraName.trim(),
      start_year: Number(eraStartYear),
    });
    setEraName("");
    setEraStartYear("");
    setAddingEra(false);
    refreshEras();
  }

  async function deleteEra(eraId: number) {
    if (!confirm("Удалить эпоху? События внутри неё не удалятся, просто перестанут быть сгруппированы.")) return;
    await api.del(`/settings/calendar-eras/${eraId}`);
    refreshEras();
  }

  function refresh() {
    api.get<Setting>(`/settings/${settingId}`).then(setSetting);
    api
      .get<Resource[]>(`/resources?scope=setting&setting_id=${settingId}`)
      .then(setResources);
    api.get<Character[]>(`/characters?setting_id=${settingId}`).then(setCharacters);
    api.get<Campaign[]>(`/campaigns?setting_id=${settingId}`).then(setCampaigns);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [settingId]);

  if (!setting) return <p className="muted">Загрузка…</p>;

  async function saveDescription(value: string) {
    await api.put(`/settings/${settingId}`, { description: value });
    refresh();
  }

  async function saveName(name: string) {
    await api.put(`/settings/${settingId}`, { name });
    refresh();
  }

  async function uploadImage(kind: "background" | "thumbnail", file: File) {
    const setUploading = kind === "background" ? setUploadingBg : setUploadingThumb;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/settings/${settingId}/${kind}`, form);
      refresh();
    } finally {
      setUploading(false);
    }
  }

  async function archiveSetting() {
    if (!confirm("Отправить сеттинг в архив?")) return;
    await api.del(`/settings/${settingId}`);
    navigate("/settings");
  }

  async function importSetting(file: File) {
    const data = JSON.parse(await file.text());
    const created = await api.post<Setting>("/settings/import", data);
    navigate(`/settings/${created.id}`);
  }

  async function pinSettingCalendar(pinned: { year: number; month: number } | null) {
    await api.put(`/settings/${settingId}/pinned-calendar`, {
      year: pinned?.year ?? null,
      month: pinned?.month ?? null,
    });
    refresh();
  }

  const calendarItems: InworldDatedItem[] = calendarEvents.map((e) => ({
    id: `event-${e.id}`,
    year: e.inworld_year,
    month: e.inworld_month,
    day: e.inworld_day,
    label: e.title,
    kind: "event",
    important: !!e.important,
  }));

  function openCreateEventModal(year: number, month: number, day: number) {
    setEventModal({ year, month, day, title: "", description: "", important: false });
    setCalendarMenu(null);
  }

  function openEditEventModal(ev: SettingCalendarEvent) {
    setEventModal({
      id: ev.id,
      year: ev.inworld_year,
      month: ev.inworld_month,
      day: ev.inworld_day,
      title: ev.title,
      description: ev.description,
      important: !!ev.important,
    });
    setCalendarMenu(null);
  }

  async function deleteCalendarEvent(eventId: number) {
    if (!confirm("Удалить событие из хроники мира? Это удалит его и из всех кампаний, куда оно было перенесено.")) return;
    await api.del(`/settings/calendar-events/${eventId}`);
    setCalendarMenu(null);
    refreshCalendarEvents();
  }

  async function toggleEventImportant(ev: SettingCalendarEvent) {
    await api.put(`/settings/calendar-events/${ev.id}`, { important: !ev.important });
    refreshCalendarEvents();
  }

  async function toggleEventVisible(ev: SettingCalendarEvent) {
    await api.put(`/settings/calendar-events/${ev.id}`, { visible_to_players: !ev.visible_to_players });
    refreshCalendarEvents();
  }

  async function saveEventModal() {
    if (!eventModal || !eventModal.title.trim()) return;
    const payload = {
      title: eventModal.title,
      description: eventModal.description,
      inworld_year: eventModal.year,
      inworld_month: eventModal.month,
      inworld_day: eventModal.day,
      important: eventModal.important,
    };
    if (eventModal.id) {
      const original = calendarEvents.find((e) => e.id === eventModal.id);
      await api.put(`/settings/calendar-events/${eventModal.id}`, payload);
      await syncMentionLinks("setting_event", eventModal.id, original?.description ?? "", eventModal.description);
    } else {
      const created = await api.post<SettingCalendarEvent>(`/settings/${settingId}/calendar-events`, payload);
      await syncMentionLinks("setting_event", created.id, "", eventModal.description);
    }
    setEventModal(null);
    refreshCalendarEvents();
  }

  function handleCalendarDayContextMenu(year: number, month: number, day: number, x: number, y: number) {
    setCalendarMenu({
      x,
      y,
      items: [{ label: "Создать событие", onClick: () => openCreateEventModal(year, month, day) }],
    });
  }

  function handleCalendarItemContextMenu(item: InworldDatedItem, x: number, y: number) {
    const ev = calendarEvents.find((e) => `event-${e.id}` === item.id);
    if (!ev) return;
    setCalendarMenu({
      x,
      y,
      items: [
        { label: "Редактировать", onClick: () => openEditEventModal(ev) },
        { label: "Удалить", danger: true, onClick: () => deleteCalendarEvent(ev.id) },
      ],
    });
  }

  function toggleEventExpanded(eventId: number) {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  function EventRow({ ev }: { ev: SettingCalendarEvent }) {
    const expanded = expandedEvents.has(ev.id);
    return (
      <div className="stack" style={{ gap: 2 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="row" style={{ alignItems: "center" }}>
            {ev.description && (
              <button style={{ padding: "2px 6px" }} onClick={() => toggleEventExpanded(ev.id)}>
                {expanded ? "▾" : "▸"}
              </button>
            )}
            <span>
              {formatEventDate(ev.inworld_year, ev.inworld_month, ev.inworld_day, calendar?.months ?? [])}
              {" — "}
              {/* Название ведёт в профиль события: в хронике живёт только
                  дата и краткая строка, всё остальное — там. */}
              <Link to={`/events/${ev.id}`}>
                <strong>{ev.title}</strong>
              </Link>
            </span>
          </span>
          <div className="row">
            <label className="row">
              <input type="checkbox" checked={!!ev.important} onChange={() => toggleEventImportant(ev)} />
              Важно
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={!!ev.visible_to_players}
                onChange={() => toggleEventVisible(ev)}
              />
              Видно игрокам
            </label>
            <button onClick={() => openEditEventModal(ev)}>Редактировать</button>
            <button className="danger" onClick={() => deleteCalendarEvent(ev.id)}>
              Удалить
            </button>
          </div>
        </div>
        {expanded && ev.description && (
          <div style={{ whiteSpace: "pre-wrap", marginLeft: 28 }}>
            <MentionText text={ev.description} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="stack" style={{ position: "relative" }}>
      {setting.background_image_url && (
        <div
          className="campaign-bg-layer"
          style={{ backgroundImage: `url("${setting.background_image_url}")` }}
        />
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ alignItems: "center" }}>
          <h1>
            <button type="button" className="entity-title-link" onClick={() => selectTab("Обзор")} title="К обзору">
              {setting.name}
            </button>
          </h1>
          <EntityTypeChip type="setting" />
        </div>
        <div className="entity-header-actions">
          {/* Имя правится в карточке «Описание» на «Обзоре» — вместе с самим
              описанием, одной кнопкой «Сохранить». */}
          <button onClick={() => setShowExport(true)}>Экспорт</button>
          <label className="row" style={{ cursor: "pointer" }}>
            Импорт
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && importSetting(e.target.files[0])}
            />
          </label>
          <button className="danger" onClick={archiveSetting}>
            Архивировать
          </button>
        </div>
      </div>

      {showExport && (
        <SettingExportModal settingId={settingId} settingName={setting.name} onClose={() => setShowExport(false)} />
      )}

      {creatingEvent && (
        <EntityWizard
          initialType="event"
          ctx={{ settingId }}
          onClose={() => setCreatingEvent(false)}
          onCreated={refreshCalendarEvents}
        />
      )}

      <div className="tabs">
        {TABS.filter((t) => t !== "Обзор").map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => selectTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Обзор" && (
        <div className="stack">
          <EditableTextCard
            key={`description-${setting.id}`}
            title="Описание"
            value={setting.description}
            onSave={saveDescription}
            rows={6}
            entityType="setting"
            entityId={settingId}
            defaultSettingId={settingId}
            fields={[{ key: "name", label: "Имя", value: setting.name, required: true }]}
            onSaveFields={(v) => saveName(v.name)}
          />

          <CrossLinksCard
            base={`/settings/${settingId}`}
            help="Ищет имена сущностей сеттинга в описаниях локаций, историях личностей, полях сообществ, силе предметов и синопсисах приключений — и делает их кликабельными. Сцены размечает такой же проход на странице приключения: там отбор точнее. Ничего не пишет, пока вы не подтвердите."
          />

          <div className="card stack">
            <h3>Кампании</h3>
            <div className="grid-cards">
              {campaigns.map((c) => (
                <Link key={c.id} to={`/campaigns/${c.id}`} className="card">
                  <h3>{c.name}</h3>
                  <div className="muted">{c.system_name ?? "Система не указана"}</div>
                </Link>
              ))}
              {campaigns.length === 0 && (
                <p className="muted">Пока нет кампаний с этим сеттингом.</p>
              )}
            </div>
          </div>

          <div className="card stack">
            <h3>Персонажи игроков</h3>
            <div className="grid-cards">
              {characters.map((c) => (
                <Link key={c.id} to={`/characters/${c.id}`} className="card">
                  <h3>{c.character_name}</h3>
                  <div className="muted">
                    {c.player_name} · {c.campaign_name}
                  </div>
                </Link>
              ))}
              {characters.length === 0 && (
                <p className="muted">Пока нет персонажей в кампаниях этого сеттинга.</p>
              )}
            </div>
          </div>

          <div className="card">
            <LinkDropZone entityType="setting" entityId={settingId} title="Связанные сущности" />
          </div>

          <div className="card stack">
            <h3>Изображения сеттинга</h3>
            <div className="entity-image-slots">
              <ImageSlot
                title="Фон профиля"
                hint="Подложка на всех страницах сеттинга."
                url={setting.background_image_url}
                wide
                uploading={uploadingBg}
                onSelect={bgCrop.onSelect}
              />
              <ImageSlot
                title="Тамбнейл"
                hint="Карточка в списке сеттингов."
                url={setting.thumbnail_image_url}
                uploading={uploadingThumb}
                onSelect={thumbCrop.onSelect}
              />
            </div>
            {bgCrop.modal}
            {thumbCrop.modal}
          </div>
        </div>
      )}

      {tab === "География" && <GeographyTab settingId={settingId} />}
      {tab === "Население" && <PopulationTab settingId={settingId} />}
      {tab === "Приключения" && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button onClick={() => navigate(`/import?setting=${settingId}`)}>
              Импорт приключения
            </button>
          </div>
          <AdventuresTab settingId={settingId} />
        </div>
      )}
      {tab === "Сокровищница" && (
        <div className="card stack">
          <ArtifactsTab settingId={settingId} />
        </div>
      )}
      {tab === "Граф связей" && <SettingGraphTab settingId={settingId} />}

      {tab === "Хроника мира" && (
        <div className="stack">
          <div className="card stack">
            <SettingCalendarEditor
              settingId={settingId}
              items={calendarItems}
              pinned={
                setting.pinned_calendar_year != null && setting.pinned_calendar_month != null
                  ? { year: setting.pinned_calendar_year, month: setting.pinned_calendar_month }
                  : null
              }
              onPin={pinSettingCalendar}
              onDayContextMenu={handleCalendarDayContextMenu}
              onItemContextMenu={handleCalendarItemContextMenu}
            />
          </div>

          <div className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong className="entry-title">Список по эпохам</strong>
              <div className="row">
                {/* Создание события через общий визард; правка существующего
                    и клик по дню календаря по-прежнему открывают быструю
                    модалку — там уже известна дата. */}
                <button className="primary" onClick={() => setCreatingEvent(true)}>
                  + Создать событие
                </button>
                <button onClick={() => setAddingEra((v) => !v)}>+ Добавить эпоху</button>
              </div>
            </div>
            <span className="muted">
              События хроники автоматически переносятся во все кампании, использующие этот сеттинг
              — удаление из кампании не затрагивает эту запись, а удаление здесь удалит событие и
              из кампаний.
            </span>
            {addingEra && (
              <div className="row">
                <input placeholder="Название эпохи" value={eraName} onChange={(e) => setEraName(e.target.value)} />
                <input
                  type="number"
                  placeholder="Год начала"
                  style={{ width: 110 }}
                  value={eraStartYear}
                  onChange={(e) => setEraStartYear(e.target.value)}
                />
                <button className="primary" onClick={createEra}>
                  Добавить
                </button>
                <button onClick={() => setAddingEra(false)}>Отмена</button>
              </div>
            )}

            <div className="stack">
              {buildEraBuckets(eras, calendarEvents).map((bucket) => (
                <details key={bucket.era?.id ?? "no-era"} className="card" open>
                  <summary className="row" style={{ justifyContent: "space-between" }}>
                    <span>
                      <strong>{bucket.era ? bucket.era.name : "Без эпохи"}</strong>{" "}
                      <span className="muted">
                        ({bucket.era ? bucket.startYear : "…"}
                        {bucket.endYear != null ? `–${bucket.endYear}` : "–…"})
                      </span>
                    </span>
                    {bucket.era && (
                      <button
                        type="button"
                        className="comp-mini danger"
                        onClick={(e) => {
                          e.preventDefault();
                          deleteEra(bucket.era!.id);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </summary>
                  <div className="stack" style={{ marginTop: 8, paddingLeft: 16 }}>
                    {groupByCentury(bucket.events).map(([centuryStart, centuryEvents]) => (
                      <details key={centuryStart} className="card">
                        <summary>
                          Столетие {centuryStart}–{centuryStart + 99}
                        </summary>
                        <div className="stack" style={{ marginTop: 8, paddingLeft: 16 }}>
                          {groupByDecade(centuryEvents).map(([decadeStart, decadeEvents]) => (
                            <details key={decadeStart} className="card">
                              <summary>{decadeStart}-е</summary>
                              <div className="stack" style={{ marginTop: 8, paddingLeft: 16 }}>
                                {groupByYear(decadeEvents).map(([year, yearEvents]) => (
                                  <details key={year} className="card">
                                    <summary>{year}</summary>
                                    <div className="stack" style={{ marginTop: 8, paddingLeft: 16 }}>
                                      {yearEvents.map((ev) => (
                                        <EventRow key={ev.id} ev={ev} />
                                      ))}
                                    </div>
                                  </details>
                                ))}
                              </div>
                            </details>
                          ))}
                        </div>
                      </details>
                    ))}
                    {bucket.events.length === 0 && <p className="muted">Событий нет.</p>}
                  </div>
                </details>
              ))}
              {calendarEvents.length === 0 && <p className="muted">Событий пока нет.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "Для игроков" && <SettingPlayerContentTab settingId={settingId} campaigns={campaigns} />}

      {tab === "Ресурсы" && (
        <div className="card stack">
          <ResourcesSection scope="setting" entityId={settingId} resources={resources} onChange={refresh} />
        </div>
      )}

      {calendarMenu && (
        <ContextMenu
          x={calendarMenu.x}
          y={calendarMenu.y}
          items={calendarMenu.items}
          onClose={() => setCalendarMenu(null)}
        />
      )}

      {eventModal && (
        <Modal onClose={() => setEventModal(null)}>
          <h3>{eventModal.id ? "Редактировать событие" : "Новое событие"}</h3>
          <div className="stack">
            <input
              placeholder="Название"
              value={eventModal.title}
              onChange={(e) => setEventModal({ ...eventModal, title: e.target.value })}
            />
            <MentionTextarea
              value={eventModal.description}
              onChange={(v) => setEventModal({ ...eventModal, description: v })}
              rows={4}
              placeholder="Описание"
              defaultSettingId={settingId}
            />
            <div className="row">
              <label className="row">
                Год
                <input
                  type="number"
                  style={{ width: 80 }}
                  value={eventModal.year}
                  onChange={(e) => setEventModal({ ...eventModal, year: Number(e.target.value) })}
                />
              </label>
              <label className="row">
                Месяц
                <select
                  value={eventModal.month}
                  onChange={(e) => setEventModal({ ...eventModal, month: Number(e.target.value) })}
                >
                  {(calendar?.months ?? []).map((m) => (
                    <option key={m.id} value={m.position}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="row">
                День
                <input
                  type="number"
                  style={{ width: 70 }}
                  value={eventModal.day}
                  onChange={(e) => setEventModal({ ...eventModal, day: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="row">
              <input
                type="checkbox"
                checked={eventModal.important}
                onChange={(e) => setEventModal({ ...eventModal, important: e.target.checked })}
              />
              Важно
            </label>
            <div className="row">
              <button className="primary" onClick={saveEventModal}>
                Сохранить
              </button>
              <button onClick={() => setEventModal(null)}>Отмена</button>
            </div>
          </div>
        </Modal>
      )}

      {tab === "Заметки" && (
        <SettingEntryList
          settingId={settingId}
          category="notes"
          addLabel="+ добавить заметку"
          emptyLabel="Заметок пока нет."
        />
      )}
    </div>
  );
}

// Одна ячейка карточки «Изображения сеттинга»: текущая картинка (или пустая
// рамка, если её нет) плюс кнопка замены. Сама рамка и есть кнопка — клик по
// превью открывает выбор файла, как у аватарок существ.
function ImageSlot({
  title,
  hint,
  url,
  wide,
  uploading,
  onSelect,
}: {
  title: string;
  hint: string;
  url: string | null;
  wide?: boolean;
  uploading: boolean;
  onSelect: (file: File | null) => void;
}) {
  return (
    <div className="stack entity-image-slot">
      <strong>{title}</strong>
      <label
        className={`entity-image-frame${wide ? " wide" : ""}${uploading ? " uploading" : ""}`}
        title={IMAGE_HINT}
      >
        {url ? (
          <img src={url} alt="" />
        ) : (
          // Оверлей «Загрузить» виден только по наведению, а на тач-экране
          // наведения нет — поэтому пустая рамка сама говорит, что делать.
          <span className="muted entity-image-empty">Нажмите, чтобы загрузить</span>
        )}
        <span className="avatar-upload-hint">
          {uploading ? "Загрузка…" : url ? "Заменить" : "Загрузить"}
        </span>
        <input
          type="file"
          accept={IMAGE_ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
        />
      </label>
      <span className="muted image-hint">{hint}</span>
    </div>
  );
}

// Corkboard-with-threads view of every relation between this setting's
// beings, factions, and locations (player characters are deliberately left
// out here — per the user's original ask, this graph is scoped to "все
// существа и фракции сеттинга"; locations were added afterwards since
// mention-links can connect to them too).
function SettingGraphTab({ settingId }: { settingId: number }) {
  const [data, setData] = useState<GraphData | null>(null);

  useEffect(() => {
    api
      .get<GraphData>(`/links/graph?types=being,community,location&setting_id=${settingId}`)
      .then(setData);
  }, [settingId]);

  return (
    <div className="card stack">
      <RelationGraph data={data} emptyMessage="Связей между существами и фракциями этого сеттинга пока нет." />
    </div>
  );
}

function GeographyTab({ settingId }: { settingId: number }) {
  return (
    <div className="card stack">
      <LocationTree settingId={settingId} />
    </div>
  );
}

// Артефакты moved out to their own top-level "Сокровищница" tab — they're
// not population. Личности holds *named* personalities only; unnamed
// creature kinds get their own Бестиарий subsection.
const POPULATION_SECTIONS = ["Личности", "Бестиарий", "Сообщества"] as const;

function PopulationTab({ settingId }: { settingId: number }) {
  const [section, setSection] = useState<(typeof POPULATION_SECTIONS)[number]>("Личности");

  return (
    <div className="card stack">
      <div className="tabs">
        {POPULATION_SECTIONS.map((s) => (
          <button key={s} className={section === s ? "active" : ""} onClick={() => setSection(s)}>
            {s}
          </button>
        ))}
      </div>
      {section === "Личности" && <BeingsSection settingId={settingId} />}
      {section === "Бестиарий" && <BestiarySection settingId={settingId} />}
      {section === "Сообщества" && <CommunitiesSection settingId={settingId} />}
    </div>
  );
}

function BeingsSection({ settingId }: { settingId: number }) {
  const [category, setCategory] = useState<BeingCategory | "all">("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [beings, setBeings] = useState<SettingBeing[]>([]);
  const [locations, setLocations] = useState<SettingLocation[]>([]);

  function refresh() {
    const params = new URLSearchParams({ setting_id: String(settingId) });
    if (category !== "all") params.set("category", category);
    else params.set("exclude_category", "bestiary");
    if (locationFilter) params.set("location_id", locationFilter);
    if (query.trim()) params.set("q", query.trim());
    api.get<SettingBeing[]>(`/setting-beings?${params.toString()}`).then(setBeings);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [settingId, category, locationFilter, query]);

  useEffect(() => {
    api.get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`).then(setLocations);
  }, [settingId]);

  async function duplicateBeing(being: SettingBeing) {
    await api.post("/setting-beings", {
      setting_id: settingId,
      name: `${being.name}_`,
      category: being.category,
      location_id: being.location_id,
      statblock_short: being.statblock_short,
      statblock_full: being.statblock_full,
      history: being.history,
      behavior: being.behavior,
    });
    refresh();
  }

  async function deleteBeing(beingId: number) {
    if (!confirm("Удалить это существо?")) return;
    await api.del(`/setting-beings/${beingId}`);
    refresh();
  }

  return (
    <div className="stack">
      <div className="tabs">
        {NAMED_BEING_CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={category === c.key ? "active" : ""}
            onClick={() => setCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="row">
        <button className="primary" onClick={() => setCreating(true)}>
          Создать
        </button>
      </div>
      {creating && (
        <EntityWizard
          initialType="being"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
          onCreated={refresh}
        />
      )}
      <div className="row">
        <input
          placeholder="Поиск: имя, связанное существо или сообщество…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* Фильтр спрятан, поэтому кнопка сама говорит, что он включён —
            иначе непонятно, почему список короче, чем ожидаешь. */}
        <button
          className={`toggle-button${filtersOpen || locationFilter ? " active" : ""}`}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          Фильтры{locationFilter ? " (1)" : ""}
        </button>
      </div>
      {filtersOpen && (
        <LocationFilter locations={locations} value={locationFilter} onChange={setLocationFilter} />
      )}
      {query.trim() && (
        <span className="muted">
          Показаны существа с этим именем, а также связанные с ним через отношения,
          сообщества/народы/культуры или общую локацию.
        </span>
      )}
      <BeingEntityRowList beings={beings} onDelete={deleteBeing} onDuplicate={duplicateBeing} asLinks />
    </div>
  );
}

// Unnamed creature kinds inhabiting the setting ("гоблины", "речные
// утопленники") — a separate list from the named personalities above, so
// the GM gets an at-a-glance answer to "кто вообще населяет мой мир". Each
// entry may point at one or more system compendium monsters (see
// CompendiumLinks card on the being's own page); the entry itself lives in
// the setting and works fine with no system attached at all.
function BestiarySection({ settingId }: { settingId: number }) {
  const [beings, setBeings] = useState<SettingBeing[]>([]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [locationFilter, setLocationFilter] = useState("");
  const [locations, setLocations] = useState<SettingLocation[]>([]);

  function refresh() {
    const params = new URLSearchParams({ setting_id: String(settingId), category: "bestiary" });
    if (query.trim()) params.set("q", query.trim());
    if (locationFilter) params.set("location_id", locationFilter);
    api.get<SettingBeing[]>(`/setting-beings?${params.toString()}`).then(setBeings);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [settingId, query, locationFilter]);

  useEffect(() => {
    api.get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`).then(setLocations);
  }, [settingId]);

  async function duplicateBeing(being: SettingBeing) {
    await api.post("/setting-beings", {
      setting_id: settingId,
      name: `${being.name}_`,
      category: "bestiary",
      statblock_short: being.statblock_short,
      statblock_full: being.statblock_full,
      history: being.history,
      behavior: being.behavior,
    });
    refresh();
  }

  async function deleteBeing(beingId: number) {
    if (!confirm("Удалить эту запись бестиария?")) return;
    await api.del(`/setting-beings/${beingId}`);
    refresh();
  }

  return (
    <div className="stack">
      <p className="muted">
        Бестиарий сеттинга — виды и типы существ без имени, населяющие этот мир. Именные
        персонажи живут в разделе «Личности». Запись бестиария можно связать с монстрами из
        компендиумов систем на её собственной странице.
      </p>
      <div className="row">
        <button className="primary" onClick={() => setCreating(true)}>
          Создать
        </button>
      </div>
      {creating && (
        <EntityWizard
          initialType="bestiary"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
          onCreated={refresh}
        />
      )}
      <input placeholder="Поиск по бестиарию…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <LocationFilter locations={locations} value={locationFilter} onChange={setLocationFilter} />
      <BeingEntityRowList beings={beings} onDelete={deleteBeing} onDuplicate={duplicateBeing} asLinks />
    </div>
  );
}

function CommunitiesSection({ settingId }: { settingId: number }) {
  const navigate = useNavigate();
  const [communities, setCommunities] = useState<SettingCommunity[]>([]);
  const [creating, setCreating] = useState(false);
  const [locationFilter, setLocationFilter] = useState("");
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const thumbnailStyles = loadThumbnailStyles();

  function refresh() {
    const params = new URLSearchParams({ setting_id: String(settingId) });
    // Без фильтра список остаётся витриной верхнего уровня (вложенные живут на
    // странице родителя). С фильтром это бессмысленно: вложенное сообщество
    // без локации иначе просто не покажется — поэтому ищем по всем уровням.
    if (locationFilter) params.set("location_id", locationFilter);
    else params.set("parent_id", "null");
    api.get<SettingCommunity[]>(`/setting-communities?${params.toString()}`).then(setCommunities);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [settingId, locationFilter]);

  useEffect(() => {
    api.get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`).then(setLocations);
  }, [settingId]);

  async function deleteCommunity(id: number) {
    if (!confirm("Удалить это сообщество?")) return;
    await api.del(`/setting-communities/${id}`);
    refresh();
  }

  return (
    <div className="stack">
      <p className="muted">
        Сообщества — любые объединения (народы, культуры, фракции, гильдии), к которым можно
        отнести личностей из раздела «Личности». Здесь показаны верхнеуровневые — вложенные
        (например, отдельный город внутри королевства) создаются на странице родительского
        сообщества, во вкладке «Вложенные сообщества».
      </p>
      <div className="row">
        <button className="primary" onClick={() => setCreating(true)}>
          Создать
        </button>
      </div>
      {creating && (
        <EntityWizard
          initialType="community"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
          onCreated={refresh}
        />
      )}
      <LocationFilter locations={locations} value={locationFilter} onChange={setLocationFilter} />
      {locationFilter && (
        <span className="muted">
          С фильтром показаны и вложенные сообщества, не только верхнеуровневые.
        </span>
      )}
      <div className="entity-row-list">
        {communities.map((c) => {
          const url = c.thumbnail_image_url;
          const mode = thumbnailStyles.communities;
          const isBg = mode === "background" && !!url;
          return (
            <Link
              key={c.id}
              to={`/communities/${c.id}`}
              className={`entity-row${isBg ? " entity-row-bg" : ""}`}
              style={isBg ? { backgroundImage: `url("${url}")` } : undefined}
            >
              {mode === "banner" && url && <img src={url} alt="" className="entity-row-thumb" />}
              <span className="entity-row-name">{c.name}</span>
              <span className="entity-row-tags">
                <TagChips tags={c.tags} />
              </span>
              <span className="entity-row-actions">
                {/* Не <a> внутри <a> — строка целиком уже ссылка. */}
                <button
                  type="button"
                  className="entity-row-action-link"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate(`/communities/${c.id}`);
                  }}
                >
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteCommunity(c.id);
                  }}
                >
                  Удалить
                </button>
              </span>
            </Link>
          );
        })}
        {communities.length === 0 && <p className="muted">Сообществ пока нет.</p>}
      </div>
    </div>
  );
}

function ArtifactsTab({ settingId }: { settingId: number }) {
  const navigate = useNavigate();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [creating, setCreating] = useState(false);

  function refresh() {
    api.get<Artifact[]>(`/artifacts?setting_id=${settingId}`).then(setArtifacts);
  }
  useEffect(refresh, [settingId]);

  async function deleteArtifact(id: number) {
    if (!confirm("Отправить артефакт в архив?")) return;
    await api.del(`/artifacts/${id}`);
    refresh();
  }

  return (
    <div className="stack">
      <div className="row">
        <button className="primary" onClick={() => setCreating(true)}>
          Создать
        </button>
      </div>
      {creating && (
        <EntityWizard
          initialType="artifact"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
          onCreated={refresh}
        />
      )}
      <div className="entity-row-list">
        {artifacts.map((a) => (
          <Link key={a.id} to={`/artifacts/${a.id}`} className="entity-row">
            <span className="entity-row-name">{a.name}</span>
            {a.owner && <span className="muted">{a.owner}</span>}
            <span className="entity-row-actions">
              {/* Не <a> внутри <a> — строка целиком уже ссылка. */}
              <button
                type="button"
                className="entity-row-action-link"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/artifacts/${a.id}`);
                }}
              >
                Изменить
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteArtifact(a.id);
                }}
              >
                Удалить
              </button>
            </span>
          </Link>
        ))}
        {artifacts.length === 0 && <p className="muted">Артефактов пока нет.</p>}
      </div>
    </div>
  );
}

function SettingExportModal({
  settingId,
  settingName,
  onClose,
}: {
  settingId: number;
  settingName: string;
  onClose: () => void;
}) {
  const [includeCalendar, setIncludeCalendar] = useState(false);
  const [includeResources, setIncludeResources] = useState(false);
  const [includeImages, setIncludeImages] = useState(false);

  async function doExport() {
    const include = [includeCalendar && "calendar", includeResources && "resources", includeImages && "images"]
      .filter(Boolean)
      .join(",");
    const data = await api.get(`/settings/${settingId}/export?include=${include}`);
    downloadJson(data, `setting-${settingName}.json`);
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <h3>Экспорт сеттинга</h3>
      <div className="stack">
        <span className="muted">
          География, население и сообщества экспортируются всегда. Что добавить ещё:
        </span>
        <label className="row">
          <input
            type="checkbox"
            checked={includeCalendar}
            onChange={(e) => setIncludeCalendar(e.target.checked)}
          />
          Календарь и хроника мира
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={includeResources}
            onChange={(e) => setIncludeResources(e.target.checked)}
          />
          Артефакты и ресурсы
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
          />
          Изображения, карты локаций (с пинами) и звуковые файлы (значительно увеличит размер файла)
        </label>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button onClick={onClose}>Отмена</button>
          <button className="primary" onClick={doExport}>
            Скачать
          </button>
        </div>
      </div>
    </Modal>
  );
}
