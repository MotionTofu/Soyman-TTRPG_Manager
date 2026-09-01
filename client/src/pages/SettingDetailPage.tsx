import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { LinkDropZone } from "../components/LinkDropZone";
import { EditableTextCard } from "../components/EditableTextCard";
import { ResourcesSection } from "../components/ResourcesSection";
import { LocationTree } from "../components/LocationTree";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { SettingCalendarEditor } from "../components/SettingCalendarEditor";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { SectionHeading } from "../components/SectionHeading";
import { useTabState } from "../hooks/useTabState";
import { Modal } from "../components/Modal";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { InworldDatedItem } from "../components/InworldCalendar";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { Timeline } from "../components/Timeline";
import { SettingCycles } from "../components/SettingCycles";
import { formatEventDate } from "../inworldCalendar";
import { useImageCrop } from "../hooks/useImageCrop";
import { downloadJson } from "../downloadJson";
import { loadThumbnailStyles } from "../thumbnailStyles";
import { TagChips } from "../components/TagChips";
import { GenrePicker } from "../components/GenrePicker";
import { ZineGraphic } from "../components/ZineGraphics";
import { GENRE_CATEGORIES } from "../genreData";
import type { SettingGenre } from "../types";
import { LocationFilter } from "../components/LocationCascadePicker";
import { SettingEntryList } from "../components/SettingEntryList";
import { BeingEntityRowList } from "../components/BeingEntityRowList";
import { SettingBeingTileGrid, SettingCommunityTileGrid } from "../components/SettingBeingTileGrid";
import { EntityWizard } from "../components/entityWizard/EntityWizard";
import { AdventuresTab } from "../components/AdventuresTab";
import { CrossLinksWizard } from "../components/CrossLinksWizard";
import { RelationGraph } from "../components/RelationGraph";
import { SETTING_SCOPED_TYPES } from "../components/GraphTypeFilters";
import { SettingPlayerContentTab } from "../components/SettingPlayerContentTab";
import type { GraphData } from "../graphTypes";
import { NAMED_BEING_CATEGORIES } from "../beingCategories";
import { NavIcon } from "../components/NavIcons";
import { EmptyState } from "../components/EmptyState";
import { isSafeImageUrl, safeBackgroundImage } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { useAlert, useConfirm } from "../hooks/useConfirm";
import { CampaignWizard } from "../components/CampaignWizard";
import { EntityImageSlot } from "../components/EntityImageSlot";
import type { System } from "../types";
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
  SettingCycle,
  SettingGroup,
  SettingLocation,
} from "../types";

function SettingCampaignTile({ campaign: c }: { campaign: Campaign }) {
  const rawUrl = c.thumbnail_image_url ?? c.background_image_url ?? null;
  const imageUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
  const authBlob = useAuthenticatedFileUrl(imageUrl);
  const bg = imageUrl?.startsWith("/files/")
    ? (authBlob ? `url("${authBlob}")` : undefined)
    : safeBackgroundImage(imageUrl);

  return (
    <Link to={`/campaigns/${c.id}`} className="card campaign-tile">
      <div className="campaign-tile-cover cover-halftone">
        {bg ? (
          <div className="cover-art cover-photo">
            <div className="cover-art-image" style={{ backgroundImage: bg }} aria-hidden="true" />
          </div>
        ) : (
          <div className="cover-art cover-art-fallback zine-grain" aria-hidden="true" />
        )}
        <div className="campaign-tile-scrim" />
        <h3 className="campaign-tile-name">{c.name}</h3>
      </div>
      <div className="campaign-tile-meta">
        <div className="campaign-tile-system">{c.system_name ?? "Система не указана"}</div>
      </div>
    </Link>
  );
}

function SettingCharacterTile({ character: ch }: { character: Character }) {
  const rawUrl = ch.thumbnail_image_url ?? ch.avatar_image_url ?? null;
  const imageUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
  const authBlob = useAuthenticatedFileUrl(imageUrl);
  const bg = imageUrl?.startsWith("/files/")
    ? (authBlob ? `url("${authBlob}")` : undefined)
    : safeBackgroundImage(imageUrl);

  return (
    <Link to={`/characters/${ch.id}`} className="card campaign-tile">
      <div className="campaign-tile-cover cover-halftone">
        {bg ? (
          <div className="cover-art cover-photo">
            <div className="cover-art-image" style={{ backgroundImage: bg }} aria-hidden="true" />
          </div>
        ) : (
          <div className="cover-art cover-art-fallback zine-grain" aria-hidden="true" />
        )}
        <div className="campaign-tile-scrim" />
        <h3 className="campaign-tile-name">{ch.character_name}</h3>
      </div>
      <div className="campaign-tile-meta">
        <div className="campaign-tile-system">{ch.player_name ?? "игрок"}</div>
      </div>
    </Link>
  );
}

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
  // Список и ось — два вида одних и тех же событий, а не две вкладки: список
  // читают и правят, ось показывает расстояния между датами.
  const [chronicleView, setChronicleView] = useState<"list" | "axis">("list");
  const [cycles, setCycles] = useState<SettingCycle[]>([]);
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
    precision: import("../types").DatePrecision;
    status: import("../types").EventStatus;
    year_end: string;
    month_end: string;
    day_end: string;
    cancel_note: string;
  } | null>(null);
  const [genrePickerOpen, setGenrePickerOpen] = useState(false);
  const [allGroups, setAllGroups] = useState<SettingGroup[]>([]);
  const [settingGroupIds, setSettingGroupIds] = useState<number[]>([]);

  // Фаза 0: надёжность загрузки — AbortController + loading/error как в SettingsListPage
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();
  const [campaignWizardOpen, setCampaignWizardOpen] = useState(false);
  const [wizardSystems, setWizardSystems] = useState<System[]>([]);
  const [wizardSettings, setWizardSettings] = useState<Setting[]>([]);

  async function openCampaignWizard() {
    try {
      const [sys, sets] = await Promise.all([
        api.get<System[]>("/systems"),
        api.get<Setting[]>("/settings"),
      ]);
      setWizardSystems(sys);
      setWizardSettings(sets);
    } catch {
      setWizardSystems([]);
      setWizardSettings([]);
    }
    setCampaignWizardOpen(true);
  }

  const [eras, setEras] = useState<SettingCalendarEra[]>([]);
  const [addingEra, setAddingEra] = useState(false);
  const [eraName, setEraName] = useState("");
  const [eraStartYear, setEraStartYear] = useState("");
  const [worldFilter, setWorldFilter] = useState("");
  const filteredCalendarEvents = useMemo(() => {
    const q = worldFilter.trim().toLowerCase();
    if (!q) return calendarEvents;
    return calendarEvents.filter((ev) => ev.title.toLowerCase().includes(q) || (ev.description ?? "").toLowerCase().includes(q));
  }, [calendarEvents, worldFilter]);
  const eraBuckets = useMemo(() => buildEraBuckets(eras, filteredCalendarEvents), [eras, filteredCalendarEvents]);
  const axisRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [timelineFocus, setTimelineFocus] = useState<{ year: number; month: number; day: number } | null>(null);
  const [calendarFocus, setCalendarFocus] = useState<{ year: number; month: number } | null>(null);

  function refreshCalendarEvents() {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    api
      .get<SettingCalendarEvent[]>(`/settings/${settingId}/calendar-events`, opts)
      .then(setCalendarEvents)
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        console.error(e);
      });
    api
      .get<SettingCycle[]>(`/settings/${settingId}/cycles`, opts)
      .then(setCycles)
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        console.error(e);
      });
    return () => controller.abort();
  }
  useEffect(refreshCalendarEvents, [settingId]);

  function refreshEras() {
    const controller = new AbortController();
    api
      .get<SettingCalendarEra[]>(`/settings/${settingId}/calendar-eras`, { signal: controller.signal })
      .then(setEras)
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        console.error(e);
      });
    return () => controller.abort();
  }
  useEffect(refreshEras, [settingId]);

  async function createEra() {
    if (!eraName.trim() || !eraStartYear.trim()) return;
    const y = Number(eraStartYear);
    if (!Number.isFinite(y)) { alert("Год — число"); return; }
    if (eras.some((er) => er.name.trim().toLowerCase() === eraName.trim().toLowerCase())) { alert("Эпоха с таким названием уже есть"); return; }
    if (eras.some((er) => er.start_year === y)) { alert("Эпоха с таким годом уже есть"); return; }
    await api.post(`/settings/${settingId}/calendar-eras`, {
      name: eraName.trim(),
      start_year: y,
    });
    setEraName("");
    setEraStartYear("");
    setAddingEra(false);
    // refreshEras создаст новый AbortController внутри
    const ctrl = new AbortController();
    api
      .get<SettingCalendarEra[]>(`/settings/${settingId}/calendar-eras`, { signal: ctrl.signal })
      .then(setEras)
      .catch(() => {});
  }

  async function deleteEra(eraId: number) {
    const ok = await confirm({
      title: "Удалить эпоху?",
      message: "События внутри неё не удалятся, просто перестанут быть сгруппированы.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/settings/calendar-eras/${eraId}`);
    const ctrl = new AbortController();
    api
      .get<SettingCalendarEra[]>(`/settings/${settingId}/calendar-eras`, { signal: ctrl.signal })
      .then(setEras)
      .catch(() => {});
  }

  async function loadOverview(signal?: AbortSignal) {
    setLoading(true);
    setLoadError(null);
    const opts = signal ? { signal } : undefined;
    try {
      const [s, res, chars, camps, groups, bySetting] = await Promise.all([
        api.get<Setting>(`/settings/${settingId}`, opts),
        api.get<Resource[]>(`/resources?scope=setting&setting_id=${settingId}`, opts),
        api.get<Character[]>(`/characters?setting_id=${settingId}`, opts),
        api.get<Campaign[]>(`/campaigns?setting_id=${settingId}`, opts),
        api.get<SettingGroup[]>("/setting-groups", opts),
        api.get<SettingGroup[]>(`/setting-groups/by-setting/${settingId}`, opts),
      ]);
      setSetting(s);
      setResources(res);
      setCharacters(chars);
      setCampaigns(camps);
      setAllGroups(groups);
      setSettingGroupIds(bySetting.map((g) => g.id));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  function refresh() {
    void loadOverview();
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingId]);

  if (loadError && !setting) {
    return (
      <div className="stack" style={{ position: "relative" }}>
        <div
          className="card"
          style={{
            borderLeft: "3px solid var(--status-cancelled)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>Не удалось загрузить сеттинг: {loadError}</span>
          <button className="primary" onClick={() => refresh()}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  // loading используется и как флаг первоначальной загрузки (пока setting===null)
  // и как индикатор обновления уже загруженных данных (saving для точечных сохранений)
  if (loading && !setting) {
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка сеттинга">
        <div
          className="card"
          style={{
            height: 140,
            opacity: 0.45,
            background: "var(--bg-elevated)",
            animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate",
          }}
        />
        <div
          className="card"
          style={{
            height: 220,
            opacity: 0.45,
            background: "var(--bg-elevated)",
            animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate",
            animationDelay: "120ms",
          }}
        />
      </div>
    );
  }

  if (!setting) {
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка сеттинга">
        <div
          className="card"
          style={{
            height: 140,
            opacity: 0.45,
            background: "var(--bg-elevated)",
            animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate",
          }}
        />
      </div>
    );
  }

  async function saveDescription(value: string) {
    setSaving(true);
    try {
      await api.put(`/settings/${settingId}`, { description: value });
      await loadOverview();
    } finally {
      setSaving(false);
    }
  }

  async function saveName(name: string, code: string) {
    // Двойник кода не запрещается, а называется: код — подсказка человеку в
    // окне неработающей ссылки, а не ключ, по которому что-то ищется.
    setSaving(true);
    try {
      const saved = await api.put<{ code_taken_by: string | null }>(`/settings/${settingId}`, {
        name,
        code,
      });
      if (saved.code_taken_by) {
        showAlert(`Код «${code}» уже носит «${saved.code_taken_by}». Это разрешено, но в ссылках оба будут выглядеть одинаково.`);
      }
      await loadOverview();
    } finally {
      setSaving(false);
    }
  }

  async function saveGenres(genres: SettingGenre[]) {
    setSaving(true);
    try {
      await api.put(`/settings/${settingId}`, { genres });
      setGenrePickerOpen(false);
      await loadOverview();
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(kind: "background" | "thumbnail", file: File) {
    const setUploading = kind === "background" ? setUploadingBg : setUploadingThumb;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/settings/${settingId}/${kind}`, form);
      await loadOverview();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    } finally {
      setUploading(false);
    }
  }

  async function deleteImage(kind: "background" | "thumbnail") {
    const ok = await confirm({
      title: kind === "background" ? "Удалить фон?" : "Удалить тамбнейл?",
      message: "Изображение будет удалено с диска.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    const setUploading = kind === "background" ? setUploadingBg : setUploadingThumb;
    setUploading(true);
    try {
      await api.del(`/settings/${settingId}/${kind}`);
      await loadOverview();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    } finally {
      setUploading(false);
    }
  }

  async function archiveSetting() {
    const ok = await confirm({
      title: "Архивировать сеттинг?",
      message: "Отправить сеттинг в архив?",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/settings/${settingId}`);
    navigate("/settings");
  }

  async function importSetting(file: File) {
    const data = JSON.parse(await file.text());
    // Файл может нести сотни мегабайт картинок. Спрашиваем один раз здесь, а
    // не гоняем флаг через маршрут молча: раскладывать их по хранилищу человек
    // не обязан, а всё остальное содержимое приезжает в любом случае.
    const heavy = file.size > 5 * 1024 * 1024;
    let withImages = true;
    if (heavy) {
      const ok = await confirm({
        title: "Импорт с изображениями?",
        message: `Файл весит ${(file.size / 1024 / 1024).toFixed(0)} МБ — похоже, в нём есть изображения.\n\nОК — поставить вместе с картинками.\nОтмена — только тексты и связи, без картинок.`,
        confirmLabel: "С картинками",
        cancelLabel: "Без картинок",
      });
      withImages = ok;
    }
    const created = await api.post<Setting>(
      `/settings/import${withImages ? "" : "?images=0"}`,
      data
    );
    navigate(`/settings/${created.id}`);
  }

  // Перетаскивание события по оси: сдвиг и уточнение — один жест. Точность
  // приходит от масштаба, на котором бросили, поэтому её отправляем вместе с
  // датой, а не вычисляем на сервере.
  async function moveCalendarEvent(
    id: number,
    date: { year: number; month: number; day: number; precision: string }
  ) {
    await api.put(`/settings/calendar-events/${id}`, {
      inworld_year: date.year,
      inworld_month: date.month,
      inworld_day: date.day,
      date_precision: date.precision,
    });
    refreshCalendarEvents();
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
    setEventModal({ year, month, day, title: "", description: "", important: false, precision: "day", status: "happened", year_end: "", month_end: "", day_end: "", cancel_note: "" });
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
      precision: ev.date_precision ?? "day",
      status: ev.status ?? "happened",
      year_end: ev.inworld_year_end != null ? String(ev.inworld_year_end) : "",
      month_end: ev.inworld_month_end != null ? String(ev.inworld_month_end) : "",
      day_end: ev.inworld_day_end != null ? String(ev.inworld_day_end) : "",
      cancel_note: ev.cancel_note ?? "",
    });
    setCalendarMenu(null);
  }

  async function deleteCalendarEvent(eventId: number) {
    const ok = await confirm({
      title: "Удалить событие?",
      message: "Это удалит его и из всех кампаний, куда оно было перенесено.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
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
    const hasPeriod = eventModal.year_end.trim() !== "" || eventModal.month_end.trim() !== "" || eventModal.day_end.trim() !== "";
    const payload: Record<string, unknown> = {
      title: eventModal.title,
      description: eventModal.description,
      inworld_year: eventModal.year,
      inworld_month: eventModal.month,
      inworld_day: eventModal.day,
      important: eventModal.important,
      date_precision: eventModal.precision,
      status: eventModal.status,
      cancel_note: eventModal.cancel_note,
      inworld_year_end: hasPeriod && eventModal.year_end.trim() !== "" ? Number(eventModal.year_end) : hasPeriod ? eventModal.year : null,
      inworld_month_end: hasPeriod && eventModal.month_end.trim() !== "" ? Number(eventModal.month_end) : hasPeriod ? eventModal.month : null,
      inworld_day_end: hasPeriod && eventModal.day_end.trim() !== "" ? Number(eventModal.day_end) : hasPeriod ? eventModal.day : null,
    };
    if (!hasPeriod) { payload.inworld_year_end = null; payload.inworld_month_end = null; payload.inworld_day_end = null; }
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
    const mentionChips = (() => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const m of (ev.description ?? "").matchAll(/\[\[(\w+):\d+\|([^\]]+)\]\]/g)) {
        const label = m[2];
        if (!seen.has(label)) { seen.add(label); out.push(label); if (out.length >= 3) break; }
      }
      return out;
    })();
    return (
      <div className="stack" style={{ gap: "var(--sp-2)" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="row chronicle-row" style={{ alignItems: "center", flexWrap: "wrap", gap: "var(--sp-2)" }}>
            {ev.description && (
              <button style={{ padding: "2px 6px" }} onClick={() => toggleEventExpanded(ev.id)}>
                {expanded ? "▾" : "▸"}
              </button>
            )}
            <span className="chronicle-date">{calendar ? formatEventDate(ev.inworld_year, ev.inworld_month, ev.inworld_day, calendar.months) : `${ev.inworld_year}.${ev.inworld_month}.${ev.inworld_day}`}</span>
            <span className={`chronicle-status is-${ev.status}`}>{ev.status === "cancelled" ? "Отменено" : ev.status === "upcoming" ? "Предстоит" : "Случилось"}</span>
            <Link to={`/events/${ev.id}`} className="chronicle-title">{ev.title}</Link>
            {mentionChips.length > 0 && (
              <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                {mentionChips.slice(0, 2).map((label) => <span key={label} className="badge tag" style={{ fontSize: "var(--fs-micro)" }}>{label}</span>)}
                {mentionChips.length > 2 && <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>+{mentionChips.length - 2}</span>}
              </span>
            )}
          </span>
          <div className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
            <button
              onClick={() => toggleEventImportant(ev)}
              title={ev.important ? "Убрать из избранного" : "В избранное"}
              className={`comp-mini ${ev.important ? "primary" : ""}`}
              style={{ padding: "2px 6px", fontSize: 14, lineHeight: 1 }}
            >
              {ev.important ? "★" : "☆"}
            </button>
            <label className="row" style={{ fontSize: "var(--fs-meta)" }}>
              <input type="checkbox" checked={!!ev.visible_to_players} onChange={() => toggleEventVisible(ev)} />
              Видно игрокам
            </label>
            <button className="comp-mini" onClick={() => openEditEventModal(ev)}>Редактировать</button>
            <button className="comp-mini" onClick={() => { setChronicleView("axis"); setTimelineFocus({ year: ev.inworld_year, month: ev.inworld_month, day: ev.inworld_day }); setTimeout(() => axisRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100); }} title="На оси">Ось</button>
            <button className="comp-mini" onClick={() => { calendarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }} title="На календаре">Календарь</button>
            <button className="comp-mini danger" onClick={() => deleteCalendarEvent(ev.id)}>✕</button>
          </div>
        </div>
        {expanded && ev.description && (
          <div className="chronicle-row__expanded" style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={ev.description} />
          </div>
        )}
      </div>
    );
  }

  // C-P0-2: гвард для background — аналог SettingsListPage (safeBackgroundImage + isSafeImageUrl)
  const safeBg = safeBackgroundImage(
    setting.background_image_url && isSafeImageUrl(setting.background_image_url)
      ? setting.background_image_url
      : null
  );

  return (
    <div className="stack" style={{ position: "relative" }}>
      {confirmDialog}
      {alertDialog}
      {safeBg && (
        <div className="campaign-bg-layer cover-photo cover-halftone" aria-hidden="true">
          <div className="cover-art-image" style={{ backgroundImage: safeBg }} />
        </div>
      )}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionHeading section="settings" compact>
            <span id="section-overview-title" style={{ scrollMarginTop: 16 }}>
              {tab === "Обзор" ? (
                setting.name
              ) : (
                <button type="button" className="entity-title-link" onClick={() => selectTab("Обзор")} title="К обзору">
                  {setting.name}
                </button>
              )}
            </span>
          </SectionHeading>
          <div className="row" style={{ gap: 6, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
            <EntityTypeChip type="setting" />
            {(setting as any).archived_at && <span className="badge cancelled">Архивировано</span>}
          </div>
        </div>
        <div className="entity-header-actions" style={{ flexShrink: 0 }}>
          {/* Имя правится в карточке «Описание» на «Обзоре» — вместе с самим
              описанием, одной кнопкой «Сохранить». */}
          {saving && <span className="muted" aria-live="polite">Сохранение…</span>}
          <button onClick={() => setShowExport(true)}>Экспорт</button>
          <label
            style={{
              background: "var(--bg-elevated)",
              border: "var(--card-border-width, 1px) solid var(--line)",
              color: "var(--text-bright)",
              borderRadius: 0,
              padding: "6px 12px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Импорт
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && importSetting(e.target.files[0])}
            />
          </label>
          <button className="danger" onClick={archiveSetting}>
            <NavIcon name="archive" /> Архивировать
          </button>
        </div>
      </div>

      {showExport && (
        <SettingExportModal settingId={settingId} settingName={setting.name} onClose={() => setShowExport(false)} />
      )}

      {genrePickerOpen && (
        <GenrePicker
          selected={setting.genres ?? []}
          onSave={saveGenres}
          onClose={() => setGenrePickerOpen(false)}
        />
      )}

      {creatingEvent && (
        <EntityWizard
          initialType="event"
          ctx={{ settingId }}
          onClose={() => setCreatingEvent(false)}
          onCreated={refreshCalendarEvents}
        />
      )}

      {loadError && setting && (
        <div
          className="card"
          style={{
            borderLeft: "3px solid var(--status-cancelled)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>Ошибка загрузки: {loadError}</span>
          <button className="primary" onClick={() => refresh()}>
            Повторить
          </button>
        </div>
      )}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => selectTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Обзор" && (
        <div className="stack setting-overview">
          {(() => {
            const hasDesc = !!setting.description?.trim();
            const hasGenres = !!(setting.genres && setting.genres.length > 0);
            const hasCampaigns = campaigns.length > 0;
            const done = (hasDesc ? 1 : 0) + (hasGenres ? 1 : 0) + (hasCampaigns ? 1 : 0);
            if (done === 3) return null;
            return (
              <div className="card stack" style={{ borderLeft: "3px solid var(--accent)" }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>Начните с этих 3 шагов</h3>
                  <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                    {done}/3
                  </span>
                </div>
                <span className="muted">Заполните базу, чтобы сеттинг ожил в списках и кампаниях.</span>
                <div className="stack">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center", opacity: hasDesc ? 0.6 : 1 }}>
                    <span className="row" style={{ gap: 6 }}>
                      <span>{hasDesc ? "✓" : "○"}</span> Заполнить описание
                    </span>
                    {!hasDesc && (
                      <button
                        className="small"
                        onClick={() => document.getElementById("section-overview-title")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      >
                        Заполнить →
                      </button>
                    )}
                  </div>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center", opacity: hasGenres ? 0.6 : 1 }}>
                    <span className="row" style={{ gap: 6 }}>
                      <span>{hasGenres ? "✓" : "○"}</span> Выбрать жанры {hasGenres ? `· ${setting.genres!.length}` : ""}
                    </span>
                    {!hasGenres && (
                      <button className="small" onClick={() => setGenrePickerOpen(true)}>
                        Выбрать →
                      </button>
                    )}
                  </div>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center", opacity: hasCampaigns ? 0.6 : 1 }}>
                    <span className="row" style={{ gap: 6 }}>
                      <span>{hasCampaigns ? "✓" : "○"}</span> Привязать кампанию {hasCampaigns ? `· ${campaigns.length}` : ""}
                    </span>
                    {!hasCampaigns && (
                      <button className="small" onClick={openCampaignWizard}>
                        Создать →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
          <EditableTextCard
            key={`description-${setting.id}`}
            title="Описание"
            value={setting.description}
            onSave={saveDescription}
            rows={6}
            entityType="setting"
            entityId={settingId}
            defaultSettingId={settingId}
            fields={[
              { key: "name", label: "Имя", value: setting.name, required: true },
              {
                key: "code",
                label: "Код",
                value: setting.code ?? "",
                placeholder: "wdh",
                pattern: "^[a-z0-9-]{2,8}$",
                title: 'Пример: wdh → Waterdeep: Dragon Heist. Короткое сокращение для ссылок [[wdh:…]]. Латиница, 2–8 символов.',
              },
            ]}
            onSaveFields={(v) => saveName(v.name, v.code)}
          >
            <div style={{ marginTop: 8 }}>
              <div className="row" style={{ alignItems: "center", gap: 6 }}>
                <strong>Жанры</strong>
                <button
                  className="genre-add-btn"
                  onClick={() => setGenrePickerOpen(true)}
                  title="Выбрать жанры"
                  aria-label="Выбрать жанры"
                >+</button>
              </div>
              <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>До 3 жанров — помогают фильтровать в списке сеттингов.</span>
              {setting.genres && setting.genres.length > 0 ? (
                <div className="genre-chips" style={{ marginTop: 4 }}>
                  {setting.genres.map((g, i) => {
                    const cat = GENRE_CATEGORIES.find((c) => c.name === g.genre);
                    return (
                      <span key={i} className="genre-chip genre-chip--selected">
                        {cat && <ZineGraphic name={cat.icon} className="genre-chip-icon" />}
                        {g.subgenre ?? g.genre}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>Жанры не выбраны</span>
              )}
            </div>

            {allGroups.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Группы сеттингов</strong>
                  <Link to="/settings" style={{ fontSize: "var(--fs-micro)", textDecoration: "underline" }}>Настроить группы →</Link>
                </div>
                <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>Папки-группы из списка сеттингов — отметьте, куда входит этот сеттинг.</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                  {allGroups.map((g) => {
                    const isIn = settingGroupIds.includes(g.id);
                    return (
                      <label
                        key={g.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                          padding: "4px 8px",
                          borderRadius: 0,
                          border: `1px solid ${isIn ? "var(--accent)" : "var(--line)"}`,
                          background: isIn ? "var(--accent-bg, rgba(79, 140, 255, 0.08))" : "transparent",
                          fontSize: "var(--fs-meta)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isIn}
                          onChange={async () => {
                            if (isIn) {
                              await api.del(`/setting-groups/${g.id}/members?settingIds=${settingId}`);
                            } else {
                              await api.post(`/setting-groups/${g.id}/members`, { settingIds: [settingId] });
                            }
                            const groups = await api.get<SettingGroup[]>(`/setting-groups/by-setting/${settingId}`);
                            setSettingGroupIds(groups.map((gr) => gr.id));
                          }}
                        />
                        {g.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </EditableTextCard>

          <div className="card res-group" id="section-campaigns">
            <div className="res-group__band" style={{ cursor: "default" }}>
              <span className="res-group__title">Кампании и персонажи</span>
              <span className="res-group__count">{campaigns.length}</span>
              <span style={{ marginLeft: "auto" }}>
                <button className="primary small" onClick={openCampaignWizard}>
                  + Новая кампания
                </button>
              </span>
            </div>
            <div className="res-group__body" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 16 }}>
            {campaigns.length === 0 ? (
              <EmptyState
                title="Кампаний нет"
                hint="Привяжите кампанию к этому сеттингу — и она появится здесь."
                action={
                  <button onClick={openCampaignWizard}>
                    + Новая кампания в этом сеттинге
                  </button>
                }
              />
            ) : (
              campaigns.map((c) => {
                const campChars = characters.filter((ch) => ch.campaign_id === c.id);
                return (
                  <div key={c.id} className="campaign-row">
                    <div className="campaign-row-main">
                      <SettingCampaignTile campaign={c} />
                    </div>
                    <div className="campaign-row-chars">
                      {campChars.length > 0 ? (
                        campChars.map((ch) => (
                          <SettingCharacterTile key={ch.id} character={ch} />
                        ))
                      ) : (
                        <div className="muted" style={{ fontSize: "var(--fs-micro)", padding: "12px 0" }}>
                          Нет персонажей
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            </div>
          </div>
          {campaignWizardOpen && (
            <CampaignWizard
              systems={wizardSystems}
              settings={wizardSettings}
              defaultSettingId={settingId}
              onClose={() => setCampaignWizardOpen(false)}
              onCreated={() => {
                setCampaignWizardOpen(false);
                refresh();
              }}
            />
          )}

          <div className="card" id="section-related">
            <LinkDropZone entityType="setting" entityId={settingId} title="Связанные сущности" />
          </div>

          <div className="card res-group" id="section-images">
            <div className="res-group__band" style={{ cursor: "default" }}>
              <span className="res-group__title">Изображения сеттинга</span>
            </div>
            <div className="res-group__body" style={{ padding: 12 }}>
            <div className="entity-image-slots">
              <EntityImageSlot
                title="Фон профиля"
                hint="Подложка на всех страницах сеттинга. Рекомендуем 1920×1080, до 15 MB, JPG/PNG/GIF/WebP/AVIF."
                url={setting.background_image_url}
                wide
                uploading={uploadingBg}
                onSelect={bgCrop.onSelect}
                onDelete={() => deleteImage("background")}
              />
              <EntityImageSlot
                title="Тамбнейл — 16×10"
                hint="Карточка в списке сеттингов. Рекомендуем 900×562 (16×10), до 15 MB, JPG/PNG/GIF/WebP/AVIF."
                url={setting.thumbnail_image_url}
                uploading={uploadingThumb}
                onSelect={thumbCrop.onSelect}
                onDelete={() => deleteImage("thumbnail")}
              />
            </div>
            </div>
            {bgCrop.modal}
            {thumbCrop.modal}
          </div>

          <CrossLinksWizard
            ownerKind="setting"
            ownerId={settingId}
            help="Ищет имена в описаниях локаций, историях личностей, полях сообществ, силе предметов и синопсисах приключений — и делает их кликабельными. Шаг за шагом, по одному типу цели: у каждого своя строгость. Сцены размечает такой же проход на странице приключения. Ничего не пишет, пока вы не подтвердите."
          />
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
          <div ref={calendarRef} className="card stack">
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

          {/* Циклы рядом с календарём: и то и другое — устройство мира,
              заводится один раз при создании сеттинга. */}
          <SettingCycles settingId={settingId} />

          <div ref={axisRef} className="card stack">
            <div className="tabs" style={{ justifyContent: "space-between", width: "100%" }}>
              <div className="row" style={{ gap: 0 }}>
                <button className={chronicleView === "list" ? "active" : ""} onClick={() => setChronicleView("list")}>Список</button>
                <button className={chronicleView === "axis" ? "active" : ""} onClick={() => setChronicleView("axis")}>Ось</button>
              </div>
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

            <div className="row" style={{ gap: 8, flexWrap: "wrap" }} hidden={chronicleView === "axis"}>
              <input placeholder="Поиск по хроноике: название, описание" value={worldFilter} onChange={(e) => setWorldFilter(e.target.value)} style={{ flex: "1 1 220px" }} />
              {worldFilter && <button onClick={() => setWorldFilter("")}>Сбросить</button>}
              <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>{filteredCalendarEvents.length} из {calendarEvents.length}</span>
            </div>

            {chronicleView === "axis" && (
              <Timeline
                focusDate={timelineFocus}
                events={filteredCalendarEvents.map((e) => ({
                  id: e.id,
                  title: e.title,
                  year: e.inworld_year,
                  month: e.inworld_month,
                  day: e.inworld_day,
                  precision: e.date_precision,
                  year_end: e.inworld_year_end,
                  month_end: e.inworld_month_end,
                  day_end: e.inworld_day_end,
                  status: e.status,
                  important: e.important === 1,
                }))}
                months={calendar?.months ?? []}
                era={calendar?.era ?? ""}
                now={
                  setting.pinned_calendar_year != null && setting.pinned_calendar_month != null
                    ? { year: setting.pinned_calendar_year, month: setting.pinned_calendar_month }
                    : null
                }
                cycles={cycles}
                onMoveEvent={moveCalendarEvent}
                onNowChange={(date) => pinSettingCalendar(date)}
                onEventClick={(id) => navigate(`/events/${id}`)}
              />
            )}

            <div className="stack chronicle-stack" hidden={chronicleView === "axis"}>
              {eraBuckets.map((bucket) => (
                <details key={bucket.era?.id ?? "no-era"} className="card">
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
            <div className="row" style={{ flexWrap: "wrap" }}>
              <label className="row">
                Точность
                <select value={eventModal.precision} onChange={(e) => setEventModal({ ...eventModal, precision: e.target.value as import("../types").DatePrecision })}>
                  <option value="day">День</option>
                  <option value="month">Месяц</option>
                  <option value="year">Год</option>
                  <option value="decade">Десятилетие</option>
                  <option value="century">Век</option>
                </select>
              </label>
              <label className="row">
                Статус
                <select value={eventModal.status} onChange={(e) => setEventModal({ ...eventModal, status: e.target.value as import("../types").EventStatus })}>
                  <option value="happened">Случилось</option>
                  <option value="upcoming">Предстоит</option>
                  <option value="cancelled">Отменено</option>
                </select>
              </label>
            </div>
            {eventModal.status === "cancelled" && (
              <label className="stack" style={{ gap: 4 }}>
                Чем отменилось
                <input placeholder="Что игроки сделали, чтобы этого не произошло" value={eventModal.cancel_note} onChange={(e) => setEventModal({ ...eventModal, cancel_note: e.target.value })} />
              </label>
            )}
            <details className="card" style={{ padding: 10 }}>
              <summary>Период (если событие растянуто)</summary>
              <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                <label className="row">Год до <input type="number" style={{ width: 90 }} placeholder="—" value={eventModal.year_end} onChange={(e) => setEventModal({ ...eventModal, year_end: e.target.value })} /></label>
                <label className="row">Мес. до <input type="number" style={{ width: 70 }} placeholder="—" value={eventModal.month_end} onChange={(e) => setEventModal({ ...eventModal, month_end: e.target.value })} /></label>
                <label className="row">День до <input type="number" style={{ width: 70 }} placeholder="—" value={eventModal.day_end} onChange={(e) => setEventModal({ ...eventModal, day_end: e.target.value })} /></label>
              </div>
              <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>Оставьте пустым — событие точечное. Заполните — период («осада март–май»).</span>
            </details>
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

// Corkboard-with-threads view of every relation between this setting's
// beings, factions, and locations (player characters are deliberately left
// out here — per the user's original ask, this graph is scoped to "все
// существа и фракции сеттинга"; locations were added afterwards since
// mention-links can connect to them too).
function SettingGraphTab({ settingId }: { settingId: number }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Раньше вкладка звала три захардкоженных типа: артефакты, сцены и
  // приключения сеттинга в его же граф не попадали, и переключить это было
  // нечем. Теперь тот же отбор, что и на общей странице, но из типов, у
  // которых внутри сеттинга есть дом.
  const [activeTypes] = useState<Set<string>>(
    () => new Set(SETTING_SCOPED_TYPES)
  );

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      types: Array.from(activeTypes).join(","),
      setting_id: String(settingId),
    });
    api.get<GraphData>(`/links/graph?${params.toString()}`, { signal: controller.signal })
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Ошибка загрузки графа");
      });
    return () => controller.abort();
  }, [settingId, activeTypes]);

  return (
    <div className="card stack">
      {error && (
        <div className="error-banner">
          {error}
          <button type="button" onClick={() => setError(null)}>Повторить</button>
        </div>
      )}
      <RelationGraph
        data={data}
        layoutKey={`setting:${settingId}`}
        emptyMessage={
          activeTypes.size === 0
            ? "Все типы сняты в фильтрах — отметьте хотя бы один."
            : "Связей между сущностями этого сеттинга пока нет."
        }
      />
    </div>
  );
}

function GeographyTab({ settingId }: { settingId: number }) {
  return (
    <div className="card stack geography-tree">
      <LocationTree settingId={settingId} />
    </div>
  );
}

// Артефакты moved out to their own top-level "Сокровищница" tab — they're
// not population. Личности holds *named* personalities only; unnamed
// creature kinds get their own Бестиарий subsection.
const POPULATION_SECTIONS = ["Личности", "Бестиарий", "Сообщества"] as const;

function PopulationTab({ settingId }: { settingId: number }) {
  const [section, setSection] = useState<(typeof POPULATION_SECTIONS)[number]>(() => {
    const p = new URLSearchParams(window.location.search).get("population");
    return (POPULATION_SECTIONS as readonly string[]).includes(p ?? "") ? (p as typeof POPULATION_SECTIONS[number]) : "Личности";
  });
  const [counts, setCounts] = useState<{ beings: number | null; bestiary: number | null; communities: number | null }>({ beings: null, bestiary: null, communities: null });
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("population", section);
    window.history.replaceState(null, "", url.toString());
  }, [section]);

  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal } as const;
    // Батч счётчиков — лёгкие COUNT-запросы, без общей транзакции
    Promise.all([
      api.get<SettingBeing[]>(`/setting-beings?setting_id=${settingId}&exclude_category=bestiary`, opts).then(r => r.length).catch(() => null),
      api.get<SettingBeing[]>(`/setting-beings?setting_id=${settingId}&category=bestiary`, opts).then(r => r.length).catch(() => null),
      api.get<SettingCommunity[]>(`/setting-communities?setting_id=${settingId}&parent_id=null`, opts).then(r => r.length).catch(() => null),
    ]).then(([b, best, c]) => {
      if (controller.signal.aborted) return;
      setCounts({ beings: b, bestiary: best, communities: c });
    });
    return () => controller.abort();
  }, [settingId]);

  const label = (s: typeof POPULATION_SECTIONS[number]) => {
    if (s === "Личности" && counts.beings != null) return `Личности · ${counts.beings}`;
    if (s === "Бестиарий" && counts.bestiary != null) return `Бестиарий · ${counts.bestiary}`;
    if (s === "Сообщества" && counts.communities != null) return `Сообщества · ${counts.communities}`;
    return s;
  };

  return (
    <div className="card stack population-tab" id="population">
      <div className="tabs" role="tablist">
        {POPULATION_SECTIONS.map((s) => (
          <button key={s} role="tab" aria-selected={section === s} className={section === s ? "active" : ""} onClick={() => setSection(s)}>
            {label(s)}
          </button>
        ))}
      </div>
      {section === "Личности" && <div id="population-beings"><BeingsSection settingId={settingId} /></div>}
      {section === "Бестиарий" && <div id="population-bestiary"><BestiarySection settingId={settingId} /></div>}
      {section === "Сообщества" && <div id="population-communities"><CommunitiesSection settingId={settingId} /></div>}
    </div>
  );
}

function BeingsSection({ settingId }: { settingId: number }) {
  const [category, setCategory] = useState<BeingCategory | "all">("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [communityFilter, setCommunityFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [sort, setSort] = useState<"name" | "recent" | "category" | "community">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [beings, setBeings] = useState<SettingBeing[]>([]);
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const [allCommunities, setAllCommunities] = useState<SettingCommunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<{ id: string; name: string; filters: { category: string; locationFilter: string; communityFilter: string; query: string; sort: string; sortDir: string } }[]>(() => {
    try { return JSON.parse(localStorage.getItem(`population-presets-${settingId}`) || "[]"); } catch { return []; }
  });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkFaction, setBulkFaction] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  // debounce 250ms — шлём q не на каждый символ
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  function handleSort(next: typeof sort) {
    if (sort === next) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(next); setSortDir("asc"); }
  }

  function refresh(signal?: AbortSignal) {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ setting_id: String(settingId) });
    if (category !== "all") params.set("category", category);
    else params.set("exclude_category", "bestiary");
    if (locationFilter) params.set("location_id", locationFilter);
    if (communityFilter) params.set("community_id", communityFilter);
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    if (sort !== "name" && sort !== "community") params.set("sort", sort);
    if (sortDir === "desc") params.set("dir", "desc");
    const opts = signal ? { signal } : undefined;
    api
      .get<SettingBeing[]>(`/setting-beings?${params.toString()}`, opts)
      .then((rows) => {
        setBeings(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setLoadError(String(e instanceof Error ? e.message : e));
        setLoading(false);
      });
  }
  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingId, category, locationFilter, communityFilter, debouncedQuery, sort, sortDir]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`, { signal: controller.signal })
      .then(setLocations)
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
      });
    return () => controller.abort();
  }, [settingId]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<SettingCommunity[]>(`/setting-communities?setting_id=${settingId}`, { signal: controller.signal })
      .then(setAllCommunities)
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
      });
    return () => controller.abort();
  }, [settingId]);

  useEffect(() => {
    localStorage.setItem(`population-presets-${settingId}`, JSON.stringify(presets));
  }, [presets, settingId]);

  function savePreset() {
    if (!presetName.trim()) return;
    const newPreset = { id: Date.now().toString(), name: presetName.trim(), filters: { category, locationFilter, communityFilter, query, sort, sortDir } };
    setPresets((prev) => [...prev, newPreset]);
    setPresetName("");
  }
  function applyPreset(p: typeof presets[0]) {
    setCategory(p.filters.category as BeingCategory | "all");
    setLocationFilter(p.filters.locationFilter);
    setCommunityFilter(p.filters.communityFilter);
    setQuery(p.filters.query);
    setSort(p.filters.sort as typeof sort);
    setSortDir(p.filters.sortDir as typeof sortDir);
  }
  function deletePreset(id: string) {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function bulkAddToFaction() {
    if (!bulkFaction || selectedIds.size === 0) return;
    setBulkSaving(true);
    try {
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map((id) => api.post(`/setting-communities/${bulkFaction}/members`, { being_id: id })));
      setSelectedIds(new Set());
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setBulkSaving(false);
    }
  }

  async function duplicateBeing(being: SettingBeing) {
    try {
      await api.post("/setting-beings", {
        setting_id: settingId,
        name: `Копия — ${being.name}`,
        category: being.category,
        location_id: being.location_id,
        statblock_short: being.statblock_short,
        statblock_full: being.statblock_full,
        history: being.history,
        behavior: being.behavior,
        description: being.description,
        tags: being.tags,
        // Копируем связи через отдельный шаг? Пока базовые поля — остальное дотянет профиль
      });
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    }
  }

  async function deleteBeing(beingId: number) {
    const ok = await confirm({
      title: "Архивировать личность?",
      message: "Будет скрыта из списков, связи останутся. Можно восстановить в архиве.",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/setting-beings/${beingId}`);
    refresh();
  }

  return (
    <div className="stack" style={{ paddingBottom: "calc(var(--player-bar-height, 52px) + 16px)" }}>
      {confirmDialog}
      <div className="sort-toggle" role="tablist" aria-label="Категории личностей">
        {NAMED_BEING_CATEGORIES.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={category === c.key}
            className={category === c.key ? "active-sort" : ""}
            onClick={() => setCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="row sort-toggle" role="tablist" aria-label="Сортировка">
        <span className="muted" style={{ fontSize: "11px", alignSelf: "center" }}>Сортировка:</span>
        <button className={sort === "name" ? "active-sort" : ""} onClick={() => handleSort("name")}>А-Я{sort === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
        <button className={sort === "recent" ? "active-sort" : ""} onClick={() => handleSort("recent")}>Недавние{sort === "recent" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
        <button className={sort === "category" ? "active-sort" : ""} onClick={() => handleSort("category")}>По типу{sort === "category" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
        <button className={sort === "community" ? "active-sort" : ""} onClick={() => handleSort("community")}>По фракциям{sort === "community" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
      </div>
      <div className="row">
        <button className="primary" onClick={() => setCreating(true)}>
          Создать личность
        </button>
      </div>
      {creating && (
        <EntityWizard
          initialType="being"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
          onCreated={() => refresh()}
        />
      )}
      <div className="row" style={{ gap: 8 }}>
        <input
          placeholder="Поиск: имя, связанное существо или сообщество…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск личностей"
          style={{ flex: 1 }}
        />
        {/* Фильтр спрятан, поэтому кнопка сама говорит, что он включён —
            иначе непонятно, почему список короче, чем ожидаешь. */}
        <button
          className={`toggle-button${filtersOpen || locationFilter || communityFilter ? " active" : ""}`}
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          Фильтры{(locationFilter || communityFilter) ? ` (${(locationFilter ? 1 : 0) + (communityFilter ? 1 : 0)})` : ""}
        </button>
      </div>
      {filtersOpen && (
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center", padding: "8px 0" }}>
          <LocationFilter locations={locations} value={locationFilter} onChange={setLocationFilter} />
          <div className="row" style={{ gap: 8, alignItems: "center", flex: "1 1 220px" }}>
            <label className="muted" style={{ fontSize: "11px", minWidth: 60 }}>Фракция:</label>
            <select value={communityFilter} onChange={(e) => setCommunityFilter(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
              <option value="">Все фракции</option>
              <option value="none">Без фракции</option>
              {allCommunities.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
            {communityFilter && <button onClick={() => setCommunityFilter("")}>Сбросить</button>}
          </div>
        </div>
      )}
      {locationFilter && (
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          Фильтр по локации активен — показаны вложенные тоже
        </span>
      )}
      {communityFilter && (
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          Фильтр по фракции: {communityFilter === "none" ? "без фракции" : allCommunities.find((c) => String(c.id) === communityFilter)?.name ?? communityFilter}
        </span>
      )}
      {debouncedQuery.trim() && (
        <span className="muted">
          Показаны существа с этим именем, описанием, тегами, а также связанные с ним через отношения,
          сообщества/народы/культуры или общую локацию.
        </span>
      )}
      <div className="stack" style={{ gap: 6, paddingTop: 8, borderTop: "1px solid var(--line)" }} title="Пресет сохраняет: категория, локация, фракция, поиск, сортировка. Клик по чипу — применить.">
        <span className="muted" style={{ fontSize: "11px", lineHeight: 1.3 }} title="Наведите на чип — покажет что внутри, на × — удалить">
          💾 Пресет — это сохранённый вид списка (фильтры + поиск + сортировка). Сохраните текущий набор, чтобы вернуться к нему одним кликом.
        </span>
        {presets.length > 0 && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted" style={{ fontSize: "11px" }}>Пресеты:</span>
            {presets.map((p) => (
              <span key={p.id} className="badge tag" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }} title={`Применить: ${p.filters.category} · ${p.filters.sort} ${p.filters.sortDir} · ${p.filters.query || "без поиска"}`}>
                <span onClick={() => applyPreset(p)} style={{ cursor: "pointer" }}>{p.name}</span>
                <button type="button" className="tag-chip-remove" onClick={() => deletePreset(p.id)} title="Удалить пресет">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <input placeholder="Имя пресета — напр. Вотердип · Орден" value={presetName} onChange={(e) => setPresetName(e.target.value)} style={{ width: 220, fontSize: "12px" }} title="Напишите имя и нажмите Сохранить — текущий набор фильтров запомнится" />
          <button disabled={!presetName.trim()} onClick={savePreset} style={{ fontSize: "12px" }} title="Сохранит категорию, локацию, фракцию, поиск и сортировку">Сохранить вид</button>
        </div>
      </div>
      {selectedIds.size > 0 && (
        <div className="row" style={{ gap: 8, alignItems: "center", padding: "8px", background: "var(--bg-elevated)", border: "1px solid var(--line)", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: "11px" }}>Выбрано {selectedIds.size}</span>
          <select value={bulkFaction} onChange={(e) => setBulkFaction(e.target.value)} style={{ flex: "1 1 200px", minWidth: 160 }}>
            <option value="">Выберите фракцию</option>
            {allCommunities.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </select>
          <button className="primary" disabled={!bulkFaction || bulkSaving} onClick={bulkAddToFaction}>{bulkSaving ? "Добавляю…" : "Добавить в фракцию"}</button>
          <button onClick={() => setSelectedIds(new Set())}>Сбросить</button>
          <button onClick={() => { const all = new Set(beings.map((b) => b.id)); setSelectedIds(all); }}>Выбрать всех</button>
        </div>
      )}
      {loadError && (
        <div
          className="card"
          style={{
            borderLeft: "3px solid var(--status-cancelled)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>Не удалось загрузить личностей: {loadError}</span>
          <button className="primary" onClick={() => refresh()}>
            Повторить
          </button>
        </div>
      )}
      {loading && beings.length === 0 && !loadError ? (
        <div className="stack" aria-busy="true" aria-label="Загрузка личностей">
          <div className="card" style={{ height: 48, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate" }} />
          <div className="card" style={{ height: 48, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate", animationDelay: "120ms" }} />
        </div>
      ) : beings.length === 0 && !loading && !loadError ? (
        <EmptyState
          title="Личностей пока нет"
          hint="Ключевые фигуры, влиятельные и примечательные — начните с первой."
          action={
            <button className="primary" onClick={() => setCreating(true)}>
              Создать личность
            </button>
          }
        />
      ) : (
        <SettingBeingTileGrid beings={beings} grouping={sort === "category" ? "category" : sort === "community" ? "community" : "alpha"} searchActive={!!debouncedQuery.trim()} dir={sortDir} onCreate={() => setCreating(true)} selectedIds={selectedIds} onToggleSelect={toggleSelect} />
      )}
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
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [creating, setCreating] = useState(false);
  const [locationFilter, setLocationFilter] = useState("");
  const [sort, setSort] = useState<"name" | "recent">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  function handleSort(next: typeof sort) {
    if (sort === next) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(next); setSortDir("asc"); }
  }

  function refresh(signal?: AbortSignal) {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ setting_id: String(settingId), category: "bestiary" });
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    if (locationFilter) params.set("location_id", locationFilter);
    if (sort !== "name") params.set("sort", sort);
    if (sortDir === "desc") params.set("dir", "desc");
    const opts = signal ? { signal } : undefined;
    api
      .get<SettingBeing[]>(`/setting-beings?${params.toString()}`, opts)
      .then((rows) => {
        setBeings(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setLoadError(String(e instanceof Error ? e.message : e));
        setLoading(false);
      });
  }
  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingId, debouncedQuery, locationFilter, sort, sortDir]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`, { signal: controller.signal })
      .then(setLocations)
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
      });
    return () => controller.abort();
  }, [settingId]);

  async function duplicateBeing(being: SettingBeing) {
    try {
      await api.post("/setting-beings", {
        setting_id: settingId,
        name: `Копия — ${being.name}`,
        category: "bestiary",
        statblock_short: being.statblock_short,
        statblock_full: being.statblock_full,
        history: being.history,
        behavior: being.behavior,
        description: being.description,
        tags: being.tags,
      });
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    }
  }

  async function deleteBeing(beingId: number) {
    const ok = await confirm({
      title: "Архивировать запись бестиария?",
      message: "Будет скрыта из списков. Можно восстановить в архиве.",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/setting-beings/${beingId}`);
    refresh();
  }

  return (
    <div className="stack" style={{ paddingBottom: "calc(var(--player-bar-height, 52px) + 16px)" }}>
      {confirmDialog}
      <p className="muted" style={{ maxWidth: "none" }}>
        Бестиарий сеттинга — виды и типы существ без имени, населяющие этот мир. Именные
        персонажи живут в разделе «Личности». Запись бестиария можно связать с монстрами из
        компендиумов систем на её собственной странице.
      </p>
      <div className="row">
        <button className="primary" onClick={() => setCreating(true)}>
          Создать запись бестиария
        </button>
      </div>
      {creating && (
        <EntityWizard
          initialType="bestiary"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
          onCreated={() => refresh()}
        />
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div className="row sort-toggle" style={{ gap: 4 }}>
          <button className={sort === "name" ? "active-sort" : ""} onClick={() => handleSort("name")}>А-Я{sort === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
          <button className={sort === "recent" ? "active-sort" : ""} onClick={() => handleSort("recent")}>Недавние{sort === "recent" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
        </div>
        <input
          placeholder="Поиск по бестиарию…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск по бестиарию"
          style={{ flex: 1 }}
        />
        <LocationFilter locations={locations} value={locationFilter} onChange={setLocationFilter} />
      </div>
      {loadError && (
        <div
          className="card"
          style={{
            borderLeft: "3px solid var(--status-cancelled)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>Не удалось загрузить бестиарий: {loadError}</span>
          <button className="primary" onClick={() => refresh()}>
            Повторить
          </button>
        </div>
      )}
      {loading && beings.length === 0 && !loadError ? (
        <div className="stack" aria-busy="true" aria-label="Загрузка бестиария">
          <div className="card" style={{ height: 48, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate" }} />
        </div>
      ) : beings.length === 0 && !loading && !loadError ? (
        <EmptyState
          title="Бестиарий пока пуст"
          hint="Виды без имени — гоблины, утопленники, духи леса. Добавьте первый."
          action={
            <button className="primary" onClick={() => setCreating(true)}>
              Создать запись бестиария
            </button>
          }
        />
      ) : (
        <SettingBeingTileGrid beings={beings} grouping="alpha" searchActive={!!debouncedQuery.trim()} dir={sortDir} onCreate={() => setCreating(true)} />
      )}
    </div>
  );
}

function CommunitiesSection({ settingId }: { settingId: number }) {
  const navigate = useNavigate();
  const [communities, setCommunities] = useState<SettingCommunity[]>([]);
  const [creating, setCreating] = useState(false);
  const [locationFilter, setLocationFilter] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [sort, setSort] = useState<"name" | "recent">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  function handleSort(next: typeof sort) {
    if (sort === next) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(next); setSortDir("asc"); }
  }

  function refresh(signal?: AbortSignal) {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ setting_id: String(settingId) });
    // Без фильтра список остаётся витриной верхнего уровня (вложенные живут на
    // странице родителя). С фильтром это бессмысленно: вложенное сообщество
    // без локации иначе просто не покажется — поэтому ищем по всем уровням.
    if (locationFilter) params.set("location_id", locationFilter);
    else if (!debouncedQuery.trim()) params.set("parent_id", "null");
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    if (sort !== "name") params.set("sort", sort);
    if (sortDir === "desc") params.set("dir", "desc");
    const opts = signal ? { signal } : undefined;
    api
      .get<SettingCommunity[]>(`/setting-communities?${params.toString()}`, opts)
      .then((rows) => {
        setCommunities(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setLoadError(String(e instanceof Error ? e.message : e));
        setLoading(false);
      });
  }
  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingId, locationFilter, debouncedQuery, sort, sortDir]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`, { signal: controller.signal })
      .then(setLocations)
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
      });
    return () => controller.abort();
  }, [settingId]);

  async function deleteCommunity(id: number) {
    const ok = await confirm({
      title: "Архивировать сообщество?",
      message: "Будет скрыто из списков, личности останутся. Можно восстановить в архиве.",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/setting-communities/${id}`);
    refresh();
  }

  return (
    <div className="stack" style={{ paddingBottom: "calc(var(--player-bar-height, 52px) + 16px)" }}>
      {confirmDialog}
      <p className="muted" style={{ maxWidth: "none" }}>
        Сообщества — любые объединения (народы, культуры, фракции, гильдии), к которым можно
        отнести личностей из раздела «Личности». Здесь показаны верхнеуровневые — вложенные
        (например, отдельный город внутри королевства) создаются на странице родительского
        сообщества, во вкладке «Вложенные сообщества».
      </p>
      <div className="row">
        <button className="primary" onClick={() => setCreating(true)}>
          Создать сообщество
        </button>
      </div>
      {creating && (
        <EntityWizard
          initialType="community"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
          onCreated={() => refresh()}
        />
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div className="row sort-toggle" style={{ gap: 4 }}>
          <button className={sort === "name" ? "active-sort" : ""} onClick={() => handleSort("name")}>А-Я{sort === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
          <button className={sort === "recent" ? "active-sort" : ""} onClick={() => handleSort("recent")}>Недавние{sort === "recent" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
        </div>
        <input
          placeholder="Поиск по сообществам…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск по сообществам"
          style={{ flex: 1, minWidth: 160 }}
        />
        <LocationFilter locations={locations} value={locationFilter} onChange={setLocationFilter} />
      </div>
      {locationFilter && !debouncedQuery.trim() && (
        <span className="muted">
          С фильтром показаны и вложенные сообщества, не только верхнеуровневые.
        </span>
      )}
      {debouncedQuery.trim() && <span className="muted">Поиск по имени — {communities.length} найдено</span>}
      {loadError && (
        <div
          className="card"
          style={{
            borderLeft: "3px solid var(--status-cancelled)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>Не удалось загрузить сообщества: {loadError}</span>
          <button className="primary" onClick={() => refresh()}>
            Повторить
          </button>
        </div>
      )}
      {loading && communities.length === 0 && !loadError ? (
        <div className="stack" aria-busy="true" aria-label="Загрузка сообществ">
          <div className="card" style={{ height: 48, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate" }} />
        </div>
      ) : communities.length === 0 && !loading && !loadError ? (
        <EmptyState
          title="Сообществ пока нет"
          hint="Народы, культуры, фракции, гильдии — начните с первого объединения."
          action={
            <button className="primary" onClick={() => setCreating(true)}>
              Создать сообщество
            </button>
          }
        />
      ) : (
        <SettingCommunityTileGrid communities={communities} searchActive={!!debouncedQuery.trim()} dir={sortDir} onCreate={() => setCreating(true)} />
      )}
    </div>
  );
}

function ArtifactsTab({ settingId }: { settingId: number }) {
  const navigate = useNavigate();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [creating, setCreating] = useState(false);
  const [confirmDialog, confirm] = useConfirm();

  function refresh() {
    api.get<Artifact[]>(`/artifacts?setting_id=${settingId}`).then(setArtifacts);
  }
  useEffect(refresh, [settingId]);

  async function deleteArtifact(id: number) {
    const ok = await confirm({ message: "Отправить артефакт в архив?", confirmLabel: "Архивировать", danger: true });
    if (!ok) return;
    await api.del(`/artifacts/${id}`);
    refresh();
  }

  return (
    <div className="stack">
      {confirmDialog}
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
          География, население, сообщества, их главы, связи и отношения экспортируются всегда. Что добавить ещё:
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
          Изображения, галереи, карты локаций (с пинами) и звуковые файлы (значительно увеличит размер файла)
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
