import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { resolveEntityLabel } from "../api/resolveEntity";
import { abilityModifier, parseBonus } from "./dnd/AbilityScores";
import { SKILL_CATALOG } from "./dnd/skillCatalog";
import { computeArmorClass } from "./dnd/armorClass";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import type { Character, DndCharacterData, SettingBeing, Statblock, StorySecret } from "../types";

type SheetFormat = "a4" | "a5";
type SheetKind = "session" | "combat" | "characters";

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
}

interface LinkedEntry {
  id: number;
  type: string;
  label: string;
}

interface CheatsheetLine {
  id: string; // `${type}-${id}`
  label: string;
  note: string;
}

interface SessionCheatsheetData {
  locations: CheatsheetLine[];
  npcs: CheatsheetLine[];
  loot: CheatsheetLine[];
  notes: string;
  clues: string;
}

interface Props {
  sessionId: number;
  campaignId: number;
  ideaNotes: string;
  cheatsheetData: string | null;
  unrevealedSecrets: StorySecret[];
}

async function loadLinkedLabels(sessionId: number, section: string): Promise<LinkedEntry[]> {
  const links = await api.get<GenericLink[]>(
    `/links?type=session&id=${sessionId}&section=${section}`
  );
  return Promise.all(
    links.map(async (l) => {
      const other =
        l.from_type === "session" && l.from_id === sessionId
          ? { type: l.to_type, id: l.to_id }
          : { type: l.from_type, id: l.from_id };
      const label = await resolveEntityLabel(other.type, other.id);
      return { id: other.id, type: other.type, label };
    })
  );
}

async function loadEnemies(sessionId: number): Promise<SettingBeing[]> {
  const links = await api.get<GenericLink[]>(
    `/links?type=session&id=${sessionId}&section=enemies`
  );
  const beingLinks = links.filter(
    (l) =>
      (l.from_type === "session" && l.to_type === "being") ||
      (l.to_type === "session" && l.from_type === "being")
  );
  const resolved = await Promise.all(
    beingLinks.map(async (l) => {
      const beingId = l.from_type === "being" ? l.from_id : l.to_id;
      try {
        return await api.get<SettingBeing>(`/setting-beings/${beingId}`);
      } catch {
        return null;
      }
    })
  );
  return resolved.filter((b): b is SettingBeing => b !== null);
}

function mergeLines(existing: CheatsheetLine[], fresh: LinkedEntry[]): CheatsheetLine[] {
  const byId = new Map(existing.map((l) => [l.id, l]));
  return fresh.map((e) => {
    const key = `${e.type}-${e.id}`;
    const prev = byId.get(key);
    return { id: key, label: e.label, note: prev?.note ?? "" };
  });
}

function classAndSubclassSummary(classes: DndCharacterData["classes"]): {
  className: string;
  subclassName: string;
} {
  const parts = classes.filter((c) => c.className);
  return {
    className: parts.map((c) => `${c.className} ${c.level}`).join(" / "),
    subclassName: parts.map((c) => c.subclassName).filter(Boolean).join(" / "),
  };
}

interface CharacterCardData {
  id: number;
  name: string;
  note: string;
  ac: number;
  passivePerception: number;
  race: string;
  className: string;
  subclassName: string;
  skills: string[];
}

async function loadCharacterCards(campaignId: number): Promise<CharacterCardData[]> {
  const characters = await api.get<Character[]>(`/characters?campaign_id=${campaignId}`);
  const cards = await Promise.all(
    characters.map(async (c) => {
      try {
        const statblocks = await api.get<Statblock[]>(
          `/statblocks?owner_type=character&owner_id=${c.id}`
        );
        const row = statblocks.find((s) => s.format === "dnd_character");
        if (!row) return null;
        let data: DndCharacterData;
        try {
          data = JSON.parse(row.content);
        } catch {
          return null;
        }
      const dexMod = abilityModifier(data.abilities.dex);
      const ac = computeArmorClass(dexMod, data.equipmentSections, parseBonus(data.manualAcBonus));
      const profBonus = parseBonus(data.proficiencyBonus);
      const wisMod = abilityModifier(data.abilities.wis);
      // Ключ владения — английский `original` (см. dnd/skillCatalog.ts).
      // Шпаргалка читает сохранённый JSON напрямую, мимо
      // `normalizeDndCharacter`, поэтому сводит имя сама: лист, ещё не
      // пересохранённый после перехода на новый ключ, иначе показал бы
      // пассивное восприятие без учёта владения.
      const perceptionLevel =
        data.skillProfs["Perception"] ?? data.skillProfs["Внимание/восприятие"] ?? 0;
      const passivePerception = 10 + wisMod + profBonus * perceptionLevel;
      const { className, subclassName } = classAndSubclassSummary(data.classes);
      const skills = SKILL_CATALOG.filter(
        (def) => (data.skillProfs[def.original] ?? data.skillProfs[def.name] ?? 0) > 0
      ).map((def) => def.name);
      return {
        id: c.id,
        name: data.characterName || c.character_name,
        note: row.note || "",
        ac,
        passivePerception,
        race: data.raceName,
        className,
        subclassName,
        skills,
      };
      } catch {
        return null;
      }
    })
  );
  return cards.filter((c): c is CharacterCardData => c !== null);
}

const PAGE_SIZE: Record<SheetKind, string> = {
  session: "A4 landscape",
  combat: "A4 landscape",
  characters: "A4 landscape",
};

// Memoized — see ObstacleDropZone's comment; props here are plain
// primitives so no caller-side changes are needed for this to take effect.
export const CheatSheetsSection = memo(function CheatSheetsSection({
  sessionId,
  campaignId,
  ideaNotes,
  cheatsheetData,
  unrevealedSecrets,
}: Props) {
  const [locations, setLocations] = useState<LinkedEntry[]>([]);
  const [npcs, setNpcs] = useState<LinkedEntry[]>([]);
  const [loot, setLoot] = useState<LinkedEntry[]>([]);
  const [enemies, setEnemies] = useState<SettingBeing[]>([]);
  const [combatFormat, setCombatFormat] = useState<SheetFormat>("a4");
  const [printJob, setPrintJob] = useState<{ kind: SheetKind; pageSize: string } | null>(null);

  const [sheet, setSheet] = useState<SessionCheatsheetData | null>(() =>
    cheatsheetData ? JSON.parse(cheatsheetData) : null
  );
  const [characterCards, setCharacterCards] = useState<CharacterCardData[] | null>(null);
  const [loadingCards, setLoadingCards] = useState(false);

  useEffect(() => {
    loadLinkedLabels(sessionId, "plot_characters").then(setNpcs);
    loadLinkedLabels(sessionId, "locations").then(setLocations);
    loadLinkedLabels(sessionId, "loot").then(setLoot);
    loadEnemies(sessionId).then(setEnemies);
  }, [sessionId]);

  // Printing a specific template means hiding everything else on the page
  // for the duration of the browser print dialog — the CSS in index.css
  // (`.printing-cheatsheet`) does the actual hide/show, this effect just
  // drives the @page size (which differs per format/combo) and cleans up
  // once the dialog closes, whether the user printed or cancelled. Margin is
  // 0 — each .cheatsheet-sheet is already sized to exactly fill its physical
  // page (width/min-height match the A4/A5 dimensions) with its own 10mm
  // internal padding, so an additional @page margin on top just pushed the
  // sheet past the printable area and forced Chrome's print preview to
  // scroll/clip it.
  useEffect(() => {
    if (!printJob) return;
    const style = document.createElement("style");
    style.textContent = `@page { size: ${printJob.pageSize}; margin: 0; }`;
    document.head.appendChild(style);
    document.body.classList.add("printing-cheatsheet");
    function cleanup() {
      document.body.classList.remove("printing-cheatsheet");
      style.remove();
      setPrintJob(null);
      window.removeEventListener("afterprint", cleanup);
    }
    window.addEventListener("afterprint", cleanup);
    const raf = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(raf);
      // Если диалог закрыли Esc или компонент размонтировался до afterprint — чистим
      if (document.body.classList.contains("printing-cheatsheet")) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printJob]);

  async function persistSheet(data: SessionCheatsheetData) {
    await api.put(`/sessions/${sessionId}`, { cheatsheet_data: JSON.stringify(data) });
  }

  async function generateSheet() {
    const next: SessionCheatsheetData = {
      locations: mergeLines(sheet?.locations ?? [], locations),
      npcs: mergeLines(sheet?.npcs ?? [], npcs),
      loot: mergeLines(sheet?.loot ?? [], loot),
      notes: sheet?.notes ?? ideaNotes,
      clues: sheet?.clues ?? "",
    };
    setSheet(next);
    await persistSheet(next);
  }

  function updateLineNote(section: "locations" | "npcs" | "loot", id: string, note: string) {
    setSheet((prev) => (prev ? { ...prev, [section]: prev[section].map((l) => (l.id === id ? { ...l, note } : l)) } : prev));
  }

  function updateText(field: "notes" | "clues", value: string) {
    setSheet((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  function blurSave() {
    if (sheet) persistSheet(sheet);
  }

  async function loadCharacters() {
    setLoadingCards(true);
    try {
      setCharacterCards(await loadCharacterCards(campaignId));
    } finally {
      setLoadingCards(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        Заполняемые шпаргалки для печати перед офлайн-сессией. Данные подтягиваются из заготовки
        на сессию — все строчки можно отредактировать после генерации.
      </p>

      <div className="sp-subcard stack">
        <strong className="sp-title">Шпаргалка сессии</strong>
        <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)", maxWidth: "68ch" }}>
          Локации, неписи и квесты (нераскрытые секреты) на первой странице; заметки, улики и
          потенциальный лут — на второй. Строчки редактируются прямо на листе.
        </p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" onClick={generateSheet}>
            {sheet ? "Обновить из заготовки" : "Сгенерировать"}
          </button>
          {sheet && (
            <button
              type="button"
              onClick={() => setPrintJob({ kind: "session", pageSize: PAGE_SIZE.session })}
            >
              Печать / Сохранить PDF
            </button>
          )}
        </div>

        {sheet && (
          <SessionSheetTable
            sheet={sheet}
            unrevealedSecrets={unrevealedSecrets}
            onUpdateLine={updateLineNote}
            onUpdateText={updateText}
            onBlurSave={blurSave}
          />
        )}
      </div>

      <div className="sp-subcard stack">
        <strong className="sp-title">Шпаргалка по персонажам ДнД</strong>
        <p className="muted" style={{ margin: 0 }}>
          Имя, КЗ, пассивное восприятие, вид, класс/подкласс и владения навыками — из статблоков
          персонажей кампании. Предметы, цели и заметки пока генерируются пустыми.
        </p>
        <div className="row">
          <button type="button" onClick={loadCharacters} disabled={loadingCards}>
            {loadingCards ? "Загрузка…" : characterCards ? "Обновить" : "Показать"}
          </button>
          {characterCards && characterCards.length > 0 && (
            <button
              type="button"
              onClick={() => setPrintJob({ kind: "characters", pageSize: PAGE_SIZE.characters })}
            >
              Сохранить под печать
            </button>
          )}
        </div>
        {characterCards && (
          <div className="dnd-cheatsheet-preview">
            {characterCards.map((c) => (
              <CharacterCardPreview key={c.id} c={c} />
            ))}
            {characterCards.length === 0 && (
              <p className="muted">В кампании нет персонажей со статблоком ДнД.</p>
            )}
          </div>
        )}
      </div>

      <div className="sp-subcard stack">
        <strong className="sp-title">Боевая шпаргалка</strong>
        <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)", maxWidth: "68ch" }}>
          Строка на каждого противника: КД, инициатива, ХП и клетки для учёта урона.
        </p>
        <div className="row">
          <select
            value={combatFormat}
            onChange={(e) => setCombatFormat(e.target.value as SheetFormat)}
          >
            <option value="a4">A4 (альбомная)</option>
            <option value="a5">A5 (книжная)</option>
          </select>
          <button
            type="button"
            onClick={() =>
              setPrintJob({ kind: "combat", pageSize: combatFormat === "a4" ? "A4 landscape" : "A5 portrait" })
            }
          >
            Сохранить под печать
          </button>
        </div>
      </div>

      {printJob &&
        createPortal(
          <div className="cheatsheet-print-portal">
            {printJob.kind === "session" && sheet && (
              <SessionPrintView sheet={sheet} unrevealedSecrets={unrevealedSecrets} />
            )}
            {printJob.kind === "combat" && <CombatSheet format={combatFormat} enemies={enemies} />}
            {printJob.kind === "characters" && characterCards && (
              <CharacterPrintSheet cards={characterCards} />
            )}
          </div>,
          document.body
        )}
    </div>
  );
});

function CharacterCardPreview({ c }: { c: CharacterCardData }) {
  return (
    <div className="card dnd-cheatsheet-card-preview">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{c.name}</strong>
        <span className="muted">
          КЗ {c.ac} · ПП {c.passivePerception}
        </span>
      </div>
      {c.note && <div className="muted">{c.note}</div>}
      <div className="muted">
        {c.race}
        {c.className && ` · ${c.className}`}
        {c.subclassName && ` (${c.subclassName})`}
      </div>
      {c.skills.length > 0 && (
        <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          {c.skills.join(", ")}
        </div>
      )}
    </div>
  );
}

// The always-visible, on-screen editable sheet — "Печать / Сохранить PDF"
// renders a separate, static snapshot (SessionPrintView below) into a
// document.body portal instead of reusing this one, since this component's
// borderless/transparent line inputs and click-to-edit text fields exist
// only to be edited, not printed. Квесты checkboxes here are plain drawn
// squares, not real <input type="checkbox">s — resolving a secret happens
// in Хроника, not here; this sheet is meant to be printed and ticked off
// by hand.
function SessionSheetTable({
  sheet,
  unrevealedSecrets,
  onUpdateLine,
  onUpdateText,
  onBlurSave,
}: {
  sheet: SessionCheatsheetData;
  unrevealedSecrets: StorySecret[];
  onUpdateLine: (section: "locations" | "npcs" | "loot", id: string, note: string) => void;
  onUpdateText: (field: "notes" | "clues", value: string) => void;
  onBlurSave: () => void;
}) {
  const [editingField, setEditingField] = useState<"notes" | "clues" | null>(null);

  function fillList(
    section: "locations" | "npcs" | "loot",
    lines: CheatsheetLine[],
    emptyLabel: string
  ) {
    return (
      <ol className="cheatsheet-fill-list">
        {lines.map((l) => (
          <li key={l.id}>
            <span className="cheatsheet-fill-label">{l.label}</span>
            <input
              className="cheatsheet-fill-input"
              placeholder="примечание"
              value={l.note}
              onChange={(e) => onUpdateLine(section, l.id, e.target.value)}
              onBlur={onBlurSave}
            />
          </li>
        ))}
        {lines.length === 0 && <li className="muted">{emptyLabel}</li>}
      </ol>
    );
  }

  function textField(field: "notes" | "clues", value: string, placeholder: string) {
    if (editingField === field) {
      return (
        <div className="cheatsheet-fill-mentionarea">
          <MentionTextarea
            value={value}
            onChange={(v) => onUpdateText(field, v)}
            rows={field === "notes" ? 6 : 5}
          />
          <button type="button" className="comp-mini" onClick={() => { onBlurSave(); setEditingField(null); }}>
            Готово
          </button>
        </div>
      );
    }
    return (
      <div
        className="cheatsheet-fill-textview"
        onClick={() => setEditingField(field)}
        title="Нажмите, чтобы отредактировать"
      >
        {value ? <MentionText text={value} mentionsAsBold /> : <span className="muted">{placeholder}</span>}
      </div>
    );
  }

  return (
    <div className="cheatsheet-live-wrap">
      <div className="cheatsheet-sheet cheatsheet-session-page" data-format="a5">
        <h2>Локации, неписи, квесты</h2>
        <section>
          <h3>Локации</h3>
          {fillList("locations", sheet.locations, "Пусто — добавьте локации в заготовку и обновите шпаргалку.")}
        </section>
        <section>
          <h3>Неписи</h3>
          {fillList("npcs", sheet.npcs, "Пусто — добавьте сюжетных персонажей в заготовку и обновите шпаргалку.")}
        </section>
        <section>
          <h3>Квесты</h3>
          <ul className="cheatsheet-quest-list">
            {unrevealedSecrets.map((s) => (
              <li key={s.id}>
                <span className="cheatsheet-quest-box" />
                {s.title || "Без названия"}
              </li>
            ))}
            {unrevealedSecrets.length === 0 && <li className="muted">Нет нераскрытых секретов.</li>}
          </ul>
        </section>
      </div>

      <div className="cheatsheet-sheet cheatsheet-session-page" data-format="a5">
        <h2>Заметки, улики, лут</h2>
        <section>
          <h3>Заметки</h3>
          {textField("notes", sheet.notes, "Нажмите, чтобы добавить заметки")}
        </section>
        <section>
          <h3>Улики</h3>
          {textField("clues", sheet.clues, "Нажмите, чтобы добавить улики")}
        </section>
        <section>
          <h3>Лут</h3>
          {fillList("loot", sheet.loot, "Пусто — добавьте потенциальный лут в заготовку и обновите шпаргалку.")}
        </section>
      </div>
    </div>
  );
}

// Static print snapshot of the session sheet — rendered into the
// document.body portal, not the on-screen SessionSheetTable, so nothing
// interactive (inputs, click-to-edit, format toolbar) ever ends up in the
// PDF. Same two A5-proportioned halves, laid out side by side on a single
// A4 landscape sheet (two A5 portrait widths ≈ one A4 landscape width),
// same section order, plain read-only markup.
function SessionPrintView({
  sheet,
  unrevealedSecrets,
}: {
  sheet: SessionCheatsheetData;
  unrevealedSecrets: StorySecret[];
}) {
  function printList(lines: CheatsheetLine[]) {
    return (
      <ol className="cheatsheet-fill-list">
        {lines.map((l) => (
          <li key={l.id}>
            <span className="cheatsheet-fill-label">{l.label}</span>
            {l.note && <span>{l.note}</span>}
          </li>
        ))}
        {lines.length === 0 && <li className="muted">—</li>}
      </ol>
    );
  }

  return (
    <div className="cheatsheet-combo cheatsheet-session-page">
      <div className="cheatsheet-sheet" data-format="a5">
        <h2>Локации, неписи, квесты</h2>
        <section>
          <h3>Локации</h3>
          {printList(sheet.locations)}
        </section>
        <section>
          <h3>Неписи</h3>
          {printList(sheet.npcs)}
        </section>
        <section>
          <h3>Квесты</h3>
          <ul className="cheatsheet-quest-list">
            {unrevealedSecrets.map((s) => (
              <li key={s.id}>
                <span className="cheatsheet-quest-box" />
                {s.title || "Без названия"}
              </li>
            ))}
            {unrevealedSecrets.length === 0 && <li className="muted">Нет нераскрытых секретов.</li>}
          </ul>
        </section>
      </div>

      <div className="cheatsheet-sheet" data-format="a5">
        <h2>Заметки, улики, лут</h2>
        <section>
          <h3>Заметки</h3>
          <div className="cheatsheet-fill-textview">
            {sheet.notes ? <MentionText text={sheet.notes} mentionsAsBold /> : "—"}
          </div>
        </section>
        <section>
          <h3>Улики</h3>
          <div className="cheatsheet-fill-textview">
            {sheet.clues ? <MentionText text={sheet.clues} mentionsAsBold /> : "—"}
          </div>
        </section>
        <section>
          <h3>Лут</h3>
          {printList(sheet.loot)}
        </section>
      </div>
    </div>
  );
}

function CharacterPrintSheet({ cards }: { cards: CharacterCardData[] }) {
  return (
    <div className="cheatsheet-sheet" data-format="a4">
      <h2>Шпаргалка по персонажам ДнД</h2>
      <div className="dnd-cheatsheet-grid">
        {cards.map((c) => (
          <div key={c.id} className="dnd-cheatsheet-card">
            <div className="dnd-cheatsheet-card-head">
              <div>
                <strong>{c.name}</strong>
                {c.note && <div className="dnd-cheatsheet-card-note">{c.note}</div>}
              </div>
              <div className="dnd-cheatsheet-card-vitals">
                <div>
                  <span>КЗ</span>
                  <strong>{c.ac}</strong>
                </div>
                <div>
                  <span>ПП</span>
                  <strong>{c.passivePerception}</strong>
                </div>
              </div>
              <div className="dnd-cheatsheet-card-classline">
                <div>{c.race}</div>
                <div>{c.className}</div>
                <div>{c.subclassName}</div>
              </div>
            </div>
            <div className="dnd-cheatsheet-card-body">
              <div className="dnd-cheatsheet-card-skills">
                {c.skills.map((s) => (
                  <div key={s}>{s}</div>
                ))}
              </div>
              <div className="dnd-cheatsheet-card-notes" />
            </div>
            <div className="dnd-cheatsheet-card-footer">
              <div>
                <div className="dnd-cheatsheet-card-footer-label">Цели</div>
              </div>
              <div className="dnd-cheatsheet-card-footer-items">
                <div className="dnd-cheatsheet-card-footer-label">Предметы</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CombatSheet({ format, enemies }: { format: SheetFormat; enemies: SettingBeing[] }) {
  return (
    <div className="cheatsheet-sheet" data-format={format}>
      <h2>Боевая шпаргалка</h2>
      {enemies.length === 0 && (
        <p className="muted">Нет противников — добавьте их в разделе «Противники».</p>
      )}
      {enemies.map((e) => (
        <div key={e.id} className="combat-row">
          <div className="combat-row-name">
            <strong>{e.name}</strong>
            {e.statblock_short && (
              <div className="muted combat-row-note">{e.statblock_short.split("\n")[0]}</div>
            )}
          </div>
          <label className="combat-field">
            КД <span className="fill-box" />
          </label>
          <label className="combat-field">
            Иниц. <span className="fill-box" />
          </label>
          <label className="combat-field">
            ХП <span className="fill-box wide" />
          </label>
          <div className="combat-boxes">
            {Array.from({ length: 20 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
