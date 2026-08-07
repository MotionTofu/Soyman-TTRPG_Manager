import { useEffect, useMemo, useState, type DragEvent } from "react";
import { api } from "../api/client";
import { useAudioPlayer, type AudioTrack } from "../audioPlayer";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { NavIcon } from "./NavIcons";
import { parseDndStatblock } from "./EntityPreviewModal";
import { abilityModifier, formatModifier } from "./dnd/AbilityScores";
import { rollDiceFormula } from "./dnd/diceRoll";
import { findDndSystemId, loadDndMechanicsGroup } from "./dnd/dndCompendium";
import { loadUseEpithets, INITIATIVE_EPITHETS } from "../initiativeTrackerPrefs";
import type {
  DndCharacterData,
  DndCreatureData,
  DndCreatureHitPoints,
  InitiativeEntry,
  PlaylistDetail,
  SearchResult,
  SessionDetail,
  Statblock,
} from "../types";

const ACCEPT_TYPES = ["being", "character", "compendium_entry"];

// Same 10-color palette used nowhere else yet — deterministic per condition
// name (hash → index) so a given condition always gets the same chip color
// across entries and re-renders, without needing a color field in the
// compendium (conditions are plain name+description mechanic_item entries).
const CONDITION_COLORS = [
  "#c0392b", "#c9a227", "#2f8f7a", "#4a90a4", "#8a5fb0",
  "#c97b4a", "#5c8f3a", "#a35fa0", "#3a6fa0", "#a0503a",
];
function colorForCondition(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return CONDITION_COLORS[Math.abs(hash) % CONDITION_COLORS.length];
}

function parseConditions(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function isDead(entry: InitiativeEntry): boolean {
  return entry.dead === true || entry.dead === 1;
}

function rollCreatureHp(hp: DndCreatureHitPoints): number | null {
  if (hp.diceCount && hp.dieSize) {
    const bonus = hp.bonus ?? 0;
    const formula = `${hp.diceCount}к${hp.dieSize}${bonus >= 0 ? "+" : ""}${bonus}`;
    return rollDiceFormula(formula);
  }
  if (hp.formula) return rollDiceFormula(hp.formula);
  return null;
}

interface Props {
  sessionId: number;
}

export function InitiativeTracker({ sessionId }: Props) {
  const [entries, setEntries] = useState<InitiativeEntry[]>([]);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [rollingId, setRollingId] = useState<number | null>(null);
  const [hpErrorId, setHpErrorId] = useState<number | null>(null);
  const [confirmRerollId, setConfirmRerollId] = useState<number | null>(null);
  const [hpEditId, setHpEditId] = useState<number | null>(null);
  const [hpAmount, setHpAmount] = useState("");
  const [conditionPickerFor, setConditionPickerFor] = useState<number | null>(null);
  const [conditionOptions, setConditionOptions] = useState<{ id: number; name: string }[]>([]);
  const { playPlaylist } = useAudioPlayer();

  function load() {
    api.get<InitiativeEntry[]>(`/initiative-entries?session_id=${sessionId}`).then(setEntries);
  }
  function loadSession() {
    api.get<SessionDetail>(`/sessions/${sessionId}`).then(setSession);
  }
  useEffect(load, [sessionId]);
  useEffect(loadSession, [sessionId]);
  useEffect(() => {
    findDndSystemId().then((systemId) => {
      if (!systemId) return;
      loadDndMechanicsGroup(systemId, "Состояния").then(setConditionOptions);
    });
  }, []);

  // Resolves everything a dropped/re-rolled entity needs from its dnd
  // statblock in one fetch — dex modifier (for tie-breaking) and hit points
  // (creatures roll from hit-dice fields via diceRoll.ts; characters already
  // carry a flat max-HP number, nothing to roll).
  async function resolveStatblockInfo(
    type: string,
    id: number
  ): Promise<{ dexModifier: number; maxHp: number | null; currentHp: number | null }> {
    if (type !== "being" && type !== "character" && type !== "compendium_entry")
      return { dexModifier: 0, maxHp: null, currentHp: null };
    try {
      const rows = await api.get<Statblock[]>(`/statblocks?owner_type=${type}&owner_id=${id}`);
      const dnd = rows.find((s) => s.format === "dnd_character" || s.format === "dnd_creature");
      if (!dnd) return { dexModifier: 0, maxHp: null, currentHp: null };
      const parsed = parseDndStatblock(dnd);
      const dexModifier = abilityModifier(parsed.abilities.dex);
      if (dnd.format === "dnd_creature") {
        const max = rollCreatureHp((parsed as DndCreatureData).hitPoints);
        return { dexModifier, maxHp: max, currentHp: max };
      }
      const max = Number((parsed as DndCharacterData).hitPointMax) || null;
      return { dexModifier, maxHp: max, currentHp: max };
    } catch {
      return { dexModifier: 0, maxHp: null, currentHp: null };
    }
  }

  function pickName(baseName: string): string {
    const sameBase = entries.filter(
      (e) => e.name === baseName || e.name.endsWith(` ${baseName}`)
    );
    if (sameBase.length === 0) return baseName;
    if (!loadUseEpithets()) return `${baseName} (${sameBase.length + 1})`;
    const usedEpithets = new Set(
      sameBase
        .map((e) => (e.name === baseName ? null : e.name.slice(0, -(baseName.length + 1))))
        .filter((e): e is string => e !== null)
    );
    const available = INITIATIVE_EPITHETS.filter((ep) => !usedEpithets.has(ep));
    if (available.length === 0) return `${baseName} (${sameBase.length + 1})`;
    const epithet = available[Math.floor(Math.random() * available.length)];
    return `${epithet} ${baseName}`;
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const result: SearchResult = JSON.parse(raw);
    if (!ACCEPT_TYPES.includes(result.type)) return;
    const [info, name] = await Promise.all([
      resolveStatblockInfo(result.type, result.id),
      Promise.resolve(pickName(result.title)),
    ]);
    await api.post("/initiative-entries", {
      session_id: sessionId,
      entity_type: result.type,
      entity_id: result.id,
      name,
      dex_modifier: info.dexModifier,
      max_hp: info.maxHp,
      current_hp: info.currentHp,
    });
    load();
  }

  async function updateInitiative(id: number, initiative: number | null) {
    await api.put(`/initiative-entries/${id}`, { initiative });
    load();
  }

  async function remove(id: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    await api.del(`/initiative-entries/${id}`);
    load();
  }

  async function clearAll() {
    await api.del(`/initiative-entries?session_id=${sessionId}`);
    load();
  }

  async function rerollHp(entry: InitiativeEntry) {
    if (!entry.entity_type || !entry.entity_id) return;
    setRollingId(entry.id);
    setHpErrorId(null);
    try {
      const info = await resolveStatblockInfo(entry.entity_type, entry.entity_id);
      if (info.maxHp == null) {
        setHpErrorId(entry.id);
        return;
      }
      await api.put(`/initiative-entries/${entry.id}`, { max_hp: info.maxHp, current_hp: info.maxHp });
      load();
    } finally {
      setRollingId(null);
    }
  }

  async function toggleDead(entry: InitiativeEntry) {
    await api.put(`/initiative-entries/${entry.id}`, { dead: !isDead(entry) });
    load();
  }

  async function toggleCondition(entry: InitiativeEntry, name: string) {
    const current = parseConditions(entry.conditions);
    const next = current.includes(name) ? current.filter((c) => c !== name) : [...current, name];
    await api.put(`/initiative-entries/${entry.id}`, { conditions: next });
    load();
  }

  function closeHpEditor() {
    setHpEditId(null);
    setHpAmount("");
  }

  // Temp HP absorbs damage first (standard 5e rule) — whatever's left over
  // after the temp pool is exhausted comes out of current HP, floored at 0.
  async function applyDamage(entry: InitiativeEntry) {
    const amount = Number(hpAmount);
    if (!amount || amount < 0) return;
    const temp = entry.temp_hp ?? 0;
    const fromTemp = Math.min(temp, amount);
    const remaining = amount - fromTemp;
    const current = entry.current_hp ?? entry.max_hp ?? 0;
    await api.put(`/initiative-entries/${entry.id}`, {
      temp_hp: temp - fromTemp,
      current_hp: Math.max(0, current - remaining),
    });
    closeHpEditor();
    load();
  }

  async function applyHeal(entry: InitiativeEntry) {
    const amount = Number(hpAmount);
    if (!amount || amount < 0) return;
    const current = entry.current_hp ?? 0;
    const capped = entry.max_hp != null ? Math.min(entry.max_hp, current + amount) : current + amount;
    await api.put(`/initiative-entries/${entry.id}`, { current_hp: capped });
    closeHpEditor();
    load();
  }

  async function applyTempHp(entry: InitiativeEntry) {
    const amount = Number(hpAmount);
    if (!amount || amount < 0) return;
    await api.put(`/initiative-entries/${entry.id}`, { temp_hp: (entry.temp_hp ?? 0) + amount });
    closeHpEditor();
    load();
  }

  const sorted = useMemo(() => {
    // Finite sentinel, not -Infinity: subtracting two -Infinity values (both
    // entries with no initiative set yet) produces NaN, and Array.sort
    // treats a NaN comparator result as "equal", silently skipping the
    // dex/name tie-breakers below and leaving entries in insertion order.
    const NO_INITIATIVE = -1_000_000;
    function cmp(a: InitiativeEntry, b: InitiativeEntry) {
      const initDiff = (b.initiative ?? NO_INITIATIVE) - (a.initiative ?? NO_INITIATIVE);
      if (initDiff !== 0) return initDiff;
      const dexDiff = b.dex_modifier - a.dex_modifier;
      if (dexDiff !== 0) return dexDiff;
      const nameDiff = a.name.localeCompare(b.name, "ru");
      if (nameDiff !== 0) return nameDiff;
      return a.id - b.id;
    }
    const alive = entries.filter((e) => !isDead(e)).sort(cmp);
    const dead = entries.filter((e) => isDead(e)).sort(cmp);
    return [...alive, ...dead];
  }, [entries]);

  const aliveSorted = useMemo(() => sorted.filter((e) => !isDead(e)), [sorted]);

  async function setCombat(active: boolean, turnEntryId: number | null) {
    await api.put(`/sessions/${sessionId}/combat`, { active, turn_entry_id: turnEntryId });
    loadSession();
  }

  async function startCombat() {
    if (aliveSorted.length === 0) return;
    await setCombat(true, aliveSorted[0].id);
    if (session?.battle_playlist_id) {
      const detail = await api.get<PlaylistDetail>(`/playlists/${session.battle_playlist_id}`);
      const tracks: AudioTrack[] = detail.items
        .filter((it) => it.src)
        .map((it) => ({ id: it.resource_id, name: it.name, src: it.src! }));
      if (tracks.length) playPlaylist(tracks, 0, session.battle_playlist_id);
    }
  }

  function stopCombat() {
    setCombat(false, null);
  }

  function step(delta: 1 | -1) {
    if (aliveSorted.length === 0) return;
    const i = aliveSorted.findIndex((e) => e.id === session?.combat_turn_entry_id);
    const from = i === -1 ? 0 : i;
    const next = aliveSorted[(from + delta + aliveSorted.length) % aliveSorted.length];
    setCombat(true, next.id);
  }

  return (
    <div
      className={`drop-zone stack${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong>Трекер инициативы</strong>
        {entries.length > 0 && (
          <button type="button" className="comp-mini" onClick={clearAll}>
            Очистить
          </button>
        )}
      </div>
      <div className="row" style={{ justifyContent: "center", gap: 4 }}>
        <button
          type="button"
          className="comp-mini"
          onClick={() => step(-1)}
          disabled={!session?.combat_active || aliveSorted.length === 0}
          title="Предыдущий"
        >
          <NavIcon name="arrowRight" className="nav-icon icon-flip-x" />
        </button>
        {session?.combat_active ? (
          <button type="button" onClick={stopCombat}>
            Завершить
          </button>
        ) : (
          <button type="button" onClick={startCombat} disabled={aliveSorted.length === 0}>
            Старт
          </button>
        )}
        <button
          type="button"
          className="comp-mini"
          onClick={() => step(1)}
          disabled={!session?.combat_active || aliveSorted.length === 0}
          title="Следующий"
        >
          <NavIcon name="arrowRight" />
        </button>
      </div>
      {entries.length === 0 && (
        <span className="muted">Перетащите сюда существо или персонажа</span>
      )}
      <div className="stack" style={{ gap: 4 }}>
        {sorted.map((entry) => {
          const dead = isDead(entry);
          const conditions = parseConditions(entry.conditions);
          const hpPct =
            entry.max_hp && entry.max_hp > 0
              ? Math.max(0, Math.min(100, (100 * (entry.current_hp ?? entry.max_hp)) / entry.max_hp))
              : null;
          return (
            <div
              key={entry.id}
              className={`initiative-tile${
                session?.combat_active && entry.id === session.combat_turn_entry_id ? " initiative-current" : ""
              }${dead ? " initiative-dead" : ""}`}
            >
              {conditions.length > 0 && (
                <div className="initiative-conditions">
                  {conditions.map((c) => (
                    <span
                      key={c}
                      className="initiative-condition-chip"
                      style={{ background: colorForCondition(c) }}
                      title={c}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {entry.name}
                </span>
                {editingId === entry.id ? (
                  <input
                    type="number"
                    autoFocus
                    defaultValue={entry.initiative ?? ""}
                    style={{ width: 56 }}
                    onBlur={(e) => {
                      updateInitiative(entry.id, e.target.value === "" ? null : Number(e.target.value));
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={() => setEditingId(entry.id)}
                    title="Двойной клик — изменить"
                    style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    {entry.initiative ?? "—"}
                    <span className="muted" style={{ fontSize: "0.8em" }}>
                      {" "}
                      · {formatModifier(entry.dex_modifier)}
                    </span>
                  </span>
                )}
                <div className="row initiative-actions" style={{ gap: 2 }}>
                  {/* Ticket 10 (icons: shared components): 💀/😐/♥/⚠ below are
                      kept as emoji on purpose — they're compact semantic
                      pictograms (dead/conditions/roll-HP/HP-error) for a dense
                      action row, not generic close/edit/delete chrome, and the
                      drawn icon set has no skull/heart/face equivalents. Only
                      the plain ✕ remove/close buttons in this row were
                      converted to the shared NavIcon delete/close icons. */}
                  <button type="button" className="comp-mini" title="Отметить мёртвым" onClick={() => toggleDead(entry)}>
                    💀
                  </button>
                  <button
                    type="button"
                    className="comp-mini"
                    title="Состояния"
                    onClick={() => setConditionPickerFor((v) => (v === entry.id ? null : entry.id))}
                  >
                    😐
                  </button>
                  {(entry.entity_type === "being" || entry.entity_type === "compendium_entry") &&
                    confirmRerollId !== entry.id && (
                    <button
                      type="button"
                      className="comp-mini"
                      title={
                        hpErrorId === entry.id
                          ? "Не удалось определить ХП — у существа не задана формула хит-костей в статблоке"
                          : "Бросить ХП"
                      }
                      style={hpErrorId === entry.id ? { color: "var(--danger, #c0392b)" } : undefined}
                      disabled={rollingId === entry.id}
                      onClick={() => {
                        if (entry.max_hp != null) setConfirmRerollId(entry.id);
                        else rerollHp(entry);
                      }}
                    >
                      {hpErrorId === entry.id ? "⚠" : "♥"}
                    </button>
                  )}
                  {confirmRerollId === entry.id && (
                    <span className="row" style={{ gap: 2, alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: "0.8em" }}>
                        Уверены?
                      </span>
                      <button
                        type="button"
                        className="comp-mini"
                        title="Да, перебросить"
                        onClick={() => {
                          setConfirmRerollId(null);
                          rerollHp(entry);
                        }}
                      >
                        Да
                      </button>
                      <button
                        type="button"
                        className="comp-mini"
                        title="Отмена"
                        onClick={() => setConfirmRerollId(null)}
                      >
                        Нет
                      </button>
                    </span>
                  )}
                  <button type="button" className="comp-mini" title="Убрать" onClick={() => remove(entry.id)}>
                    <NavIcon name="delete" />
                  </button>
                </div>
              </div>
              {conditionPickerFor === entry.id && (
                <div className="initiative-condition-picker stack">
                  {conditionOptions.length === 0 && <span className="muted">Состояния не найдены в компендиуме</span>}
                  {conditionOptions.map((c) => (
                    <label key={c.id} className="row" style={{ gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={conditions.includes(c.name)}
                        onChange={() => toggleCondition(entry, c.name)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
              {hpPct != null && (
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <span className="muted" style={{ fontSize: "0.8em", whiteSpace: "nowrap" }}>
                    ХП: {entry.current_hp ?? "—"} / {entry.max_hp}
                    {entry.temp_hp ? ` (+${entry.temp_hp})` : ""}
                  </span>
                  <div
                    className="initiative-hp-bar-track"
                    style={{ flex: 1, cursor: "pointer" }}
                    title="Изменить ХП"
                    onClick={() => {
                      setHpEditId(entry.id);
                      setHpAmount("");
                    }}
                  >
                    <div className="initiative-hp-bar-fill" style={{ width: `${hpPct}%` }} />
                    {entry.max_hp && entry.temp_hp ? (
                      <div
                        className="initiative-hp-bar-temp"
                        style={{ width: `${Math.min(100, (100 * entry.temp_hp) / entry.max_hp)}%` }}
                      />
                    ) : null}
                  </div>
                </div>
              )}
              {hpEditId === entry.id && (
                <div className="initiative-hp-editor row" style={{ gap: 4, alignItems: "center" }}>
                  <input
                    type="number"
                    autoFocus
                    placeholder="Кол-во"
                    value={hpAmount}
                    onChange={(e) => setHpAmount(e.target.value)}
                    style={{ width: 64 }}
                  />
                  <button type="button" className="comp-mini" onClick={() => applyDamage(entry)}>
                    Урон
                  </button>
                  <button type="button" className="comp-mini" onClick={() => applyHeal(entry)}>
                    Лечение
                  </button>
                  <button type="button" className="comp-mini" onClick={() => applyTempHp(entry)}>
                    +Врем. ХП
                  </button>
                  <button type="button" className="comp-mini" title="Закрыть" onClick={closeHpEditor}>
                    <NavIcon name="close" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
