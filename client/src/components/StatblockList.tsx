import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useQueuedSave } from "../hooks/useQueuedSave";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { useConfirm } from "../hooks/useConfirm";
import { NavIcon } from "./NavIcons";
import { EmptyState } from "./EmptyState";
import { Modal } from "./Modal";
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
  // dnd_creature statblock's Размер/Тип/КО/КД/Хиты/Скорость from the profile fields set on the
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
  ownerCreatureAC,
  ownerCreatureHP,
  ownerCreatureSpeed,
  soleOnPage,
}: Props) {
  const [statblocks, setStatblocks] = useState<Statblock[]>([]);
  const [templates, setTemplates] = useState<Resource[]>([]);
  const [adding, setAdding] = useState(false);
  const [format, setFormat] = useState<StatblockFormat>("text");
  const [templateId, setTemplateId] = useState("");
  const [newKind, setNewKind] = useState<"short" | "full">("full");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");
  const [importWarnings, setImportWarnings] = useState<{ field: string; message: string }[]>([]);
  const [importDragOver, setImportDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const [preview, setPreview] = useState<null | {
    characterName: string;
    shortText: string;
    warnings: { field: string; message: string }[];
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
  const [showDndWizard, setShowDndWizard] = useState(false);
  const [showDndCreatureWizard, setShowDndCreatureWizard] = useState(false);
  const [showLitmWizard, setShowLitmWizard] = useState(false);
  const [litmWizardStatblockId, setLitmWizardStatblockId] = useState<number | null>(null);
  const [activeStatblockId, setActiveId] = useState<number | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();

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
        throw new Error("Файл не похож на JSON — убедитесь, что это экспорт с next.dnd.su (Long Story Short)");
      }
      // Preview first — no DB write yet
      const previewRes = await api.post<{
        characterName: string;
        shortText: string;
        warnings: { field: string; message: string }[];
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
        setImportError(msg || "Не удалось разобрать файл. Убедитесь, что это экспорт персонажа с Long Story Short (next.dnd.su).");
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
      const ok = confirm("У персонажа уже есть чарник(и). Добавить ещё один?\n\nЛишний можно удалить после импорта.");
      if (!ok) return;
    }
    setImporting(true);
    setImportError("");
    try {
      const res = await api.post<{ characterName: string; warnings: { field: string; message: string }[]; shortText: string; statblock: Statblock }>(
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
    const file = e.dataTransfer.files?.[0] ?? null;
    if (file) importFile(file);
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

  return (
    <div className="stack">
      {confirmDialog}
      {isEmpty && showLssImport && (
        <EmptyState
          icon="skullDie"
          title="Чарника нет"
          hint="Заполните лист на Long Story Short (next.dnd.su) и закиньте сюда JSON — получите полноценный статблок за один клик, или создайте чарник вручную."
          action={
            <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <label className="primary" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", border: "1px solid var(--primary-bg)", background: "var(--primary-bg)", color: "var(--primary-text)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <NavIcon name="upload" /> {importing ? "Импортирую…" : "Выбрать JSON (LSS)"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={(e) => importFile(e.target.files?.[0] ?? null, e.target as HTMLInputElement)}
                />
              </label>
              <a href="https://next.dnd.su" target="_blank" rel="noreferrer" className="muted" style={{ fontSize: "var(--fs-meta)", textDecoration: "underline" }}>
                next.dnd.su ↗
              </a>
            </div>
          }
        />
      )}

      {statblocks.length > 1 && (
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
      {shownStatblocks.map((sb) => (
        <StatblockCard
          key={sb.id}
          statblock={sb}
          ownerType={ownerType}
          ownerId={ownerId}
          onChange={refresh}
          onRemove={removeStatblock}
          campaignId={campaignId}
          settingId={settingId}
          soleOnPage={soleOnPage}
        />
      ))}

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
              JSON с <a href="https://next.dnd.su" target="_blank" rel="noreferrer">next.dnd.su</a> — перетащите файл сюда или
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
              style={{ display: "none" }}
              onChange={(e) => importFile(e.target.files?.[0] ?? null, e.target as HTMLInputElement)}
            />
          </label>
          <span className="muted" style={{ fontSize: "var(--fs-meta)", lineHeight: 1.35 }}>
            Экспорт в LSS: откройте персонажа → меню → «Экспорт JSON». Мы создадим статблок «D&D — Персонаж».
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

      {preview && (
        <Modal onClose={() => { setPreview(null); setPendingJson(null); }}>
          <div className="stack" style={{ minWidth: 320 }}>
            <h3 style={{ margin: 0, fontFamily: "var(--font-display)", textTransform: "uppercase" }}>Предпросмотр импорта</h3>
            <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", whiteSpace: "pre-wrap" }}>{preview.shortText}</div>
            <div className="card" style={{ padding: 10, display: "grid", gridTemplateColumns: "140px 1fr", gap: "4px 10px", fontSize: "var(--fs-meta)" }}>
              <span className="muted">Имя</span><span>{preview.characterName || "—"}</span>
              <span className="muted">Раса</span><span>{preview.summary.raceName || "—"} {preview.summary.raceId ? "✓ в справочнике" : preview.summary.raceName ? "— текстом" : ""}</span>
              <span className="muted">Класс</span><span>{[preview.summary.className, preview.summary.subclassName].filter(Boolean).join(" — ") || "—"} {preview.summary.classId ? "✓" : preview.summary.className ? "— текстом" : ""} · Ур. {preview.summary.level}</span>
              <span className="muted">КД / Хиты / Скорость</span><span>{preview.summary.armorClass || "—"} / {preview.summary.hitPointMax || "—"} / {preview.summary.speed || "—"}</span>
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
              <button className="primary" onClick={confirmImport} disabled={importing}>{importing ? "Сохраняю…" : "Импортировать"}</button>
            </div>
            <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>Создастся статблок «D&D — Персонаж». Заклинания LSS (по ID) пока переносятся вручную — см. замечания.</div>
          </div>
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
  soleOnPage,
}: {
  statblock: Statblock;
  ownerType: "character" | "being" | "compendium_entry";
  ownerId: number;
  onChange: () => void;
  onRemove: (id: number) => void;
  campaignId?: number;
  settingId?: number;
  soleOnPage?: boolean;
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

  // Лист персонажа рисует собственную плашку-шапку (§1.4), поэтому обёртка
  // <details className="card"> ниже давала вторую, более плоскую шапку поверх
  // первой — с тем же именем и вторым набором кнопок. Она же прятала лист за
  // аккордеоном, а свёрнутый чарник за столом бесполезен: аккордеон нужен
  // списку, а не листу. Правка идёт по секциям внутри вида (гриллинг 2026-09-03).
  if (statblock.format === "dnd_character" && dndValue) {
    return (
      <DndCharacterView
        value={dndValue as DndCharacterData}
        onQuickUpdate={quickSaveDnd}
        syncTabToUrl={soleOnPage}
        headerExtra={
          <>
            {saveIndicator}
            <button type="button" className="comp-mini" title="Удалить чарник" onClick={() => onRemove(statblock.id)}>
              <NavIcon name="delete" />
            </button>
          </>
        }
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
