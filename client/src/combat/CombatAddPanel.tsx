import { useEffect, useMemo, useState } from "react";
import { useEntity, useResource, write } from "../data/hooks";
import { compendiumPaths } from "../data/compendiumEntries";
import { sessionPaths } from "../data/sessions";
import { BEING_CATEGORY_LABELS } from "../beingCategories";
import type { Campaign, Character, CompendiumEntry, InitiativeEntry, SettingBeing } from "../types";
import { addFighters, addSameAgain, type Source } from "./addToCombat";
import { parseNestState } from "./nestState";
import type { useCombat } from "./useCombat";

type Combat = ReturnType<typeof useCombat>;

// --- Опасность (Q38) ---

function crValue(cr: unknown): number | null {
  if (typeof cr !== "string" && typeof cr !== "number") return null;
  const s = String(cr).trim();
  if (!s) return null;
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const BANDS = [
  { key: "0-1", label: "ОП 0–1", max: 1 },
  { key: "2-4", label: "ОП 2–4", max: 4 },
  { key: "5-10", label: "ОП 5–10", max: 10 },
  { key: "11+", label: "ОП 11+", max: Infinity },
] as const;

function bandOf(cr: number | null): string {
  if (cr == null) return "?";
  return BANDS.find((b) => cr <= b.max)!.key;
}

// --- Панель ---

interface Row {
  key: string;
  name: string;
  meta: string;
  src: Source;
  /** Персонаж уже в бою: погашен, добавляется двойником (Q41). */
  inFight?: boolean;
  /** Бестиарий: опасность, тип, звёздочка. */
  cr?: number | null;
  type?: string;
  favourite?: boolean;
}

const NO_ENTRIES: CompendiumEntry[] = [];

type Cat = "fav" | "pc" | "setting" | "bestiary";
const NO_TYPE = "Без типа";

/**
 * «Добавить в бой» — ПКМ по пустому месту ленты (Q37): поиск сверху,
 * колонки категория → тип → список. Панель не закрывается после
 * добавления — «Готово» или Esc (Q39).
 */
export function AddToCombatPanel({
  combat,
  sessionId,
  x,
  y,
  onClose,
}: {
  combat: Combat;
  sessionId: number;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const campaignId = combat.session?.campaign_id ?? null;
  const campaign = useEntity<Campaign>("campaign", campaignId).data ?? null;
  const systemId = campaign?.system_id ?? null;
  const settingId = campaign?.setting_id ?? null;

  const characters = useResource<Character[]>(campaignId ? sessionPaths.campaignCharacters(campaignId) : null).data;
  const beings = useResource<SettingBeing[]>(settingId ? `/setting-beings?setting_id=${settingId}` : null).data;
  const sections = useResource<{ id: number; kind: string }[]>(systemId ? compendiumPaths.sections(systemId) : null).data;
  const bestiarySection = sections?.find((s) => s.kind === "monster")?.id ?? null;
  const bestiary =
    useResource<CompendiumEntry[]>(
      systemId && bestiarySection ? compendiumPaths.sectionEntries(systemId, bestiarySection) : null
    ).data ?? NO_ENTRIES;

  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Cat>("bestiary");
  const [type, setType] = useState<string | null>(null);
  const [band, setBand] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const inFight = useMemo(
    () => new Set(combat.entries.filter((e) => e.entity_type === "character" && !parseNestState(e).double).map((e) => e.entity_id)),
    [combat.entries]
  );

  const bestiaryRows: Row[] = useMemo(
    () =>
      bestiary.map((e) => {
        const typeName = (e.data?.creature_type as { name?: string } | undefined)?.name ?? NO_TYPE;
        const cr = crValue(e.data?.cr);
        return {
          key: `c:${e.id}`,
          name: e.name,
          meta: `${typeName} · ОП ${e.data?.cr ?? "?"}`,
          src: { type: "compendium_entry" as const, id: e.id, name: e.name },
          cr,
          type: typeName,
          favourite: !!e.favourite,
        };
      }),
    [bestiary]
  );
  const pcRows: Row[] = (characters ?? [])
    .filter((c) => !c.archived_at)
    .map((c) => {
      const fighting = inFight.has(c.id);
      return {
        key: `p:${c.id}`,
        name: c.character_name,
        meta: `${c.player_name ?? "персонаж"}${fighting ? " · в бою" : ""}`,
        src: { type: "character", id: c.id, name: c.character_name, double: fighting },
        inFight: fighting,
      };
    });
  const settingRows: Row[] = (beings ?? []).map((b) => ({
    key: `b:${b.id}`,
    name: b.name,
    meta: BEING_CATEGORY_LABELS[b.category] ?? "",
    src: { type: "being", id: b.id, name: b.name },
  }));

  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of bestiaryRows) m.set(r.type!, (m.get(r.type!) ?? 0) + 1);
    // По числу существ (Q37); записи без типа — в конце.
    return [...m.entries()].sort((a, b) => Number(a[0] === NO_TYPE) - Number(b[0] === NO_TYPE) || b[1] - a[1]);
  }, [bestiaryRows]);
  const favRows = bestiaryRows.filter((r) => r.favourite);

  const query = q.trim().toLocaleLowerCase("ru");
  let rows: Row[];
  let grouped = false;
  if (query) {
    rows = [...pcRows, ...settingRows, ...bestiaryRows].filter((r) => r.name.toLocaleLowerCase("ru").includes(query));
  } else if (cat === "fav") rows = favRows;
  else if (cat === "pc") rows = pcRows;
  else if (cat === "setting") rows = settingRows;
  else {
    rows = type ? bestiaryRows.filter((r) => r.type === type) : [];
    grouped = true;
  }
  if (grouped) {
    rows = [...rows].sort((a, b) => (a.cr ?? 99) - (b.cr ?? 99) || a.name.localeCompare(b.name, "ru"));
  } else {
    rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }
  const bandsHere = grouped ? BANDS.filter((b) => rows.some((r) => bandOf(r.cr ?? null) === b.key)) : [];
  const shown = grouped && band ? rows.filter((r) => bandOf(r.cr ?? null) === band) : rows;

  async function add(row: Row) {
    if (busy) return;
    setBusy(true);
    const n = counts[row.key] ?? 1;
    try {
      const last = await addFighters(combat, sessionId, row.src, n);
      if (last) setStatus(`Встали в бой: ${row.src.double ? `двойник ${row.name}` : row.name}${n > 1 ? ` ×${n}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  const W = 840;
  const H = 440;
  const left = Math.max(8, Math.min(x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - H - 8));

  const catItem = (key: Cat, label: string, count: number | null) => (
    <button
      key={key}
      type="button"
      className={`cm-pk-it${!query && cat === key ? " is-on" : ""}`}
      onClick={() => {
        setQ("");
        setCat(key);
        setBand(null);
      }}
    >
      {label} {count != null && <small>{count}</small>}
    </button>
  );

  let header: string | null = null;
  return (
    <div className="cm-layer" onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        className="cm-picker"
        role="dialog"
        aria-label="Добавить в бой"
        style={{ left, top, width: W, height: H }}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <div className="cm-pk-top">
          <input
            type="text"
            autoFocus
            placeholder="Поиск по всему: персонажи, сеттинг, бестиарий"
            aria-label="Поиск"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" className="cm-btn" onClick={onClose}>
            Готово
          </button>
        </div>
        <div className="cm-pk-cols">
          {!query && (
            <div className="cm-pk-col">
              {catItem("fav", "Избранное", favRows.length)}
              {catItem("pc", "Персонажи", pcRows.length)}
              {catItem("setting", "Существа сеттинга", settingRows.length)}
              {catItem("bestiary", "Бестиарий", bestiaryRows.length)}
            </div>
          )}
          {!query && cat === "bestiary" && (
            <div className="cm-pk-col">
              {types.map(([t, n]) => (
                <button
                  key={t}
                  type="button"
                  className={`cm-pk-it${type === t ? " is-on" : ""}`}
                  onClick={() => {
                    setType(t);
                    setBand(null);
                  }}
                >
                  {t} <small>{n}</small>
                </button>
              ))}
            </div>
          )}
          <div className="cm-pk-list">
            {bandsHere.length > 1 && (
              <div className="cm-pk-chips">
                {bandsHere.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    className={`cm-pk-chip${band === b.key ? " is-on" : ""}`}
                    onClick={() => setBand(band === b.key ? null : b.key)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}
            {shown.map((r) => {
              const head = grouped ? (BANDS.find((b) => b.key === bandOf(r.cr ?? null))?.label ?? "ОП ?") : null;
              const showHead = head != null && head !== header;
              header = head;
              return (
                <div key={r.key}>
                  {showHead && <div className="cm-pk-h">{head}</div>}
                  <div className={`cm-pk-row${r.inFight ? " is-dim" : ""}`}>
                    <div className="cm-pk-n">
                      {r.name}
                      <small>{r.meta}</small>
                    </div>
                    <label className="cm-pk-cnt" title="Сколько добавить — не инициатива">
                      Сколько ×
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={counts[r.key] ?? 1}
                        onChange={(e) =>
                          setCounts({ ...counts, [r.key]: Math.max(1, Math.min(10, Math.floor(Number(e.target.value)) || 1)) })
                        }
                      />
                    </label>
                    <button type="button" className="cm-btn cm-btn--sm" disabled={busy} onClick={() => void add(r)}>
                      {r.inFight ? "Двойник" : "Добавить"}
                    </button>
                  </div>
                </div>
              );
            })}
            {shown.length === 0 && (
              <div className="cm-pk-empty">
                {query
                  ? "Ничего не нашлось"
                  : cat === "bestiary" && !type
                    ? "Выберите тип слева"
                    : cat === "fav"
                      ? "Избранного нет — звёздочка у существа в бестиарии системы"
                      : "Пусто"}
              </div>
            )}
          </div>
        </div>
        <div className="cm-pk-foot">
          <span>{busy ? "Ставим в бой…" : status}</span>
          <span>Встают в бой без инициативы · Esc — закрыть</span>
        </div>
      </div>
    </div>
  );
}

/** ПКМ по гнезду (Q42): «Ещё такой же», «Убрать из боя…» с подтверждением. */
export function NestMenu({
  combat,
  sessionId,
  entry,
  x,
  y,
  onClose,
}: {
  combat: Combat;
  sessionId: number;
  entry: InitiativeEntry;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - 248));
  const top = Math.max(8, Math.min(y, window.innerHeight - 160));
  // ponytail: запись в лог боя — шаг 4 (лог ещё не заведён).
  function remove() {
    onClose();
    void combat.change(`«${entry.name}» не убран из боя`, () => write.del(`/initiative-entries/${entry.id}`), {
      patch: (rows) => rows.filter((e) => e.id !== entry.id),
    });
  }

  return (
    <div className="cm-layer" onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div className="cm-menu" role="menu" aria-label={entry.name} style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="cm-menu__h">{entry.name}</div>
        {!confirming ? (
          <>
            {entry.kind === "creature" && (
              <button
                type="button"
                role="menuitem"
                className="cm-menu__it"
                onClick={() => {
                  onClose();
                  addSameAgain(combat, sessionId, entry);
                }}
              >
                Ещё такой же
              </button>
            )}
            <button type="button" role="menuitem" className="cm-menu__it" onClick={() => setConfirming(true)}>
              Убрать из боя…
            </button>
          </>
        ) : (
          <>
            <div className="cm-menu__q">Убрать «{entry.name}» из боя?</div>
            <div className="cm-menu__row">
              <button type="button" className="cm-btn cm-btn--sm cm-btn--dmg" autoFocus onClick={remove}>
                Убрать
              </button>
              <button type="button" className="cm-btn cm-btn--sm" onClick={onClose}>
                Отмена
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
