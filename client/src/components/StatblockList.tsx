import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAction, useAfterWrite, useResource, write } from "../data/hooks";
import { readResource } from "../data/imperative";
import { showSaveError } from "../data/notices";
import {
  applySavedStatblock,
  archivedStatblockListPath,
  statblockAffects,
  statblockListPath,
  useStatblockQueue,
} from "../data/statblocks";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { useConfirm } from "../hooks/useConfirm";
import { NavIcon } from "./NavIcons";
import { EmptyState } from "./EmptyState";
import { Modal } from "./Modal";
import { ContextMenu } from "./ContextMenu";
import type {
  Campaign,
  DndCharacterData,
  DndCreatureData,
  LitMCharacterData,
  LitMChallengeData,
  Resource,
  Statblock,
  StatblockFormat,
  ZipCharacterData,
  ZipCreatureData,
} from "../types";
import { emptyZipCharacter, emptyZipCreature, normalizeZipCharacter, normalizeZipCreature, ZipCharacterEdit, ZipCharacterView, ZipCreatureEdit, ZipCreatureView } from "./zip/ZipCharacterForm";
import { emptyChallenge, LitMChallengeEdit, LitMChallengeView } from "./litm/LitMChallengeForm";
import {
  emptyCharacter,
  LitMCharacterEdit,
  LitMCharacterView,
  normalizeCharacter,
  normalizeTheme,
} from "./litm/LitMCharacterForm";
import { normalizeDndCreature, DndCreatureView } from "./dnd/DndCreatureForm";
import { CreatureCardLoader } from "./CreatureCard";
import { emptyDndCharacter, normalizeDndCharacter, DndCharacterView } from "./dnd/DndCharacterForm";
import { classAndLevelSummary } from "./dnd/dndSummary";
import { findDndSystemId } from "./dnd/dndCompendium";
import { LitMCharacterWizard } from "./litm/LitMCharacterWizard";
import { DndCharacterWizard } from "./dnd/DndCharacterWizard";
import { LssImportWizard, type LssPreviewExtras } from "./dnd/LssImportWizard";
import { DndCreatureWizard } from "./dnd/DndCreatureWizard";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";

const TEMPLATE_TYPE = "statblock_template";
// Пока список грузится — пустой, и один и тот же массив: новый на каждой
// отрисовке сбивал бы мемоизацию всего, что от списка зависит.
const NO_STATBLOCKS: Statblock[] = [];

// Имя статблока для модалки удаления и тоста отмены: «ЭТО» из прежнего
// confirm() не называло, что именно сносится.
function statblockTitle(sb: Statblock): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(sb.content || "{}") as Record<string, unknown>;
  } catch {
    /* битый JSON — обойдёмся форматом */
  }
  const named =
    typeof parsed.characterName === "string" && parsed.characterName
      ? parsed.characterName
      : typeof parsed.name === "string" && parsed.name
      ? parsed.name
      : typeof parsed.title === "string" && parsed.title
      ? parsed.title
      : "";
  if (named) return named;
  return sb.note?.trim() || FORMAT_LABELS[sb.format] || "Статблок";
}

// Подпись строки менеджера чарников (/sheet, первый таб): система + то, что
// к ней уместно. Для D&D 5.5 — вид · класс [подкласс] уровень, для остальных
// — формат + краткий/полный.
function statblockManagerSubtitle(sb: Statblock): string {
  if (sb.format === "dnd_character") {
    try {
      const data = normalizeDndCharacter(JSON.parse(sb.content || "{}"));
      const cls = classAndLevelSummary(data.classes);
      const line = [data.raceName, cls].filter(Boolean).join(" · ");
      if (line) return `${FORMAT_LABELS[sb.format]} · ${line}`;
    } catch {
      /* битый JSON — только формат */
    }
    return FORMAT_LABELS[sb.format];
  }
  if (sb.format === "dnd_creature") return FORMAT_LABELS[sb.format];
  const kind = KIND_LABELS[sb.kind] ?? sb.kind;
  return `${FORMAT_LABELS[sb.format]} · ${kind}`;
}
const KIND_LABELS: Record<string, string> = { short: "Краткий", full: "Полный" };
const FORMAT_LABELS: Record<StatblockFormat, string> = {
  zip_character: "Золото и прах — Путешественник",
  zip_creature: "Золото и прах — Существо",
  text: "Обычный текст",
  litm_character: "Legend in the Mist — Персонаж",
  litm_challenge: "Legend in the Mist — Угроза (Challenge)",
  dnd_character: "D&D — Персонаж",
  dnd_creature: "D&D — Существо",
};

interface Props {
  ownerType: "character" | "being" | "compendium_entry";
  ownerId: number;
  campaignId?: number;
  // Forwarded to the plain-text statblock's MentionTextarea — preselects
  // "Сеттинг" in the @-mention "Создать новую сущность" flow. Pass the
  // owning setting when known (e.g. a being's setting_id).
  settingId?: number;
  // Pre-fills a new statblock's name field(s) — the owning character's/being's
  // name always, plus the player's name when it's a player character. Passed
  // in by the detail pages, which already have this data loaded.
  ownerName?: string;
  ownerPlayerName?: string;
  /** Портрет владельца — он же лицо первой карты листа (гриллинг 2026-09-04). */
  ownerPortraitUrl?: string | null;
  // Bestiary-only (ownerType === "compendium_entry"): pre-fills a new
  // dnd_creature statblock's Размер/Тип/КО/КЗ/Хиты/Скорость from the profile fields set on the
  // compendium monster entry itself, so they don't have to be typed twice.
  ownerCreatureType?: string;
  ownerCreatureSize?: string;
  ownerCreatureCR?: string;
  ownerCreatureAC?: string;
  ownerCreatureHP?: string;
  ownerCreatureSpeed?: string;
  // Список на странице один (страница сущности), а не один из многих
  // (бестиарий). Только тогда лист персонажа держит активную вкладку в
  // адресе: общий параметр на несколько листов им конфликтует
  // (гриллинг 2026-09-03).
  soleOnPage?: boolean;
  /**
   * Телефон: чарник не рисуется здесь, а открывается по этой ссылке на весь
   * экран — в разделе остаётся плашка (гриллинг 2026-09-04). На десктопе
   * проп игнорируется: там места хватает и лист живёт в странице.
   */
  sheetHref?: string;
  /**
   * Страница чарника: только сам лист, без визарда, импорта, корзины и
   * кнопки добавления. Всё это осталось на профиле — там его и заполняют.
   */
  sheetOnly?: boolean;
  // Жест «назад» с первой карты (свайп вправо, решение владельца 2026-09-06).
  // Задаёт полноэкранная страница чарника; встроенному листу возвращаться
  // некуда, и без пропса жест молчит.
  onSheetBack?: () => void;
  // Портрет протух (подпись URL живёт 60 секунд): перезагрузить владельца.
  onPortraitRefresh?: () => void;
  // Слот в шапке менеджера чарников (профиль персонажа): туда вызывающая
  // страница кладёт своё управление, которое относится к подготовке, а не к
  // листу — например, «Послания персонажу». В табах с чарниками не показывается.
  managerTop?: ReactNode;
}

// «2026-09-04 08:12:33» из SQLite — в человеческое «4 сентября». Строка
// приходит без часового пояса и трактуется как местное время: сервер и
// приложение живут на одной машине.
const trashDateFormat = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" });

function formatArchivedAt(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? raw : `удалён ${trashDateFormat.format(d)}`;
}

export function StatblockList({
  ownerType,
  ownerId,
  campaignId,
  settingId,
  ownerName,
  ownerPlayerName,
  ownerPortraitUrl,
  ownerCreatureType,
  ownerCreatureSize,
  ownerCreatureCR,
  ownerCreatureAC,
  ownerCreatureHP,
  ownerCreatureSpeed,
  soleOnPage,
  sheetHref,
  sheetOnly,
  onSheetBack,
  onPortraitRefresh,
  managerTop,
}: Props) {
  // Список владельца — из кэша слоя данных (docs/adr/0001): тот же ключ читает
  // вкладка «Имущество» профиля, правки извне обновляет DataLayerSync.
  const statblocks = useResource<Statblock[]>(statblockListPath(ownerType, ownerId)).data ?? NO_STATBLOCKS;
  // Удалённые статблоки владельца. До сих пор удалённый чарник исчезал
  // навсегда: вернуть его можно было только тостом «Отменить», жившим восемь
  // секунд, а дальше он молча лежал в базе вместе с портретом на диске.
  // Корзина — тот же запрос с флагом и тот же префикс ключа: восстановленный
  // статблок не окажется разом и в списке, и в корзине.
  const archived = useResource<Statblock[]>(archivedStatblockListPath(ownerType, ownerId)).data ?? NO_STATBLOCKS;
  const allTemplates = useResource<Resource[]>(`/resources?scope=global&type=${TEMPLATE_TYPE}`).data;
  const run = useAction();
  const afterWrite = useAfterWrite();
  const [adding, setAdding] = useState(false);
  const [format, setFormat] = useState<StatblockFormat>("text");
  const [templateId, setTemplateId] = useState("");
  const [newKind, setNewKind] = useState<"short" | "full">("full");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");
  const [importWarnings, setImportWarnings] = useState<{ field: string; message: string }[]>([]);
  // Батч-импорт (Волна 2, Q1/Q4/Q6): поштучные результаты, частичный успех —
  // валидные создаются, битые остаются в списке с причиной. Один файл идёт
  // старым путём через превью-модалку.
  const [batchResults, setBatchResults] = useState<{ file: string; ok: boolean; detail: string }[]>([]);
  const [importDragOver, setImportDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const [preview, setPreview] = useState<null | {
    characterName: string;
    shortText: string;
    warnings: { field: string; message: string }[];
    // Полный разбор для визарда подтверждений (тикет 04/06).
    characterData: Record<string, unknown>;
    rawExtras: LssPreviewExtras;
    summary: {
      raceName: string;
      raceId: number | null;
      className: string;
      subclassName: string;
      classId: number | null;
      subclassId: number | null;
      level: number;
      armorClass: string;
      hitPointMax: string;
      speed: string;
      skillCount: number;
      attackCount: number;
      equipmentCount: number;
    };
  }>(null);
  const [pendingJson, setPendingJson] = useState<string | null>(null);
  // Визард подтверждений поверх превью (тикет 06): правит characterData
  // локально, сохраняет сам; отмена возвращает в превью.
  const [showLssWizard, setShowLssWizard] = useState(false);
  const [showDndWizard, setShowDndWizard] = useState(false);
  // Клон чарника (Волна 2, Q1–Q8): мгновенная копия данных, не префилл
  // визарда — токены визарда (навыки «группа:ключ», метки наборов, прибавка
  // поверх) из готового листа не восстанавливаются без вранья, а копия
  // данных переносит билд 1:1. Визард не открывается — черновик не тронут
  // (Q5 закрыт сильней, чем договаривались: confirm не нужен вовсе).
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneSourceId, setCloneSourceId] = useState<number | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneEdited, setCloneEdited] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState("");
  const dndCharacters = statblocks.filter((s) => s.format === "dnd_character");
  function openClone() {
    const first = dndCharacters[0] ?? null;
    setCloneSourceId(first?.id ?? null);
    setCloneName(first ? `${statblockTitle(first)} (копия)` : "");
    setCloneEdited(false);
    setCloneError("");
    setCloneOpen(true);
  }
  async function confirmClone() {
    const src = statblocks.find((s) => s.id === cloneSourceId) ?? null;
    if (!src || src.format !== "dnd_character") return;
    const name = cloneName.trim();
    if (!name) {
      setCloneError("Назовите копию — без имени создать нельзя.");
      return;
    }
    setCloning(true);
    setCloneError("");
    try {
      // Клон нормализуется: иначе копия старого листа уносит его старый
      // формат дальше, и миграции приходится проходить заново уже у неё.
      const data = normalizeDndCharacter(JSON.parse(src.content));
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Статблок-источник не похож на персонажа.");
      }
      // Билд целиком; сбрасываются имя, портрет (уровень строки — не
      // копируется) и живое состояние (Q2, Q8).
      const copy: DndCharacterData = {
        ...data,
        characterName: name,
        hitPointsCurrent: typeof data.hitPointMax === "string" ? data.hitPointMax : "",
        hitPointsTemp: "",
        hitPointMaxTemp: "",
        hitDiceUsed: {},
        deathSaveSuccesses: 0,
        deathSaveFailures: 0,
        exhaustion: 0,
        conditions: [],
        concentration: "",
        inspiration: false,
      };
      await write.post("/statblocks", {
        owner_type: ownerType,
        owner_id: ownerId,
        format: "dnd_character",
        kind: src.kind,
        content: JSON.stringify(copy),
      });
      setCloneOpen(false);
      refresh();
      setImportSuccess(`Клонирован «${name}»`);
      setTimeout(() => setImportSuccess(""), 6000);
    } catch (e) {
      setCloneError(e instanceof Error && e.message ? e.message : "Не удалось клонировать.");
    } finally {
      setCloning(false);
    }
  }
  const [showDndCreatureWizard, setShowDndCreatureWizard] = useState(false);
  const [showLitmWizard, setShowLitmWizard] = useState(false);
  const [litmWizardStatblockId, setLitmWizardStatblockId] = useState<number | null>(null);
  const [activeStatblockId, setActiveId] = useState<number | null>(null);
  // Профиль персонажа: первый таб — менеджер чарников, дальше по табу на
  // чарник. По умолчанию открыт менеджер. В табах с чарниками — только сам
  // лист, всё управление (создать, импорт из LSS, клон, корзина, удаление)
  // живёт в менеджере. На /sheet (sheetOnly) менеджера нет — там играют.
  const [mgrTab, setMgrTab] = useState<number | "manager">("manager");
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const isMobileSheet = useIsMobile();
  // Создание из «Чарников»: ?newSheet=1 однократно открывает визард, затем
  // параметр снимается — иначе кнопка «назад» возвращала бы в визард.
  const [searchParams, setSearchParams] = useSearchParams();
  const didAutoWizard = useRef(false);
  useEffect(() => {
    if (didAutoWizard.current || searchParams.get("newSheet") !== "1") return;
    didAutoWizard.current = true;
    setShowDndWizard(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("newSheet");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);
  // Создание чарника с таббара (только десктоп, решение владельца 2026-09-06):
  // undefined — нет, null — выбор системы, number — визард с этой системой.
  const [creatingSystem, setCreatingSystem] = useState<number | null | undefined>(undefined);
  // Системы нужны только выбору при создании — и грузятся, только когда он открыт.
  const createSystems =
    useResource<{ id: number; name: string }[]>(creatingSystem !== undefined ? "/systems" : null).data ?? [];
  const [createSystemId, setCreateSystemId] = useState("");
  function startSheetCreate() {
    setCreateSystemId("");
    setCreatingSystem(null);
  }
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();

  const litmFormat: StatblockFormat = ownerType === "character" ? "litm_character" : "litm_challenge";
  const dndFormat: StatblockFormat = ownerType === "character" ? "dnd_character" : "dnd_creature";

  // Статблоки владельца изменились (визард, импорт, клон сохранили своё):
  // обновить списки и сказать другим окнам. Первичную загрузку и правки
  // извне берёт на себя слой данных.
  function refresh() {
    afterWrite(statblockAffects(ownerType, ownerId));
  }

  // Восстановление и окончательное удаление — поштучно. Массового «очистить
  // корзину» нет намеренно: удалять навсегда несколько чарников одним нажатием
  // — ровно тот промах, из-за которого мягкое удаление и появилось.
  async function restoreArchived(sb: Statblock) {
    await run(() => write.put(`/statblocks/${sb.id}/restore`), { affects: statblockAffects(ownerType, ownerId) });
  }
  async function purgeArchived(sb: Statblock) {
    const name = statblockTitle(sb);
    const ok = await confirm({
      title: "Удалить навсегда?",
      message: `«${name}» будет стёрт без возможности вернуть. Портрет статблока уйдёт в _Archive хранилища.`,
      confirmLabel: "Удалить навсегда",
      danger: true,
    });
    if (!ok) return;
    await run(() => write.del(`/statblocks/${sb.id}/forever`), {
      affects: statblockAffects(ownerType, ownerId),
      retry: false,
    });
  }

  const templates = useMemo(
    () =>
      (allTemplates ?? []).filter(
        (t) =>
          !t.template_format ||
          t.template_format === "text" ||
          t.template_format === litmFormat ||
          t.template_format === dndFormat ||
          t.template_format === "zip_character" ||
          t.template_format === "zip_creature"
      ),
    [allTemplates, litmFormat, dndFormat]
  );

  async function addStatblock() {
    // Создание не повторяется кнопкой плашки: ответ мог потеряться уже после
    // того, как сервер статблок завёл, и повтор сделал бы второй.
    const create = (body: { format: StatblockFormat; content: string; kind?: string }) =>
      run(
        () => write.post<{ id: number }>("/statblocks", { owner_type: ownerType, owner_id: ownerId, kind: "full", ...body }),
        { affects: statblockAffects(ownerType, ownerId), retry: false }
      );

    if (format === "litm_character") {
      const character = emptyCharacter();
      character.characterName = ownerName ?? "";
      if (campaignId) {
        try {
          const campaign = await readResource<Campaign>(`/campaigns/${campaignId}`);
          if (campaign.group_theme_litm) {
            character.fellowshipTheme = normalizeTheme(JSON.parse(campaign.group_theme_litm));
          }
        } catch {
          // no campaign group theme available — leave the empty default
        }
      }
      const res = await create({ format, content: JSON.stringify(character) });
      if (!res) return;
      setLitmWizardStatblockId(res.id);
      setShowLitmWizard(true);
      return;
    }

    let created: { id: number } | undefined;
    if (format === "litm_challenge") {
      created = await create({ format, content: JSON.stringify(emptyChallenge()) });
    } else if (format === "zip_character") {
      const character = emptyZipCharacter();
      character.characterName = ownerName ?? "";
      if (ownerType === "character") character.playerName = ownerPlayerName ?? "";
      created = await create({ format, content: JSON.stringify(character) });
    } else if (format === "zip_creature") {
      created = await create({ format, content: JSON.stringify(emptyZipCreature()) });
    } else if (format === "dnd_character") {
      const character = emptyDndCharacter();
      character.characterName = ownerName ?? "";
      if (ownerType === "character") character.playerName = ownerPlayerName ?? "";
      character.systemId = await findDndSystemId();
      created = await create({ format, content: JSON.stringify(character) });
    } else {
      const template = templates.find((t) => String(t.id) === templateId);
      created = await create({
        format: (template?.template_format || "text") as StatblockFormat,
        kind: template?.template_kind ?? newKind,
        content: template?.notes ?? "",
      });
    }
    // Не создалось — форма остаётся открытой с выбранным, ошибка на плашке.
    if (!created) return;
    setAdding(false);
    setTemplateId("");
    setFormat("text");
  }

  // Чарник — часы работы или импорт из LSS, а сносился он по одному
  // `confirm("удалить ЭТО?")` и физическому DELETE, без отката. Теперь: модалка
  // называет, что именно удаляется, сервер помечает строку архивной, а тост
  // восемь секунд держит «Отменить» (PUT /statblocks/:id/restore).
  async function removeStatblock(id: number) {
    const sb = statblocks.find((s) => s.id === id);
    const name = sb ? statblockTitle(sb) : "Статблок";
    const ok = await confirm({
      title: "Удалить статблок?",
      message: `«${name}» уйдёт из списка. Восемь секунд после удаления будет доступна отмена.`,
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    // Без catch упавшее удаление молчит: тоста нет, статблок на месте —
    // мастер решает, что кнопка не сработала, и жмёт ещё раз.
    try {
      await deleteWithUndo({
        entityName: name,
        deleteFn: async () => {
          await write.del(`/statblocks/${id}`);
          // Удалили открытый лист менеджера — возвращаемся в менеджер, а не
          // висим на пустом табе.
          if (mgrTab === id) setMgrTab("manager");
          refresh();
        },
        restoreFn: async () => {
          await write.put(`/statblocks/${id}/restore`);
          refresh();
        },
      });
    } catch (e) {
      showSaveError(`Не удалось удалить «${name}»: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function importFile(file: File | null, inputEl?: HTMLInputElement | null) {
    if (!file) return;
    const targetInput = inputEl ?? fileInputRef.current;
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(`Файл слишком большой (${(file.size / 1024 / 1024).toFixed(1)} МБ). Лимит 5 МБ.`);
      if (targetInput) targetInput.value = "";
      return;
    }
    setImporting(true);
    setImportError("");
    setImportSuccess("");
    setImportWarnings([]);
    try {
      const json = await file.text();
      if (!json.trim()) throw new Error("Файл пустой");
      try {
        JSON.parse(json);
      } catch {
        throw new Error("Файл не похож на JSON — убедитесь, что это экспорт с longstoryshort.app (Long Story Short)");
      }
      // Preview first — no DB write yet. Через `write`: разбор ничего не пишет,
      // и транспорт не должен объявлять его правкой другим окнам.
      const previewRes = await write.post<{
        characterName: string;
        shortText: string;
        warnings: { field: string; message: string }[];
        characterData: Record<string, unknown>;
        rawExtras: LssPreviewExtras;
        summary: {
          raceName: string;
          raceId: number | null;
          className: string;
          subclassName: string;
          classId: number | null;
          subclassId: number | null;
          level: number;
          armorClass: string;
          hitPointMax: string;
          speed: string;
          skillCount: number;
          attackCount: number;
          equipmentCount: number;
        };
      }>("/statblocks/import/preview", { owner_type: ownerType, owner_id: ownerId, json });
      setPendingJson(json);
      setPreview(previewRes);
      // reset input now — pendingJson holds the file
      if (targetInput) targetInput.value = "";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("too large") || msg.includes("413") || msg.toLowerCase().includes("payload")) {
        setImportError("Файл слишком большой (лимит 5 МБ). Попробуйте экспорт без лишних вложений.");
      } else if (msg.includes("Не удалось разобрать") || msg.includes("Не JSON") || msg.includes("Файл пустой") || msg.includes("Файл не похож")) {
        setImportError(msg);
      } else if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        setImportError("Персонаж не найден — обновите страницу и попробуйте снова.");
      } else if (msg.toLowerCase().includes("character")) {
        setImportError(msg);
      } else {
        setImportError(msg || "Не удалось разобрать файл. Убедитесь, что это экспорт персонажа с Long Story Short (longstoryshort.app).");
      }
      if (targetInput) targetInput.value = "";
    } finally {
      setImporting(false);
    }
  }

  async function confirmImport() {
    if (!pendingJson || !preview) return;
    const hasExisting = statblocks.some((s) => s.format === "dnd_character");
    if (hasExisting) {
      // confirm — промис модалки: без await условие всегда truthy и вопрос
      // не работает (тикет 04). confirmImport уже async, ждём честно.
      const ok = await confirm("У персонажа уже есть чарник(и). Добавить ещё один?\n\nЛишний можно удалить после импорта.");
      if (!ok) return;
    }
    setImporting(true);
    setImportError("");
    try {
      const res = await write.post<{ characterName: string; warnings: { field: string; message: string }[]; shortText: string; statblock: Statblock }>(
        "/statblocks/import",
        { owner_type: ownerType, owner_id: ownerId, json: pendingJson }
      );
      setPreview(null);
      setPendingJson(null);
      refresh();
      const wCount = res.warnings?.length ?? 0;
      setImportSuccess(`Импортирован ${res.characterName ? `«${res.characterName}»` : "персонаж"}${wCount ? ` — ${wCount} замечаний` : ""}`);
      if (wCount) setImportWarnings(res.warnings);
      setTimeout(() => setImportSuccess(""), 6000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setImportError(msg || "Не удалось сохранить статблок.");
    } finally {
      setImporting(false);
    }
  }

  // Drag helpers for the import zone (desktop: перетащить файл)
  function onImportDragOver(e: React.DragEvent) {
    e.preventDefault();
    setImportDragOver(true);
  }
  function onImportDragLeave() {
    setImportDragOver(false);
  }
  function onImportDrop(e: React.DragEvent) {
    e.preventDefault();
    setImportDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) void importFiles(files);
  }

  async function importFiles(files: FileList | File[] | null, inputEl?: HTMLInputElement | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    // Один файл — старый путь с превью-модалкой, без смены поведения.
    if (list.length === 1) {
      importFile(list[0] ?? null, inputEl);
      return;
    }
    const targetInput = inputEl ?? fileInputRef.current;
    const hasExisting = statblocks.some((s) => s.format === "dnd_character");
    if (hasExisting) {
      const ok = await confirm({
        title: "Импортировать пачку?",
        message: `Файлов: ${list.length}. У персонажа уже есть чарник(и) — валидные файлы добавятся новыми статблоками, битые останутся в списке с причиной.`,
        confirmLabel: "Импортировать",
      });
      if (!ok) {
        if (targetInput) targetInput.value = "";
        return;
      }
    }
    setImporting(true);
    setImportError("");
    setImportSuccess("");
    setImportWarnings([]);
    setBatchResults([]);
    const results: { file: string; ok: boolean; detail: string }[] = [];
    // Последовательно: сервер один, локальный — пачки по 3–10 файлов,
    // параллелить нечего, а порядок в списке совпадает с выбором.
    for (const file of list) {
      if (file.size > MAX_IMPORT_BYTES) {
        results.push({ file: file.name, ok: false, detail: `слишком большой (${(file.size / 1024 / 1024).toFixed(1)} МБ, лимит 5 МБ)` });
        setBatchResults([...results]);
        continue;
      }
      try {
        const json = await file.text();
        if (!json.trim()) throw new Error("Файл пустой");
        try {
          JSON.parse(json);
        } catch {
          throw new Error("Файл не похож на JSON — нужен экспорт с longstoryshort.app");
        }
        const pv = await write.post<{ characterName: string; warnings: { field: string; message: string }[] }>(
          "/statblocks/import/preview",
          { owner_type: ownerType, owner_id: ownerId, json }
        );
        const res = await write.post<{ characterName: string; warnings: { field: string; message: string }[] }>(
          "/statblocks/import",
          { owner_type: ownerType, owner_id: ownerId, json }
        );
        const wCount = res.warnings?.length ?? pv.warnings?.length ?? 0;
        results.push({
          file: file.name,
          ok: true,
          detail: `«${res.characterName || pv.characterName || "персонаж"}» создан${wCount ? ` — ${wCount} замечаний` : ""}`,
        });
      } catch (e) {
        const msg = e instanceof Error && e.message ? e.message : String(e);
        results.push({ file: file.name, ok: false, detail: msg || "Не удалось импортировать" });
      }
      setBatchResults([...results]);
    }
    setImporting(false);
    if (targetInput) targetInput.value = "";
    refresh();
    const okCount = results.filter((r) => r.ok).length;
    setImportSuccess(`Пачка: ${okCount} из ${results.length} импортировано`);
    setTimeout(() => setImportSuccess(""), 6000);
  }

  const showLssImport = ownerType === "character";
  const isEmpty = statblocks.length === 0;
  // Показываем один лист: аккордеона у чарника больше нет, и несколько
  // статблоков рисовались бы полными листами подряд. Выбор держится по id, а
  // не по индексу — список перезапрашивается после каждого добавления и
  // удаления.
  const activeId = statblocks.some((sb) => sb.id === activeStatblockId)
    ? activeStatblockId
    : statblocks[0]?.id ?? null;
  const shownStatblocks =
    statblocks.length > 1 ? statblocks.filter((sb) => sb.id === activeId) : statblocks;

  const cards = shownStatblocks.map((sb) => (
    <StatblockCard
      key={sb.id}
      statblock={sb}
      ownerType={ownerType}
      ownerId={ownerId}
      onRemove={removeStatblock}
      campaignId={campaignId}
      settingId={settingId}
      soleOnPage={soleOnPage}
      ownerPortraitUrl={ownerPortraitUrl}
      sheetHref={sheetHref}
      onSheetBack={onSheetBack}
      onPortraitRefresh={onPortraitRefresh}
    />
  ));

  // Профиль персонажа: первый таб — менеджер чарников, дальше по табу на
  // чарник. В табах с чарниками — только сам лист, всё управление живёт в
  // менеджере. Сущностям и записям бестиария менеджер не нужен — там прежний
  // вид без изменений.
  const isCharProfile = ownerType === "character";
  const mgrActive = statblocks.find((s) => s.id === mgrTab) ?? null;
  const showMgr = isCharProfile && (mgrTab === "manager" || mgrActive == null);
  const mgrCards = (mgrActive ? [mgrActive] : []).map((sb) => (
    <StatblockCard
      key={sb.id}
      statblock={sb}
      ownerType={ownerType}
      ownerId={ownerId}
      onRemove={removeStatblock}
      campaignId={campaignId}
      settingId={settingId}
      soleOnPage={soleOnPage}
      ownerPortraitUrl={ownerPortraitUrl}
      sheetHref={sheetHref}
      onSheetBack={onSheetBack}
      onPortraitRefresh={onPortraitRefresh}
    />
  ));

  // Страница чарника: лист и переключатель между листами, если их несколько.
  // Визард, импорт, корзина и «добавить» остались на профиле — заполняют
  // лист там, а здесь по нему играют.
  if (sheetOnly) {
    return (
      <div className="stack">
        {confirmDialog}
        {/* Десктоп: чарники всегда в таббаре, создание — табом [+]
            (решение владельца 2026-09-06). На телефоне как было: табы только
            при нескольких, создание — на профиле. */}
        {(!isMobileSheet || statblocks.length > 1) && (
          <div className="tabs sb-switcher">
            {statblocks.map((sb) => (
              <button
                key={sb.id}
                type="button"
                className={sb.id === activeId ? "active" : ""}
                onClick={() => setActiveId(sb.id)}
              >
                {statblockTitle(sb)}
              </button>
            ))}
            {!isMobileSheet && ownerType === "character" && (
              <button type="button" title="Новый чарник" aria-label="Новый чарник" onClick={startSheetCreate}>
                +
              </button>
            )}
          </div>
        )}
        {/* Пусто и на телефоне: без чарников табы скрыты и страницы создания
            нет — тупик. Решение владельца (создание табом [+] только десктоп,
            остальное на профиле) не трогаем: чиним только «ноль чарников». */}
        {isEmpty && creatingSystem === undefined && ownerType === "character" && (
          <div className="card stack">
            <span className="muted">Чарника пока нет — создайте первый.</span>
            <div className="row">
              <button type="button" className="primary" onClick={startSheetCreate}>
                Создать чарник
              </button>
            </div>
          </div>
        )}
        {creatingSystem !== undefined ? (
          creatingSystem === null ? (
            <div className="card stack">
              <strong>Новый чарник — какой системы?</strong>
              <div className="row" style={{ gap: 8 }}>
                <select value={createSystemId} onChange={(e) => setCreateSystemId(e.target.value)}>
                  <option value="">Выбрать систему…</option>
                  {createSystems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary"
                  disabled={!createSystemId}
                  onClick={() => setCreatingSystem(Number(createSystemId))}
                >
                  Далее
                </button>
                <button type="button" onClick={() => setCreatingSystem(undefined)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <DndCharacterWizard
              ownerType="character"
              ownerId={ownerId}
              ownerName={ownerName}
              ownerPlayerName={ownerPlayerName}
              initialSystemId={creatingSystem}
              ownerPortraitUrl={ownerPortraitUrl}
              onCancel={() => setCreatingSystem(undefined)}
              onDone={() => {
                setCreatingSystem(undefined);
                refresh();
              }}
            />
          )
        ) : (
          cards
        )}
        {/* Визард из «Чарников» (?newSheet=1): на странице чарника тоже,
            иначе «Сразу в чарник» приводил бы на пустую страницу. */}
        {showDndWizard && ownerType === "character" && (
          <DndCharacterWizard
            ownerType="character"
            ownerId={ownerId}
            ownerName={ownerName}
            ownerPlayerName={ownerPlayerName}
            ownerPortraitUrl={ownerPortraitUrl}
            onCancel={() => setShowDndWizard(false)}
            onDone={() => {
              setShowDndWizard(false);
              refresh();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      {confirmDialog}
      {isCharProfile && (
        <div className="tabs sb-switcher" role="tablist" aria-label="Чарники">
          <button
            key="manager"
            type="button"
            className={showMgr ? "active" : ""}
            onClick={() => setMgrTab("manager")}
            role="tab"
            aria-selected={showMgr}
          >
            Менеджер
          </button>
          {statblocks.map((sb) => (
            <button
              key={sb.id}
              type="button"
              className={!showMgr && mgrActive?.id === sb.id ? "active" : ""}
              onClick={() => setMgrTab(sb.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ x: e.clientX, y: e.clientY, id: sb.id });
              }}
              title="Правый клик — удалить"
              role="tab"
              aria-selected={!showMgr && mgrActive?.id === sb.id}
            >
              {statblockTitle(sb)}
            </button>
          ))}
        </div>
      )}
      {tabMenu && isCharProfile && (() => {
        const sb = statblocks.find((s) => s.id === tabMenu.id);
        return (
          <ContextMenu
            x={tabMenu.x}
            y={tabMenu.y}
            title={sb ? statblockTitle(sb) : "Чарник"}
            items={[{ label: "Удалить", danger: true, onClick: () => void removeStatblock(tabMenu.id) }]}
            onClose={() => setTabMenu(null)}
          />
        );
      })()}
      {showMgr && (
        <div className="stack">
          {managerTop}
          {isEmpty ? (
            <div className="card stack">
              <span className="muted">Чарников пока нет — создайте первый.</span>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="primary" onClick={() => setShowDndWizard(true)}>
                  Создать чарник
                </button>
                <label className="comp-mini" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <NavIcon name="upload" /> {importing ? "Импортирую…" : "Перенести из Long Story Short"}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => void importFiles(e.target.files, e.target as HTMLInputElement)}
                  />
                </label>
              </div>
            </div>
          ) : (
            <>
              <div className="stack" style={{ gap: 8 }}>
                {statblocks.map((sb) => (
                  <div key={sb.id} className="card row" style={{ justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => setMgrTab(sb.id)}
                      style={{ background: "transparent", border: 0, textAlign: "left", flex: "1 1 auto", minWidth: 0, cursor: "pointer", padding: 0 }}
                      aria-label={`Открыть чарник: ${statblockTitle(sb)}`}
                    >
                      <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{statblockTitle(sb)}</strong>
                      <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{statblockManagerSubtitle(sb)}</span>
                    </button>
                    <button
                      type="button"
                      className="comp-mini danger"
                      onClick={() => void removeStatblock(sb.id)}
                      aria-label={`Удалить чарник: ${statblockTitle(sb)}`}
                      title="Удалить чарник"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className="primary" onClick={() => setShowDndWizard(true)}>
                  Создать чарник
                </button>
                <label className="comp-mini" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <NavIcon name="upload" /> {importing ? "Импортирую…" : "Перенести из Long Story Short"}
                  <input
                    type="file"
                    accept="application/json,.json"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => void importFiles(e.target.files, e.target as HTMLInputElement)}
                  />
                </label>
              </div>
            </>
          )}
        </div>
      )}
      {!isCharProfile && isEmpty && showLssImport && (
        <EmptyState
          title="Чарника нет"
          /* Главная дорога — свой визард: он спрашивает класс, вид,
             предысторию и черту по порядку и сам раскладывает выдачи. Импорт
             из Long Story Short стоит рядом второй кнопкой — он нужен тем, у
             кого лист уже заполнен там, а не как основной способ завести
             персонажа. Раньше кнопка импорта была единственной и выглядела
             как единственный способ вообще. */
          hint="Создайте чарник в визарде — он проведёт по шагам и сам разложит всё, что дают класс, вид, предыстория и черта. Если лист уже заполнен на Long Story Short — перенесите его JSON."
          action={
            <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
              <button className="primary" onClick={() => setShowDndWizard(true)}>
                Создать чарник
              </button>
              <label className="comp-mini" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <NavIcon name="upload" /> {importing ? "Импортирую…" : "Перенести из Long Story Short"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => void importFiles(e.target.files, e.target as HTMLInputElement)}
                />
              </label>
              <a href="https://longstoryshort.app/" target="_blank" rel="noreferrer" className="muted" style={{ fontSize: "var(--fs-meta)", textDecoration: "underline" }}>
                longstoryshort.app ↗
              </a>
            </div>
          }
        />
      )}

      {!isCharProfile && statblocks.length > 1 && (
        <div className="tabs sb-switcher">
          {statblocks.map((sb) => (
            <button
              key={sb.id}
              type="button"
              className={sb.id === activeId ? "active" : ""}
              onClick={() => setActiveId(sb.id)}
            >
              {statblockTitle(sb)}
            </button>
          ))}
        </div>
      )}
      {isCharProfile ? (showMgr ? null : mgrCards) : cards}

      {/* Управление чарниками — только в менеджере: в табах с чарниками
          только сам лист. Сущностям и бестиарию — как было. */}
      {(!isCharProfile || showMgr) && (
      <>
      {/* Клон чарника — рядом с созданием, не в листе за столом (Q3).
          Оба типа владельцев: список и так ограничен владельцем (Q7). */}
      {dndCharacters.length > 0 && (
        <div className="row">
          <button type="button" onClick={openClone}>
            Клонировать чарник…
          </button>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
            Копия билда: класс, вид, предыстория, черта, навыки, заклинания, снаряжение. Имя, портрет и раны — с нуля.
          </span>
        </div>
      )}
      {cloneOpen && (
        <Modal onClose={() => !cloning && setCloneOpen(false)} closeOnBackdropClick={false}>
          <div className="stack" style={{ minWidth: 320 }}>
            <h3 style={{ margin: 0, fontFamily: "var(--font-display)", textTransform: "uppercase" }}>Клон чарника</h3>
            <label>
              Источник
              <select
                value={cloneSourceId ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setCloneSourceId(id);
                  if (!cloneEdited) {
                    const src = statblocks.find((s) => s.id === id) ?? null;
                    setCloneName(src ? `${statblockTitle(src)} (копия)` : "");
                  }
                }}
              >
                {dndCharacters.map((sb) => (
                  <option key={sb.id} value={sb.id}>
                    {statblockTitle(sb)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Имя копии
              <input
                value={cloneName}
                onChange={(e) => {
                  setCloneName(e.target.value);
                  setCloneEdited(true);
                }}
                placeholder="Имя персонажа"
                maxLength={80}
              />
            </label>
            {cloneError && <div className="backup-info error" role="alert">{cloneError}</div>}
            <div className="row" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setCloneOpen(false)} disabled={cloning}>Отмена</button>
              <button className="primary" onClick={confirmClone} disabled={cloning || !cloneName.trim()}>
                {cloning ? "Создаю…" : "Создать копию"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {showLssImport && !isEmpty && (
        <div
          className={`import-drop-zone${importDragOver ? " drag-over" : ""}`}
          onDragOver={onImportDragOver}
          onDragLeave={onImportDragLeave}
          onDrop={onImportDrop}
          style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              <NavIcon name="upload" /> Импорт из Long Story Short
            </span>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              JSON с <a href="https://longstoryshort.app/" target="_blank" rel="noreferrer">longstoryshort.app</a> — перетащите файл сюда или
            </span>
          </div>
          <label
            className="character-avatar-upload"
            style={{ alignSelf: "flex-start", width: "auto", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
          >
            <NavIcon name="document" />
            {importing ? "Импортирую…" : "Выбрать JSON"}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              multiple
              style={{ display: "none" }}
              onChange={(e) => void importFiles(e.target.files, e.target as HTMLInputElement)}
            />
          </label>
          <span className="muted" style={{ fontSize: "var(--fs-meta)", lineHeight: 1.35 }}>
            Экспорт в LSS: откройте персонажа → меню → «Экспорт JSON». Можно выбрать несколько файлов сразу — создадутся поштучно. Мы создадим статблоки «D&D — Персонаж».
          </span>
        </div>
      )}
      {showLssImport && isEmpty && (
        <div
          className={`import-drop-zone${importDragOver ? " drag-over" : ""}`}
          onDragOver={onImportDragOver}
          onDragLeave={onImportDragLeave}
          onDrop={onImportDrop}
          style={{ padding: 8, textAlign: "center", fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--muted)" }}
        >
          или перетащите JSON-файл сюда
        </div>
      )}
      {showLssImport && importError && <div className="backup-info error" role="alert">{importError}</div>}
      {showLssImport && importSuccess && <div className="backup-info" style={{ borderColor: "var(--line)", background: "var(--paper)" }} role="status">{importSuccess}</div>}
      {showLssImport && importWarnings.length > 0 && (
        <details className="card" style={{ padding: 10 }}>
          <summary style={{ cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Замечания импорта — {importWarnings.length}
          </summary>
          <ul style={{ margin: "8px 0 0 16px", display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-meta)" }}>
            {importWarnings.map((w, i) => (
              <li key={i} className="muted">
                <strong>{w.field}:</strong> {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      {showLssImport && batchResults.length > 0 && (
        <div className="card" style={{ padding: 10 }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Пачка — {batchResults.filter((r) => r.ok).length} из {batchResults.length}
          </span>
          <ul style={{ margin: "8px 0 0 16px", display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-meta)" }}>
            {batchResults.map((r, i) => (
              <li key={`${r.file}-${i}`} className="muted">
                <strong>{r.file}:</strong> {r.ok ? "✓ " : "✗ "}{r.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <Modal onClose={() => { setPreview(null); setPendingJson(null); }}>
          <div className="stack" style={{ minWidth: 320 }}>
            <h3 style={{ margin: 0, fontFamily: "var(--font-display)", textTransform: "uppercase" }}>Предпросмотр импорта</h3>
            <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", whiteSpace: "pre-wrap" }}>{preview.shortText}</div>
            <div className="card" style={{ padding: 10, display: "grid", gridTemplateColumns: "140px 1fr", gap: "4px 10px", fontSize: "var(--fs-meta)" }}>
              <span className="muted">Имя</span><span>{preview.characterName || "—"}</span>
              <span className="muted">Раса</span><span>{preview.summary.raceName || "—"} {preview.summary.raceId ? "✓ в справочнике" : preview.summary.raceName ? "— текстом" : ""}</span>
              <span className="muted">Класс</span><span>{[preview.summary.className, preview.summary.subclassName].filter(Boolean).join(" — ") || "—"} {preview.summary.classId ? "✓" : preview.summary.className ? "— текстом" : ""} · Ур. {preview.summary.level}</span>
              <span className="muted">КЗ / Хиты / Скорость</span><span>{preview.summary.armorClass || "—"} / {preview.summary.hitPointMax || "—"} / {preview.summary.speed || "—"}</span>
              <span className="muted">Навыков / Атак / Снаряжения</span><span>{preview.summary.skillCount} / {preview.summary.attackCount} / {preview.summary.equipmentCount}</span>
            </div>
            {preview.warnings.length > 0 && (
              <div className="stack" style={{ gap: 4 }}>
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Замечания — {preview.warnings.length}</span>
                <ul style={{ margin: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-meta)" }}>
                  {preview.warnings.map((w, i) => (
                    <li key={i} className="muted"><strong>{w.field}:</strong> {w.message}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="row" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => { setPreview(null); setPendingJson(null); }}>Отмена</button>
              <button onClick={confirmImport} disabled={importing}>{importing ? "Сохраняю…" : "Импортировать как есть"}</button>
              <button className="primary" onClick={() => setShowLssWizard(true)} disabled={importing}>Доработать в визарде</button>
            </div>
            <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>Визард проведёт по шагам: линки справочника, характеристики, бой, снаряжение, заклинания, текст. «Как есть» — сразу статблоком без сверки. Заклинания LSS (по ID) в обоих случаях подбираются вручную — см. замечания.</div>
          </div>
        </Modal>
      )}

      {showLssWizard && preview && (
        <Modal onClose={() => setShowLssWizard(false)}>
          <LssImportWizard
            ownerType={ownerType === "character" ? "character" : "being"}
            ownerId={ownerId}
            initial={preview.characterData}
            rawExtras={preview.rawExtras}
            warnings={preview.warnings}
            shortText={preview.shortText}
            existingCount={statblocks.filter((s) => s.format === "dnd_character").length}
            onCancel={() => setShowLssWizard(false)}
            onCreateFresh={() => {
              setShowLssWizard(false);
              setPreview(null);
              setPendingJson(null);
              if (ownerType === "character") setShowDndWizard(true);
            }}
            onDone={() => {
              setShowLssWizard(false);
              setPreview(null);
              setPendingJson(null);
              refresh();
              setImportSuccess(`Импортирован ${preview.characterName ? `«${preview.characterName}»` : "персонаж"} — визард`);
              setImportWarnings(preview.warnings);
              setTimeout(() => setImportSuccess(""), 6000);
            }}
          />
        </Modal>
      )}

      {adding ? (
        <div className="card stack">
          <div className="row">
            <select value={format} onChange={(e) => setFormat(e.target.value as StatblockFormat)}>
              <option value="text">{FORMAT_LABELS.text}</option>
              <option value={litmFormat}>{FORMAT_LABELS[litmFormat]}</option>
              <option value={dndFormat}>{FORMAT_LABELS[dndFormat]}</option>
              <option value="zip_character">{FORMAT_LABELS.zip_character}</option>
              <option value="zip_creature">{FORMAT_LABELS.zip_creature}</option>
            </select>
            {format === "text" && (
              <>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">Без шаблона</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.system_name ?? "любая система"},{" "}
                      {t.template_format && t.template_format !== "text"
                        ? FORMAT_LABELS[t.template_format]
                        : KIND_LABELS[t.template_kind ?? "full"]}
                      )
                    </option>
                  ))}
                </select>
                {!templateId && (
                  <select value={newKind} onChange={(e) => setNewKind(e.target.value as "short" | "full")}>
                    <option value="short">Краткий</option>
                    <option value="full">Полный</option>
                  </select>
                )}
              </>
            )}
            <button
              className="primary"
              onClick={
                format === "dnd_character" && ownerType === "character"
                  ? () => setShowDndWizard(true)
                  : format === "dnd_creature"
                  ? () => setShowDndCreatureWizard(true)
                  : addStatblock
              }
            >
              Добавить
            </button>
            <button onClick={() => setAdding(false)}>Отмена</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ alignSelf: "flex-start" }}>
          + Добавить {ownerType === "character" ? "чарник" : "статблок"}
        </button>
      )}

      {/* Корзина показывается, только когда в ней что-то есть, и свёрнута:
          за столом она не нужна ни разу, а нужна она в тот единственный день,
          когда «я снёс чарник неделю назад». */}
      {archived.length > 0 && (
        <details className="sb-trash">
          <summary>Удалённые: {archived.length}</summary>
          <div className="stack" style={{ gap: 6, padding: "8px 0 0" }}>
            {archived.map((sb) => (
              <div key={sb.id} className="row sb-trash__row">
                <span className="sb-trash__name">{statblockTitle(sb)}</span>
                <span className="muted sb-trash__when">{formatArchivedAt(sb.archived_at)}</span>
                <button type="button" className="comp-mini" onClick={() => void restoreArchived(sb)}>
                  Восстановить
                </button>
                <button type="button" className="comp-mini danger" onClick={() => void purgeArchived(sb)}>
                  Удалить навсегда
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {showDndWizard && ownerType === "character" && (
        <DndCharacterWizard
          ownerType="character"
          ownerId={ownerId}
          ownerName={ownerName}
          ownerPlayerName={ownerPlayerName}
          ownerPortraitUrl={ownerPortraitUrl}
          onCancel={() => setShowDndWizard(false)}
          onDone={() => {
            setShowDndWizard(false);
            setAdding(false);
            refresh();
          }}
        />
      )}
        {showLitmWizard && (
          <LitMCharacterWizard
            ownerName={ownerName}
            ownerPlayerName={ownerPlayerName}
            onComplete={(data) => {
              setShowLitmWizard(false);
              if (litmWizardStatblockId) {
                void run(
                  () => write.put(`/statblocks/${litmWizardStatblockId}`, { content: JSON.stringify(data) }),
                  { affects: statblockAffects(ownerType, ownerId) }
                );
              }
            }}
            onCancel={() => setShowLitmWizard(false)}
          />
        )}

      {showDndCreatureWizard && (
        <DndCreatureWizard
          ownerType={ownerType}
          ownerId={ownerId}
          ownerName={ownerName}
          ownerCreatureSize={ownerCreatureSize}
          ownerCreatureType={ownerCreatureType}
          ownerCreatureCR={ownerCreatureCR}
          ownerCreatureAC={ownerCreatureAC}
          ownerCreatureHP={ownerCreatureHP}
          ownerCreatureSpeed={ownerCreatureSpeed}
          onCancel={() => setShowDndCreatureWizard(false)}
          onDone={() => {
            setShowDndCreatureWizard(false);
            setAdding(false);
            refresh();
          }}
        />
      )}
      </>
      )}
    </div>
  );
}

function StatblockCard({
  statblock,
  ownerType,
  ownerId,
  onRemove,
  campaignId,
  settingId,
  soleOnPage,
  ownerPortraitUrl,
  sheetHref,
  onSheetBack,
  onPortraitRefresh,
}: {
  statblock: Statblock;
  ownerType: "character" | "being" | "compendium_entry";
  ownerId: number;
  onRemove: (id: number) => void;
  campaignId?: number;
  settingId?: number;
  soleOnPage?: boolean;
  /** Портрет владельца — лицо первой карты листа. */
  ownerPortraitUrl?: string | null;
  /** Телефон: вместо листа — плашка со ссылкой сюда. */
  sheetHref?: string;
  /** Жест «назад» с первой карты — задаёт полноэкранная страница чарника. */
  onSheetBack?: () => void;
  /** Портрет протух: перезагрузить владельца, чтобы приехал свежий URL. */
  onPortraitRefresh?: () => void;
}) {
  const isMobile = useIsMobile();
  const isLitm = statblock.format === "litm_character" || statblock.format === "litm_challenge";
  const isDnd = statblock.format === "dnd_character" || statblock.format === "dnd_creature";
  const isZip = statblock.format === "zip_character" || statblock.format === "zip_creature";
  // Патч применим только там, где content — это JSON: у обычного текста
  // полей нет, и делить его не на что.
  const isJsonFormat = isLitm || isDnd || isZip;

  function parseLitm(raw: string): LitMCharacterData | LitMChallengeData {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      parsed = {};
    }
    return statblock.format === "litm_character"
      ? normalizeCharacter(parsed)
      : { ...emptyChallenge(), ...(parsed as object) };
  }

  function parseZip(raw: string): import("../types").ZipCharacterData | import("../types").ZipCreatureData {
    let parsed: unknown;
    try { parsed = JSON.parse(raw || "{}"); } catch { parsed = {}; }
    return statblock.format === "zip_character" ? normalizeZipCharacter(parsed) : normalizeZipCreature(parsed);
  }

  function parseDnd(raw: string): DndCharacterData | DndCreatureData {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      parsed = {};
    }
    return statblock.format === "dnd_character" ? normalizeDndCharacter(parsed) : normalizeDndCreature(parsed);
  }

  // Parsing + normalizing (especially normalizeDndCharacter, with its legacy
  // migrations) is expensive enough that re-running it on every keystroke —
  // as happened when litmData/dndData were plain `const`s recomputed from
  // `content` on every render — made the whole form feel laggy. Parse once
  // via a lazy initializer and keep the *parsed* object as state instead;
  // `content` (the JSON string, only needed for saving) is kept in sync
  // alongside it in each onChange handler below.
  const [litmValue, setLitmValue] = useState<LitMCharacterData | LitMChallengeData | null>(() =>
    isLitm ? parseLitm(statblock.content) : null
  );
  const [dndValue, setDndValue] = useState<DndCharacterData | DndCreatureData | null>(() =>
    isDnd ? parseDnd(statblock.content) : null
  );
  const [zipValue, setZipValue] = useState<ZipCharacterData | ZipCreatureData | null>(() =>
    isZip ? parseZip(statblock.content) : null
  );
  const [editMode, setEditMode] = useState(() => {
    if (isLitm) {
      return statblock.format === "litm_character"
        ? !(litmValue as LitMCharacterData).promise && !(litmValue as LitMCharacterData).themes.some((t) => t.name)
        : !(litmValue as LitMChallengeData).title;
    }
    if (isDnd) {
      return statblock.format === "dnd_character"
        ? !(dndValue as DndCharacterData).characterName
        : !(dndValue as DndCreatureData).name;
    }
    return !statblock.content;
  });
  const [content, setContent] = useState(statblock.content);
  const [note, setNote] = useState(statblock.note);
  // Отказ сервера при сохранении из формы — чаще всего «изменён в другом
  // окне». Раньше `await api.put(...)` без catch давал unhandled rejection,
  // а форма закрывалась как ни в чём не бывало.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Версия, от которой начата правка в полной форме. Пока форма открыта, она
  // не обновляется: чужая правка приходит сигналом, список перечитывается, и
  // свежий `updated_at` из пропа выдал бы снимок формы за сделанный поверх
  // чужого — сервер принял бы его, и чужая правка тихо пропала бы (найдено
  // проверкой 2026-09-11; до перевода на слой было так же). Вне формы версия
  // идёт за пропом.
  const editBaseRef = useRef(statblock.updated_at ?? null);
  useEffect(() => {
    if (editMode) return;
    editBaseRef.current = statblock.updated_at ?? null;
  }, [editMode, statblock.updated_at]);
  // Mirrors the <details> element's own open/closed state — native <summary>
  // clicks toggle the DOM directly (uncontrolled), so this needs an onToggle
  // handler to stay in sync rather than being driven only by editMode. Used
  // to gate the mobile full-screen overlay treatment (sb-fullscreen-mobile).
  const [expanded, setExpanded] = useState(editMode);
  // dnd_creature only: whether the statblock's own header/body is expanded.
  // Replaces the generic <details> accordion for this format — see below.
  const [collapsed, setCollapsed] = useState(!editMode);
  // Прямо из пропа, а не `useState(statblock.kind)`: замороженная копия
  // означала, что смена вида в базе не доезжает до уже открытой карточки.
  const kind = statblock.kind;
  // dnd_creature only: portrait shown in the statblock's own sb-top-avatar
  // slot (separate from whatever avatar the owning being/character has).
  const [avatarUrl, setAvatarUrl] = useState(statblock.avatar_image_url);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const client = useQueryClient();
  const run = useAction();
  const afterWrite = useAfterWrite();
  // Быстрые правки: дебаунс, один запрос в полёте, патч полей, сбой —
  // плашкой (data/statblocks.ts).
  const queue = useStatblockQueue(statblock, isJsonFormat);

  async function uploadAvatar(file: File) {
    setAvatarUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const updated = await run(
        () => write.post<{ avatar_image_url: string | null }>(`/statblocks/${statblock.id}/avatar`, form, { timeoutMs: 60_000 }),
        { affects: statblockAffects(statblock.owner_type, statblock.owner_id) }
      );
      if (updated) setAvatarUrl(updated.avatar_image_url);
    } finally {
      setAvatarUploading(false);
    }
  }

  // Живая синхронизация (событие character-updated → refresh списка) до сих
  // пор до открытой карточки не доходила: dndValue/litmValue разбирались
  // лениво один раз и из пропа больше не пересчитывались. Список обновлялся,
  // карточка держала старый разбор — и первая же быстрая правка отправляла
  // устаревший снимок целиком, стирая правку со второго клиента.
  //
  // Принимаем внешнее обновление, только когда у нас нечего терять: ничего не
  // висит в очереди сохранения и не открыта полная форма правки (там лежит
  // набранный, ещё не сохранённый текст).
  useEffect(() => {
    if (statblock.content === content) return;
    if (editMode || queue.hasPending()) return;
    queue.markSaved(statblock.content);
    setContent(statblock.content);
    if (isLitm) setLitmValue(parseLitm(statblock.content));
    if (isDnd) setDndValue(parseDnd(statblock.content));
    // parseLitm/parseDnd читают только statblock.format, который у карточки не меняется
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statblock.content]);

  async function save() {
    // Снимок целиком уходит только отсюда — из полной формы правки, где в
    // поле лежит набранный текст. Версия страхует именно этот путь: если
    // статблок успели изменить в другом окне, сервер отвечает 409, форма
    // остаётся открытой и набранное никуда не девается.
    //
    // Ошибка остаётся текстом в форме, а не плашкой (решение 2026-09-11):
    // «Повторить» на плашке отправило бы тот же снимок и получило бы тот же
    // 409 — решать, чья правка важнее, может только человек у формы.
    let row: Statblock;
    try {
      row = await write.put<Statblock>(`/statblocks/${statblock.id}`, {
        content,
        note,
        baseUpdatedAt: editBaseRef.current,
      });
    } catch (e) {
      setSaveError(
        (e as { message?: string })?.message ||
          "Не удалось сохранить — попробуйте ещё раз"
      );
      return;
    }
    setSaveError(null);
    queue.markSaved(content);
    applySavedStatblock(client, { ...row, content });
    afterWrite(statblockAffects(statblock.owner_type, statblock.owner_id));
    // [[type:id|Label]] mention tokens survive JSON-encoding as plain
    // substrings, so this diffs correctly for LitM (JSON) content too.
    syncMentionLinks(statblock.owner_type, statblock.owner_id, statblock.content, content);
    setEditMode(false);
  }

  // Lets tag add/remove in the collapsed view persist immediately, without
  // making the user open full edit mode first.
  //
  // Все три quickSave* идут через одну очередь (useQueuedSave): дебаунс 400 мс,
  // один запрос в полёте, видимая ошибка вместо unhandled rejection. Раньше
  // каждая из них делала `await api.put(...)` без catch и дёргала onChange()
  // — то есть полный перезапрос списка статблоков на каждый щелчок пипса.
  function quickSave(v: LitMCharacterData | LitMChallengeData) {
    const json = JSON.stringify(v);
    setLitmValue(v);
    setContent(json);
    queue.schedule(json);
  }


  // Same idea as quickSave above, for D&D character view-mode quick edits
  // (HP, inspiration, death saves, spell slots used) — merges a partial patch
  // instead of replacing the whole value.
  function quickSaveDnd(patch: Partial<DndCharacterData>) {
    const next = { ...(dndValue as DndCharacterData), ...patch };
    const json = JSON.stringify(next);
    setDndValue(next);
    setContent(json);
    queue.schedule(json);
  }


  // Same idea, for D&D creature view-mode per-tab quick edits (Основное/
  // Действия/Заклинания/Снаряжение/Особенности each edit in place).
  function quickSaveDndCreature(patch: Partial<DndCreatureData>) {
    const next = { ...(dndValue as DndCreatureData), ...patch };
    const json = JSON.stringify(next);
    setDndValue(next);
    setContent(json);
    queue.schedule(json);
  }

  // То же для zip-листа: правки в режиме просмотра уходят через ту же очередь,
  // что у litm и D&D, — дебаунс и один запрос в полёте.
  function quickSaveZip(patch: Partial<ZipCharacterData>) {
    const next = { ...(zipValue as ZipCharacterData), ...patch };
    const json = JSON.stringify(next);
    setZipValue(next);
    setContent(json);
    queue.schedule(json);
  }

  function quickSaveZipCreature(patch: Partial<ZipCreatureData>) {
    const next = { ...(zipValue as ZipCreatureData), ...patch };
    const json = JSON.stringify(next);
    setZipValue(next);
    setContent(json);
    queue.schedule(json);
  }

  // Быстрые правки уходят молча, и до сих пор при отвале сети на экране всё
  // выглядело сохранённым. Индикатор показывает очередь: «сохраняю…» и
  // «не сохранено». Кнопка повтора — на плашке сбоку: она видна, даже когда
  // шапка статблока уехала за экран (решение 2026-09-11).
  const saveIndicator =
    queue.status === "idle" ? null : (
      <span className={`sb-save-status is-${queue.status}`} role="status" aria-live="polite">
        {queue.status === "saving" ? "сохраняю…" : "не сохранено"}
      </span>
    );

  const summaryTitle =
    statblock.format === "litm_challenge"
      ? (litmValue as LitMChallengeData)?.title || "Без названия"
      : statblock.format === "dnd_creature"
      ? (dndValue as DndCreatureData)?.name || "Без названия"
      : statblock.format === "dnd_character"
      ? (dndValue as DndCharacterData)?.characterName || "Без имени"
      : statblock.format === "zip_character"
      ? (zipValue as import("../types").ZipCharacterData)?.characterName || "Без имени"
      : statblock.format === "zip_creature"
      ? (zipValue as import("../types").ZipCreatureData)?.name || "Без названия"
      : null;

  // Статблок существа сам рисует плашку-шапку (§1.4), поэтому обёртка
  // <details className="card"> ниже дала бы вторую, более плоскую шапку
  // поверх первой: кнопки уезжают в саму плашку, и она же служит
  // переключателем свёрнутости. Правка идёт ПО СЕКЦИЯМ внутри вида —
  // кнопки «редактировать» здесь больше нет (design_revision.md, шаг 6).
  if (statblock.format === "zip_creature") {
    const headerExtraZip = (
      <>
        {saveIndicator}
        <button type="button" className="comp-mini" onClick={() => onRemove(statblock.id)}>
          <NavIcon name="delete" />
        </button>
      </>
    );
    return zipValue ? (
      <div className={!collapsed ? "sb-fullscreen-mobile" : undefined}>
        <div className="card stack" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>{(zipValue as import("../types").ZipCreatureData).name || "Существо ЗиП"}</h3>{headerExtraZip}</div>
          {editMode ? <ZipCreatureEdit value={zipValue as import("../types").ZipCreatureData} onChange={(v) => { setZipValue(v); setContent(JSON.stringify(v)); }} /> : <ZipCreatureView value={zipValue as import("../types").ZipCreatureData} onQuickUpdate={quickSaveZipCreature} />}
          <div className="row" style={{ gap: 8 }}>
            {editMode ? <><button className="primary" onClick={save}>Сохранить</button><button onClick={() => setEditMode(false)}>Отмена</button></> : <button onClick={() => setEditMode(true)}>Редактировать</button>}
          </div>
          {saveError && <p className="sb-save-error">{saveError}</p>}
        </div>
      </div>
    ) : null;
  }

  if (statblock.format === "dnd_creature") {
    const headerExtra = (
      <>
        {saveIndicator}
        <button type="button" className="comp-mini" onClick={() => onRemove(statblock.id)}>
          <NavIcon name="delete" />
        </button>
      </>
    );

    // Краткий статблок существа — это и есть быстрый взгляд, просто в
    // четвёртом месте: рисуется карточкой существа (design_revision.md, шаг
    // 4). Прежний compact-вид печатал все черты, действия и легендарные
    // подряд, то есть был плохим полным статблоком.
    if (kind === "short" && statblock.format === "dnd_creature" && ownerType !== "character") {
      return (
        <div className="stack">
          {headerExtra && (
            <div className="sb-short-card-controls">
              <span className="sb-short-card-caption">Краткий статблок</span>
              <span className="row">{headerExtra}</span>
            </div>
          )}
          <CreatureCardLoader
            type={ownerType}
            id={ownerId}
            statblockId={statblock.id}
            hideProfileButton
          />
        </div>
      );
    }

    return dndValue ? (
      // On a phone, an expanded creature statblock is squeezed into the same
      // narrow inline column as everything else on the owning page — the
      // wrapper below (CSS-gated to mobile widths, see .sb-fullscreen-mobile
      // in index.css) promotes it to a full-screen overlay instead, without
      // touching DndCreatureView's own collapse/edit logic at all. Tapping
      // the header again (onHeaderClick) collapses it back, same as before.
      <div className={!collapsed ? "sb-fullscreen-mobile" : undefined}>
        <DndCreatureView
          value={dndValue as DndCreatureData}
          onQuickUpdate={quickSaveDndCreature}
          collapsed={collapsed}
          headerExtra={headerExtra}
          onHeaderClick={() => setCollapsed((v) => !v)}
          avatarUrl={avatarUrl}
          onAvatarUpload={uploadAvatar}
          avatarUploading={avatarUploading}
        />
      </div>
    ) : null;
  }

  // Лист персонажа рисует собственную плашку-шапку (§1.4), поэтому обёртка
  // <details className="card"> ниже давала вторую, более плоскую шапку поверх
  // первой — с тем же именем и вторым набором кнопок. Она же прятала лист за
  // аккордеоном, а свёрнутый чарник за столом бесполезен: аккордеон нужен
  // списку, а не листу. Правка идёт по секциям внутри вида (гриллинг 2026-09-03).
  if (statblock.format === "dnd_character" && dndValue) {
    // Телефон: лист сюда не помещается — он оказывался внутри чужой
    // прокрутки, под крошками, шапкой профиля и рядом вкладок, и «весь
    // экран» у карты был не весь. В разделе остаётся плашка, лист
    // открывается своим маршрутом (гриллинг 2026-09-04).
    if (sheetHref && isMobile) {
      const sheet = dndValue as DndCharacterData;
      const classLine = [sheet.raceName, classAndLevelSummary(sheet.classes)].filter(Boolean).join(" · ");
      return (
        <div className="sheet-plate">
          <Link className="sheet-plate-open" to={sheetHref}>
            <span className="sheet-plate-name">{sheet.characterName || "Без имени"}</span>
            {classLine && <span className="sheet-plate-sub">{classLine}</span>}
          </Link>
          {/* Карандаш открывает тот же лист сразу в правке: на самой карте
              органов правки больше нет — за столом её читают, а заполняют
              отсюда, из профиля (правки владельца 2026-09-04). */}
          <Link
            className="comp-mini sheet-plate-edit"
            to={`${sheetHref}?edit=1`}
            title="Править чарник"
            aria-label={`Править чарник: ${sheet.characterName || "Без имени"}`}
          >
            <NavIcon name="edit" />
          </Link>
          {/* Своя мишень внутри общей: плашка целиком — «открыть», а
              удаление не должно срабатывать по промаху. */}
          <button
            type="button"
            className="comp-mini sheet-plate-remove"
            title="Удалить чарник"
            aria-label={`Удалить чарник: ${sheet.characterName || "Без имени"}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove(statblock.id);
            }}
          >
            <NavIcon name="delete" />
          </button>
        </div>
      );
    }
    return (
      <DndCharacterView
        value={dndValue as DndCharacterData}
        portraitUrl={ownerPortraitUrl}
        onQuickUpdate={quickSaveDnd}
        syncTabToUrl={soleOnPage}
        campaignId={campaignId}
        ownerCharacterId={statblock.owner_type === "character" ? statblock.owner_id : null}
        onSheetBack={onSheetBack}
        onPortraitRefresh={onPortraitRefresh}
      />
    );
  }

  return (
    <details
      className={`card${expanded ? " sb-fullscreen-mobile" : ""}`}
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary className="row" style={{ justifyContent: "space-between" }}>
        <span>
          <span className="badge planned">
            {isLitm || isDnd || isZip ? FORMAT_LABELS[statblock.format] : KIND_LABELS[statblock.kind]}
          </span>
          {summaryTitle && <span className="muted"> {summaryTitle}</span>}
          {!isLitm && !isDnd && statblock.note && <span className="muted"> {statblock.note}</span>}
        </span>
        <span className="row" style={{ gap: 4 }}>
          {saveIndicator}
          <button
            type="button"
            className="comp-mini"
            title="Редактировать"
            aria-label={`Редактировать: ${summaryTitle || FORMAT_LABELS[statblock.format]}`}
            onClick={(e) => {
              e.preventDefault();
              setEditMode((v) => !v);
              setExpanded(true);
            }}
          >
            <NavIcon name="edit" />
          </button>
          {/* Обе кнопки — только иконка: без подписи скринридер читал их как
              «кнопка», а «удалить» здесь ещё и без title. */}
          <button
            type="button"
            className="comp-mini"
            title="Удалить"
            aria-label={`Удалить: ${summaryTitle || FORMAT_LABELS[statblock.format]}`}
            onClick={(e) => {
              e.preventDefault();
              onRemove(statblock.id);
            }}
          >
            <NavIcon name="delete" />
          </button>
        </span>
      </summary>
      <div className="stack" style={{ marginTop: 10 }}>
        {editMode ? (
          <>
            {statblock.format === "litm_character" && litmValue && (
              <LitMCharacterEdit
                value={litmValue as LitMCharacterData}
                onChange={(v) => {
                  setLitmValue(v);
                  setContent(JSON.stringify(v));
                }}
                campaignId={campaignId}
              />
            )}
            {statblock.format === "litm_challenge" && litmValue && (
              <LitMChallengeEdit
                value={litmValue as LitMChallengeData}
                onChange={(v) => {
                  setLitmValue(v);
                  setContent(JSON.stringify(v));
                }}
              />
            )}
            {statblock.format === "zip_character" && zipValue && (
              <ZipCharacterEdit
                value={zipValue as import("../types").ZipCharacterData}
                onChange={(v) => {
                  setZipValue(v);
                  setContent(JSON.stringify(v));
                }}
              />
            )}
            {!isLitm && !isDnd && !isZip && (
              <MentionTextarea value={content} onChange={setContent} rows={8} defaultSettingId={settingId} />
            )}
            <label>
              Примечание
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                title={
                  statblock.format === "dnd_character"
                    ? "Короткая подпись под именем — используется в шпаргалке по персонажам"
                    : undefined
                }
              />
            </label>
            <div className="row">
              <button className="primary" onClick={save}>
                Сохранить
              </button>
              <button onClick={() => setEditMode(false)}>Отмена</button>
            </div>
            {saveError && <p className="sb-save-error">{saveError}</p>}
          </>
        ) : (
          <>
            {statblock.format === "litm_character" && litmValue && (
              <LitMCharacterView
                value={litmValue as LitMCharacterData}
                onQuickUpdate={quickSave}
                campaignId={campaignId}
              />
            )}
            {statblock.format === "litm_challenge" && litmValue && (
              <LitMChallengeView value={litmValue as LitMChallengeData} />
            )}
            {statblock.format === "zip_character" && zipValue && (
              <ZipCharacterView
                value={zipValue as import("../types").ZipCharacterData}
                onQuickUpdate={quickSaveZip}
              />
            )}
            {/* Ветки чарника здесь нет: `dnd_character` с разобранным
                значением возвращается выше собственной плашкой, до этой
                обёртки-аккордеона, — сюда он не доходит. */}
            {!isLitm && !isDnd && !isZip && (
              <div style={{ whiteSpace: "pre-wrap" }}>
                {statblock.content ? <MentionText text={statblock.content} /> : <span className="muted">Пусто</span>}
              </div>
            )}
            {!isLitm && !isDnd && statblock.note && <div className="muted">Примечание: {statblock.note}</div>}
            <button
              onClick={() => {
                setEditMode(true);
                setExpanded(true);
              }}
              style={{ alignSelf: "flex-start" }}
            >
              Редактировать
            </button>
          </>
        )}
      </div>
    </details>
  );
}
