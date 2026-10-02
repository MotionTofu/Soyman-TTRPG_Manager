import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { dataKeys, type Affect } from "../data/entities";
import { useAction, useAfterWrite, useEntity, useResource, useSaveEntity, write } from "../data/hooks";
import { readResource, readOnce } from "../data/imperative";
import { settingPaths } from "../data/settingEntities";
import {
  chronicleEventAffects,
  chroniclePaths,
  settingGroupAffects,
  settingPagePaths,
  timelineAffects,
} from "../data/settingPage";
import { SettingChronicleEventRow } from "../components/SettingChronicleEventRow";
import { GeographyRegistry } from "../components/setting/GeographyRegistry";
import { LocationRootGraph } from "../components/LocationRootGraph";
import { LocationMiller } from "../components/LocationMiller";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { SettingCalendarEditor } from "../components/SettingCalendarEditor";
import { SettingCalendarSettings } from "../components/SettingCalendarSettings";
import { ImportantDatesSection } from "../components/ImportantDatesSection";
import { EntityPage } from "../components/EntityPage";
import { useTabState } from "../hooks/useTabState";
import { Modal } from "../components/Modal";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { syncMentionLinks } from "../mentions";
import type { InworldDatedItem } from "../components/InworldCalendar";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { Timeline } from "../components/Timeline";
import { SettingCycles } from "../components/SettingCycles";
import { SettingCyclePanel } from "../components/setting/SettingCyclePanel";
import { dateFromElapsed, weekdayIndexFor } from "../inworldCalendar";
import { downloadJson } from "../downloadJson";
import { ExportProgress } from "../components/ExportProgress";
import { GenrePicker } from "../components/GenrePicker";
import type { SettingGenre } from "../types";
import { ArtifactTileGrid, ArtifactEditModal, ArtifactAssignModal } from "../components/ArtifactTileGrid";
import { groupArtifacts, type ArtifactGrouping } from "../artifactGroups";
import { EntityPreviewContent } from "../components/EntityPreviewModal";
import { EntityWizard } from "../components/entityWizard/EntityWizard";
import { AdventuresTab } from "../components/AdventuresTab";
import { ITEM_CLASSES, MAGIC_ITEM_RARITIES, itemTypeOptions } from "../compendium";
import { CrossLinksWizard } from "../components/CrossLinksWizard";
import { RelationGraph } from "../components/RelationGraph";
import { SETTING_SCOPED_TYPES } from "../components/GraphTypeFilters";

import type { GraphData } from "../graphTypes";
import { EmptyState } from "../components/EmptyState";
import { isSafeImageUrl, safeBackgroundImage } from "../utils/safeUrl";
import { useAlert, useConfirm } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { CampaignWizard } from "../components/CampaignWizard";
import { EntityTabWorkspace } from "../components/EntityTabWorkspace";
import { PopulationTab } from "../components/PopulationTab";
import { SettingOverview, type SettingCounts } from "../components/setting/SettingOverview";
import { SettingWorldTab } from "../components/setting/SettingWorldTab";
import { SettingGalleryTab } from "../components/setting/SettingGalleryTab";
import { SettingLibraryTab } from "../components/setting/SettingLibraryTab";
import { SettingAudioTab } from "../components/setting/SettingAudioTab";
import type { InstanceSummary } from "../components/workbooks/model";
import "./setting-profile.css";

import type { System } from "../types";
import type {
  Artifact,
  Campaign,
  ImportantDate,
  Setting,
  SettingCalendarEra,
  SettingCalendarEvent,
  SettingCalendarTimeline,
  SettingCycle,
  SettingGroup,
} from "../types";

// Вкладки профиля сеттинга (разбор 2026-10-01, Q1; «Заметки» убраны
// 2026-10-02, Q19). Под «…» — то, к чему ходят реже.
const TABS = [
  "Обзор",
  "Мир",
  "География",
  "Население",
  "Хроника",
  "Приключения",
  "Галерея",
  "Тетрадь",
  "Сокровищница",
  "Граф связей",
  "Библиотека",
  "Аудиотека",
] as const;
type Tab = (typeof TABS)[number];
const MORE_TABS: readonly Tab[] = ["Сокровищница", "Граф связей", "Библиотека", "Аудиотека"];
// Пустой сеттинг (Q13): на виду четыре вкладки, остальные — под «…».
const CORE_TABS: readonly Tab[] = ["Обзор", "Мир", "География", "Население"];
const TAB_ALIASES: Readonly<Record<string, string>> = {
  "Хроника мира": "Хроника",
  Ресурсы: "Галерея",
  Заметки: "Мир",
};

// Пустые списки — одни на все отрисовки: `?? []` давал бы новый массив
// каждый раз и сбивал бы useMemo ниже.
const NO_EVENTS: SettingCalendarEvent[] = [];
const NO_CYCLES: SettingCycle[] = [];
const NO_DATES: ImportantDate[] = [];
const NO_ERAS: SettingCalendarEra[] = [];
const NO_TIMELINES: SettingCalendarTimeline[] = [];
const NO_CAMPAIGNS: Campaign[] = [];
const NO_GROUPS: SettingGroup[] = [];
const NO_ARTIFACTS: Artifact[] = [];
const NO_WORKBOOKS: InstanceSummary[] = [];

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
  const [tab, selectTab] = useTabState(TABS, "Обзор", TAB_ALIASES);
  const [showExport, setShowExport] = useState(false);
  // Редкие действия «Обзора» переехали под «…» (Q2): окна по пунктам меню.
  const [dialog, setDialog] = useState<"name" | "groups" | "links" | null>(null);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [savingName, setSavingName] = useState(false);

  // Каждый раздел читает своё, только пока открыт: «Обзор» не тянет хронику,
  // а хроника — персонажей кампаний.
  const onChronicle = tab === "Хроника";
  const counts = useResource<SettingCounts>(`/settings/${settingId}/counts`).data ?? null;
  const workbooks = useResource<InstanceSummary[]>(`/workbooks/instances?project_type=setting&project_id=${settingId}`).data ?? NO_WORKBOOKS;
  const onTags = dialog === "groups";
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
  // Порядок дат (просьба владельца 2026-10-02): старые сверху или новые сверху.
  const [chronicleNewestFirst, setChronicleNewestFirst] = useState(false);
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
    /** «Повторяется» (разбор 2026-10-02, Q2): не «нет» — запись уедет в «Повторяющиеся». */
    recurrence: "none" | "annual" | "monthly" | "weekly";
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
    const dir = chronicleNewestFirst ? -1 : 1;
    const byDate = (a: SettingCalendarEvent, b: SettingCalendarEvent) =>
      dir * (a.inworld_year - b.inworld_year || a.inworld_month - b.inworld_month || a.inworld_day - b.inworld_day);
    const sorted = [...events];
    if (chronicleSort === "important-first") sorted.sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0) || byDate(a, b));
    else sorted.sort(byDate);
    return sorted;
  }, [filteredCalendarEvents, chronicleFilter, chronicleSort, chronicleNewestFirst, selectedEraId, eras]);
  // Эпохи текущего таймлайна (общий — timeline_id = null). Раньше фильтр по
  // эпохам появлялся только у отдельного таймлайна, и эпохи общего было не выбрать.
  const timelineEras = useMemo(
    () => eras.filter((e) => (e.timeline_id ?? null) === selectedTimelineId).sort((a, b) => a.start_year - b.start_year),
    [eras, selectedTimelineId]
  );
  const eraOfYear = (year: number) => timelineEras.filter((e) => e.start_year <= year).pop();
  const axisRef = useRef<HTMLDivElement>(null);
  // Скрытое файловое поле импорта — его щёлкает пункт «Импорт» из меню «…».
  const importInputRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [timelineFocus, setTimelineFocus] = useState<{ year: number; month: number; day: number } | null>(null);

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
    setEventModal({ year, month, day, title: "", description: "", important: false, precision: "day", status: "happened", year_end: "", month_end: "", day_end: "", cancel_note: "", recurrence: "none" });
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
      recurrence: "none",
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

  /**
   * Событие → повторяющаяся дата (разбор 2026-10-02, Q1, Q6): перенос, а не
   * копия. Подтверждение перечисляет только то, что у события заполнено.
   */
  async function saveAsRecurring(modal: NonNullable<typeof eventModal>, recurrence: "annual" | "monthly" | "weekly") {
    const weekdays = [...(calendar?.weekdays ?? [])].sort((a, b) => a.position - b.position);
    const weekday = weekdays[weekdayIndexFor(modal.year, modal.month, modal.day, calendar?.months ?? [], weekdays.length)]?.position;
    if (recurrence === "weekly" && weekday == null) {
      showAlert("В календаре сеттинга нет дней недели.");
      return false;
    }
    const day = recurrence === "weekly" ? weekday : modal.day;
    const dateAffects: Affect[] = [{ path: chroniclePaths.importantDates(settingId) }];
    if (!modal.id) {
      return run(
        () =>
          write
            .post(chroniclePaths.importantDates(settingId), {
              owner_type: "setting", owner_id: settingId, title: modal.title.trim(), description: modal.description,
              recurrence, year: null, month: recurrence === "annual" ? modal.month : null, day, custom_rule: "", date_type: "", color: "",
            })
            .then(() => true),
        { affects: dateAffects, retry: false }
      );
    }
    const id = modal.id;
    const original = calendarEvents.find((e) => e.id === id);
    const footprint = await readOnce<{ links: number; campaign_copies: number; mention_dates: number }>(`/settings/calendar-events/${id}/footprint`).catch(() => null);
    const lost = [
      original?.status === "upcoming" && "статус «предстоит»",
      original?.status === "cancelled" && "статус «отменено»" + (original.cancel_note ? " и чем отменилось" : ""),
      original?.important ? "отметка «важное»" : false,
      original?.full_description?.trim() && "подробное описание",
      original?.consequences?.trim() && "последствия",
      original?.player_text?.trim() && "текст для игроков",
      footprint?.links && `связи: ${footprint.links}`,
      footprint?.campaign_copies && `копии в кампаниях: ${footprint.campaign_copies}`,
      footprint?.mention_dates && `важные даты у упомянутых: ${footprint.mention_dates}`,
    ].filter(Boolean);
    const ok = await confirm({
      title: "Сделать повторяющимся?",
      message: `«${modal.title.trim()}» переедет в «Повторяющиеся»; страница события пропадёт.` + (lost.length ? ` Уйдут: ${lost.join(", ")}.` : ""),
      confirmLabel: "Перенести",
    });
    if (!ok) return false;
    return run(
      async () => {
        // Сначала правки окна (название, описание) — потом перенос.
        await write.put(`/settings/calendar-events/${id}`, { title: modal.title.trim(), description: modal.description });
        await write.post(`/settings/calendar-events/${id}/to-recurring`, { recurrence, day });
        return true;
      },
      { affects: [...chronicleEventAffects(settingId, id), ...dateAffects], retry: false }
    );
  }

  async function saveEventModal() {
    if (!eventModal || !eventModal.title.trim()) return;
    if (eventModal.recurrence !== "none") {
      if (await saveAsRecurring(eventModal, eventModal.recurrence)) setEventModal(null);
      return;
    }
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
  const tabCount = (n: number | undefined) => (n ? ` · ${n}` : "");
  const label: Partial<Record<Tab, string>> = {
    Мир: `Мир${tabCount(counts?.world)}`,
    География: `География${tabCount(counts?.places)}`,
    Население: `Население${tabCount(counts ? counts.beings + counts.communities : 0)}`,
    Хроника: `Хроника${tabCount(counts?.events)}`,
    Приключения: `Приключения${tabCount(counts?.adventures)}`,
  };
  // «Тетрадь» — только когда к сеттингу привязана тетрадь (Q1).
  const available = TABS.filter((t) => t !== "Тетрадь" || workbooks.length > 0);
  const shownTabs = available.filter((t) => (isNewSetting ? CORE_TABS.includes(t) : !MORE_TABS.includes(t)));
  const hiddenTabs = available.filter((t) => !shownTabs.includes(t));

  return (
    <EntityPage
      paper
      crumbs={[{ label: "Сеттинги", to: "/settings" }, { label: setting.name }]}
      entityType="setting"
      title={setting.name}
      badges={setting.archived_at && <span className="badge cancelled">Архивировано</span>}
      // Жанры — метками под именем, на месте мазка (владелец, 2026-10-02);
      // щелчок открывает выбор жанров.
      meta={
        <span className="setting-genres">
          {(setting.genres ?? []).map((g, i) => (
            <button key={i} type="button" className="badge tag" onClick={() => setGenrePickerOpen(true)}>
              {g.subgenre ?? g.genre}
            </button>
          ))}
          {!setting.genres?.length && (
            <button type="button" className="badge tag setting-genres__add" onClick={() => setGenrePickerOpen(true)}>
              + жанр
            </button>
          )}
          {(savingFields || savingName) && <span aria-live="polite">Сохранение…</span>}
        </span>
      }
      backdrop={safeBg}
      actions={[
        { label: "Название и код…", onClick: () => setDialog("name") },
        { label: "Группы сеттингов…", onClick: () => setDialog("groups") },
        { label: "Проверка связей", onClick: () => setDialog("links") },
        { label: "Экспорт", onClick: () => setShowExport(true) },
        { label: "Импорт", onClick: () => importInputRef.current?.click() },
        { label: "Архивировать", danger: true, onClick: archiveSetting },
      ]}
      tabs={shownTabs.map((t) => ({ id: t, label: label[t] ?? t }))}
      hiddenTabs={hiddenTabs}
      tab={tab}
      onTab={(t) => selectTab(t as Tab)}
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

      {dialog === "name" && (
        <NameDialog
          setting={setting}
          onSave={async (name, code) => {
            await saveName(name, code);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "groups" && (
        <Modal ariaLabel="Группы сеттингов" onClose={() => setDialog(null)}>
          <h3>Группы сеттингов</h3>
          {allGroups.length === 0 ? (
            <p className="muted">Групп пока нет — их заводят в списке сеттингов.</p>
          ) : (
            <div className="stack">
              {allGroups.map((g) => {
                const isIn = settingGroupIds.includes(g.id);
                return (
                  <label key={g.id} className="row">
                    <input type="checkbox" checked={isIn} onChange={() => void toggleGroup(g, isIn)} />
                    {g.name}
                  </label>
                );
              })}
            </div>
          )}
        </Modal>
      )}
      {dialog === "links" && (
        <Modal ariaLabel="Проверка связей" wide onClose={() => setDialog(null)}>
          <CrossLinksWizard
            ownerKind="setting"
            ownerId={settingId}
            help="Ищет имена в описаниях локаций, историях личностей, полях сообществ, силе предметов и синопсисах приключений — и делает их кликабельными. Шаг за шагом, по одному типу цели: у каждого своя строгость. Сцены размечает такой же проход на странице приключения. Ничего не пишет, пока вы не подтвердите."
          />
        </Modal>
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
        <SettingOverview
          setting={setting}
          campaigns={campaigns}
          counts={counts}
          savePatch={save}
          onNewCampaign={openCampaignWizard}
          onGenres={() => setGenrePickerOpen(true)}
          onWorld={() => selectTab("Мир")}
        />
      )}
      {campaignWizardOpen && (
        <CampaignWizard
          systems={wizardSystems}
          settings={wizardSettings}
          defaultSettingId={settingId}
          onClose={() => setCampaignWizardOpen(false)}
          onCreated={() => setCampaignWizardOpen(false)}
        />
      )}
      {tab === "Мир" && <SettingWorldTab settingId={settingId} />}
      {tab === "География" && <GeographyTab settingId={settingId} />}
      {tab === "Население" && <PopulationTab settingId={settingId} />}
      {tab === "Приключения" && (
        <div className="card stack">
          <AdventuresTab settingId={settingId} />
        </div>
      )}
      {tab === "Сокровищница" && <ArtifactsTab settingId={settingId} />}
      {tab === "Граф связей" && <SettingGraphTab settingId={settingId} />}

      {tab === "Хроника" && (
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
              below={(view) => (
                <SettingCyclePanel
                  settingId={settingId}
                  cycles={cycles}
                  view={view}
                  onAddCycle={() => setChronicleTab("Циклы")}
                  onDayMenu={(day, x, y) => {
                    const date = dateFromElapsed(day, calendar?.months ?? []);
                    setCalendarMenu({
                      x,
                      y,
                      items: [{ label: "Событие на этот день", onClick: () => openCreateEventModal(date.year, date.month, date.day) }],
                    });
                  }}
                />
              )}
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
                    <button
                      className="comp-mini"
                      aria-pressed={chronicleNewestFirst}
                      title="Порядок дат"
                      onClick={() => setChronicleNewestFirst((v) => !v)}
                    >
                      {chronicleNewestFirst ? "↓ Новые сверху" : "↑ Старые сверху"}
                    </button>
                    {timelineEras.length > 0 && (
                      <>
                        <span style={{ margin: "0 4px" }}>|</span>
                        <select
                          className="comp-mini"
                          value={selectedEraId ?? ""}
                          onChange={(e) => setSelectedEraId(e.target.value ? Number(e.target.value) : null)}
                          style={{ fontSize: "var(--fs-meta)" }}
                        >
                          <option value="">Все эпохи</option>
                          {timelineEras.map((e) => (
                            <option key={e.id} value={e.id}>{e.name} ({e.start_year})</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                  <div className="stack">
                    {sortedFilteredEvents.map((ev, i) => {
                      // Q4 (2026-10-02): в хронологическом порядке события
                      // делятся заголовками эпох.
                      const era = chronicleSort === "chronological" ? eraOfYear(ev.inworld_year) : undefined;
                      const prev = i > 0 && chronicleSort === "chronological" ? eraOfYear(sortedFilteredEvents[i - 1].inworld_year) : undefined;
                      return (
                      <Fragment key={ev.id}>
                      {era && era !== prev && <div className="chronicle-era">{era.name} <span>· с {era.start_year} года</span></div>}
                      <SettingChronicleEventRow
                        ev={ev}
                        expanded={expandedEvents.has(ev.id)} calendar={calendar}
                        onToggleExpand={toggleEventExpanded}
                        onToggleImportant={toggleEventImportant}
                        onToggleVisible={toggleEventVisible}
                        onEdit={openEditEventModal} onDelete={deleteCalendarEvent}
                        onShowOnAxis={(e) => { setTimelineFocus({ year: e.inworld_year, month: e.inworld_month, day: e.inworld_day }); setTimeout(() => axisRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100); }}
                        onShowOnCalendar={() => { calendarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                      />
                      </Fragment>
                      );
                    })}
                    {sortedFilteredEvents.length === 0 && <p className="muted">{calendarEvents.length === 0 ? "Событий пока нет." : "Ничего не найдено."}</p>}
                  </div>
                </div>
              )}

              {chronicleTab === "Повторяющиеся" && (
                <ImportantDatesSection
                  settingId={settingId}
                  months={calendar?.months}
                  weekdays={calendar?.weekdays}
                  now={{ year: setting.pinned_calendar_year ?? null, month: setting.pinned_calendar_month ?? null }}
                />
              )}

              {chronicleTab === "Циклы" && (
                <SettingCycles
                  settingId={settingId}
                  months={calendar?.months}
                  now={{ year: setting.pinned_calendar_year ?? null, month: setting.pinned_calendar_month ?? null }}
                />
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

      {tab === "Галерея" && <SettingGalleryTab setting={setting} />}
      {tab === "Библиотека" && <SettingLibraryTab settingId={settingId} />}
      {tab === "Аудиотека" && <SettingAudioTab settingId={settingId} />}
      {tab === "Тетрадь" && (
        // Привязка тетради — шаг 4 тетрадей; пока вкладка ведёт в привязанные.
        <section className="paper-groups" aria-label="Тетрадь сеттинга">
          <ul className="paper-rows">
            {workbooks.map((w) => (
              <li key={w.id}>
                <Link className="paper-rows__main" to={`/workbooks/${w.id}`}>
                  {w.title} →
                </Link>
                <span className="paper-rows__sub">
                  {w.template_title}
                  {w.progress ? ` · заполнено ${w.progress.filled} из ${w.progress.total}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
            {(() => {
              // Q7: повторять неточное или растянутое не по чему.
              const blocked =
                eventModal.precision !== "day" ? "уточните дату до дня"
                : eventModal.year_end.trim() || eventModal.month_end.trim() || eventModal.day_end.trim() ? "уберите конец периода"
                : null;
              return (
                <label className="row">
                  Повторяется
                  <select
                    value={eventModal.recurrence}
                    onChange={(e) => setEventModal({ ...eventModal, recurrence: e.target.value as NonNullable<typeof eventModal>["recurrence"] })}
                  >
                    <option value="none">нет</option>
                    <option value="annual" disabled={!!blocked}>каждый год</option>
                    <option value="monthly" disabled={!!blocked}>каждый месяц</option>
                    <option value="weekly" disabled={!!blocked}>каждую неделю</option>
                  </select>
                  {blocked && <span className="muted">чтобы повторять — {blocked}</span>}
                  {!blocked && eventModal.recurrence !== "none" && <span className="muted">уедет в «Повторяющиеся»</span>}
                </label>
              );
            })()}
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

    </EntityPage>
  );
}

// Имя и код — редкая правка, под «…» (Q2). Код — короткое сокращение для
// ссылок [[wdh:…]]; двойник кода разрешён, его только называют.
function NameDialog({ setting, onSave, onClose }: { setting: Setting; onSave: (name: string, code: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(setting.name);
  const [code, setCode] = useState(setting.code ?? "");
  return (
    <Modal ariaLabel="Название и код" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void onSave(name.trim(), code.trim());
        }}
      >
        <h3>Название и код</h3>
        <label className="stack">
          Название
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="stack">
          Код для ссылок
          <input
            value={code}
            placeholder="wdh"
            pattern="^[a-z0-9-]{2,8}$"
            title="Пример: wdh → Waterdeep: Dragon Heist. Латиница, 2–8 символов."
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <div className="row">
          <button type="submit" className="primary">
            Сохранить
          </button>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </Modal>
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
    <button type="button" aria-pressed={view === id} onClick={() => pick(id)}>
      {label}
    </button>
  );
  // Переключатель вида — сегментом, как на остальных вкладках бумаги (доска 16).
  const seg = (
    <div className="population__seg" role="group" aria-label="Вид географии">
      {tab("columns", "Колонки")}
      {tab("list", "Список")}
      {tab("tree", "Дерево")}
    </div>
  );
  return (
    <div className="stack">
      {view === "columns" && <LocationMiller key={`m-${settingId}`} settingId={settingId} lead={seg} />}
      {view === "list" && (
        <GeographyRegistry
          settingId={settingId}
          lead={seg}
          onOpenInColumns={(chain) => {
            // Колонки читают путь из того же ключа при монтировании.
            try {
              localStorage.setItem(`geography-millerpath-${settingId}`, JSON.stringify(chain));
            } catch {
              /* ignore */
            }
            pick("columns");
          }}
        />
      )}
      {view === "tree" && <LocationRootGraph key={settingId} settingId={settingId} lead={seg} />}
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
  const [includeAlbums, setIncludeAlbums] = useState(false);
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
      const include = [includeCalendar && "calendar", includeResources && "resources", includeResources && includeAlbums && "albums", includeImages && "images", includeAdventures && "adventures"]
        .filter(Boolean)
        .join(",");
      const data = await readOnce(`/settings/${settingId}/export?include=${include}`, {
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
        {/* Альбомы — доп. контент поверх ресурсов (разбор 2026-10-02, Q1/Q8). */}
        <label className="row setting-export__nested">
          <input
            type="checkbox"
            checked={includeResources && includeAlbums}
            disabled={busy || !includeResources}
            onChange={(e) => setIncludeAlbums(e.target.checked)}
          />
          Альбомы галереи
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
