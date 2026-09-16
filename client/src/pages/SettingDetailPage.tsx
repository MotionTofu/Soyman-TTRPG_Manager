import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { dataKeys, type Affect } from "../data/entities";
import { useAction, useAfterWrite, useEntity, useResource, useSaveEntity, write } from "../data/hooks";
import { readResource } from "../data/imperative";
import { settingPaths } from "../data/settingEntities";
import {
  chronicleEventAffects,
  chroniclePaths,
  populationPaths,
  settingGroupAffects,
  settingPagePaths,
  timelineAffects,
} from "../data/settingPage";
import { EditableTextCard } from "../components/EditableTextCard";
import { SettingChronicleEventRow } from "../components/SettingChronicleEventRow";
import { ResourcesSection, type ResourceStats } from "../components/ResourcesSection";
import { RESOURCE_CATEGORIES } from "../resourceCategories";
import { LocationTree } from "../components/LocationTree";
import { LocationRootGraph } from "../components/LocationRootGraph";
import { LocationMiller } from "../components/LocationMiller";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { SettingCalendarEditor } from "../components/SettingCalendarEditor";
import { SettingCalendarSettings } from "../components/SettingCalendarSettings";
import { ImportantDatesSection } from "../components/ImportantDatesSection";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { EntityPage } from "../components/EntityPage";
import { ListSkeleton, Loadable } from "../components/Loadable";
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
import { ExportProgress } from "../components/ExportProgress";
import { loadThumbnailStyles } from "../thumbnailStyles";
import { TagChips } from "../components/TagChips";
import { GenrePicker } from "../components/GenrePicker";
import { ZineGraphic } from "../components/ZineGraphics";
import { GENRE_CATEGORIES, MAX_GENRES } from "../genreData";
import type { SettingGenre } from "../types";
import { LocationFilter } from "../components/LocationCascadePicker";
import { SettingEntryList } from "../components/SettingEntryList";
import { SettingBeingTileGrid, SettingCommunityTileGrid } from "../components/SettingBeingTileGrid";
import { ArtifactTileGrid, ArtifactEditModal, ArtifactAssignModal } from "../components/ArtifactTileGrid";
import { groupArtifacts, type ArtifactGrouping } from "../artifactGroups";
import { EntityPreviewContent, CreatureCardPreview } from "../components/EntityPreviewModal";
import { StatblockList } from "../components/StatblockList";
import { EntityWizard } from "../components/entityWizard/EntityWizard";
import { AdventuresTab } from "../components/AdventuresTab";
import { ITEM_CLASSES, MAGIC_ITEM_RARITIES, itemTypeOptions } from "../compendium";
import { CrossLinksWizard } from "../components/CrossLinksWizard";
import { RelationGraph } from "../components/RelationGraph";
import { SETTING_SCOPED_TYPES } from "../components/GraphTypeFilters";

import type { GraphData } from "../graphTypes";
import { NAMED_BEING_CATEGORIES } from "../beingCategories";
import { NavIcon } from "../components/NavIcons";
import { EmptyState } from "../components/EmptyState";
import { isSafeImageUrl, safeBackgroundImage } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { useAlert, useConfirm, usePrompt } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { CampaignWizard } from "../components/CampaignWizard";
import { EntityImageSlot } from "../components/EntityImageSlot";
import { EntityTabWorkspace } from "../components/EntityTabWorkspace";

import type { System } from "../types";
import type {
  Artifact,
  BeingCategory,
  Campaign,
  Character,
  ImportantDate,
  Resource,
  Setting,
  SettingBeing,
  SettingBeingDetail,
  SettingCalendarEra,
  SettingCalendarEvent,
  SettingCalendarTimeline,
  SettingCommunity,
  SettingCommunityDetail,
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
  "Ресурсы",
] as const;

// Пустые списки — одни на все отрисовки: `?? []` давал бы новый массив
// каждый раз и сбивал бы useMemo ниже.
const NO_EVENTS: SettingCalendarEvent[] = [];
const NO_CYCLES: SettingCycle[] = [];
const NO_DATES: ImportantDate[] = [];
const NO_ERAS: SettingCalendarEra[] = [];
const NO_TIMELINES: SettingCalendarTimeline[] = [];
const NO_CAMPAIGNS: Campaign[] = [];
const NO_CHARACTERS: Character[] = [];
const NO_RESOURCES: Resource[] = [];
const NO_GROUPS: SettingGroup[] = [];
const NO_BEINGS: SettingBeing[] = [];
const NO_COMMUNITIES: SettingCommunity[] = [];
const NO_LOCATIONS: SettingLocation[] = [];
const NO_ARTIFACTS: Artifact[] = [];

export function SettingDetailPage() {
  const { id } = useParams();
  const settingId = Number(id);
  const navigate = useNavigate();
  const run = useAction();
  const queryClient = useQueryClient();
  const settingState = useEntity<Setting>("setting", settingId);
  const setting = settingState.data ?? null;
  const { save, saving: savingFields } = useSaveEntity<Setting>("setting", settingId);
  const settingAffects: Affect[] = [{ kind: "setting", id: settingId }];
  // Кампании нужны сразу: по ним решается, какие вкладки показать.
  const campaignsState = useResource<Campaign[]>(settingPagePaths.campaigns(settingId));
  const campaigns = campaignsState.data ?? NO_CAMPAIGNS;
  // Фон и тамбнейл живут в карточке «Изображения сеттинга» внизу «Обзора» и
  // заливаются сразу по выбору файла — не откладываются до «Сохранить» рядом с
  // именем, как было раньше.
  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const bgCrop = useImageCrop("background", (file) => uploadImage("background", file));
  const thumbCrop = useImageCrop("thumbnail", (file) => uploadImage("thumbnail", file));
  const [tab, selectTab] = useTabState(TABS, "Обзор");
  // Навигация внутри таба «Обзор» (Master–Detail): описание, теги,
  // кампании, изображения, проверка связей. Онбординг — transient-баннер
  // сверху, верхний таб-бар не трогаем.
  const [ovSel, setOvSel] = useState<{ section: string; item?: string }>({ section: "desc" });
  // Навигация внутри таба «Ресурсы»: все и категории со счётчиками.
  const [resSel, setResSel] = useState<{ section: string; item?: string }>({ section: "all" });
  const [resStats, setResStats] = useState<ResourceStats | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [savingName, setSavingName] = useState(false);

  // Каждый раздел читает своё, только пока открыт: «Обзор» не тянет хронику,
  // а хроника — персонажей кампаний.
  const onChronicle = tab === "Хроника мира";
  const resources = useResource<Resource[]>(tab === "Ресурсы" ? settingPagePaths.resources(settingId) : null).data ?? NO_RESOURCES;
  const characters =
    useResource<Character[]>(tab === "Обзор" && ovSel.section === "campaigns" ? settingPagePaths.characters(settingId) : null).data ??
    NO_CHARACTERS;
  const onTags = tab === "Обзор" && ovSel.section === "tags";
  const allGroups = useResource<SettingGroup[]>(onTags ? settingPagePaths.groups() : null).data ?? NO_GROUPS;
  const settingGroups = useResource<SettingGroup[]>(onTags ? settingPagePaths.groupsOf(settingId) : null).data ?? NO_GROUPS;
  const settingGroupIds = settingGroups.map((g) => g.id);

  const calendar = useSettingCalendar(settingId);
  const calendarEvents = useResource<SettingCalendarEvent[]>(onChronicle ? chroniclePaths.events(settingId) : null).data ?? NO_EVENTS;
  const cycles = useResource<SettingCycle[]>(onChronicle ? chroniclePaths.cycles(settingId) : null).data ?? NO_CYCLES;
  const importantDates = useResource<ImportantDate[]>(onChronicle ? chroniclePaths.importantDates(settingId) : null).data ?? NO_DATES;
  const eras = useResource<SettingCalendarEra[]>(onChronicle ? chroniclePaths.eras(settingId) : null).data ?? NO_ERAS;
  const timelines = useResource<SettingCalendarTimeline[]>(onChronicle ? chroniclePaths.timelines(settingId) : null).data ?? NO_TIMELINES;
  const [chronicleTab, setChronicleTab] = useState<"Хронология" | "Повторяющиеся" | "Циклы" | "Календарь">("Хронология");
  const [chronicleFilter, setChronicleFilter] = useState<"all" | "important" | "upcoming" | "cancelled" | "visible">("all");
  const [chronicleSort, setChronicleSort] = useState<"chronological" | "important-first">("chronological");
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

  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();
  const [campaignWizardOpen, setCampaignWizardOpen] = useState(false);
  const [wizardSystems, setWizardSystems] = useState<System[]>([]);
  const [wizardSettings, setWizardSettings] = useState<Setting[]>([]);

  async function openCampaignWizard() {
    try {
      const [sys, sets] = await Promise.all([
        readResource<System[]>("/systems"),
        readResource<Setting[]>("/settings"),
      ]);
      setWizardSystems(sys);
      setWizardSettings(sets);
    } catch {
      setWizardSystems([]);
      setWizardSettings([]);
    }
    setCampaignWizardOpen(true);
  }

  const [selectedTimelineId, setSelectedTimelineId] = useState<number | null>(null);
  const [addingTimeline, setAddingTimeline] = useState(false);
  const [timelineName, setTimelineName] = useState("");
  const [selectedEraId, setSelectedEraId] = useState<number | null>(null);
  const [worldFilter, setWorldFilter] = useState("");
  const filteredCalendarEvents = useMemo(() => {
    const q = worldFilter.trim().toLowerCase();
    if (!q) return calendarEvents;
    return calendarEvents.filter((ev) => ev.title.toLowerCase().includes(q) || (ev.description ?? "").toLowerCase().includes(q));
  }, [calendarEvents, worldFilter]);
  const sortedFilteredEvents = useMemo(() => {
    let events = filteredCalendarEvents;
    if (chronicleFilter === "important") events = events.filter((e) => e.important);
    else if (chronicleFilter === "upcoming") events = events.filter((e) => e.status === "upcoming");
    else if (chronicleFilter === "cancelled") events = events.filter((e) => e.status === "cancelled");
    else if (chronicleFilter === "visible") events = events.filter((e) => e.visible_to_players);
    if (selectedEraId != null) {
      const era = eras.find((e) => e.id === selectedEraId);
      if (era) {
        const nextEra = eras.filter((e) => e.timeline_id === era.timeline_id).sort((a, b) => a.start_year - b.start_year).find((e) => e.start_year > era.start_year);
        const endYear = nextEra ? nextEra.start_year : era.start_year + 1000;
        events = events.filter((e) => e.inworld_year >= era.start_year && e.inworld_year < endYear);
      }
    }
    const sorted = [...events];
    if (chronicleSort === "important-first") sorted.sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0));
    else sorted.sort((a, b) => a.inworld_year - b.inworld_year || a.inworld_month - b.inworld_month || a.inworld_day - b.inworld_day);
    return sorted;
  }, [filteredCalendarEvents, chronicleFilter, chronicleSort, selectedEraId, eras]);
  const axisRef = useRef<HTMLDivElement>(null);
  // Скрытое файловое поле импорта — его щёлкает пункт «Импорт» из меню «…».
  const importInputRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [timelineFocus, setTimelineFocus] = useState<{ year: number; month: number; day: number } | null>(null);
  const [calendarFocus, setCalendarFocus] = useState<{ year: number; month: number } | null>(null);

  async function createTimeline() {
    const name = timelineName.trim();
    if (!name) return;
    const done = await run(() => write.post(chroniclePaths.timelines(settingId), { name }).then(() => true), {
      affects: timelineAffects(settingId),
      retry: false,
    });
    if (!done) return;
    setTimelineName("");
    setAddingTimeline(false);
  }

  async function deleteTimeline(timelineId: number) {
    const ok = await confirm({
      title: "Удалить таймлайн?",
      message: "Эпохи этого таймлайна станут безэтапными. События не удалятся.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    const done = await run(() => write.del(`/settings/calendar-timelines/${timelineId}`).then(() => true), {
      affects: timelineAffects(settingId),
    });
    if (done && selectedTimelineId === timelineId) setSelectedTimelineId(null);
  }

  // Крошки до прихода данных знают только первую ступень.
  const rootCrumbs = [{ label: "Сеттинги", to: "/settings" }];

  if (settingState.error && !setting) {
    return (
      <EntityPage
        crumbs={rootCrumbs}
        entityType="setting"
        title=""
        error={settingState.error}
        onRetry={settingState.reload}
      >
        {null}
      </EntityPage>
    );
  }

  // Пока кампаний нет, набор вкладок не решён: без них страница мигнула бы
  // четырьмя вкладками вместо девяти.
  if (!setting || (campaignsState.loading && !campaignsState.error)) {
    return (
      <EntityPage crumbs={rootCrumbs} entityType="setting" title="" loading>
        {null}
      </EntityPage>
    );
  }

  // Карточки полей держат правку открытой, пока сохранение не удалось: для
  // этого им нужна ошибка, а плашку показывает слой.
  async function saveDescription(value: string) {
    if (!(await save({ description: value }))) throw new Error("Не сохранилось");
  }

  async function saveName(name: string, code: string) {
    // Двойник кода не запрещается, а называется: код — подсказка человеку в
    // окне неработающей ссылки, а не ключ, по которому что-то ищется.
    setSavingName(true);
    try {
      const saved = await run(
        () => write.put<{ code_taken_by: string | null }>(`/settings/${settingId}`, { name, code }),
        { affects: settingAffects }
      );
      if (!saved) throw new Error("Не сохранилось");
      if (saved.code_taken_by) {
        showAlert(`Код «${code}» уже носит «${saved.code_taken_by}». Это разрешено, но в ссылках оба будут выглядеть одинаково.`);
      }
    } finally {
      setSavingName(false);
    }
  }

  async function saveGenres(genres: SettingGenre[]) {
    if (await save({ genres })) setGenrePickerOpen(false);
  }

  async function uploadImage(kind: "background" | "thumbnail", file: File) {
    const setUploading = kind === "background" ? setUploadingBg : setUploadingThumb;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await run(() => write.post(`/settings/${settingId}/${kind}`, form).then(() => true), { affects: settingAffects });
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
      await run(() => write.del(`/settings/${settingId}/${kind}`).then(() => true), { affects: settingAffects });
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
    const done = await run(() => write.del(`/settings/${settingId}`).then(() => true), { affects: [{ kind: "setting" }] });
    if (done) navigate("/settings");
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
    // Повтор импорта поставил бы второй сеттинг — поэтому без «Повторить».
    const created = await run(() => write.post<Setting>(`/settings/import${withImages ? "" : "?images=0"}`, data), {
      affects: [{ kind: "setting" }],
      retry: false,
    });
    if (created) navigate(`/settings/${created.id}`);
  }

  // Перетаскивание события по оси: сдвиг и уточнение — один жест. Точность
  // приходит от масштаба, на котором бросили, поэтому её отправляем вместе с
  // датой, а не вычисляем на сервере.
  async function moveCalendarEvent(
    id: number,
    date: { year: number; month: number; day: number; precision: string }
  ) {
    await run(
      () =>
        write
          .put(`/settings/calendar-events/${id}`, {
            inworld_year: date.year,
            inworld_month: date.month,
            inworld_day: date.day,
            date_precision: date.precision,
          })
          .then(() => true),
      { affects: chronicleEventAffects(settingId, id) }
    );
  }

  async function pinSettingCalendar(pinned: { year: number; month: number } | null) {
    await run(
      () =>
        write
          .put(`/settings/${settingId}/pinned-calendar`, {
            year: pinned?.year ?? null,
            month: pinned?.month ?? null,
          })
          .then(() => true),
      { affects: settingAffects }
    );
  }

  // Отметка события («важное», «видно игрокам») видна сразу, до ответа
  // сервера; отказ возвращает прежнее — перечитка при отказе не идёт.
  // В кэше флаги лежат числами, как их отдаёт сервер, а принимает он булевы.
  async function patchEvent(ev: SettingCalendarEvent, body: Record<string, boolean>, cached: Partial<SettingCalendarEvent>) {
    const key = dataKeys.resource(chroniclePaths.events(settingId));
    const previous = queryClient.getQueryData<SettingCalendarEvent[]>(key);
    if (previous) queryClient.setQueryData(key, previous.map((e) => (e.id === ev.id ? { ...e, ...cached } : e)));
    const done = await run(() => write.put(`/settings/calendar-events/${ev.id}`, body).then(() => true), {
      affects: chronicleEventAffects(settingId, ev.id),
    });
    if (!done && previous) queryClient.setQueryData(key, previous);
  }

  // Отметка группы видна сразу; отказ возвращает прежний набор.
  async function toggleGroup(group: SettingGroup, isIn: boolean) {
    const key = dataKeys.resource(settingPagePaths.groupsOf(settingId));
    const previous = queryClient.getQueryData<SettingGroup[]>(key);
    if (previous) {
      queryClient.setQueryData(key, isIn ? previous.filter((g) => g.id !== group.id) : [...previous, group]);
    }
    const done = await run(
      () =>
        (isIn
          ? write.del(`/setting-groups/${group.id}/members?settingIds=${settingId}`)
          : write.post(`/setting-groups/${group.id}/members`, { settingIds: [settingId] })
        ).then(() => true),
      { affects: settingGroupAffects() }
    );
    if (!done && previous) queryClient.setQueryData(key, previous);
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
    setCalendarMenu(null);
    await run(() => write.del(`/settings/calendar-events/${eventId}`).then(() => true), {
      affects: chronicleEventAffects(settingId, eventId),
    });
  }

  function toggleEventImportant(ev: SettingCalendarEvent) {
    void patchEvent(ev, { important: !ev.important }, { important: ev.important ? 0 : 1 } as Partial<SettingCalendarEvent>);
  }

  function toggleEventVisible(ev: SettingCalendarEvent) {
    void patchEvent(ev, { visible_to_players: !ev.visible_to_players }, { visible_to_players: ev.visible_to_players ? 0 : 1 } as Partial<SettingCalendarEvent>);
  }

  async function saveEventModal() {
    if (!eventModal || !eventModal.title.trim()) return;
    const hasPeriod = eventModal.year_end.trim() !== "" || eventModal.month_end.trim() !== "" || eventModal.day_end.trim() !== "";
    // Валидация порядка start/end: конец периода не может быть раньше начала.
    if (hasPeriod) {
      const sy = Number(eventModal.year) || 0;
      const ey = eventModal.year_end.trim() !== "" ? Number(eventModal.year_end) : sy;
      const sm = Number(eventModal.month) || 1;
      const em = eventModal.month_end.trim() !== "" ? Number(eventModal.month_end) : sm;
      const sd = Number(eventModal.day) || 1;
      const ed = eventModal.day_end.trim() !== "" ? Number(eventModal.day_end) : sd;
      if (ey < sy || (ey === sy && em < sm) || (ey === sy && em === sm && ed < sd)) {
        showAlert("Дата окончания периода раньше даты начала.");
        return;
      }
    }
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
    const modal = eventModal;
    // Окно закрывается, только если записалось: набранное при отказе не теряется.
    const done = modal.id
      ? await run(
          async () => {
            const original = calendarEvents.find((e) => e.id === modal.id);
            await write.put(`/settings/calendar-events/${modal.id}`, payload);
            await syncMentionLinks("setting_event", modal.id!, original?.description ?? "", modal.description);
            return true;
          },
          { affects: chronicleEventAffects(settingId, modal.id) }
        )
      : await run(
          async () => {
            const created = await write.post<SettingCalendarEvent>(chroniclePaths.events(settingId), payload);
            await syncMentionLinks("setting_event", created.id, "", modal.description);
            return true;
          },
          // Повтор создал бы второе событие.
          { affects: chronicleEventAffects(settingId), retry: false }
        );
    if (done) setEventModal(null);
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

  // C-P0-2: гвард для background — аналог SettingsListPage (safeBackgroundImage + isSafeImageUrl)
  const safeBg = safeBackgroundImage(
    setting.background_image_url && isSafeImageUrl(setting.background_image_url)
      ? setting.background_image_url
      : null
  );

  const isNewSetting = campaigns.length === 0;
  // Пустому сеттингу показываем четыре вкладки вместо десяти: остальные
  // нечем наполнить, пока нет ни одной кампании.
  const coreTabs = new Set(["Обзор", "География", "Население", "Хроника мира"]);
  const visibleTabs = isNewSetting ? TABS.filter((t) => coreTabs.has(t)) : TABS;
  const hiddenTabs = isNewSetting ? TABS.filter((t) => !coreTabs.has(t)) : [];

  return (
    <EntityPage
      crumbs={[{ label: "Сеттинги", to: "/settings" }, { label: setting.name }]}
      entityType="setting"
      title={setting.name}
      badges={(setting as any).archived_at && <span className="badge cancelled">Архивировано</span>}
      meta={(savingFields || savingName) && <span aria-live="polite">Сохранение…</span>}
      backdrop={safeBg}
      // Имя правится в карточке «Описание» на «Обзоре» — вместе с самим
      // описанием, одной кнопкой «Сохранить». Экспорт, импорт и архивация
      // редки, и ни одно из них не заслуживает места в шапке: под «…» все.
      actions={[
        { label: "Экспорт", onClick: () => setShowExport(true) },
        { label: "Импорт", onClick: () => importInputRef.current?.click() },
        { label: "Архивировать", danger: true, onClick: archiveSetting },
      ]}
      tabs={visibleTabs}
      hiddenTabs={hiddenTabs}
      tab={tab}
      onTab={(t) => selectTab(t as (typeof TABS)[number])}
      overlays={
        <>
          {confirmDialog}
          {alertDialog}
          {/* Импорт — файловое поле, а пункт меню кнопкой его не откроет:
              держим поле здесь и щёлкаем по нему из «…». */}
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && importSetting(e.target.files[0])}
          />
        </>
      }
    >
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
        />
      )}

      {/* Обновление не удалось, но прежние данные на экране: баннер рядом с
          содержимым, а не вместо него. */}
      {settingState.error && (
        <div className="card entity-page__error">
          <span>Ошибка загрузки: {settingState.error}</span>
          <button className="primary" onClick={settingState.reload}>
            Повторить
          </button>
        </div>
      )}

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
          <EntityTabWorkspace
            sections={[
              { id: "desc", label: "Описание" },
              { id: "tags", label: "Теги" },
              { id: "campaigns", label: "Кампании", count: campaigns.length },
              { id: "images", label: "Изображения" },
              { id: "links", label: "Проверка связей" },
            ]}
            selection={ovSel}
            onSelect={setOvSel}
            workspaceKey={settingId}
            navFooter={
              ovSel.section === "campaigns" ? (
                <button className="primary" onClick={openCampaignWizard} style={{ alignSelf: "flex-start" }}>
                  + Новая кампания
                </button>
              ) : undefined
            }
          >
          {ovSel.section === "desc" && (
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
                  { key: "name", label: "Название", value: setting.name, required: true },
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
              />
          )}
          {ovSel.section === "tags" && (
            <div className="card stack" style={{ flex: 1, minWidth: 0 }}>
              <h3>Теги</h3>
              <div className="genre-chips">
                {setting.genres && setting.genres.length > 0 && setting.genres.map((g, i) => {
                  const cat = GENRE_CATEGORIES.find((c) => c.name === g.genre);
                  return (
                    <button
                      key={i}
                      type="button"
                      className="genre-chip genre-chip--selected"
                      onClick={() => setGenrePickerOpen(true)}
                    >
                      {cat && <ZineGraphic name={cat.icon} className="genre-chip-icon" />}
                      {g.subgenre ?? g.genre}
                    </button>
                  );
                })}
                {(!setting.genres || setting.genres.length < MAX_GENRES) && (
                  <button
                    type="button"
                    className="genre-chip"
                    onClick={() => setGenrePickerOpen(true)}
                  >
                    +жанр
                  </button>
                )}
              </div>
              {allGroups.length > 0 && (
                <>
                  <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0" }} />
                  <strong>Группы сеттингов</strong>
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
                            onChange={() => void toggleGroup(g, isIn)}
                          />
                          {g.name}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
          {ovSel.section === "campaigns" && (
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
          )}
          {ovSel.section === "images" && (
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
          )}
          {ovSel.section === "links" && (
          <CrossLinksWizard
            ownerKind="setting"
            ownerId={settingId}
            help="Ищет имена в описаниях локаций, историях личностей, полях сообществ, силе предметов и синопсисах приключений — и делает их кликабельными. Шаг за шагом, по одному типу цели: у каждого своя строгость. Сцены размечает такой же проход на странице приключения. Ничего не пишет, пока вы не подтвердите."
          />
          )}
          </EntityTabWorkspace>
          {campaignWizardOpen && (
            <CampaignWizard
              systems={wizardSystems}
              settings={wizardSettings}
              defaultSettingId={settingId}
              onClose={() => setCampaignWizardOpen(false)}
              onCreated={() => setCampaignWizardOpen(false)}
            />
          )}
        </div>
      )}

      {tab === "География" && <GeographyTab settingId={settingId} />}
      {tab === "Население" && <PopulationTab settingId={settingId} />}
      {tab === "Приключения" && (
        <div className="card stack">
          <AdventuresTab settingId={settingId} />
        </div>
      )}
      {tab === "Сокровищница" && <ArtifactsTab settingId={settingId} />}
      {tab === "Граф связей" && <SettingGraphTab settingId={settingId} />}

      {tab === "Хроника мира" && (
        <div className="stack">
          {(calendarEvents.length > 0 || timelines.length > 0 || cycles.length > 0 || eras.length > 0 || importantDates.length > 0) ? (
            <div ref={axisRef} className="card stack">
            <Timeline
              focusDate={timelineFocus}
              events={filteredCalendarEvents.map((e) => ({
                id: e.id, title: e.title,
                year: e.inworld_year, month: e.inworld_month, day: e.inworld_day,
                precision: e.date_precision,
                year_end: e.inworld_year_end, month_end: e.inworld_month_end, day_end: e.inworld_day_end,
                status: e.status, important: e.important === 1,
              }))}
              months={calendar?.months ?? []}
              era={calendar?.era ?? ""}
              eras={eras}
              selectedTimelineId={selectedTimelineId}
              now={
                setting.pinned_calendar_year != null && setting.pinned_calendar_month != null
                  ? { year: setting.pinned_calendar_year, month: setting.pinned_calendar_month }
                  : null
              }
              cycles={cycles}
              importantDates={importantDates}
              onMoveEvent={moveCalendarEvent}
              onNowChange={(date) => pinSettingCalendar(date)}
              onEventClick={(id) => navigate(`/events/${id}`)}
              action={
                <>
                  <button className="primary" onClick={() => setCreatingEvent(true)}>+ Создать событие</button>
                  <button onClick={() => setChronicleTab("Календарь")}>+ Эпоху</button>
                </>
              }
              leftAction={
                <span className="row" style={{ gap: 4, alignItems: "center" }}>
                  <select
                    value={selectedTimelineId ?? ""}
                    onChange={(e) => setSelectedTimelineId(e.target.value ? Number(e.target.value) : null)}
                    style={{ fontSize: "var(--fs-meta)" }}
                  >
                    <option value="">Общий</option>
                    {timelines.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <button className="comp-mini" onClick={() => setAddingTimeline((v) => !v)} title="Новый таймлайн">+</button>
                  {addingTimeline && (
                    <span className="row" style={{ gap: 4 }}>
                      <input placeholder="Название таймлайна" value={timelineName} onChange={(e) => setTimelineName(e.target.value)} style={{ width: 180 }} />
                      <button className="comp-mini primary" onClick={createTimeline}>OK</button>
                      <button className="comp-mini" onClick={() => { setAddingTimeline(false); setTimelineName(""); }}>✕</button>
                    </span>
                  )}
                  {selectedTimelineId != null && (
                    <button className="comp-mini danger" onClick={() => deleteTimeline(selectedTimelineId)} title="Удалить таймлайн">✕</button>
                  )}
                </span>
              }
            />
          </div>
          ) : null}

          <div className="chronicle-split">
            <div className="chronicle-left stack">
              {/* каркас в обход намеренно — переключатель внутри вкладки, а не вкладки страницы: полоса каркаса одна на карточку */}
              {(calendarEvents.length > 0 || timelines.length > 0 || cycles.length > 0 || eras.length > 0 || importantDates.length > 0) && (
                <div className="tabs">
                  {(["Хронология", "Повторяющиеся", "Циклы", "Календарь"] as const).map((t) => (
                    <button key={t} className={chronicleTab === t ? "active" : ""} onClick={() => setChronicleTab(t)}>{t}</button>
                  ))}
                </div>
              )}

              {chronicleTab === "Хронология" && (
                <div className="stack chronicle-scroll">
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input placeholder="Поиск по хронике: название, описание" value={worldFilter} onChange={(e) => setWorldFilter(e.target.value)} style={{ flex: "1 1 220px" }} />
                    {worldFilter && <button onClick={() => setWorldFilter("")}>Сбросить</button>}
                    <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>{sortedFilteredEvents.length} из {calendarEvents.length}</span>
                  </div>
                  <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                    {(["all", "important", "upcoming", "cancelled", "visible"] as const).map((f) => (
                      <button key={f} className={`comp-mini ${chronicleFilter === f ? "primary" : ""}`} onClick={() => setChronicleFilter(f)}>
                        {{ all: "Все", important: "Важные", upcoming: "Предстоящие", cancelled: "Отменённые", visible: "Видимые игрокам" }[f]}
                      </button>
                    ))}
                    <span style={{ margin: "0 4px" }}>|</span>
                    <button className={`comp-mini ${chronicleSort === "chronological" ? "primary" : ""}`} onClick={() => setChronicleSort("chronological")}>Хронология</button>
                    <button className={`comp-mini ${chronicleSort === "important-first" ? "primary" : ""}`} onClick={() => setChronicleSort("important-first")}>Важные сверху</button>
                    {selectedTimelineId != null && eras.some((e) => e.timeline_id === selectedTimelineId) && (
                      <>
                        <span style={{ margin: "0 4px" }}>|</span>
                        <select
                          className="comp-mini"
                          value={selectedEraId ?? ""}
                          onChange={(e) => setSelectedEraId(e.target.value ? Number(e.target.value) : null)}
                          style={{ fontSize: "var(--fs-meta)" }}
                        >
                          <option value="">Все эпохи</option>
                          {eras.filter((e) => e.timeline_id === selectedTimelineId).sort((a, b) => a.start_year - b.start_year).map((e) => (
                            <option key={e.id} value={e.id}>{e.name} ({e.start_year})</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                  <div className="stack">
                    {sortedFilteredEvents.map((ev) => (
                      <SettingChronicleEventRow
                        key={ev.id} ev={ev}
                        expanded={expandedEvents.has(ev.id)} calendar={calendar}
                        onToggleExpand={toggleEventExpanded}
                        onToggleImportant={toggleEventImportant}
                        onToggleVisible={toggleEventVisible}
                        onEdit={openEditEventModal} onDelete={deleteCalendarEvent}
                        onShowOnAxis={(e) => { setTimelineFocus({ year: e.inworld_year, month: e.inworld_month, day: e.inworld_day }); setTimeout(() => axisRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100); }}
                        onShowOnCalendar={() => { calendarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                      />
                    ))}
                    {sortedFilteredEvents.length === 0 && <p className="muted">{calendarEvents.length === 0 ? "Событий пока нет." : "Ничего не найдено."}</p>}
                  </div>
                </div>
              )}

              {chronicleTab === "Повторяющиеся" && (
                <ImportantDatesSection settingId={settingId} months={calendar?.months} weekdays={calendar?.weekdays} />
              )}

              {chronicleTab === "Циклы" && (
                <SettingCycles settingId={settingId} />
              )}

              {chronicleTab === "Календарь" && (
                <SettingCalendarSettings settingId={settingId} />
              )}
            </div>

            <div ref={calendarRef} className="chronicle-right stack" style={{ gap: "var(--sp-6)" }}>
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
          </div>
        </div>
        )}

      {tab === "Ресурсы" && (
        <EntityTabWorkspace
          sections={[
            { id: "all", label: "Все", count: resStats?.total ?? resources.length },
            ...RESOURCE_CATEGORIES.map((c) => ({
              id: c.key,
              label: c.label,
              count: resStats?.byCategory[c.key] ?? 0,
            })),
          ]}
          selection={resSel}
          onSelect={setResSel}
          workspaceKey={settingId}
        >
          <div className="card stack">
            <ResourcesSection
              scope="setting"
              entityId={settingId}
              resources={resources}
              visibleCategories={resSel.section === "all" ? null : [resSel.section]}
              onStats={(s) => setResStats((prev) => (JSON.stringify(prev) === JSON.stringify(s) ? prev : s))}
            />
          </div>
        </EntityTabWorkspace>
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
    </EntityPage>
  );
}

// Corkboard-with-threads view of every relation between this setting's
// beings, factions, and locations (player characters are deliberately left
// out here — per the user's original ask, this graph is scoped to "все
// существа и фракции сеттинга"; locations were added afterwards since
// mention-links can connect to them too).
function SettingGraphTab({ settingId }: { settingId: number }) {
  // Раньше вкладка звала три захардкоженных типа: артефакты, сцены и
  // приключения сеттинга в его же граф не попадали, и переключить это было
  // нечем. Теперь тот же отбор, что и на общей странице, но из типов, у
  // которых внутри сеттинга есть дом.
  const [activeTypes] = useState<Set<string>>(
    () => new Set(SETTING_SCOPED_TYPES)
  );

  const params = new URLSearchParams({
    types: Array.from(activeTypes).join(","),
    setting_id: String(settingId),
    view: "world",
  });
  const graph = useResource<GraphData>(settingPagePaths.graph(params.toString()));

  return (
    <div className="card stack">
      {graph.error && (
        <div className="error-banner">
          {graph.error}
          <button type="button" onClick={graph.reload}>Повторить</button>
        </div>
      )}
      <RelationGraph
        data={graph.data ?? null}
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

type GeographyView = "columns" | "list" | "tree";

function GeographyTab({ settingId }: { settingId: number }) {
  const [view, setView] = useState<GeographyView>(() => {
    try {
      const v = localStorage.getItem(`geography-view-${settingId}`);
      // Старые ключи: tree(дерево)→list(список), root(корень)→tree(дерево).
      if (v === "list" || v === "tree" || v === "columns") return v;
      if (v === "root") return "tree";
      return "columns";
    } catch {
      return "columns";
    }
  });
  function pick(next: GeographyView) {
    setView(next);
    try {
      localStorage.setItem(`geography-view-${settingId}`, next);
    } catch {
      /* ignore */
    }
  }
  const tab = (id: GeographyView, label: React.ReactNode) => (
    <button
      role="tab"
      aria-selected={view === id}
      className={view === id ? "active" : ""}
      onClick={() => pick(id)}
    >
      {label}
    </button>
  );
  return (
    <div className="stack">
      {/* каркас в обход намеренно — переключатель внутри вкладки, а не вкладки страницы: полоса каркаса одна на карточку */}
      <div className="tabs" role="tablist" aria-label="Режим просмотра географии">
        {tab("columns", "Колонки")}
        {tab("list", "Список")}
        {tab("tree", <>Дерево <span className="badge tag">beta</span></>)}
      </div>
      {view === "columns" && <LocationMiller key={`m-${settingId}`} settingId={settingId} />}
      {view === "list" && (
        <div className="card stack geography-tree">
          <LocationTree settingId={settingId} flat selectOnClick />
        </div>
      )}
      {view === "tree" && <LocationRootGraph key={settingId} settingId={settingId} />}
    </div>
  );
}

// Пагинация плиточных сеток («Все» в Личностях/Бестиарии/Сообществах/
// Сокровищнице): страница — 6 строк плитки. Колонки резиновые
// (minmax 280px), поэтому ширину меряем ResizeObserver'ом.
// active=false — без пагинации (возвращает всё как есть).
function useTilePagination<T>(
  items: T[],
  active: boolean,
  resetKey: string
): { paged: T[]; pager: ReactNode; wrapRef: RefObject<HTMLDivElement | null> } {
  const [page, setPage] = useState(1);
  const [cols, setCols] = useState(4);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Строка-ключ собирается вызывающей секцией из её фильтров: сменился
  // набор — страница сбрасывается на первую.
  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !active) return;
    const update = () => setCols(Math.max(1, Math.floor(el.clientWidth / 290)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);
  const pageSize = Math.max(1, cols) * 6;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = active ? items.slice((safePage - 1) * pageSize, safePage * pageSize) : items;
  const pager =
    active && totalPages > 1 ? (
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          Показано {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, items.length)} из {items.length}
        </span>
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            ← Назад
          </button>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
            Стр. {safePage} из {totalPages}
          </span>
          <button disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
            Вперёд →
          </button>
        </div>
      </div>
    ) : null;
  return { paged, pager, wrapRef };
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
  // Счётчики — те же списки, что читают разделы без фильтров: открытый раздел
  // берёт их из кэша, а правка в разделе обновляет и число на вкладке.
  const counts = {
    beings: useResource<SettingBeing[]>(populationPaths.beings(settingId)).data?.length ?? null,
    bestiary: useResource<SettingBeing[]>(populationPaths.bestiary(settingId)).data?.length ?? null,
    communities: useResource<SettingCommunity[]>(populationPaths.communities(settingId)).data?.length ?? null,
  };
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("population", section);
    window.history.replaceState(null, "", url.toString());
  }, [section]);


  const label = (s: typeof POPULATION_SECTIONS[number]) => {
    if (s === "Личности" && counts.beings != null) return `Личности · ${counts.beings}`;
    if (s === "Бестиарий" && counts.bestiary != null) return `Бестиарий · ${counts.bestiary}`;
    if (s === "Сообщества" && counts.communities != null) return `Сообщества · ${counts.communities}`;
    return s;
  };

  return (
    <div className="card stack population-tab" id="population">
      {/* каркас в обход намеренно — переключатель внутри вкладки, а не вкладки страницы: полоса каркаса одна на карточку */}
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
  const run = useAction();
  const afterWrite = useAfterWrite();
  const [promptDialog, promptText] = usePrompt();
  const { deleteWithUndo } = useUndoDelete();
  const [category, setCategory] = useState<BeingCategory | "all">("all");
  // Master–Detail внутри «Личностей»: категории слева раскрываются в
  // существ, выбранное — справа большой карточкой. Категория навигации и
  // фильтр списка — одно состояние, расходятся только при пресетах.
  const [beingSel, setBeingSel] = useState<{ section: string; item?: string }>({ section: "all" });
  const [locationFilter, setLocationFilter] = useState("");
  const [communityFilter, setCommunityFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [sort, setSort] = useState<"name" | "recent" | "category" | "community">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [confirmDialog, confirm] = useConfirm();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkFaction, setBulkFaction] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  // debounce 250ms — шлём q не на каждый символ
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Сохраняем последние фильтры для Breadcrumb в профиле существа (U-P0-2)
  useEffect(() => {
    try {
      const p = new URLSearchParams();
      if (category !== "all") p.set("category", category);
      if (locationFilter) p.set("location_id", locationFilter);
      if (communityFilter) p.set("community_id", communityFilter);
      if (debouncedQuery.trim()) p.set("q", debouncedQuery.trim());
      if (sort !== "name") p.set("sort", sort);
      if (sortDir === "desc") p.set("dir", "desc");
      const str = p.toString();
      if (str) sessionStorage.setItem(`population-last-filters-${settingId}`, str);
      else sessionStorage.removeItem(`population-last-filters-${settingId}`);
    } catch {}
  }, [category, locationFilter, communityFilter, debouncedQuery, sort, sortDir, settingId]);

  function handleSort(next: typeof sort) {
    if (sort === next) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(next); setSortDir("asc"); }
  }

  // Смена фильтра не мигает пустым списком: пока грузится новый, виден прежний.
  const listState = useResource<SettingBeing[]>(
    populationPaths.beings(settingId, {
      category,
      locationId: locationFilter,
      communityId: communityFilter,
      query: debouncedQuery,
      sort,
      dir: sortDir,
    }),
    { keepPrevious: true }
  );
  const beings = listState.data ?? NO_BEINGS;
  const locations = useResource<SettingLocation[]>(settingPaths.inSetting("location", settingId)).data ?? NO_LOCATIONS;
  const allCommunities = useResource<SettingCommunity[]>(settingPaths.inSetting("community", settingId)).data ?? NO_COMMUNITIES;

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
    const ids = Array.from(selectedIds);
    const done = await run(
      () => Promise.all(ids.map((id) => write.post(`/setting-communities/${bulkFaction}/members`, { being_id: id }))).then(() => true),
      // Состав виден и у сообщества, и во «Фракциях» каждого существа.
      { affects: [{ kind: "being" }, { kind: "community", id: Number(bulkFaction) }] }
    );
    if (done) setSelectedIds(new Set());
    setBulkSaving(false);
  }

  async function duplicateBeing(being: SettingBeing) {
    // Повтор создал бы вторую копию.
    await run(
      () =>
        write.post("/setting-beings", {
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
        }),
      { affects: [{ kind: "being" }], retry: false }
    );
  }

  async function deleteBeing(beingId: number) {
    const ok = await confirm({
      title: "Архивировать личность?",
      message: "Будет скрыта из списков, связи останутся. Можно восстановить в архиве.",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    const name = beings.find((b) => b.id === beingId)?.name ?? "Личность";
    await run(
      () =>
        deleteWithUndo({
          entityName: name,
          deleteFn: async () => { await write.del(`/setting-beings/${beingId}`); },
          restoreFn: async () => { await write.put(`/setting-beings/${beingId}/restore`); afterWrite([{ kind: "being" }]); },
        }).then(() => true),
      { affects: [{ kind: "being" }] }
    );
  }

  async function renameBeing(being: SettingBeing) {
    const name = await promptText({ title: "Переименовать личность", message: "Имя", defaultValue: being.name });
    if (!name?.trim() || name.trim() === being.name) return;
    await run(() => write.put(`/setting-beings/${being.id}`, { name: name.trim() }).then(() => true), {
      affects: [{ kind: "being", id: being.id }],
    });
  }

  const beingNavCats = NAMED_BEING_CATEGORIES.filter((c) => c.key !== "all");
  const beingSections = [
    { id: "all", label: "Все", count: category === "all" ? beings.length : undefined },
    ...beingNavCats.map((c) => ({
      id: c.key,
      label: c.label,
      count: category === c.key ? beings.length : undefined,
      // Пункты — из текущего (уже отфильтрованного сервером) списка:
      // раскрытие категории всегда совпадает с её выбором.
      items: category === c.key ? beings.map((b) => ({ id: String(b.id), label: b.name || "Без названия" })) : [],
    })),
  ];

  function handleBeingSelect(next: { section: string; item?: string }) {
    if (next.section !== "all" && next.section !== category) {
      setCategory(next.section as BeingCategory | "all");
    } else if (next.section === "all" && category !== "all") {
      setCategory("all");
    }
    setBeingSel(next.item ? { section: next.section, item: next.item } : { section: next.section });
  }

  const {
    paged: pagedBeings,
    pager: tilesPager,
    wrapRef: gridWrapRef,
  } = useTilePagination(beings, beingSel.section === "all" && !beingSel.item, [
    category,
    debouncedQuery,
    locationFilter,
    communityFilter,
    sort,
    sortDir,
  ].join("|"));

  return (
    <div className="stack" style={{ paddingBottom: "calc(var(--player-bar-height, 52px) + 16px)" }}>
      {confirmDialog}
      {promptDialog}
      <div className="row sort-toggle" role="tablist" aria-label="Сортировка" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {/* Фильтр спрятан, поэтому кнопка сама говорит, что он включён —
            иначе непонятно, почему список короче, чем ожидаешь. */}
        <button
          className={`toggle-button${filtersOpen || locationFilter || communityFilter ? " active" : ""}`}
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          Фильтры{(locationFilter || communityFilter) ? ` (${(locationFilter ? 1 : 0) + (communityFilter ? 1 : 0)})` : ""}
        </button>
        <input
          placeholder="Поиск: имя, связанное существо или сообщество…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск личностей"
          style={{ flex: 1, minWidth: 140 }}
        />
        <span className="muted" style={{ fontSize: "11px", alignSelf: "center" }}>Сортировка:</span>
        <button className={sort === "name" ? "active-sort" : ""} onClick={() => handleSort("name")}>А-Я{sort === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
        <button className={sort === "recent" ? "active-sort" : ""} onClick={() => handleSort("recent")}>Недавние{sort === "recent" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
        <button className={sort === "category" ? "active-sort" : ""} onClick={() => handleSort("category")}>По типу{sort === "category" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
        <button className={sort === "community" ? "active-sort" : ""} onClick={() => handleSort("community")}>По фракциям{sort === "community" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
        <button className="primary" onClick={() => setCreating(true)} style={{ marginLeft: "auto" }}>
          Создать личность
        </button>
      </div>
      {creating && (
        <EntityWizard
          initialType="being"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
        />
      )}
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
      <Loadable
        loading={listState.loading}
        error={listState.data ? null : listState.error}
        errorTitle="Не удалось загрузить личностей"
        onRetry={listState.reload}
        skeleton={<ListSkeleton variant="rows" label="Загрузка личностей" />}
        empty={beings.length === 0 ? (
          <EmptyState
            title="Личностей пока нет"
            hint="Ключевые фигуры, влиятельные и примечательные — начните с первой."
            action={
              <button className="primary" onClick={() => setCreating(true)}>
                Создать личность
              </button>
            }
          />
        ) : null}
      >
        <EntityTabWorkspace
          sections={beingSections}
          selection={beingSel}
          onSelect={handleBeingSelect}
          workspaceKey={settingId}
          navFooter={
            <button className="primary" onClick={() => setCreating(true)} style={{ alignSelf: "flex-start" }}>
              Создать личность
            </button>
          }
        >
          {beingSel.item ? (
            <BeingDetailPane
              key={beingSel.item}
              beingId={Number(beingSel.item)}
              settingId={settingId}
              onBack={() => setBeingSel({ section: beingSel.section })}
            />
          ) : (
            <div ref={gridWrapRef} className="stack">
              {tilesPager}
              <SettingBeingTileGrid beings={pagedBeings} grouping={sort === "category" ? "category" : sort === "community" ? "community" : "alpha"} searchActive={!!debouncedQuery.trim()} dir={sortDir} onCreate={() => setCreating(true)} selectedIds={selectedIds} onToggleSelect={toggleSelect} onRename={renameBeing} onArchive={(b) => deleteBeing(b.id)} />
            </div>
          )}
        </EntityTabWorkspace>
      </Loadable>
    </div>
  );
}

// Карточка сообщества справа: лицо (аватар/монограмма + имя), сводка
// (описание, теги, локации, вложенность) и состав — кто состоит.
function CommunityDetailPane({ communityId, onBack }: { communityId: number; onBack: () => void }) {
  // Та же карточка, что у профиля сообщества: правка там видна здесь сразу.
  const detailState = useEntity<SettingCommunityDetail>("community", communityId);
  const detail = detailState.data;
  const error = detail ? null : detailState.error;

  if (error) {
    return (
      <div className="card stack">
        <span>Не удалось загрузить сообщество: {error}</span>
        <div className="row">
          <button className="primary" onClick={onBack}>Назад к списку</button>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="card" aria-busy="true" aria-label="Загрузка сообщества">
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  const avatar = detail.avatar_image_url ?? detail.thumbnail_image_url;
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          {avatar ? (
            <img
              src={avatar}
              alt=""
              style={{ width: 64, height: 64, objectFit: "cover", border: "1px solid var(--line)", flexShrink: 0 }}
            />
          ) : (
            <span
              className="monster-tile__monogram"
              style={{ width: 64, height: 64, fontSize: "var(--fs-h2)", flexShrink: 0 }}
              aria-hidden="true"
            >
              {(detail.name.trim()[0] ?? "?").toUpperCase()}
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0 }}>{detail.name || "Без названия"}</h3>
            {detail.name_original && <div className="muted">в оригинале: {detail.name_original}</div>}
          </div>
        </div>
        <div className="entity-field-row">
          <span className="muted">Описание</span>
          <span style={{ whiteSpace: "pre-wrap", flex: 1, minWidth: 0 }}>
            {detail.description || <span className="muted">—</span>}
          </span>
        </div>
        {detail.tags.length > 0 && (
          <div className="entity-field-row">
            <span className="muted">Теги</span>
            <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {detail.tags.map((t) => (
                <span key={t} className="badge tag">{t}</span>
              ))}
            </span>
          </div>
        )}
        {detail.ancestors.length > 0 && (
          <div className="entity-field-row">
            <span className="muted">Входит в</span>
            <span>
              {detail.ancestors.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && <span className="muted"> → </span>}
                  <Link to={`/communities/${a.id}`}>{a.name}</Link>
                </span>
              ))}
            </span>
          </div>
        )}
        {detail.locations.length > 0 && (
          <div className="entity-field-row">
            <span className="muted">Локации</span>
            <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {detail.locations.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && <span className="muted">· </span>}
                  <Link to={`/locations/${l.id}`}>{l.name}</Link>
                </span>
              ))}
            </span>
          </div>
        )}
        {detail.children.length > 0 && (
          <div className="entity-field-row">
            <span className="muted">Вложенные</span>
            <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {detail.children.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && <span className="muted">· </span>}
                  <Link to={`/communities/${c.id}`}>{c.name}</Link>
                </span>
              ))}
            </span>
          </div>
        )}
        <Link to={`/communities/${communityId}`}>Открыть полный профиль →</Link>
      </div>
      <div className="card stack">
        <h3>Состоит · {detail.members.length}</h3>
        {detail.members.length === 0 ? (
          <span className="muted">Пока никого — личности добавляются на странице сообщества или перетаскиванием.</span>
        ) : (
          <div className="stack" style={{ gap: 4 }}>
            {detail.members.map((m) => (
              <div key={m.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                <Link to={`/beings/${m.id}`} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.name || "Без названия"}
                </Link>
                {m.category && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{m.category}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Большая карточка личности справа: обычная карточка + статблок двумя
// столбцами, под карточкой — где обитает и в каких фракциях состоит.
function BeingDetailPane({ beingId, settingId, onBack }: { beingId: number; settingId: number; onBack: () => void }) {
  // Та же карточка, что у профиля существа: правка там видна здесь сразу.
  const detailState = useEntity<SettingBeingDetail>("being", beingId);
  const detail = detailState.data;
  const error = detail ? null : detailState.error;

  if (error) {
    return (
      <div className="card stack">
        <span>Не удалось загрузить существо: {error}</span>
        <div className="row">
          <button className="primary" onClick={onBack}>Назад к списку</button>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="card" aria-busy="true" aria-label="Загрузка личности">
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="being-detail-split">
        <div className="stack" style={{ flex: 1, minWidth: 0 }}>
          <CreatureCardPreview type="being" id={beingId} />
          <div className="card stack">
            <div className="entity-field-row">
              <span className="muted">Обитает</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {detail.locations.length > 0 ? (
                  <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {detail.locations.map((l, i) => (
                      <span key={l.id}>
                        {i > 0 && <span className="muted">· </span>}
                        <Link to={`/locations/${l.id}`}>{l.name}</Link>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </span>
            </div>
            <div className="entity-field-row">
              <span className="muted">Фракции</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {detail.communities.length > 0 ? (
                  <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {detail.communities.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && <span className="muted">· </span>}
                        <Link to={`/communities/${c.id}`}>{c.name}</Link>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </span>
            </div>
            <Link to={`/beings/${beingId}`}>Открыть полный профиль →</Link>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StatblockList ownerType="being" ownerId={beingId} ownerName={detail.name} settingId={settingId} soleOnPage />
        </div>
      </div>
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
  const run = useAction();
  const afterWrite = useAfterWrite();
  const [promptDialog, promptText] = usePrompt();
  const { deleteWithUndo } = useUndoDelete();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [creating, setCreating] = useState(false);
  const [locationFilter, setLocationFilter] = useState("");
  const [sort, setSort] = useState<"name" | "recent" | "creature_type">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [confirmDialog, confirm] = useConfirm();
  // Master–Detail: список записей слева, выбранная — справа большой
  // карточкой (та же BeingDetailPane, что у личностей).
  const [selId, setSelId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  function handleSort(next: typeof sort) {
    if (sort === next) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(next); setSortDir("asc"); }
  }

  const listState = useResource<SettingBeing[]>(
    populationPaths.bestiary(settingId, { query: debouncedQuery, locationId: locationFilter, sort, dir: sortDir }),
    { keepPrevious: true }
  );
  // Сервер умеет только name/recent/category — тип существа сортируем
  // клиентски (creature_meta догружается отдельным запросом сервера).
  const beings = useMemo(() => {
    const rows = listState.data ?? NO_BEINGS;
    if (sort !== "creature_type") return rows;
    const dirMul = sortDir === "desc" ? -1 : 1;
    return [...rows].sort(
      (a, b) =>
        dirMul *
        ((a.creature_meta?.creatureType ?? "").localeCompare(b.creature_meta?.creatureType ?? "", "ru") ||
          a.name.localeCompare(b.name, "ru", { numeric: true }))
    );
  }, [listState.data, sort, sortDir]);
  const locations = useResource<SettingLocation[]>(settingPaths.inSetting("location", settingId)).data ?? NO_LOCATIONS;

  async function duplicateBeing(being: SettingBeing) {
    // Повтор создал бы вторую копию.
    await run(
      () =>
        write.post("/setting-beings", {
        setting_id: settingId,
        name: `Копия — ${being.name}`,
        category: "bestiary",
        statblock_short: being.statblock_short,
        statblock_full: being.statblock_full,
        history: being.history,
        behavior: being.behavior,
        description: being.description,
        tags: being.tags,
        }),
      { affects: [{ kind: "being" }], retry: false }
    );
  }

  async function deleteBeing(beingId: number) {
    const ok = await confirm({
      title: "Архивировать запись бестиария?",
      message: "Будет скрыта из списков. Можно восстановить в архиве.",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    const name = beings.find((b) => b.id === beingId)?.name ?? "Запись";
    await run(
      () =>
        deleteWithUndo({
          entityName: name,
          deleteFn: async () => { await write.del(`/setting-beings/${beingId}`); },
          restoreFn: async () => { await write.put(`/setting-beings/${beingId}/restore`); afterWrite([{ kind: "being" }]); },
        }).then(() => true),
      { affects: [{ kind: "being" }] }
    );
  }

  async function renameBeing(being: SettingBeing) {
    const name = await promptText({ title: "Переименовать запись", message: "Название", defaultValue: being.name });
    if (!name?.trim() || name.trim() === being.name) return;
    await run(() => write.put(`/setting-beings/${being.id}`, { name: name.trim() }).then(() => true), {
      affects: [{ kind: "being", id: being.id }],
    });
  }

  const {
    paged: pagedBeings,
    pager: tilesPager,
    wrapRef: gridWrapRef,
  } = useTilePagination(beings, selId == null, [debouncedQuery, locationFilter, sort, sortDir].join("|"));

  return (
    <div className="stack" style={{ paddingBottom: "calc(var(--player-bar-height, 52px) + 16px)" }}>
      {confirmDialog}
      {promptDialog}
      {creating && (
        <EntityWizard
          initialType="bestiary"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
        />
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div className="row sort-toggle" style={{ gap: 4 }}>
          <button className={sort === "name" ? "active-sort" : ""} onClick={() => handleSort("name")}>А-Я{sort === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
          <button className={sort === "recent" ? "active-sort" : ""} onClick={() => handleSort("recent")}>Недавние{sort === "recent" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
          <button className={sort === "creature_type" ? "active-sort" : ""} onClick={() => handleSort("creature_type")}>По типу{sort === "creature_type" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
        </div>
        <input
          placeholder="Поиск по бестиарию…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск по бестиарию"
          style={{ flex: 1 }}
        />
        <LocationFilter locations={locations} value={locationFilter} onChange={setLocationFilter} />
        <button className="primary" onClick={() => setCreating(true)} style={{ marginLeft: "auto" }}>
          Создать запись бестиария
        </button>
      </div>
      <Loadable
        loading={listState.loading}
        error={listState.data ? null : listState.error}
        errorTitle="Не удалось загрузить бестиарий"
        onRetry={listState.reload}
        skeleton={<ListSkeleton variant="rows" count={1} label="Загрузка бестиария" />}
        empty={beings.length === 0 ? (
          <EmptyState
            title="Бестиарий пока пуст"
            hint="Виды без имени — гоблины, утопленники, духи леса. Добавьте первый."
            action={
              <button className="primary" onClick={() => setCreating(true)}>
                Создать запись бестиария
              </button>
            }
          />
        ) : null}
      >
        <EntityTabWorkspace
          sections={[
            {
              id: "all",
              label: "Все записи",
              count: beings.length,
              items: beings.map((b) => ({ id: String(b.id), label: b.name || "Без названия" })),
            },
          ]}
          selection={{ section: "all", item: selId != null ? String(selId) : undefined }}
          onSelect={(next) => next.item != null && setSelId(Number(next.item))}
          workspaceKey={settingId}
          navFooter={
            <button className="primary" onClick={() => setCreating(true)} style={{ alignSelf: "flex-start" }}>
              Создать запись бестиария
            </button>
          }
        >
          {selId != null ? (
            <BeingDetailPane
              key={selId}
              beingId={selId}
              settingId={settingId}
              onBack={() => setSelId(null)}
            />
          ) : (
            <div ref={gridWrapRef} className="stack">
              {tilesPager}
              <SettingBeingTileGrid beings={pagedBeings} grouping={sort === "creature_type" ? "creature_type" : "alpha"} searchActive={!!debouncedQuery.trim()} dir={sortDir} onCreate={() => setCreating(true)} onRename={renameBeing} onArchive={(b) => deleteBeing(b.id)} />
            </div>
          )}
        </EntityTabWorkspace>
      </Loadable>
    </div>
  );
}

function CommunitiesSection({ settingId }: { settingId: number }) {
  const [promptDialog, promptText] = usePrompt();
  const { deleteWithUndo } = useUndoDelete();
  const run = useAction();
  const afterWrite = useAfterWrite();
  const [creating, setCreating] = useState(false);
  const [locationFilter, setLocationFilter] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [sort, setSort] = useState<"name" | "recent">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [confirmDialog, confirm] = useConfirm();
  // Master–Detail: список слева, выбранное — справа карточкой
  // сообщества + состав (CommunityDetailPane ниже).
  const [selId, setSelId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  function handleSort(next: typeof sort) {
    if (sort === next) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(next); setSortDir("asc"); }
  }

  const listState = useResource<SettingCommunity[]>(
    populationPaths.communities(settingId, { locationId: locationFilter, query: debouncedQuery, sort, dir: sortDir }),
    { keepPrevious: true }
  );
  const communities = listState.data ?? NO_COMMUNITIES;
  const locations = useResource<SettingLocation[]>(settingPaths.inSetting("location", settingId)).data ?? NO_LOCATIONS;

  async function deleteCommunity(id: number) {
    const ok = await confirm({
      title: "Архивировать сообщество?",
      message: "Будет скрыто из списков, личности останутся. Можно восстановить в архиве.",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    const name = communities.find((c) => c.id === id)?.name ?? "Сообщество";
    await run(
      () =>
        deleteWithUndo({
          entityName: name,
          deleteFn: async () => { await write.del(`/setting-communities/${id}`); },
          restoreFn: async () => { await write.put(`/setting-communities/${id}/restore`); afterWrite([{ kind: "community" }]); },
        }).then(() => true),
      { affects: [{ kind: "community" }] }
    );
  }

  async function renameCommunity(community: SettingCommunity) {
    const name = await promptText({ title: "Переименовать сообщество", message: "Название", defaultValue: community.name });
    if (!name?.trim() || name.trim() === community.name) return;
    await run(() => write.put(`/setting-communities/${community.id}`, { name: name.trim() }).then(() => true), {
      affects: [{ kind: "community", id: community.id }],
    });
  }

  const {
    paged: pagedCommunities,
    pager: tilesPager,
    wrapRef: gridWrapRef,
  } = useTilePagination(communities, selId == null, [debouncedQuery, locationFilter, sort, sortDir].join("|"));

  return (
    <div className="stack" style={{ paddingBottom: "calc(var(--player-bar-height, 52px) + 16px)" }}>
      {confirmDialog}
      {promptDialog}
      {creating && (
        <EntityWizard
          initialType="community"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
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
        <button className="primary" onClick={() => setCreating(true)} style={{ marginLeft: "auto" }}>
          Создать сообщество
        </button>
      </div>
      {locationFilter && !debouncedQuery.trim() && (
        <span className="muted">
          С фильтром показаны и вложенные сообщества, не только верхнеуровневые.
        </span>
      )}
      {debouncedQuery.trim() && <span className="muted">Поиск по имени — {communities.length} найдено</span>}
      <Loadable
        loading={listState.loading}
        error={listState.data ? null : listState.error}
        errorTitle="Не удалось загрузить сообщества"
        onRetry={listState.reload}
        skeleton={<ListSkeleton variant="rows" count={1} label="Загрузка сообществ" />}
        empty={communities.length === 0 ? (
          <EmptyState
            title="Сообществ пока нет"
            hint="Народы, культуры, фракции, гильдии — начните с первого объединения."
            action={
              <button className="primary" onClick={() => setCreating(true)}>
                Создать сообщество
              </button>
            }
          />
        ) : null}
      >
        <EntityTabWorkspace
          sections={[
            {
              id: "all",
              label: "Все сообщества",
              count: communities.length,
              items: communities.map((c) => ({ id: String(c.id), label: c.name || "Без названия" })),
            },
          ]}
          selection={{ section: "all", item: selId != null ? String(selId) : undefined }}
          onSelect={(next) => next.item != null && setSelId(Number(next.item))}
          workspaceKey={settingId}
          navFooter={
            <button className="primary" onClick={() => setCreating(true)} style={{ alignSelf: "flex-start" }}>
              Создать сообщество
            </button>
          }
        >
          {selId != null ? (
            <CommunityDetailPane
              key={selId}
              communityId={selId}
              onBack={() => setSelId(null)}
            />
          ) : (
            <div ref={gridWrapRef} className="stack">
              {tilesPager}
              <SettingCommunityTileGrid communities={pagedCommunities} searchActive={!!debouncedQuery.trim()} dir={sortDir} onCreate={() => setCreating(true)} onRename={renameCommunity} onArchive={(c) => deleteCommunity(c.id)} />
            </div>
          )}
        </EntityTabWorkspace>
      </Loadable>
    </div>
  );
}

function ArtifactsTab({ settingId }: { settingId: number }) {
  const run = useAction();
  const afterWrite = useAfterWrite();
  const listState = useResource<Artifact[]>(settingPaths.inSetting("artifact", settingId));
  const artifacts = listState.data ?? NO_ARTIFACTS;
  const loading = listState.loading;
  const loadError = listState.data ? null : listState.error;
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [grouping, setGrouping] = useState<"alpha" | "item_class" | "rarity">("item_class");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterClass, setFilterClass] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");
  const [filterRarity, setFilterRarity] = useState<string>("");
  // Master–Detail: группы слева, предметы — пунктами, выбранный — справа
  // в превью с действиями. Сетка плиток остаётся для обзоров (Все/группа).
  const [artSel, setArtSel] = useState<{ section: string; item?: string }>({ section: "all" });
  const [editing, setEditing] = useState<Artifact | null>(null);
  const [assigning, setAssigning] = useState<Artifact | null>(null);
  const [rev, setRev] = useState(0);
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const typeOptions = filterClass ? itemTypeOptions(filterClass) : [];

  const filtered = artifacts.filter((a) => {
    if (filterClass && a.item_class !== filterClass) return false;
    if (filterType && a.item_type !== filterType) return false;
    if (filterRarity && a.rarity !== filterRarity) return false;
    if (!debouncedQuery.trim()) return true;
    const q = debouncedQuery.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      (a.owner && a.owner.toLowerCase().includes(q)) ||
      (a.rarity && a.rarity.toLowerCase().includes(q)) ||
      (a.item_type && a.item_type.toLowerCase().includes(q))
    );
  });

  const groups = useMemo(() => groupArtifacts(filtered, grouping, sortDir), [filtered, grouping, sortDir]);
  const artSections = [
    { id: "all", label: "Все", count: filtered.length },
    ...groups.map(([label, list]) => ({
      id: `g:${label}`,
      label,
      count: list.length,
      items: list.map((a) => ({ id: String(a.id), label: a.name || "Без названия" })),
    })),
  ];
  const selItem = artSel.item != null ? artifacts.find((a) => String(a.id) === artSel.item) : undefined;
  const selGroup = artSel.section.startsWith("g:")
    ? groups.find(([label]) => `g:${label}` === artSel.section)
    : undefined;

  async function removeArtifact(a: Artifact) {
    const ok = await confirm({ message: `Отправить «${a.name}» в архив?`, confirmLabel: "Архивировать", danger: true });
    if (!ok) return;
    const done = await run(
      () =>
        deleteWithUndo({
          entityName: a.name,
          deleteFn: async () => {
            await write.del(`/artifacts/${a.id}`);
          },
          restoreFn: async () => {
            await write.put(`/artifacts/${a.id}/restore`);
            afterWrite([{ kind: "artifact" }]);
          },
        }).then(() => true),
      { affects: [{ kind: "artifact" }] }
    );
    if (done) setArtSel({ section: artSel.section });
  }

  function gridScope(): { artifacts: Artifact[]; grouping: ArtifactGrouping } {
    if (selGroup) return { artifacts: selGroup[1], grouping };
    return { artifacts: filtered, grouping };
  }

  const artAll = artSel.section === "all" && !artSel.item;
  const {
    paged: pagedArtifacts,
    pager: tilesPager,
    wrapRef: gridWrapRef,
  } = useTilePagination(filtered, artAll, [
    debouncedQuery,
    grouping,
    sortDir,
    filterClass,
    filterType,
    filterRarity,
  ].join("|"));

  return (
    <div className="card stack">
      {confirmDialog}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="primary" onClick={() => setCreating(true)}>
          + Предмет
        </button>
        <input
          placeholder="Поиск…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 150 }}
        />
        <div className="row" style={{ gap: 2 }}>
          {([
            ["item_class", "По типу"],
            ["rarity", "По редкости"],
            ["alpha", "По алфавиту"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              className={grouping === key ? "active" : ""}
              onClick={() => {
                if (grouping === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                else { setGrouping(key); setSortDir("asc"); }
              }}
              style={{ fontSize: "var(--fs-meta)" }}
            >
              {label} {grouping === key ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <select value={filterClass} onChange={(e) => { setFilterClass(e.target.value); setFilterType(""); }} style={{ fontSize: "var(--fs-meta)" }}>
          <option value="">Все роды</option>
          {ITEM_CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ fontSize: "var(--fs-meta)" }} disabled={!filterClass}>
          <option value="">Все типы</option>
          {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterRarity} onChange={(e) => setFilterRarity(e.target.value)} style={{ fontSize: "var(--fs-meta)" }}>
          <option value="">Все редкости</option>
          {MAGIC_ITEM_RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {(filterClass || filterType || filterRarity) && (
          <button style={{ fontSize: "var(--fs-meta)" }} onClick={() => { setFilterClass(""); setFilterType(""); setFilterRarity(""); }}>
            Сбросить фильтры
          </button>
        )}
      </div>
      {creating && (
        <EntityWizard
          initialType="artifact"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
          // Визард отдаёт (id, type): созданный предмет выбираем сразу.
          onCreated={(id) => {
            if (typeof id === "number") setArtSel({ section: "all", item: String(id) });
          }}
        />
      )}
      {loading && <p className="muted">Загрузка…</p>}
      {loadError && (
        <EmptyState kind="error"
          title="Ошибка загрузки"
          hint={loadError}
          action={<button onClick={listState.reload}>Повторить</button>}
        />
      )}
      {!loading && !loadError && filtered.length === 0 && artifacts.length === 0 && (
        <EmptyState
          title="Сокровищница пуста"
          hint="Особые предметы сеттинга, имеющие значение для приключений"
          action={
            <button className="primary" onClick={() => setCreating(true)}>
              + Создать первый предмет
            </button>
          }
        />
      )}
      {!loading && !loadError && filtered.length === 0 && artifacts.length > 0 && (
        <p className="muted">Ничего не найдено.</p>
      )}
      {!loading && !loadError && filtered.length > 0 && (
        <EntityTabWorkspace
          sections={artSections}
          selection={artSel}
          onSelect={setArtSel}
          workspaceKey={settingId}
          navFooter={
            <button className="primary" onClick={() => setCreating(true)} style={{ alignSelf: "flex-start" }}>
              + Предмет
            </button>
          }
        >
          {selItem ? (
            <div className="stack">
              <EntityPreviewContent key={`${selItem.id}-${rev}`} type="artifact" id={selItem.id} />
              <div className="card">
                <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                  <Link to={`/artifacts/${selItem.id}`} className="primary" style={{ display: "inline-block", padding: "6px 12px", textDecoration: "none" }}>
                    Открыть профиль
                  </Link>
                  <button onClick={() => setEditing(selItem)}>Редактировать</button>
                  <button onClick={() => setAssigning(selItem)}>Привязать</button>
                  <button className="danger" onClick={() => removeArtifact(selItem)}>Архивировать</button>
                </div>
              </div>
            </div>
          ) : (
            <div ref={gridWrapRef} className="stack">
              {artAll && tilesPager}
              <ArtifactTileGrid
                artifacts={artAll ? pagedArtifacts : gridScope().artifacts}
                grouping={gridScope().grouping}
                searchActive={!!debouncedQuery.trim()}
                dir={sortDir}
                settingId={settingId}
              />
            </div>
          )}
        </EntityTabWorkspace>
      )}
      {editing && (
        <ArtifactEditModal
          artifact={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setRev((r) => r + 1); setEditing(null); }}
        />
      )}
      {assigning && (
        <ArtifactAssignModal
          artifact={assigning}
          settingId={settingId}
          onClose={() => setAssigning(null)}
          onSaved={() => { setRev((r) => r + 1); setAssigning(null); }}
        />
      )}
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
  const [includeAdventures, setIncludeAdventures] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doExport() {
    // Выгрузка — один синхронный запрос без процента готовности; с картинками
    // и приключениями может идти десятки секунд, поэтому длинный таймаут
    // и бесконечный индикатор, чтобы не выглядело зависшим.
    setBusy(true);
    setError(null);
    try {
      const include = [includeCalendar && "calendar", includeResources && "resources", includeImages && "images", includeAdventures && "adventures"]
        .filter(Boolean)
        .join(",");
      const data = await api.get(`/settings/${settingId}/export?include=${include}`, {
        timeoutMs: 120000,
      });
      downloadJson(data, `setting-${settingName}.json`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={() => { if (!busy) onClose(); }}>
      <h3>Экспорт сеттинга</h3>
      <div className="stack">
        <span className="muted">
          География, население, сообщества, их главы, связи и отношения экспортируются всегда. Что добавить ещё:
        </span>
        <label className="row">
          <input
            type="checkbox"
            checked={includeCalendar}
            disabled={busy}
            onChange={(e) => setIncludeCalendar(e.target.checked)}
          />
          Календарь и хроника мира
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={includeResources}
            disabled={busy}
            onChange={(e) => setIncludeResources(e.target.checked)}
          />
          Артефакты и ресурсы
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={includeImages}
            disabled={busy}
            onChange={(e) => setIncludeImages(e.target.checked)}
          />
          Изображения, галереи, карты локаций (с пинами) и звуковые файлы (значительно увеличит размер файла)
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={includeAdventures}
            disabled={busy}
            onChange={(e) => setIncludeAdventures(e.target.checked)}
          />
          Приключения (сценарии, сцены, проверки, полотна)
        </label>
        {busy && <ExportProgress label="Идёт экспорт…" />}
        {error && !busy && <ExportProgress error={error} />}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button disabled={busy} onClick={onClose}>Отмена</button>
          <button className="primary" disabled={busy} onClick={doExport}>
            {busy ? "Экспортируем…" : "Скачать"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
