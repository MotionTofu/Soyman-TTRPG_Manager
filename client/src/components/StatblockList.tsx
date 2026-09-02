import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useQueuedSave } from "../hooks/useQueuedSave";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { useConfirm } from "../hooks/useConfirm";
import { NavIcon } from "./NavIcons";
import type {
  Campaign,
  DndCharacterData,
  DndCreatureData,
  LitMCharacterData,
  LitMChallengeData,
  Resource,
  Statblock,
  StatblockFormat,
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
import { emptyDndCharacter, normalizeDndCharacter, DndCharacterEdit, DndCharacterView } from "./dnd/DndCharacterForm";
import { findDndSystemId } from "./dnd/dndCompendium";
import { LitMCharacterWizard } from "./litm/LitMCharacterWizard";
import { DndCharacterWizard } from "./dnd/DndCharacterWizard";
import { DndCreatureWizard } from "./dnd/DndCreatureWizard";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";

const TEMPLATE_TYPE = "statblock_template";

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
  // Bestiary-only (ownerType === "compendium_entry"): pre-fills a new
  // dnd_creature statblock's Размер/Тип/КО from the profile fields set on the
  // compendium monster entry itself, so they don't have to be typed twice.
  ownerCreatureType?: string;
  ownerCreatureSize?: string;
  ownerCreatureCR?: string;
}

export function StatblockList({
  ownerType,
  ownerId,
  campaignId,
  settingId,
  ownerName,
  ownerPlayerName,
  ownerCreatureType,
  ownerCreatureSize,
  ownerCreatureCR,
}: Props) {
  const [statblocks, setStatblocks] = useState<Statblock[]>([]);
  const [templates, setTemplates] = useState<Resource[]>([]);
  const [adding, setAdding] = useState(false);
  const [format, setFormat] = useState<StatblockFormat>("text");
  const [templateId, setTemplateId] = useState("");
  const [newKind, setNewKind] = useState<"short" | "full">("full");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [showDndWizard, setShowDndWizard] = useState(false);
  const [showDndCreatureWizard, setShowDndCreatureWizard] = useState(false);
  const [showLitmWizard, setShowLitmWizard] = useState(false);
  const [litmWizardStatblockId, setLitmWizardStatblockId] = useState<number | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const { toast: undoToast, deleteWithUndo, dismiss: dismissUndo } = useUndoDelete();

  const litmFormat: StatblockFormat = ownerType === "character" ? "litm_character" : "litm_challenge";
  const dndFormat: StatblockFormat = ownerType === "character" ? "dnd_character" : "dnd_creature";

  function refresh() {
    api
      .get<Statblock[]>(`/statblocks?owner_type=${ownerType}&owner_id=${ownerId}`)
      .then(setStatblocks);
  }
  useEffect(refresh, [ownerType, ownerId]);

  // Live sync — a statblock save from player-app (or another open GM
  // instance) pushes here via RealtimeListener's "character-updated" event.
  useEffect(() => {
    if (ownerType !== "character") return;
    function onCharacterUpdated(e: Event) {
      const detail = (e as CustomEvent<{ characterId: number }>).detail;
      if (detail?.characterId === ownerId) refresh();
    }
    window.addEventListener("character-updated", onCharacterUpdated);
    return () => window.removeEventListener("character-updated", onCharacterUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerType, ownerId]);

  useEffect(() => {
    api
      .get<Resource[]>(`/resources?scope=global&type=${TEMPLATE_TYPE}`)
      .then((all) =>
        setTemplates(
          all.filter(
            (t) =>
              !t.template_format ||
              t.template_format === "text" ||
              t.template_format === litmFormat ||
              t.template_format === dndFormat ||
              t.template_format === "zip_character" ||
              t.template_format === "zip_creature"
          )
        )
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [litmFormat, dndFormat]);

  async function addStatblock() {
    if (format === "litm_character") {
      const character = emptyCharacter();
      character.characterName = ownerName ?? "";
      if (campaignId) {
        try {
          const campaign = await api.get<Campaign>(`/campaigns/${campaignId}`);
          if (campaign.group_theme_litm) {
            character.fellowshipTheme = normalizeTheme(JSON.parse(campaign.group_theme_litm));
          }
        } catch {
          // no campaign group theme available — leave the empty default
        }
      }
      const res = await api.post<{ id: number }>("/statblocks", {
        owner_type: ownerType,
        owner_id: ownerId,
        format,
        kind: "full",
        content: JSON.stringify(character),
      });
      setLitmWizardStatblockId(res.id);
      setShowLitmWizard(true);
      return;
    } else if (format === "litm_challenge") {
      await api.post("/statblocks", {
        owner_type: ownerType,
        owner_id: ownerId,
        format,
        kind: "full",
        content: JSON.stringify(emptyChallenge()),
      });

        } else if (format === "zip_character") {
      const character = emptyZipCharacter();
      character.characterName = ownerName ?? "";
      if (ownerType === "character") character.playerName = ownerPlayerName ?? "";
      await api.post("/statblocks", {
        owner_type: ownerType,
        owner_id: ownerId,
        format,
        kind: "full",
        content: JSON.stringify(character),
      });
    } else if (format === "zip_creature") {
      await api.post("/statblocks", {
        owner_type: ownerType,
        owner_id: ownerId,
        format,
        kind: "full",
        content: JSON.stringify(emptyZipCreature()),
      });
    } else if (format === "dnd_character") {
      const character = emptyDndCharacter();
      character.characterName = ownerName ?? "";
      if (ownerType === "character") character.playerName = ownerPlayerName ?? "";
      character.systemId = await findDndSystemId();
      await api.post("/statblocks", {
        owner_type: ownerType,
        owner_id: ownerId,
        format,
        kind: "full",
        content: JSON.stringify(character),
      });
    } else {
      const template = templates.find((t) => String(t.id) === templateId);
      const templateFormat = template?.template_format || "text";
      await api.post("/statblocks", {
        owner_type: ownerType,
        owner_id: ownerId,
        format: templateFormat,
        kind: template?.template_kind ?? newKind,
        content: template?.notes ?? "",
      });
    }
    setAdding(false);
    setTemplateId("");
    setFormat("text");
    refresh();
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
    await deleteWithUndo({
      entityName: name,
      deleteFn: async () => {
        await api.del(`/statblocks/${id}`);
        refresh();
      },
      restoreFn: async () => {
        await api.put(`/statblocks/${id}/restore`);
        refresh();
      },
    });
  }


  async function importFile(file: File | null) {
    if (!file) return;
    setImporting(true);
    setImportError("");
    try {
      const json = await file.text();
      await api.post("/statblocks/import", { owner_type: ownerType, owner_id: ownerId, json });
      refresh();
    } catch (e) {
      setImportError("Не удалось разобрать файл. Убедитесь, что это экспорт персонажа с Long Story Short.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="stack">
      {confirmDialog}
      {undoToast && (
        <div className="archive-toast" role="status" aria-live="polite">
          <span className="archive-toast__msg">{undoToast.msg}</span>
          <div className="archive-toast__actions">
            <button className="archive-toast__undo" onClick={() => undoToast.onUndo()}>
              Отменить
            </button>
            <button className="archive-toast__close" onClick={dismissUndo} aria-label="Закрыть">
              ×
            </button>
          </div>
        </div>
      )}
      {statblocks.map((sb) => (
        <StatblockCard
          key={sb.id}
          statblock={sb}
          ownerType={ownerType}
          ownerId={ownerId}
          onChange={refresh}
          onRemove={removeStatblock}
          campaignId={campaignId}
          settingId={settingId}
        />
      ))}

      <label className="character-avatar-upload" style={{ alignSelf: "flex-start" }}>
        {importing ? "Импортирую…" : "Импортировать JSON (Long Story Short)"}
        <input
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => importFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {importError && <div className="backup-info error">{importError}</div>}

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

      {showDndWizard && ownerType === "character" && (
        <DndCharacterWizard
          ownerType="character"
          ownerId={ownerId}
          ownerName={ownerName}
          ownerPlayerName={ownerPlayerName}
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
                api.put(`/statblocks/${litmWizardStatblockId}`, {
                  content: JSON.stringify(data),
                }).then(() => refresh());
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
          onCancel={() => setShowDndCreatureWizard(false)}
          onDone={() => {
            setShowDndCreatureWizard(false);
            setAdding(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function StatblockCard({
  statblock,
  ownerType,
  ownerId,
  onChange,
  onRemove,
  campaignId,
  settingId,
}: {
  statblock: Statblock;
  ownerType: "character" | "being" | "compendium_entry";
  ownerId: number;
  onChange: () => void;
  onRemove: (id: number) => void;
  campaignId?: number;
  settingId?: number;
}) {
  const isLitm = statblock.format === "litm_character" || statblock.format === "litm_challenge";
  const isDnd = statblock.format === "dnd_character" || statblock.format === "dnd_creature";
  const isZip = statblock.format === "zip_character" || statblock.format === "zip_creature";

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
  // Mirrors the <details> element's own open/closed state — native <summary>
  // clicks toggle the DOM directly (uncontrolled), so this needs an onToggle
  // handler to stay in sync rather than being driven only by editMode. Used
  // to gate the mobile full-screen overlay treatment (sb-fullscreen-mobile).
  const [expanded, setExpanded] = useState(editMode);
  // dnd_creature only: whether the statblock's own header/body is expanded.
  // Replaces the generic <details> accordion for this format — see below.
  const [collapsed, setCollapsed] = useState(!editMode);
  const [kind] = useState(statblock.kind);
  // dnd_creature only: portrait shown in the statblock's own sb-top-avatar
  // slot (separate from whatever avatar the owning being/character has).
  const [avatarUrl, setAvatarUrl] = useState(statblock.avatar_image_url);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const queue = useQueuedSave(
    useCallback(
      async (json: string) => {
        await api.put(`/statblocks/${statblock.id}`, { content: json });
      },
      [statblock.id]
    )
  );

  async function uploadAvatar(file: File) {
    setAvatarUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const updated = await api.post<{ avatar_image_url: string | null }>(
        `/statblocks/${statblock.id}/avatar`,
        form
      );
      setAvatarUrl(updated.avatar_image_url);
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
    setContent(statblock.content);
    if (isLitm) setLitmValue(parseLitm(statblock.content));
    if (isDnd) setDndValue(parseDnd(statblock.content));
    // parseLitm/parseDnd читают только statblock.format, который у карточки не меняется
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statblock.content]);

  async function save() {
    await api.put(`/statblocks/${statblock.id}`, { content, note });
    // [[type:id|Label]] mention tokens survive JSON-encoding as plain
    // substrings, so this diffs correctly for LitM (JSON) content too.
    syncMentionLinks(statblock.owner_type, statblock.owner_id, statblock.content, content);
    setEditMode(false);
    onChange();
  }

  // Lets tag add/remove in the collapsed view persist immediately, without
  // making the user open full edit mode first.
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


  // Быстрые правки уходят молча, и до сих пор при отвале сети на экране всё
  // выглядело сохранённым. Индикатор показывает очередь: «сохраняю…» и
  // «не сохранено» с повтором.
  const saveIndicator =
    queue.status === "idle" ? null : (
      <span className={`sb-save-status is-${queue.status}`} role="status" aria-live="polite">
        {queue.status === "saving" ? (
          "сохраняю…"
        ) : (
          <>
            не сохранено
            <button type="button" className="comp-mini" onClick={() => void queue.flush()}>
              Повторить
            </button>
          </>
        )}
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
            onClick={(e) => {
              e.preventDefault();
              setEditMode((v) => !v);
              setExpanded(true);
            }}
          >
            <NavIcon name="edit" />
          </button>
          <button
            type="button"
            className="comp-mini"
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
            {statblock.format === "zip_creature" && zipValue && (
              <ZipCreatureEdit
                value={zipValue as import("../types").ZipCreatureData}
                onChange={(v) => {
                  setZipValue(v);
                  setContent(JSON.stringify(v));
                }}
              />
            )}
            {statblock.format === "dnd_character" && dndValue && (
              <DndCharacterEdit
                value={dndValue as DndCharacterData}
                onChange={(v) => {
                  setDndValue(v);
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
            {statblock.format === "zip_creature" && zipValue && (
              <ZipCreatureView value={zipValue as import("../types").ZipCreatureData} onQuickUpdate={quickSaveZipCreature} />
            )}
            {statblock.format === "dnd_character" && dndValue && (
              <DndCharacterView
                value={dndValue as DndCharacterData}
                compact={kind === "short"}
                onQuickUpdate={quickSaveDnd}
              />
            )}
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
