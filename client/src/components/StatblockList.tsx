import { useEffect, useState } from "react";
import { api } from "../api/client";
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
import { emptyChallenge, LitMChallengeEdit, LitMChallengeView } from "./litm/LitMChallengeForm";
import {
  emptyCharacter,
  LitMCharacterEdit,
  LitMCharacterView,
  normalizeCharacter,
  normalizeTheme,
} from "./litm/LitMCharacterForm";
import { normalizeDndCreature, DndCreatureEdit, DndCreatureView } from "./dnd/DndCreatureForm";
import { emptyDndCharacter, normalizeDndCharacter, DndCharacterEdit, DndCharacterView } from "./dnd/DndCharacterForm";
import { findDndSystemId } from "./dnd/dndCompendium";
import { DndCharacterWizard } from "./dnd/DndCharacterWizard";
import { DndCreatureWizard } from "./dnd/DndCreatureWizard";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { STATBLOCK_THEMES } from "../statblockThemes";

const TEMPLATE_TYPE = "statblock_template";
const KIND_LABELS: Record<string, string> = { short: "Краткий", full: "Полный" };
const FORMAT_LABELS: Record<StatblockFormat, string> = {
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
  // dnd_creature statblock's Размер/Тип/УО from the profile fields set on the
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
              t.template_format === dndFormat
          )
        )
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [litmFormat, dndFormat]);

  async function addStatblock() {
    if (format === "litm_character") {
      const character = emptyCharacter();
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
      await api.post("/statblocks", {
        owner_type: ownerType,
        owner_id: ownerId,
        format,
        kind: "full",
        content: JSON.stringify(character),
      });
    } else if (format === "litm_challenge") {
      await api.post("/statblocks", {
        owner_type: ownerType,
        owner_id: ownerId,
        format,
        kind: "full",
        content: JSON.stringify(emptyChallenge()),
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

  async function removeStatblock(id: number) {
    await api.del(`/statblocks/${id}`);
    refresh();
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
      {statblocks.map((sb) => (
        <StatblockCard
          key={sb.id}
          statblock={sb}
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
          + Добавить статблок
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
  onChange,
  onRemove,
  campaignId,
  settingId,
}: {
  statblock: Statblock;
  onChange: () => void;
  onRemove: (id: number) => void;
  campaignId?: number;
  settingId?: number;
}) {
  const isLitm = statblock.format === "litm_character" || statblock.format === "litm_challenge";
  const isDnd = statblock.format === "dnd_character" || statblock.format === "dnd_creature";

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
  const [theme, setTheme] = useState(statblock.theme);
  const [density] = useState(statblock.density);
  const [kind] = useState(statblock.kind);

  async function save() {
    await api.put(`/statblocks/${statblock.id}`, { content, note });
    // [[type:id|Label]] mention tokens survive JSON-encoding as plain
    // substrings, so this diffs correctly for LitM (JSON) content too.
    syncMentionLinks(statblock.owner_type, statblock.owner_id, statblock.content, content);
    setEditMode(false);
    onChange();
  }

  async function changeTheme(v: string) {
    setTheme(v);
    await api.put(`/statblocks/${statblock.id}`, { theme: v });
  }

  // Lets tag add/remove in the collapsed view persist immediately, without
  // making the user open full edit mode first.
  async function quickSave(v: LitMCharacterData | LitMChallengeData) {
    const json = JSON.stringify(v);
    setLitmValue(v);
    setContent(json);
    await api.put(`/statblocks/${statblock.id}`, { content: json });
    onChange();
  }

  // Same idea as quickSave above, for D&D character view-mode quick edits
  // (HP, inspiration, death saves, spell slots used) — merges a partial patch
  // instead of replacing the whole value.
  async function quickSaveDnd(patch: Partial<DndCharacterData>) {
    const next = { ...(dndValue as DndCharacterData), ...patch };
    const json = JSON.stringify(next);
    setDndValue(next);
    setContent(json);
    await api.put(`/statblocks/${statblock.id}`, { content: json });
    onChange();
  }

  const summaryTitle =
    statblock.format === "litm_challenge"
      ? (litmValue as LitMChallengeData)?.title || "Без названия"
      : statblock.format === "dnd_creature"
      ? (dndValue as DndCreatureData)?.name || "Без названия"
      : statblock.format === "dnd_character"
      ? (dndValue as DndCharacterData)?.characterName || "Без имени"
      : null;

  return (
    <details className="card" open={editMode}>
      <summary className="row" style={{ justifyContent: "space-between" }}>
        <span>
          <span className="badge planned">
            {isLitm || isDnd ? FORMAT_LABELS[statblock.format] : KIND_LABELS[statblock.kind]}
          </span>
          {summaryTitle && <span className="muted"> {summaryTitle}</span>}
          {!isLitm && !isDnd && statblock.note && <span className="muted"> {statblock.note}</span>}
        </span>
        <button
          onClick={(e) => {
            e.preventDefault();
            onRemove(statblock.id);
          }}
        >
          ✕
        </button>
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
            {statblock.format === "dnd_character" && dndValue && (
              <DndCharacterEdit
                value={dndValue as DndCharacterData}
                onChange={(v) => {
                  setDndValue(v);
                  setContent(JSON.stringify(v));
                }}
              />
            )}
            {statblock.format === "dnd_creature" && dndValue && (
              <DndCreatureEdit
                value={dndValue as DndCreatureData}
                onChange={(v) => {
                  setDndValue(v);
                  setContent(JSON.stringify(v));
                }}
              />
            )}
            {!isLitm && !isDnd && (
              <MentionTextarea value={content} onChange={setContent} rows={8} defaultSettingId={settingId} />
            )}
            {statblock.format !== "dnd_character" && (
              <label>
                Примечание
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            )}
            <div className="row">
              <button className="primary" onClick={save}>
                Сохранить
              </button>
              <button onClick={() => setEditMode(false)}>Отмена</button>
            </div>
          </>
        ) : (
          <>
            {(isDnd || isLitm) && (dndValue || litmValue) && (
              <div className="sb-theme-picker">
                <span className="muted">Тема:</span>
                <select value={theme ?? "color"} onChange={(e) => changeTheme(e.target.value)}>
                  {STATBLOCK_THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {statblock.format === "litm_character" && litmValue && (
              <LitMCharacterView
                value={litmValue as LitMCharacterData}
                onQuickUpdate={quickSave}
                campaignId={campaignId}
                theme={theme}
                density={density}
              />
            )}
            {statblock.format === "litm_challenge" && litmValue && (
              <LitMChallengeView value={litmValue as LitMChallengeData} theme={theme} density={density} />
            )}
            {statblock.format === "dnd_character" && dndValue && (
              <DndCharacterView
                value={dndValue as DndCharacterData}
                theme={theme}
                density={density}
                compact={kind === "short"}
                onQuickUpdate={quickSaveDnd}
              />
            )}
            {statblock.format === "dnd_creature" && dndValue && (
              <DndCreatureView
                value={dndValue as DndCreatureData}
                theme={theme}
                density={density}
                compact={kind === "short"}
              />
            )}
            {!isLitm && !isDnd && (
              <div style={{ whiteSpace: "pre-wrap" }}>
                {statblock.content ? <MentionText text={statblock.content} /> : <span className="muted">Пусто</span>}
              </div>
            )}
            {!isLitm && !isDnd && statblock.note && <div className="muted">Примечание: {statblock.note}</div>}
            <button onClick={() => setEditMode(true)} style={{ alignSelf: "flex-start" }}>
              Редактировать
            </button>
          </>
        )}
      </div>
    </details>
  );
}
